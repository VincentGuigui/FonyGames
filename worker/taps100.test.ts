import {
  PREROUND_MS,
  TAPS100_MAX_PLAYERS,
  TAPS100_MIN_PLAYERS,
  TAPS100_ROUND_CAP_MS,
  TAPS100_TOTAL,
  type ServerMessage,
} from '../shared/protocol';
import { nextDeadline, onTaps100, startTaps100, tick, type Ctx, type Taps100 } from './taps100';

/**
 * 100 Taps' referee.
 * Spec: docs/specs/games/100-taps.md
 *
 * Same four rules Tap Tap Music's referee carries, minus the window:
 *
 * 1. **The order is dealt once, shared by everyone**, and every cell in it is used.
 * 2. **Only the exact next number is ever a correct tap** — `order[cleared.length]`,
 *    never a window of candidates, because the board hides nothing.
 * 3. **A miss rewinds to the last checkpoint, not to zero.** Reused unchanged from
 *    Tap Tap Music.
 * 4. **First to clear all 100 ends the round immediately**, for everyone.
 */

let failures = 0;
let checks = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  checks++;
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

const A = 'p-a';
const B = 'p-b';
const C = 'p-c';

/** A tiny, fixed PRNG so every run shuffles the order the same way. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 4_294_967_296;
  };
}

function harness() {
  let clock = 5_000_000;
  let seq = 0;
  let stored: Taps100 | null = null;
  const sent: ServerMessage[] = [];
  const rand = seeded(11);

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    random: rand,
    broadcast: (m) => void sent.push(m),
    sendTo: (id, m) => void sent.push({ ...m, to: id } as unknown as ServerMessage),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as Taps100) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as Taps100;
    },
    setAlarm: async () => {},
  };

  return {
    ctx,
    sent,
    at: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
    state: () => stored,
    last: () =>
      [...sent].reverse().find((m) => m.t === 'taps100') as
        | Extract<ServerMessage, { t: 'taps100' }>
        | undefined,
    progressFor: (id: string) =>
      sent.filter(
        (m): m is Extract<ServerMessage, { t: 'taps100-progress' }> & { to: string } =>
          m.t === 'taps100-progress' && (m as { to?: string }).to === id,
      ),
    clear: () => void (sent.length = 0),
  };
}

/** Start a round and clear the start-up broadcast so a test sees only its own taps. */
async function running(players: string[] = [A, B]) {
  const h = harness();
  await startTaps100(h.ctx, 1, players);
  h.advance(PREROUND_MS + 1);
  h.clear();
  return h;
}

/** This player's own next-due cell right now — the one and only correct tap. */
function nextFor(h: ReturnType<typeof harness>, id: string): number {
  const s = h.state()!;
  return s.order[s.cleared[id]?.length ?? 0]!;
}

/* ---------------------------------------------------------------- */

async function dealing(): Promise<void> {
  console.log('\ndealing the order');
  const h = harness();

  check(`${TAPS100_MIN_PLAYERS} is allowed`, await startTaps100(h.ctx, 1, [A, B]));
  check('1 player is refused', !(await startTaps100(harness().ctx, 1, [A])));
  check(
    `${TAPS100_MAX_PLAYERS + 1} players are refused`,
    !(await startTaps100(harness().ctx, 1, Array.from({ length: TAPS100_MAX_PLAYERS + 1 }, (_, i) => `p-${i}`))),
  );

  const s = h.state()!;
  check('the order has all 100 cells', s.order.length === TAPS100_TOTAL, s.order.length);
  check('every cell appears exactly once', new Set(s.order).size === TAPS100_TOTAL);
  check('everyone starts with nothing cleared', s.cleared[A]!.length === 0 && s.cleared[B]!.length === 0);

  const solo = harness();
  check('solo test mode allows one', await startTaps100(solo.ctx, 1, [A], true));
}

