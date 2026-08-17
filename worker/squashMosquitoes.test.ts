import {
  PREROUND_MS,
  SQUASH_GRID_CELLS,
  SQUASH_MAX_PLAYERS,
  SQUASH_MIN_PLAYERS,
  SQUASH_ROUND_CAP_MS,
  SQUASH_TOTAL,
  type ServerMessage,
} from '../shared/protocol';
import {
  nextDeadline,
  onSquashTap,
  startSquash,
  tick,
  type Ctx,
  type Squash,
} from './squashMosquitoes';

/**
 * Squash Mosquitoes' referee.
 * Spec: docs/specs/games/squash-mosquitoes.md
 *
 * Three rules carry the whole game, and each one fails silently if it is wrong:
 *
 * 1. **Every squash pays for the next two.** Miss this and the swarm never grows, or
 *    grows from the wrong index, and the difficulty curve the whole spec is built on
 *    is gone without a single test failing to compile.
 * 2. **A board is private.** The `squash` broadcast must never carry another player's
 *    active or squashed indices — only a count. `squash-board` goes to one player only.
 * 3. **First to 66 ends the round for everybody**, immediately — not first to *spawn*
 *    66, first to *squash* 66.
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

/** A tiny, fixed PRNG so every run shuffles the pattern the same way. */
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
  let stored: Squash | null = null;
  const sent: ServerMessage[] = [];
  const rand = seeded(42);

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    random: rand,
    broadcast: (m) => void sent.push(m),
    sendTo: (id, m) => void sent.push({ ...m, to: id } as unknown as ServerMessage),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as Squash) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as Squash;
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
    /** The last public `squash` broadcast — never a specific player's board. */
    last: () =>
      [...sent].reverse().find((m) => m.t === 'squash') as
        | Extract<ServerMessage, { t: 'squash' }>
        | undefined,
    /** Every private `squash-board` sent to `id`, in order. */
    boardsFor: (id: string) =>
      sent.filter(
        (m): m is Extract<ServerMessage, { t: 'squash-board' }> & { to: string } =>
          m.t === 'squash-board' && (m as { to?: string }).to === id,
      ),
    clear: () => void (sent.length = 0),
  };
}

/** Start a round and clear the start-up broadcast so a test sees only its own taps. */
async function running(players: string[] = [A, B]) {
  const h = harness();
  await startSquash(h.ctx, 1, players);
  h.advance(PREROUND_MS + 1);
  h.clear();
  return h;
}

/* ---------------------------------------------------------------- */

async function seating(): Promise<void> {
  console.log('\nseating and the pattern');
  const h = harness();

  check(`${SQUASH_MIN_PLAYERS} is allowed`, await startSquash(h.ctx, 1, [A, B]));
  check('1 player is refused', !(await startSquash(harness().ctx, 1, [A])));
  check(
    `${SQUASH_MAX_PLAYERS + 1} players are refused`,
    !(await startSquash(harness().ctx, 1, Array.from({ length: SQUASH_MAX_PLAYERS + 1 }, (_, i) => `p-${i}`))),
  );

  const s = h.state()!;
  check('the pattern has 66 entries', s.pattern.length === SQUASH_TOTAL, s.pattern.length);
  check(
    'every entry is a distinct, valid cell',
    new Set(s.pattern).size === SQUASH_TOTAL &&
      s.pattern.every((p) => Number.isInteger(p) && p >= 0 && p < SQUASH_GRID_CELLS),
  );
  check('both boards start on the same first mosquito', s.boards[A]?.active.join() === s.boards[B]?.active.join());
  check('everyone starts at nil squashed', s.boards[A]?.squashed.length === 0);

  const solo = harness();
  check('solo test mode allows one', await startSquash(solo.ctx, 1, [A], true));
}

async function preRound(): Promise<void> {
  console.log('\nthe rules panel window');
  const h = harness();
  await startSquash(h.ctx, 1, [A, B]);
  const s = h.state()!;
  const cell = s.pattern[0]!;

  await onSquashTap(h.ctx, A, 1, cell);
  check('no squashing while the rules are up', h.state()!.boards[A]!.squashed.length === 0);

  h.advance(PREROUND_MS + 1);
  await onSquashTap(h.ctx, A, 1, cell);
  check('allowed once play begins', h.state()!.boards[A]!.squashed.length === 1);
}

async function spawning(): Promise<void> {
  console.log('\nevery squash pays for the next two');
  const h = await running();
  const pattern = h.state()!.pattern;

  check('one mosquito to start', h.state()!.boards[A]!.active.join() === '0');

  await onSquashTap(h.ctx, A, 1, pattern[0]!);
  const after1 = h.state()!.boards[A]!;
  check('squashed one', after1.squashed.join() === '0', after1.squashed);
  check('and two more spawned', after1.active.slice().sort((x, y) => x - y).join() === '1,2', after1.active);

  await onSquashTap(h.ctx, A, 1, pattern[1]!);
  const after2 = h.state()!.boards[A]!;
  // Each squash removes one and adds two, so the count alive climbs by one every
  // time: 1 to start, 2 after the first squash, 3 after the second.
  check('the count of things alive climbs by one per squash', after2.active.length === 3, after2.active);
  check('nextSpawn has moved on', after2.nextSpawn === 5, after2.nextSpawn);

  check('B is untouched by A squashing', h.state()!.boards[B]!.squashed.length === 0);

  // Tapping empty ground, or a cell that is not yet spawned, does nothing.
  const untouched = h.state()!.boards[A]!.active.length;
  await onSquashTap(h.ctx, A, 1, pattern[10]!); // spawned much later, not active yet
  check('a cell not yet spawned ignores a tap', h.state()!.boards[A]!.active.length === untouched);
}

