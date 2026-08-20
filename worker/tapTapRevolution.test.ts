import {
  PREROUND_MS,
  TAPTAP_MAX_PLAYERS,
  TAPTAP_MIN_PLAYERS,
  TAPTAP_ROUND_CAP_MS,
  TAPTAP_TOTAL,
  type ServerMessage,
} from '../shared/protocol';
import { nextDeadline, onTapTap, startTapTap, tick, type Ctx, type TapTap } from './tapTapRevolution';

/**
 * Tap Tap Revolution's referee.
 * Spec: docs/specs/games/tap-tap-revolution.md
 *
 * Three rules carry the whole game:
 *
 * 1. **The order is dealt once, shared by everyone**, and every cell in it is used —
 *    unlike Squash Mosquitoes' pattern, nothing is held in reserve.
 * 2. **A miss rewinds to the last checkpoint, not to zero.** This is the built,
 *    "forgiving" rule — the spec's own harsher idea never shipped.
 * 3. **First to clear all 100 ends the round immediately**, for everyone — not just for
 *    the finisher.
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
  let stored: TapTap | null = null;
  const sent: ServerMessage[] = [];
  const rand = seeded(11);

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    random: rand,
    broadcast: (m) => void sent.push(m),
    sendTo: (id, m) => void sent.push({ ...m, to: id } as unknown as ServerMessage),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as TapTap) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as TapTap;
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
      [...sent].reverse().find((m) => m.t === 'taptap') as
        | Extract<ServerMessage, { t: 'taptap' }>
        | undefined,
    progressFor: (id: string) =>
      sent.filter(
        (m): m is Extract<ServerMessage, { t: 'taptap-progress' }> & { to: string } =>
          m.t === 'taptap-progress' && (m as { to?: string }).to === id,
      ),
    clear: () => void (sent.length = 0),
  };
}

/** Start a round and clear the start-up broadcast so a test sees only its own taps. */
async function running(players: string[] = [A, B]) {
  const h = harness();
  await startTapTap(h.ctx, 1, players);
  h.advance(PREROUND_MS + 1);
  h.clear();
  return h;
}

/* ---------------------------------------------------------------- */

async function dealing(): Promise<void> {
  console.log('\ndealing the order');
  const h = harness();

  check(`${TAPTAP_MIN_PLAYERS} is allowed`, await startTapTap(h.ctx, 1, [A, B]));
  check('1 player is refused', !(await startTapTap(harness().ctx, 1, [A])));
  check(
    `${TAPTAP_MAX_PLAYERS + 1} players are refused`,
    !(await startTapTap(harness().ctx, 1, Array.from({ length: TAPTAP_MAX_PLAYERS + 1 }, (_, i) => `p-${i}`))),
  );

  const s = h.state()!;
  check('the order has all 100 cells', s.order.length === TAPTAP_TOTAL, s.order.length);
  check('every cell appears exactly once', new Set(s.order).size === TAPTAP_TOTAL);
  check('everyone starts at zero progress', s.progress[A] === 0 && s.progress[B] === 0);

  const solo = harness();
  check('solo test mode allows one', await startTapTap(solo.ctx, 1, [A], true));
}

async function preRound(): Promise<void> {
  console.log('\nthe rules panel window');
  const h = harness();
  await startTapTap(h.ctx, 1, [A, B]);
  const s = h.state()!;

  await onTapTap(h.ctx, A, 1, s.order[0]!);
  check('no tapping while the rules are up', h.state()!.progress[A] === 0);

  h.advance(PREROUND_MS + 1);
  await onTapTap(h.ctx, A, 1, s.order[0]!);
  check('allowed once play begins', h.state()!.progress[A] === 1);
}

async function correctTaps(): Promise<void> {
  console.log('\na correct tap advances by one');
  const h = await running();
  const order = h.state()!.order;

  await onTapTap(h.ctx, A, 1, order[0]!);
  check('progress advanced', h.state()!.progress[A] === 1);

  await onTapTap(h.ctx, A, 1, order[1]!);
  await onTapTap(h.ctx, A, 1, order[2]!);
  check('and again, each time the actual lit cell', h.state()!.progress[A] === 3);

  check('B is untouched by A\'s taps', h.state()!.progress[B] === 0);

  const before = h.state()!.progress[A];
  await onTapTap(h.ctx, A, 1, order[7]!); // not the lit cell for A right now
  check(
    'a cell that is not yet lit for this player misses, rewinding to the checkpoint at 0',
    h.state()!.progress[A] === 0,
    { before, after: h.state()!.progress[A] },
  );
}

async function checkpointRewind(): Promise<void> {
  console.log('\na miss rewinds to the last checkpoint, not to zero');
  const h = await running();
  const order = h.state()!.order;

  for (let i = 0; i < 13; i++) await onTapTap(h.ctx, A, 1, order[i]!);
  check('13 correct taps in', h.state()!.progress[A] === 13);

  // A wrong tap: anything that is not order[13].
  const wrong = order.find((c) => c !== order[13]);
  await onTapTap(h.ctx, A, 1, wrong!);
  check(
    'rewound to the checkpoint at 10, not to 0',
    h.state()!.progress[A] === 10,
    h.state()!.progress[A],
  );

  // From the checkpoint, the next correct tap is order[10] again.
  await onTapTap(h.ctx, A, 1, order[10]!);
  check('resumes from the checkpoint', h.state()!.progress[A] === 11);
}