async function preRound(): Promise<void> {
  console.log('\nthe rules panel window');
  const h = harness();
  await startTaps100(h.ctx, 1, [A, B]);
  const next = nextFor(h, A);

  await onTaps100(h.ctx, A, 1, next);
  check('no tapping while the rules are up', h.state()!.cleared[A]!.length === 0);

  h.advance(PREROUND_MS + 1);
  await onTaps100(h.ctx, A, 1, next);
  check('allowed once play begins', h.state()!.cleared[A]!.length === 1);
}

async function onlyTheExactNextIsCorrect(): Promise<void> {
  console.log('\nonly order[cleared.length] is ever correct — no window of candidates');
  const h = await running();
  const order = h.state()!.order;
  const next = nextFor(h, A);

  // Every other cell in the whole board is wrong right now, not just ones "outside a window".
  const someOtherCell = order.find((c) => c !== next)!;
  await onTaps100(h.ctx, A, 1, someOtherCell);
  check('a plausible-looking but wrong cell still misses', h.state()!.cleared[A]!.length === 0);

  await onTaps100(h.ctx, A, 1, next);
  check('the one correct cell advances progress', h.state()!.cleared[A]!.length === 1);
  check('it is the cell actually tapped', h.state()!.cleared[A]![0] === next);

  const secondNext = nextFor(h, A);
  check('the next-due cell moves on to order[1]', secondNext === order[1]);
}

async function correctTaps(): Promise<void> {
  console.log('\na correct tap advances by one; B is untouched by A\'s taps');
  const h = await running();

  await onTaps100(h.ctx, A, 1, nextFor(h, A));
  check('progress advanced', h.state()!.cleared[A]!.length === 1);
  check('B is untouched', h.state()!.cleared[B]!.length === 0);
}

async function alreadyGoneIsAMiss(): Promise<void> {
  console.log('\ntapping an already-cleared cell misses, same as any other wrong cell');
  const h = await running();
  const first = nextFor(h, A);
  await onTaps100(h.ctx, A, 1, first);
  check('one cleared', h.state()!.cleared[A]!.length === 1);

  await onTaps100(h.ctx, A, 1, first); // tap the same, now-gone cell again
  check('tapping it again is a miss, not a no-op', h.state()!.cleared[A]!.length === 0);
}

async function checkpointRewind(): Promise<void> {
  console.log('\na miss rewinds to the last checkpoint, not to zero — undoing the most recently tapped cells');
  const h = await running();

  const tapped: number[] = [];
  for (let i = 0; i < 13; i++) {
    const cell = nextFor(h, A);
    await onTaps100(h.ctx, A, 1, cell);
    tapped.push(cell);
  }
  check('13 correct taps in', h.state()!.cleared[A]!.length === 13);

  // A wrong tap: anything not the current next-due cell.
  const order = h.state()!.order;
  const next = nextFor(h, A);
  const wrong = order.find((c) => c !== next && !tapped.includes(c))!;
  await onTaps100(h.ctx, A, 1, wrong);
  const after = h.state()!.cleared[A]!;
  check('rewound to the checkpoint at 10, not to 0', after.length === 10, after);
  check(
    'the checkpoint kept the FIRST ten taps, in the order they were tapped',
    after.join(',') === tapped.slice(0, 10).join(','),
  );
}

async function checkpointAtExactBoundary(): Promise<void> {
  console.log('\na miss exactly on a checkpoint stays there');
  const h = await running();

  for (let i = 0; i < 10; i++) {
    await onTaps100(h.ctx, A, 1, nextFor(h, A));
  }
  check('exactly at a checkpoint', h.state()!.cleared[A]!.length === 10);

  const order = h.state()!.order;
  const next = nextFor(h, A);
  const cleared = h.state()!.cleared[A]!;
  const wrong = order.find((c) => c !== next && !cleared.includes(c))!;
  await onTaps100(h.ctx, A, 1, wrong);
  check('a miss right at the checkpoint does not go any further back', h.state()!.cleared[A]!.length === 10);
}

