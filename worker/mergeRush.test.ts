import {
  MERGE_COUNTDOWN_MS,
  MERGE_MAX_PLAYERS,
  MERGE_REPORT_GRACE_MS,
  MERGE_ROUND_MS,
  type ServerMessage,
} from '../shared/protocol';
import { mass, maxMoves, maxScore, newGame, startBoard, step, DIRS, type Dir, type Game } from '../shared/merge';
import { nextDeadline, onMergeBoard, onPlayerGone, startMergeRush, tick, toState, type Ctx, type MergeRush } from './mergeRush';

/**
 * Merge Rush's referee. Spec: docs/specs/games/merge-rush.md §6-§8
 *
 * The moves happen on the phones. What is asserted here is what this file owns:
 * the shared seed, what it believes of a report, the clock and the winner.
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

function harness(randoms: number[] = [0.123456]) {
  let clock = 9_000_000;
  let seq = 0;
  let r = 0;
  let stored: MergeRush | null = null;
  const sent: ServerMessage[] = [];
  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as MergeRush) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as MergeRush;
    },
    setAlarm: async () => {},
    random: () => randoms[r++ % randoms.length] as number,
  };
  return {
    ctx,
    sent,
    get now() {
      return clock;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    state: () => stored as MergeRush,
  };
}

/** A real game of `n` moves from a seed, as a phone would report it. */
function played(seed: number, n: number): Game {
  let g = newGame(seed);
  for (let i = 0; i < n * 3 && g.moves < n; i++) g = step(g, DIRS[i % 4] as Dir, seed).game;
  return g;
}

async function starting(): Promise<void> {
  console.log('\nstarting a round (§2.1, §6)');
  const h = harness([0.5]);
  check('two players start', await startMergeRush(h.ctx, 1, [A, B]));
  const s = h.state();
  check('the first move is after the countdown', s.startsAt === h.now + MERGE_COUNTDOWN_MS);
  check('the cap is the round plus the grace', nextDeadline(s) === s.startsAt + MERGE_ROUND_MS + MERGE_REPORT_GRACE_MS);
  check('there is a seed', Number.isInteger(s.seed) && s.seed >= 0);
  const begin = JSON.stringify(startBoard(s.seed));
  check('everyone starts on the same board', JSON.stringify(s.boards[A]?.board) === begin && JSON.stringify(s.boards[B]?.board) === begin);
  check('which is the seed\'s own starting board', JSON.stringify(toState(s).boards[A]?.board) === begin);
  check('at zero', s.boards[A]?.score === 0 && s.boards[A]?.moves === 0 && s.boards[A]?.over === false);
  check('and the room was told', h.sent.some((m) => m.t === 'merge-rush'));

  const other = harness([0.9]);
  await startMergeRush(other.ctx, 1, [A, B]);
  check('a different draw is a different seed', other.state().seed !== s.seed);

  const alone = harness();
  check('one player alone is a round', await startMergeRush(alone.ctx, 1, [A]));
  check('and a solo one', alone.state().solo);
  const crowd = Array.from({ length: MERGE_MAX_PLAYERS + 1 }, (_, i) => `p${i}`);
  check('nine cannot start', !(await startMergeRush(harness().ctx, 1, crowd)));
}

