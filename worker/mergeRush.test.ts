import {
  MERGE_COUNTDOWN_MS,
  MERGE_HIGHLANDER_MS,
  MERGE_MAX_PLAYERS,
  MERGE_RACE_CAP_MS,
  MERGE_TARGET_ENDLESS,
  MERGE_REPORT_GRACE_MS,
  MERGE_ROUND_MS,
  type ServerMessage,
} from '../shared/protocol';
import { mass, maxMoves, maxScore, newGame, puzzle, slide, solveDepth, startBoard, step, tilesLeft, DIRS, type Board, type Dir, type Game } from '../shared/merge';
import { nextDeadline, onMergeBoard, onPlayerGone, startMergeRush, tick, toState, type Ctx, type MergeRush } from './mergeRush';

/**
 * Double Fusion's referee. Spec: docs/specs/games/merge-rush.md §6-§8
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
  check('two players start', await startMergeRush(h.ctx, 1, [A, B], {}));
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
  await startMergeRush(other.ctx, 1, [A, B], {});
  check('a different draw is a different seed', other.state().seed !== s.seed);

  const alone = harness();
  check('one player alone is a round', await startMergeRush(alone.ctx, 1, [A], {}));
  check('and a solo one', alone.state().solo);
  const crowd = Array.from({ length: MERGE_MAX_PLAYERS + 1 }, (_, i) => `p${i}`);
  check('nine cannot start', !(await startMergeRush(harness().ctx, 1, crowd, {})));
}

async function reporting(): Promise<void> {
  console.log('\na report is believed only as far as the rules allow (§8)');
  const h = harness();
  await startMergeRush(h.ctx, 1, [A, B, C], {});
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
  await startMergeRush(early.ctx, 1, [A, B], {});
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
  await startMergeRush(h.ctx, 1, [A, B], {});
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
  await startMergeRush(stuck.ctx, 1, [A, B], {});
  stuck.advance(MERGE_COUNTDOWN_MS + 40_000);
  const s1 = played(stuck.state().seed, 30);
  await onMergeBoard(stuck.ctx, A, 1, s1.board, s1.score, s1.moves, true);
  check('one phone being stuck does not end the round', stuck.state().phase === 'playing');
  await onMergeBoard(stuck.ctx, B, 1, s1.board, s1.score, s1.moves, true);
  check('everyone stuck ends it early', stuck.state().phase === 'done');
  check('a dead heat goes to the first to join', stuck.state().winner === A);

  const left = harness();
  await startMergeRush(left.ctx, 1, [A, B], {});
  left.advance(MERGE_COUNTDOWN_MS + 60_000);
  const keep = played(left.state().seed, 50);
  await onMergeBoard(left.ctx, A, 1, keep.board, keep.score, keep.moves, false);
  await onPlayerGone(left.ctx, A);
  check('a player leaving stops holding the round open only once everyone is done', left.state().phase === 'playing');
  await onPlayerGone(left.ctx, B);
  check('everyone gone ends it', left.state().phase === 'done');
  check('and the leaver\'s score still wins', left.state().winner === A && left.state().boards[A]?.score === keep.score);

  const solo = harness();
  await startMergeRush(solo.ctx, 1, [A], {}, true);
  solo.advance(MERGE_COUNTDOWN_MS + 10_000);
  const one = played(solo.state().seed, 10);
  await onMergeBoard(solo.ctx, A, 1, one.board, one.score, one.moves, true);
  check('solo ends on the one phone being done', solo.state().phase === 'done');
  check('and the one player wins', solo.state().winner === A && solo.state().solo);

  const nobody = harness();
  await startMergeRush(nobody.ctx, 1, [A, B], {});
  nobody.advance(MERGE_COUNTDOWN_MS + MERGE_ROUND_MS + MERGE_REPORT_GRACE_MS);
  await tick(nobody.ctx);
  check('nobody moving still ends with a winner: the first to join', nobody.state().phase === 'done' && nobody.state().winner === A);
}

async function tieBreaks(): Promise<void> {
  console.log('\nthe best score always wins (§2)');
  const h = harness();
  await startMergeRush(h.ctx, 1, [A, B, C], {});
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
  await startMergeRush(z.ctx, 1, [A, B], {});
  z.advance(MERGE_COUNTDOWN_MS + 30_000);
  const lo = played(z.state().seed, 10);
  const hi = played(z.state().seed, 70);
  await onMergeBoard(z.ctx, A, 1, lo.board, lo.score, lo.moves, true);
  await onMergeBoard(z.ctx, B, 1, hi.board, hi.score, hi.moves, true);
  check('otherwise the higher score wins, whoever joined first', z.state().winner === B);
}

/** Play a Highlander puzzle to the end by searching for the solution, as a phone would play it. */
function solved(start: Board): { board: Board; moves: number } {
  const prev = new Map<string, { from: string; board: Board }>();
  const key = (b: Board) => b.join(',');
  let frontier: Board[] = [start];
  prev.set(key(start), { from: '', board: start });
  while (frontier.length) {
    const next: Board[] = [];
    for (const b of frontier) {
      for (const d of DIRS) {
        const s = slide(b, d);
        if (!s.moved || prev.has(key(s.board))) continue;
        prev.set(key(s.board), { from: key(b), board: s.board });
        if (tilesLeft(s.board) === 1) {
          let moves = 0;
          for (let k = key(s.board); prev.get(k)?.from; k = prev.get(k)!.from) moves++;
          return { board: s.board, moves };
        }
        next.push(s.board);
      }
    }
    frontier = next;
  }
  throw new Error('unsolvable');
}