async function privacy(): Promise<void> {
  console.log('\na board is private');
  const h = await running();
  const pattern = h.state()!.pattern;

  await onSquashTap(h.ctx, A, 1, pattern[0]!);

  const broadcast = h.last()!;
  check('the public frame carries a COUNT', typeof broadcast.d.scores[A] === 'number', broadcast.d.scores);
  check(
    'and nothing that looks like a board',
    !('active' in broadcast.d) && !('squashed' in broadcast.d),
    Object.keys(broadcast.d),
  );

  const mine = h.boardsFor(A);
  check('A is sent A\'s own board', mine.length === 1, mine.length);
  check('with the right shape', mine[0]!.d.board.squashed.join() === '0');

  const theirs = h.boardsFor(B);
  check('B is sent nothing after A\'s tap', theirs.length === 0, theirs.length);
}

async function winning(): Promise<void> {
  console.log('\nfirst to squash all 66 wins, immediately');
  const h = await running();
  const s = h.state()!;

  // Drive A's own board all the way to 66, one legal tap at a time: always tap
  // the lowest active index still alive, which is always squashable because it
  // was spawned strictly in pattern order.
  for (let n = 0; n < SQUASH_TOTAL; n++) {
    const board = h.state()!.boards[A]!;
    if (board.squashed.length >= SQUASH_TOTAL) break;
    const index = Math.min(...board.active);
    await onSquashTap(h.ctx, A, 1, s.pattern[index]!);
  }

  const done = h.state()!;
  check('A squashed all 66', done.boards[A]!.squashed.length === SQUASH_TOTAL);
  check('A is the winner', done.winner === A);
  check('the round is done', done.phase === 'done');

  // The round is over: nothing else moves it.
  const sentBefore = h.sent.length;
  await onSquashTap(h.ctx, B, 1, s.pattern[0]!);
  check('no more taps count once the round is done', h.sent.length === sentBefore);
}

async function capping(): Promise<void> {
  console.log('\nthe safety cap');
  const h = await running([A, B, C]);
  const s = h.state()!;

  // A ahead, B behind, C untouched.
  await onSquashTap(h.ctx, A, 1, s.pattern[0]!);
  await onSquashTap(h.ctx, A, 1, s.pattern[1]!);
  await onSquashTap(h.ctx, B, 1, s.pattern[0]!);

  h.advance(SQUASH_ROUND_CAP_MS + 1);
  const ended = await tick(h.ctx);
  check('the cap ends the round', ended);
  check('whoever squashed the most wins', h.state()!.winner === A, h.state());
  check('the round reports done', h.state()!.phase === 'done');

  // A tie at the cap has no winner.
  const tied = await running([A, B]);
  tied.advance(SQUASH_ROUND_CAP_MS + 1);
  await tick(tied.ctx);
  check('nobody squashed anything: a tie, no winner', tied.state()!.winner === null);
}

async function cheating(): Promise<void> {
  console.log('\nclamping and stale rounds');
  const h = await running();
  const s = h.state()!;

  await onSquashTap(h.ctx, A, 99, s.pattern[0]!);
  check('a stale roundId is ignored', h.state()!.boards[A]!.squashed.length === 0);

  await onSquashTap(h.ctx, A, 1, -1);
  await onSquashTap(h.ctx, A, 1, SQUASH_GRID_CELLS);
  await onSquashTap(h.ctx, A, 1, 1.5);
  check('out-of-range and non-integer cells are ignored', h.state()!.boards[A]!.squashed.length === 0);

  const notInPattern = [...Array(SQUASH_GRID_CELLS).keys()].find((c) => !s.pattern.includes(c))!;
  await onSquashTap(h.ctx, A, 1, notInPattern);
  check('a cell outside the pattern entirely is ignored', h.state()!.boards[A]!.squashed.length === 0);

  await onSquashTap(h.ctx, A, 1, s.pattern[5]!); // not yet spawned
  check('a cell not yet spawned is ignored', h.state()!.boards[A]!.squashed.length === 0);

  await onSquashTap(h.ctx, A, 1, s.pattern[0]!);
  const before = h.state()!.boards[A]!.squashed.length;
  await onSquashTap(h.ctx, A, 1, s.pattern[0]!); // already squashed
  check('squashing the same one twice does nothing the second time', h.state()!.boards[A]!.squashed.length === before);

  check('nextDeadline is the cap while running', nextDeadline(h.state()!) === h.state()!.endsAt);
}

for (const t of [seating, preRound, spawning, privacy, winning, capping, cheating]) {
  await t();
}

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