async function reporting(): Promise<void> {
  console.log('\na report is believed only as far as the rules allow (§8)');
  const h = harness();
  await startMergeRush(h.ctx, 1, [A, B, C]);
  const seed = h.state().seed;
  const g = played(seed, 40);
  h.advance(MERGE_COUNTDOWN_MS + 30_000);

  await onMergeBoard(h.ctx, A, 1, g.board, g.score, g.moves, false);
  const a = h.state().boards[A];
  check('an honest report is taken as it is', a?.score === g.score && a?.moves === g.moves && JSON.stringify(a?.board) === JSON.stringify(g.board), a);
  check('and broadcast', h.sent.filter((m) => m.t === 'merge-rush').length >= 2);

  await onMergeBoard(h.ctx, A, 1, g.board, 1, 1, false);
  check('score and moves never go down', h.state().boards[A]?.score === g.score && h.state().boards[A]?.moves === g.moves);

  const startMass = mass(startBoard(seed));
  await onMergeBoard(h.ctx, B, 1, g.board, 99_999_999, g.moves, false);
  check('a score past the bound is clipped to it', h.state().boards[B]?.score === maxScore(startMass, g.moves), h.state().boards[B]);

  await onMergeBoard(h.ctx, C, 1, g.board, g.score, 5_000_000, false);
  check('more moves than a thumb makes are clipped to the clock', h.state().boards[C]?.moves === maxMoves(30_000), h.state().boards[C]);

  const before = JSON.stringify(h.state().boards[A]?.board);
  await onMergeBoard(h.ctx, A, 1, new Array(16).fill(17), g.score, g.moves, false);
  check('a board holding more than the moves could build is ignored', JSON.stringify(h.state().boards[A]?.board) === before);
  await onMergeBoard(h.ctx, A, 1, [1, 2, 3], g.score, g.moves, false);
  check('as is one that is not a board', JSON.stringify(h.state().boards[A]?.board) === before);
  await onMergeBoard(h.ctx, A, 1, g.board, Number.NaN, 'lots', false);
  check('nonsense is zero, not a crash', h.state().boards[A]?.score === g.score);

  await onMergeBoard(h.ctx, A, 2, g.board, 1, 1, false);
  await onMergeBoard(h.ctx, 'stranger', 1, g.board, 1, 1, false);
  check('a stale round and a stranger are ignored', !('stranger' in h.state().boards));

  const early = harness();
  await startMergeRush(early.ctx, 1, [A, B]);
  const gg = played(early.state().seed, 60);
  await onMergeBoard(early.ctx, A, 1, gg.board, gg.score, gg.moves, false);
  check('sixty moves before the first one are clipped to one', early.state().boards[A]?.moves === 1, early.state().boards[A]);

  await onMergeBoard(h.ctx, A, 1, g.board, g.score, g.moves, true);
  check('over is taken', h.state().boards[A]?.over === true);
  await onMergeBoard(h.ctx, A, 1, g.board, g.score + 500, g.moves, false);
  check('and once over, a phone stays over and its score stands', h.state().boards[A]?.over === true && h.state().boards[A]?.score === g.score);
}

async function ending(): Promise<void> {
  console.log('\nhow a round ends (§2, §7)');
  const h = harness();
  await startMergeRush(h.ctx, 1, [A, B]);
  const seed = h.state().seed;
  const hi = played(seed, 80);
  const lo = played(seed, 20);
  h.advance(MERGE_COUNTDOWN_MS + MERGE_ROUND_MS);
  await onMergeBoard(h.ctx, A, 1, hi.board, hi.score, hi.moves, false);
  await onMergeBoard(h.ctx, B, 1, lo.board, lo.score, lo.moves, false);
  check('reports alone do not end a round that is still on the clock', h.state().phase === 'playing');
  check('an early tick does nothing', !(await tick(h.ctx)));
  h.advance(MERGE_REPORT_GRACE_MS);
  check('the cap ends it', await tick(h.ctx));
  check('the highest score wins', h.state().winner === A && hi.score > lo.score, { hi: hi.score, lo: lo.score });
  check('nextDeadline is never once done', nextDeadline(h.state()) === Infinity);
  await onMergeBoard(h.ctx, B, 1, hi.board, hi.score, hi.moves, false);
  check('a report after the end is ignored', h.state().boards[B]?.score === lo.score);

  const stuck = harness();
  await startMergeRush(stuck.ctx, 1, [A, B]);
  stuck.advance(MERGE_COUNTDOWN_MS + 40_000);
  const s1 = played(stuck.state().seed, 30);
  await onMergeBoard(stuck.ctx, A, 1, s1.board, s1.score, s1.moves, true);
  check('one phone being stuck does not end the round', stuck.state().phase === 'playing');
  await onMergeBoard(stuck.ctx, B, 1, s1.board, s1.score, s1.moves, true);
  check('everyone stuck ends it early', stuck.state().phase === 'done');
  check('a dead heat goes to the first to join', stuck.state().winner === A);

  const left = harness();
  await startMergeRush(left.ctx, 1, [A, B]);
  left.advance(MERGE_COUNTDOWN_MS + 60_000);
  const keep = played(left.state().seed, 50);
  await onMergeBoard(left.ctx, A, 1, keep.board, keep.score, keep.moves, false);
  await onPlayerGone(left.ctx, A);
  check('a player leaving stops holding the round open only once everyone is done', left.state().phase === 'playing');
  await onPlayerGone(left.ctx, B);
  check('everyone gone ends it', left.state().phase === 'done');
  check('and the leaver\'s score still wins', left.state().winner === A && left.state().boards[A]?.score === keep.score);

  const solo = harness();
  await startMergeRush(solo.ctx, 1, [A], true);
  solo.advance(MERGE_COUNTDOWN_MS + 10_000);
  const one = played(solo.state().seed, 10);
  await onMergeBoard(solo.ctx, A, 1, one.board, one.score, one.moves, true);
  check('solo ends on the one phone being done', solo.state().phase === 'done');
  check('and the one player wins', solo.state().winner === A && solo.state().solo);

  const nobody = harness();
  await startMergeRush(nobody.ctx, 1, [A, B]);
  nobody.advance(MERGE_COUNTDOWN_MS + MERGE_ROUND_MS + MERGE_REPORT_GRACE_MS);
  await tick(nobody.ctx);
  check('nobody moving still ends with a winner: the first to join', nobody.state().phase === 'done' && nobody.state().winner === A);
}

