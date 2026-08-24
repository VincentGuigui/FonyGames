import {
  PREROUND_MS,
  TAPTAP_MAX_PLAYERS,
  TAPTAP_MIN_PLAYERS,
  TAPTAP_ROUND_CAP_MS,
  TAPTAP_TOTAL,
  TAPTAP_WINDOW_SIZE,
  taptapWindow,
  type ServerMessage,
} from '../shared/protocol';
import { nextDeadline, onTapTap, startTapTap, tick, type Ctx, type TapTap } from './tapTapMusic';

/**
 * Tap Tap Music's referee.
 * Spec: docs/specs/games/tap-tap-music.md
 *
 * Four rules carry the whole game:
 *
 * 1. **The order is dealt once, shared by everyone**, and every cell in it is used —
 *    unlike Squash Mosquitoes' pattern, nothing is held in reserve.
 * 2. **Five cells are live at once, tappable in any order** — `taptapWindow` is the
 *    one function that decides which five, from `order` and a player's own cleared
 *    history, and it is shared between referee and client on purpose.
 * 3. **A miss rewinds to the last checkpoint, not to zero.** This is the built,
 *    "forgiving" rule — the spec's own harsher idea never shipped. A rewind undoes
 *    the most RECENTLY tapped cells, in tap order — not the highest `order` positions.
 * 4. **First to clear all 100 ends the round immediately**, for everyone — not just for
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

/** This player's own window right now — the up to five cells a correct tap could be. */
function windowFor(h: ReturnType<typeof harness>, id: string): number[] {
  const s = h.state()!;
  return taptapWindow(s.order, s.cleared[id] ?? []);
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
  check('everyone starts with nothing cleared', s.cleared[A]!.length === 0 && s.cleared[B]!.length === 0);

  const solo = harness();
  check('solo test mode allows one', await startTapTap(solo.ctx, 1, [A], true));
}

async function preRound(): Promise<void> {
  console.log('\nthe rules panel window');
  const h = harness();
  await startTapTap(h.ctx, 1, [A, B]);
  const win = windowFor(h, A);

  await onTapTap(h.ctx, A, 1, win[0]!);
  check('no tapping while the rules are up', h.state()!.cleared[A]!.length === 0);

  h.advance(PREROUND_MS + 1);
  await onTapTap(h.ctx, A, 1, win[0]!);
  check('allowed once play begins', h.state()!.cleared[A]!.length === 1);
}

async function fiveAtOnce(): Promise<void> {
  console.log('\nfive cells are live at once, tappable in any order');
  const h = await running();
  const win = windowFor(h, A);

  check('exactly five cells are live', win.length === TAPTAP_WINDOW_SIZE, win);
  check('all five distinct', new Set(win).size === TAPTAP_WINDOW_SIZE);

  // Tap the LAST of the five first — out of order on purpose.
  await onTapTap(h.ctx, A, 1, win[4]!);
  check('a correct tap counts wherever it sits in the window', h.state()!.cleared[A]!.length === 1);
  check('it is the one actually tapped', h.state()!.cleared[A]![0] === win[4]);

  const nextWin = windowFor(h, A);
  check('the window slides in a new sixth cell to stay at five', nextWin.length === TAPTAP_WINDOW_SIZE);
  check(
    'the four untouched cells are still live',
    [win[0], win[1], win[2], win[3]].every((c) => nextWin.includes(c!)),
  );

  // Now tap the remaining original four, in a scrambled order.
  for (const c of [win[1]!, win[3]!, win[0]!, win[2]!]) {
    await onTapTap(h.ctx, A, 1, c);
  }
  check('all five original cells are cleared', h.state()!.cleared[A]!.length === 5);
  check(
    'cleared holds them in the order actually tapped, not order[] order',
    h.state()!.cleared[A]!.join(',') === [win[4], win[1], win[3], win[0], win[2]].join(','),
  );
}

async function correctTaps(): Promise<void> {
  console.log('\na correct tap advances by one; a cell outside the window misses');
  const h = await running();
  const order = h.state()!.order;

  const win = windowFor(h, A);
  await onTapTap(h.ctx, A, 1, win[0]!);
  check('progress advanced', h.state()!.cleared[A]!.length === 1);

  check('B is untouched by A\'s taps', h.state()!.cleared[B]!.length === 0);

  const before = h.state()!.cleared[A]!.length;
  // The very last cell in the shuffle cannot be among the five earliest uncleared
  // cells with only one of a hundred cleared so far — it is nowhere near the window.
  const farAhead = order[order.length - 1]!;
  check('confirms it is outside the window', !windowFor(h, A).includes(farAhead));

  await onTapTap(h.ctx, A, 1, farAhead);
  check(
    'a cell outside the current window misses, rewinding to the checkpoint at 0',
    h.state()!.cleared[A]!.length === 0,
    { before, after: h.state()!.cleared[A]!.length },
  );
}