async function modes(): Promise<void> {
  console.log('\nthe three modes (§3)');
  const ta = harness();
  await startMergeRush(ta.ctx, 1, [A, B], { mode: 'time-attack' });
  check('Time Attack runs two minutes', ta.state().roundMs === MERGE_ROUND_MS && ta.state().mode === 'time-attack' && ta.state().target === 0);

  const race = harness();
  await startMergeRush(race.ctx, 1, [A, B], { mode: 'race', target: 9 });
  const r = race.state();
  check('a race keeps its target and has no countdown', r.mode === 'race' && r.target === 9 && r.roundMs === 0);
  check('its only clock is the cap', nextDeadline(r) === r.startsAt + MERGE_RACE_CAP_MS + MERGE_REPORT_GRACE_MS);
  check('and it starts from the seed\'s board', JSON.stringify(r.start) === JSON.stringify(startBoard(r.seed)));
  // A 512 tile is legal after 130 moves: the board can hold up to start + 4 × 130.
  const g = { board: [9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], score: 4000, moves: 130 };
  race.advance(MERGE_COUNTDOWN_MS + 60_000);
  await onMergeBoard(race.ctx, A, 1, [8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 900, 70, false);
  check('a tile short of the target wins nothing yet', race.state().phase === 'playing');
  await onMergeBoard(race.ctx, B, 1, g.board, g.score, g.moves, false);
  check('the first phone to make the target tile wins at once', race.state().phase === 'done' && race.state().winner === B);

  const slow = harness();
  await startMergeRush(slow.ctx, 1, [A, B], { mode: 'race', target: 13 });
  const sg = played(slow.state().seed, 120);
  const sh = played(slow.state().seed, 30);
  slow.advance(MERGE_COUNTDOWN_MS + MERGE_RACE_CAP_MS + MERGE_REPORT_GRACE_MS);
  await onMergeBoard(slow.ctx, A, 1, sh.board, sh.score, sh.moves, false);
  await onMergeBoard(slow.ctx, B, 1, sg.board, sg.score, sg.moves, false);
  check('a race nobody finishes ends on its cap', await tick(slow.ctx));
  check('and goes to the bigger tile', slow.state().winner === (Math.max(...sg.board) >= Math.max(...sh.board) ? B : A));

  const end = harness();
  await startMergeRush(end.ctx, 1, [A, B], { mode: 'race', target: MERGE_TARGET_ENDLESS });
  check('an endless race keeps its target and has no countdown', end.state().target === MERGE_TARGET_ENDLESS && end.state().roundMs === 0);
  const eg = played(end.state().seed, 120);
  const small = played(end.state().seed, 40);
  end.advance(MERGE_COUNTDOWN_MS + 60_000);
  await onMergeBoard(end.ctx, A, 1, eg.board, eg.score, eg.moves, false);
  check('a big tile does not end an endless race', end.state().phase === 'playing');
  await onMergeBoard(end.ctx, A, 1, eg.board, eg.score, eg.moves, true);
  check('one player stuck does not end it either', end.state().phase === 'playing');
  await onMergeBoard(end.ctx, B, 1, small.board, small.score, small.moves, true);
  check('it ends when everyone is stuck', end.state().phase === 'done');
  check('and the biggest tile wins', end.state().winner === (Math.max(...eg.board) >= Math.max(...small.board) ? A : B), { a: Math.max(...eg.board), b: Math.max(...small.board) });

  const hl = harness();
  await startMergeRush(hl.ctx, 1, [A, B, C], { mode: 'highlander' });
  const h = hl.state();
  check('Highlander runs three minutes', h.roundMs === MERGE_HIGHLANDER_MS);
  check('on the seed\'s puzzle, for everyone', JSON.stringify(h.start) === JSON.stringify(puzzle(h.seed)) && JSON.stringify(h.boards[A]?.board) === JSON.stringify(h.start));
  check('which can be solved', solveDepth(h.start) !== null);
  hl.advance(MERGE_COUNTDOWN_MS + 40_000);

  const cheat = [...h.start];
  cheat[cheat.findIndex((e) => e === 0)] = 3;
  await onMergeBoard(hl.ctx, A, 1, cheat, 0, 5, false);
  check('a board that gained mass is ignored: nothing ever spawns here', JSON.stringify(hl.state().boards[A]?.board) === JSON.stringify(h.start));
  const one = new Array(16).fill(0);
  one[0] = 17;
  await onMergeBoard(hl.ctx, A, 1, one, 0, 5, true);
  check('nor is a single tile worth more than the puzzle', hl.state().phase === 'playing');

  const part = slide(h.start, 'left').moved ? slide(h.start, 'left').board : slide(h.start, 'right').board;
  await onMergeBoard(hl.ctx, C, 1, part, 0, 1, false);
  const win = solved(h.start);
  await onMergeBoard(hl.ctx, B, 1, win.board, 0, win.moves, true);
  check(`the first phone down to one tile wins (${win.moves} moves)`, hl.state().phase === 'done' && hl.state().winner === B);
  check('and its duration is the referee\'s clock from the round start', hl.state().boards[B]?.solvedMs === 40_000, hl.state().boards[B]);
  check('while a player who did not finish has none', hl.state().boards[C]?.solvedMs === undefined && hl.state().boards[A]?.solvedMs === undefined);
  check('the duration reaches the room', toState(hl.state()).boards[B]?.solvedMs === 40_000);

  const rs = harness();
  await startMergeRush(rs.ctx, 1, [A, B], { mode: 'highlander' });
  const p0 = rs.state().start;
  const ans = solved(p0);
  rs.advance(MERGE_COUNTDOWN_MS + 20_000);
  await onMergeBoard(rs.ctx, A, 1, p0, 0, 3, false);
  rs.advance(35_000);
  await onMergeBoard(rs.ctx, A, 1, ans.board, 0, ans.moves + 6, true);
  check('a restart does not stop the clock: the time is the whole 55 s', rs.state().boards[A]?.solvedMs === 55_000, rs.state().boards[A]);

  const cap = harness();
  await startMergeRush(cap.ctx, 1, [A, B], { mode: 'highlander' });
  const c0 = cap.state().start;
  cap.advance(MERGE_COUNTDOWN_MS + 30_000);
  const fewer = DIRS.map((d) => slide(c0, d)).find((x) => x.moved && tilesLeft(x.board) < tilesLeft(c0));
  if (fewer) await onMergeBoard(cap.ctx, B, 1, fewer.board, 0, 1, false);
  cap.advance(MERGE_HIGHLANDER_MS + MERGE_REPORT_GRACE_MS);
  await tick(cap.ctx);
  check('Highlander unsolved at the bell goes to the fewest tiles left', cap.state().phase === 'done' && cap.state().winner === (fewer ? B : A));
}

async function wire(): Promise<void> {
  console.log('\nwhat the room sees (§6, §10)');
  const h = harness();
  const ids = Array.from({ length: MERGE_MAX_PLAYERS }, (_, i) => `player-${i}`);
  await startMergeRush(h.ctx, 1, ids, {});
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
await modes();
await wire();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