async function tieBreaks(): Promise<void> {
  console.log('\nthe best score always wins (§2)');
  const h = harness();
  await startMergeRush(h.ctx, 1, [A, B, C]);
  const seed = h.state().seed;
  const g = played(seed, 40);
  const slow = played(seed, 41);
  h.advance(MERGE_COUNTDOWN_MS + 60_000);
  await onMergeBoard(h.ctx, A, 1, slow.board, g.score, slow.moves, true);
  await onMergeBoard(h.ctx, B, 1, g.board, g.score, g.moves, true);
  await onMergeBoard(h.ctx, C, 1, g.board, 0, g.moves, true);
  const e = h.state().boards;
  check('two players on the same score', e[A]?.score === e[B]?.score && (e[A]?.score ?? 0) > 0, { a: e[A]?.score, b: e[B]?.score });
  check('the one who needed fewer moves wins it', h.state().winner === B, { a: e[A]?.moves, b: e[B]?.moves, winner: h.state().winner });

  const z = harness();
  await startMergeRush(z.ctx, 1, [A, B]);
  z.advance(MERGE_COUNTDOWN_MS + 30_000);
  const lo = played(z.state().seed, 10);
  const hi = played(z.state().seed, 70);
  await onMergeBoard(z.ctx, A, 1, lo.board, lo.score, lo.moves, true);
  await onMergeBoard(z.ctx, B, 1, hi.board, hi.score, hi.moves, true);
  check('otherwise the higher score wins, whoever joined first', z.state().winner === B);
}

async function wire(): Promise<void> {
  console.log('\nwhat the room sees (§6, §10)');
  const h = harness();
  const ids = Array.from({ length: MERGE_MAX_PLAYERS }, (_, i) => `player-${i}`);
  await startMergeRush(h.ctx, 1, ids);
  const g = played(h.state().seed, 150);
  h.advance(MERGE_COUNTDOWN_MS + 100_000);
  for (const id of ids) await onMergeBoard(h.ctx, id, 1, g.board, g.score, g.moves, false);
  const bytes = JSON.stringify(toState(h.state())).length;
  check(`a full room's frame is small (${bytes} bytes)`, bytes < 3000, bytes);
  check('an entry is a board and three small values', Object.keys(toState(h.state()).boards['player-0']!).sort().join() === 'board,moves,over,score');
}

await starting();
await reporting();
await ending();
await tieBreaks();
await wire();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