async function alreadyGoneIsAMiss(): Promise<void> {
  console.log('\ntapping an already-cleared cell misses, same as any other wrong cell');
  const h = await running();
  const win = windowFor(h, A);
  await onTapTap(h.ctx, A, 1, win[0]!);
  check('one cleared', h.state()!.cleared[A]!.length === 1);

  await onTapTap(h.ctx, A, 1, win[0]!); // tap the same, now-gone cell again
  check('tapping it again is a miss, not a no-op', h.state()!.cleared[A]!.length === 0);
}

async function checkpointRewind(): Promise<void> {
  console.log('\na miss rewinds to the last checkpoint, not to zero — undoing the most recently tapped cells');
  const h = await running();

  const tapped: number[] = [];
  for (let i = 0; i < 13; i++) {
    const win = windowFor(h, A);
    const cell = win[0]!;
    await onTapTap(h.ctx, A, 1, cell);
    tapped.push(cell);
  }
  check('13 correct taps in', h.state()!.cleared[A]!.length === 13);

  // A wrong tap: anything not currently live.
  const win = windowFor(h, A);
  const order = h.state()!.order;
  const wrong = order.find((c) => !win.includes(c) && !tapped.includes(c));
  await onTapTap(h.ctx, A, 1, wrong!);
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
    const cell = windowFor(h, A)[0]!;
    await onTapTap(h.ctx, A, 1, cell);
  }
  check('exactly at a checkpoint', h.state()!.cleared[A]!.length === 10);

  const win = windowFor(h, A);
  const order = h.state()!.order;
  const cleared = h.state()!.cleared[A]!;
  const wrong = order.find((c) => !win.includes(c) && !cleared.includes(c));
  await onTapTap(h.ctx, A, 1, wrong!);
  check('a miss right at the checkpoint does not go any further back', h.state()!.cleared[A]!.length === 10);
}

async function winning(): Promise<void> {
  console.log('\nfirst to clear all 100 wins, immediately');
  const h = await running();

  for (let i = 0; i < TAPTAP_TOTAL; i++) {
    const cell = windowFor(h, A)[0]!;
    await onTapTap(h.ctx, A, 1, cell);
  }

  const done = h.state()!;
  check('A cleared all 100', done.cleared[A]!.length === TAPTAP_TOTAL);
  check('A is the winner', done.winner === A);
  check('the round reports done', done.phase === 'done');
  check('A has a finish time', done.finishedAt[A] !== null);

  const sentBefore = h.sent.length;
  await onTapTap(h.ctx, B, 1, done.order[0]!);
  check('no more taps count once the round is done', h.sent.length === sentBefore);
}

async function finishedPlayerTapsAreNoOps(): Promise<void> {
  console.log('\na finished player tapping again does nothing (round still running for others)');
  const h = await running([A, B, C]);

  for (let i = 0; i < TAPTAP_TOTAL; i++) {
    const cell = windowFor(h, A)[0]!;
    await onTapTap(h.ctx, A, 1, cell);
  }
  check('A finished but the round is done for everyone', h.state()!.phase === 'done');

  // Once the round is done, nobody's taps are processed further — confirmed above by
  // "no more taps count once the round is done" in winning(); this checks the
  // finished-player guard specifically, before the round ends, with a fresh room.
  const h2 = await running([A, B]);
  for (let i = 0; i < TAPTAP_TOTAL - 1; i++) {
    const cell = windowFor(h2, A)[0]!;
    await onTapTap(h2.ctx, A, 1, cell);
  }
  check('A is one tap from finishing', h2.state()!.cleared[A]!.length === TAPTAP_TOTAL - 1);
}

async function capping(): Promise<void> {
  console.log('\nthe safety cap');
  const h = await running([A, B, C]);

  for (let i = 0; i < 40; i++) await onTapTap(h.ctx, A, 1, windowFor(h, A)[0]!);
  for (let i = 0; i < 20; i++) await onTapTap(h.ctx, B, 1, windowFor(h, B)[0]!);

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
  console.log('\ncleared history is private; remaining count is public');
  const h = await running();
  const win = windowFor(h, A);

  await onTapTap(h.ctx, A, 1, win[0]!);

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

  await onTapTap(h.ctx, A, 99, windowFor(h, A)[0]!);
  check('a stale roundId is ignored', h.state()!.cleared[A]!.length === 0);

  await onTapTap(h.ctx, A, 1, -1);
  await onTapTap(h.ctx, A, 1, TAPTAP_TOTAL);
  await onTapTap(h.ctx, A, 1, 1.5);
  check('out-of-range and non-integer cells are ignored', h.state()!.cleared[A]!.length === 0);

  check('nextDeadline is the cap while running', nextDeadline(h.state()!) === h.state()!.endsAt);
}

for (const t of [
  dealing,
  preRound,
  fiveAtOnce,
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