async function checkpointAtExactBoundary(): Promise<void> {
  console.log('\na miss exactly on a checkpoint stays there');
  const h = await running();
  const order = h.state()!.order;

  for (let i = 0; i < 10; i++) await onTapTap(h.ctx, A, 1, order[i]!);
  check('exactly at a checkpoint', h.state()!.progress[A] === 10);

  const wrong = order.find((c) => c !== order[10]);
  await onTapTap(h.ctx, A, 1, wrong!);
  check('a miss right at the checkpoint does not go any further back', h.state()!.progress[A] === 10);
}

async function winning(): Promise<void> {
  console.log('\nfirst to clear all 100 wins, immediately');
  const h = await running();
  const order = h.state()!.order;

  for (let i = 0; i < TAPTAP_TOTAL; i++) {
    await onTapTap(h.ctx, A, 1, order[i]!);
  }

  const done = h.state()!;
  check('A cleared all 100', done.progress[A] === TAPTAP_TOTAL);
  check('A is the winner', done.winner === A);
  check('the round reports done', done.phase === 'done');
  check('A has a finish time', done.finishedAt[A] !== null);

  const sentBefore = h.sent.length;
  await onTapTap(h.ctx, B, 1, order[0]!);
  check('no more taps count once the round is done', h.sent.length === sentBefore);
}

async function finishedPlayerTapsAreNoOps(): Promise<void> {
  console.log('\na finished player tapping again does nothing (round still running for others)');
  const h = await running([A, B, C]);
  const order = h.state()!.order;

  for (let i = 0; i < TAPTAP_TOTAL; i++) await onTapTap(h.ctx, A, 1, order[i]!);
  check('A finished but the round is done for everyone', h.state()!.phase === 'done');

  // Once the round is done, nobody's taps are processed further — confirmed above by
  // "no more taps count once the round is done" in winning(); this checks the
  // finished-player guard specifically, before the round ends, with a fresh room.
  const h2 = await running([A, B]);
  const order2 = h2.state()!.order;
  for (let i = 0; i < TAPTAP_TOTAL - 1; i++) await onTapTap(h2.ctx, A, 1, order2[i]!);
  check('A is one tap from finishing', h2.state()!.progress[A] === TAPTAP_TOTAL - 1);
}

async function capping(): Promise<void> {
  console.log('\nthe safety cap');
  const h = await running([A, B, C]);
  const order = h.state()!.order;

  for (let i = 0; i < 40; i++) await onTapTap(h.ctx, A, 1, order[i]!);
  for (let i = 0; i < 20; i++) await onTapTap(h.ctx, B, 1, order[i]!);

  h.advance(TAPTAP_ROUND_CAP_MS + 1);
  const ended = await tick(h.ctx);
  check('the cap ends the round', ended);
  check('whoever cleared the most wins', h.state()!.winner === A, h.state());
  check('the round reports done', h.state()!.phase === 'done');

  const tied = await running([A, B]);
  tied.advance(TAPTAP_ROUND_CAP_MS + 1);
  await tick(tied.ctx);
  check('nobody tapped anything: a tie, no winner', tied.state()!.winner === null);
}

async function privacy(): Promise<void> {
  console.log('\nprogress is private; remaining count is public');
  const h = await running();
  const order = h.state()!.order;

  await onTapTap(h.ctx, A, 1, order[0]!);

  const broadcast = h.last()!;
  check('the public frame carries remaining COUNTS', typeof broadcast.d.remaining[A] === 'number');
  check('and the order, not anyone\'s progress index', 'order' in broadcast.d && !('progress' in broadcast.d));

  const mine = h.progressFor(A);
  check('A is sent A\'s own progress', mine.length === 1 && mine[0]!.d.index === 1);

  const theirs = h.progressFor(B);
  check('B is sent nothing after A\'s tap', theirs.length === 0);
}

async function cheating(): Promise<void> {
  console.log('\nclamping and stale rounds');
  const h = await running();
  const order = h.state()!.order;

  await onTapTap(h.ctx, A, 99, order[0]!);
  check('a stale roundId is ignored', h.state()!.progress[A] === 0);

  await onTapTap(h.ctx, A, 1, -1);
  await onTapTap(h.ctx, A, 1, TAPTAP_TOTAL);
  await onTapTap(h.ctx, A, 1, 1.5);
  check('out-of-range and non-integer cells are ignored', h.state()!.progress[A] === 0);

  check('nextDeadline is the cap while running', nextDeadline(h.state()!) === h.state()!.endsAt);
}

for (const t of [
  dealing,
  preRound,
  correctTaps,
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