async function winning(): Promise<void> {
  console.log('\nfirst to clear all 100 wins, immediately');
  const h = await running();

  for (let i = 0; i < TAPS100_TOTAL; i++) {
    await onTaps100(h.ctx, A, 1, nextFor(h, A));
  }

  const done = h.state()!;
  check('A cleared all 100', done.cleared[A]!.length === TAPS100_TOTAL);
  check('A is the winner', done.winner === A);
  check('the round reports done', done.phase === 'done');
  check('A has a finish time', done.finishedAt[A] !== null);

  const sentBefore = h.sent.length;
  await onTaps100(h.ctx, B, 1, done.order[0]!);
  check('no more taps count once the round is done', h.sent.length === sentBefore);
}

async function finishedPlayerTapsAreNoOps(): Promise<void> {
  console.log('\na finished player tapping again does nothing (round still running for others)');
  const h = await running([A, B, C]);

  for (let i = 0; i < TAPS100_TOTAL; i++) {
    await onTaps100(h.ctx, A, 1, nextFor(h, A));
  }
  check('A finished but the round is done for everyone', h.state()!.phase === 'done');

  const h2 = await running([A, B]);
  for (let i = 0; i < TAPS100_TOTAL - 1; i++) {
    await onTaps100(h2.ctx, A, 1, nextFor(h2, A));
  }
  check('A is one tap from finishing', h2.state()!.cleared[A]!.length === TAPS100_TOTAL - 1);
}

async function capping(): Promise<void> {
  console.log('\nthe safety cap');
  const h = await running([A, B, C]);

  for (let i = 0; i < 40; i++) await onTaps100(h.ctx, A, 1, nextFor(h, A));
  for (let i = 0; i < 20; i++) await onTaps100(h.ctx, B, 1, nextFor(h, B));

  h.advance(TAPS100_ROUND_CAP_MS + 1);
  const ended = await tick(h.ctx);
  check('the cap ends the round', ended);
  check('whoever cleared the most wins', h.state()!.winner === A, h.state());
  check('the round reports done', h.state()!.phase === 'done');

  const tied = await running([A, B]);
  tied.advance(TAPS100_ROUND_CAP_MS + 1);
  await tick(tied.ctx);
  check('nobody tapped anything: a tie, no winner', tied.state()!.winner === null);
}

async function privacy(): Promise<void> {
  console.log('\ncleared history is private; remaining count is public');
  const h = await running();

  await onTaps100(h.ctx, A, 1, nextFor(h, A));

  const broadcast = h.last()!;
  check('the public frame carries remaining COUNTS', typeof broadcast.d.remaining[A] === 'number');
  check(
    'and the order, not anyone\'s cleared history',
    'order' in broadcast.d && !('cleared' in broadcast.d),
  );

  const mine = h.progressFor(A);
  check('A is sent A\'s own cleared history', mine.length === 1 && mine[0]!.d.cleared.length === 1);

  const theirs = h.progressFor(B);
  check('B is sent nothing after A\'s tap', theirs.length === 0);
}

async function cheating(): Promise<void> {
  console.log('\nclamping and stale rounds');
  const h = await running();

  await onTaps100(h.ctx, A, 99, nextFor(h, A));
  check('a stale roundId is ignored', h.state()!.cleared[A]!.length === 0);

  await onTaps100(h.ctx, A, 1, -1);
  await onTaps100(h.ctx, A, 1, TAPS100_TOTAL);
  await onTaps100(h.ctx, A, 1, 1.5);
  check('out-of-range and non-integer cells are ignored', h.state()!.cleared[A]!.length === 0);

  check('nextDeadline is the cap while running', nextDeadline(h.state()!) === h.state()!.endsAt);
}

for (const t of [
  dealing,
  preRound,
  onlyTheExactNextIsCorrect,
  correctTaps,
  alreadyGoneIsAMiss,
  checkpointRewind,
  checkpointAtExactBoundary,
  winning,
  finishedPlayerTapsAreNoOps,
  capping,
  privacy,
  cheating,
]) {
  await t();
}

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
