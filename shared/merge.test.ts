import { MERGE_CELLS, MERGE_CRESCENDO_LEVELS, MERGE_HIGHLANDER_MS, MERGE_MAX_EXPONENT, MERGE_TARGETS, MERGE_TARGET_ENDLESS } from './protocol';
import {
  NO_STONE,
  applyMalus,
  bigFusions,
  malusTargets,
  DIRS,
  bestLevel,
  bestTile,
  canMove,
  compareEntries,
  crescendoPuzzle,
  hasWon,
  normaliseMergeOptions,
  puzzle,
  PUZZLE_MIN_DEPTH,
  roundMsFor,
  solveDepth,
  tilesLeft,
  isBoard,
  mass,
  maxMass,
  maxMoves,
  maxScore,
  newGame,
  slide,
  spawn,
  startBoard,
  step,
  tileValue,
  type Board,
  type Dir,
  type Game,
} from './merge';

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

/** A board from four rows of tile values, which reads like the screen. */
function rows(...r: number[][]): Board {
  return r.flat().map((v) => (v === 0 ? 0 : Math.log2(v)));
}
const same = (a: Board, b: Board): boolean => a.length === b.length && a.every((e, i) => e === b[i]);

function sliding(): void {
  console.log('\nsliding and merging (§2)');
  const left = (b: Board) => slide(b, 'left');

  check('tiles slide to the wall', same(left(rows([0, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])).board, rows([2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])));
  check('two equal tiles merge into their double', same(left(rows([2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])).board, rows([4, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])));
  check('a merge scores the new tile', left(rows([2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])).gained === 4);
  check('four equal tiles are two merges, not one', same(left(rows([2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])).board, rows([4, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])));
  check('and they score both', left(rows([2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])).gained === 8);
  check('a tile merges once a move: 2 2 4 → 4 4', same(left(rows([2, 2, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])).board, rows([4, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])));
  check('the wall-side pair goes first: 2 2 2 → 4 2', same(left(rows([2, 2, 2, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])).board, rows([4, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])));
  check('unequal neighbours stay', same(left(rows([2, 4, 2, 4], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])).board, rows([2, 4, 2, 4], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])));
  check('a board that cannot move reports it', !left(rows([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2])).moved);

  const start = rows([2, 0, 0, 2], [0, 4, 0, 0], [0, 0, 0, 0], [8, 0, 0, 8]);
  check('right slides the other way', same(slide(start, 'right').board, rows([0, 0, 0, 4], [0, 0, 0, 4], [0, 0, 0, 0], [0, 0, 0, 16])));
  const col = rows([2, 0, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0], [4, 0, 0, 0]);
  check('up merges a column', same(slide(col, 'up').board, rows([4, 0, 0, 0], [4, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])));
  check('down merges it toward the floor', same(slide(col, 'down').board, rows([0, 0, 0, 0], [0, 0, 0, 0], [4, 0, 0, 0], [4, 0, 0, 0])));
  check('a slide leaves its input alone', same(start, rows([2, 0, 0, 2], [0, 4, 0, 0], [0, 0, 0, 0], [8, 0, 0, 8])));
  check('tile values are powers of two', tileValue(0) === 0 && tileValue(1) === 2 && tileValue(11) === 2048);
}

function moving(): void {
  console.log('\na move spawns one tile, and only if something moved (§2)');
  const g0 = newGame(7);
  check('a round starts on two tiles', g0.board.filter((e) => e > 0).length === 2, g0.board);
  check('at score 0 on move 0', g0.score === 0 && g0.moves === 0);

  const dir = DIRS.find((d) => slide(g0.board, d).moved) as Dir;
  const { game, moved } = step(g0, dir, 7);
  check('a move that changes the board counts', moved && game.moves === 1);
  check('and spawns one new tile', game.board.filter((e) => e > 0).length === 3, game.board);

  const stuck: Game = { board: rows([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]), score: 5, moves: 9 };
  const r = step(stuck, 'left', 7);
  check('a move that changes nothing is not a move', !r.moved && r.game === stuck);
  check('a full board with no equal neighbours cannot move', !canMove(stuck.board));
  check('an empty cell is a move', canMove(rows([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 0])));
  check('two equal neighbours are a move, sideways', canMove(rows([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 2, 8])));
  check('and down', canMove(rows([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 8, 4], [4, 2, 8, 2])));
}

function sameLuck(): void {
  console.log('\nsame seed, same board, same luck (§2.1)');
  check('the same seed gives the same starting board', same(startBoard(1234), startBoard(1234)));
  check('a different seed gives a different one', !same(startBoard(1234), startBoard(98765)));
  let different = 0;
  for (let s = 1; s <= 40; s++) if (!same(startBoard(s), startBoard(s + 1))) different++;
  check(`starting boards vary across seeds (${different}/40)`, different > 30);

  const play = (seed: number, plan: Dir[]): Game => {
    let g = newGame(seed);
    for (const d of plan) g = step(g, d, seed).game;
    return g;
  };
  const plan: Dir[] = [];
  for (let i = 0; i < 60; i++) plan.push(DIRS[(i * 7 + (i >> 2)) % 4] as Dir);
  const a = play(31337, plan);
  const b = play(31337, plan);
  check('two players making the same moves have the same board', same(a.board, b.board));
  check('and the same score', a.score === b.score && a.moves === b.moves);
  check('a different seed plays out differently', !same(a.board, play(31338, plan).board));

  const board = startBoard(5);
  check('the n-th spawn is a pure function of seed, n and board', same(spawn(board, 5, 9), spawn(board, 5, 9)));
  check('different spawns land differently', !same(spawn(board, 5, 3), spawn(board, 5, 4)) || !same(spawn(board, 5, 4), spawn(board, 5, 5)));

  let fours = 0;
  let spawned = 0;
  for (let n = 0; n < 4000; n++) {
    const next = spawn(new Array<number>(MERGE_CELLS).fill(0), 99, n);
    next.forEach((e) => {
      if (e > 0) {
        spawned++;
        if (e === 2) fours++;
      }
    });
  }
  check(`about one spawn in ten is a 4 (${((fours / spawned) * 100).toFixed(1)}%)`, fours / spawned > 0.08 && fours / spawned < 0.12);
  check('a full board spawns nothing', same(spawn(rows([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]), 1, 0), rows([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2])));
}

/** A slightly greedy, thoroughly deterministic player. */
function play(seed: number, maxSteps: number): Game {
  let g = newGame(seed);
  const order: Dir[] = ['down', 'left', 'right', 'up'];
  for (let i = 0; i < maxSteps; i++) {
    let best: { game: Game; gain: number } | null = null;
    for (const d of order) {
      const r = step(g, d, seed);
      if (!r.moved) continue;
      const gain = r.game.score - g.score;
      if (!best || gain > best.gain) best = { game: r.game, gain };
    }
    if (!best) break;
    g = best.game;
  }
  return g;
}

function bounds(): void {
  console.log('\nwhat the referee will believe (§8)');
  let allUnder = true;
  let massUnder = true;
  let worst = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const startMass = mass(startBoard(seed));
    const g = play(seed, 900);
    if (g.score > maxScore(startMass, g.moves)) allUnder = false;
    if (mass(g.board) > maxMass(startMass, g.moves)) massUnder = false;
    worst = Math.max(worst, g.score / maxScore(startMass, g.moves));
  }
  check(`real games stay under the score bound (worst ${(worst * 100).toFixed(1)}% of it)`, allUnder);
  check('and under the mass bound', massUnder);

  const g = play(3, 900);
  check('a long game reaches big tiles', bestTile(g.board) >= 64, bestTile(g.board));
  check('every real board is a board', isBoard(g.board));

  check('a board needs sixteen cells', !isBoard([1, 2, 3]));
  check('whole exponents only', !isBoard(new Array(16).fill(1.5)));
  check('and not negative ones', !isBoard(new Array(16).fill(-1)));
  check(`and not past 2^${MERGE_MAX_EXPONENT}`, !isBoard(new Array(16).fill(MERGE_MAX_EXPONENT + 1)));
  check('a string is not a board', !isBoard('0000000000000000'));

  check('one move is allowed at the very start', maxMoves(0) === 1);
  check('twelve a second after that', maxMoves(1000) === 13 && maxMoves(120_000) === 1441);
  check('nothing before the start', maxMoves(-500) === 1);
  check('mass is the sum of the tiles', mass(rows([2, 4, 0, 0], [8, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 2])) === 16);
  check('the biggest tile on a board', bestTile(rows([2, 4, 0, 0], [64, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 2])) === 64);
  check('an empty board has no tile', bestTile(new Array(16).fill(0)) === 0);
  check('a level is the exponent of the best tile: 128 is 7', bestLevel(rows([2, 4, 0, 0], [128, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 2])) === 7);
  check('an empty board is level 0', bestLevel(new Array(16).fill(0)) === 0);
}

function modes(): void {
  console.log('\nthree ways to play (§3)');
  check('nothing chosen is Crescendo', JSON.stringify(normaliseMergeOptions(undefined)) === '{"mode":"crescendo","target":0,"aggressive":false}');
  check('Time Attack is gone: it falls back to Crescendo', normaliseMergeOptions({ mode: 'time-attack' }).mode === 'crescendo');
  check('a race keeps its target', JSON.stringify(normaliseMergeOptions({ mode: 'race', target: 9 })) === '{"mode":"race","target":9,"aggressive":false}');
  check('a race with no target races to 2048', normaliseMergeOptions({ mode: 'race' }).target === 11);
  check('a target off the list is 2048 too', normaliseMergeOptions({ mode: 'race', target: 14 }).target === 11);
  check('256 is no longer on the list', !(MERGE_TARGETS as readonly number[]).includes(8) && normaliseMergeOptions({ mode: 'race', target: 8 }).target === 11);
  check('the list is 512 up to 8192, then endless', MERGE_TARGETS.join() === `9,10,11,12,13,${MERGE_TARGET_ENDLESS}`);
  check('endless is a legal race target', normaliseMergeOptions({ mode: 'race', target: MERGE_TARGET_ENDLESS }).target === MERGE_TARGET_ENDLESS);
  check('endless is out of reach of any board', MERGE_TARGET_ENDLESS > MERGE_MAX_EXPONENT);
  check('only a race has a target', normaliseMergeOptions({ mode: 'highlander', target: 9 }).target === 0);
  check('an unknown mode is Crescendo', normaliseMergeOptions({ mode: 'blitz' }).mode === 'crescendo');
  check('Highlander runs a minute; a race and Crescendo count up with no clock', roundMsFor('highlander') === MERGE_HIGHLANDER_MS && roundMsFor('race') === 0 && roundMsFor('crescendo') === 0);

  const b512 = rows([512, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 2]);
  check('a race is won by the target tile', hasWon('race', 9, b512));
  check('or anything bigger', hasWon('race', 8, b512));
  const huge = new Array<number>(16).fill(0);
  huge[0] = MERGE_MAX_EXPONENT;
  check('an endless race is never won, whatever is on the board', !hasWon('race', MERGE_TARGET_ENDLESS, huge));
  check('not by a smaller one', !hasWon('race', 10, b512));
  check('Highlander is won by one tile left', hasWon('highlander', 0, rows([0, 0, 0, 0], [0, 64, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])));
  check('not by two', !hasWon('highlander', 0, b512));
  check('Crescendo is never won by a board alone — the referee counts levels', !hasWon('crescendo', 0, rows([0, 0, 0, 0], [0, 64, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])));

  console.log('\nwho is ahead, by each mode\'s measure (§2)');
  const e = (score: number, moves: number, board: Board) => ({ score, moves, board });
  const big = rows([256, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
  const small = rows([64, 64, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
  check('Crescendo: more levels, whatever the score', compareEntries('crescendo')({ ...e(1, 90, small), level: 4 }, { ...e(900, 10, big), level: 3 }) < 0);
  check('Crescendo, same levels: who got there first', compareEntries('crescendo')({ ...e(0, 90, small), level: 4, levelMs: 50_000 }, { ...e(0, 10, big), level: 4, levelMs: 70_000 }) < 0);
  check('no level at all ranks behind one', compareEntries('crescendo')(e(0, 1, big), { ...e(0, 99, big), level: 1 }) > 0);
  check('a race: the bigger tile, whatever the score', compareEntries('race')(e(100, 50, big), e(900, 10, small)) < 0);
  check('a race on the same tile: the higher score', compareEntries('race')(e(900, 50, big), e(100, 10, big)) < 0);
  const one = rows([0, 0, 0, 0], [0, 64, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
  check('Highlander, both on one tile: the quicker solve', compareEntries('highlander')({ ...e(0, 90, one), solvedMs: 40_000 }, { ...e(0, 10, one), solvedMs: 55_000 }) < 0);
  check('and a solve beats an unsolved board', compareEntries('highlander')({ ...e(0, 90, one), solvedMs: 99_000 }, e(0, 10, big.map((x, i) => (i === 5 ? 1 : x)))) < 0);
  check('Highlander: fewer tiles left', compareEntries('highlander')(e(0, 90, big), e(500, 10, small)) < 0);
  check('every mode: fewer moves breaks a tie', compareEntries('race')(e(100, 9, big), e(100, 10, big)) < 0);
  check('a dead heat keeps the order it was given in', compareEntries('race')(e(100, 9, big), e(100, 9, big)) === 0);
}

function highlander(): void {
  console.log('\nHighlander: a puzzle that is proved solvable (§3)');
  check('one tile is solved', solveDepth(rows([0, 0, 0, 0], [0, 8, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])) === 0);
  check('two equal tiles in a row take one move', solveDepth(rows([2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])) === 1);
  check('two unequal tiles never merge', solveDepth(rows([2, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])) === null);

  let ok = 0;
  let slowest = 0;
  let deepest = 0;
  const n = 120;
  for (let seed = 1; seed <= n; seed++) {
    const t0 = performance.now();
    const p = puzzle(seed * 2654435761);
    slowest = Math.max(slowest, performance.now() - t0);
    const d = solveDepth(p);
    const m = mass(p);
    const tiles = tilesLeft(p);
    if (d !== null && d >= PUZZLE_MIN_DEPTH && (m & (m - 1)) === 0 && tiles >= 5 && tiles <= 7) ok++;
    deepest = Math.max(deepest, d ?? 0);
  }
  check(`${n} puzzles: every one solvable, at least ${PUZZLE_MIN_DEPTH} moves deep, 5-7 tiles adding to a power of two (${ok}/${n})`, ok === n);
  check(`the deepest needs ${deepest} moves`, deepest >= PUZZLE_MIN_DEPTH);
  check(`and the slowest took ${slowest.toFixed(0)} ms to build`, slowest < 2000);
  check('the same seed is the same puzzle', puzzle(42).join() === puzzle(42).join());
  check('a different seed is a different one', puzzle(42).join() !== puzzle(43).join());
  check('the fallback board is solvable too', solveDepth([1, 0, 0, 1, 0, 2, 0, 0, 0, 0, 3, 0, 4, 0, 0, 5]) !== null);

  const p = puzzle(7);
  const s = step({ board: p, score: 0, moves: 0 }, 'left', 7, false);
  const sl = slide(p, 'left');
  check('with spawns off, a move is the slide and nothing else', !sl.moved || same(s.game.board, sl.board));
  check('so the total never changes', !sl.moved || mass(s.game.board) === mass(p));
}

function crescendo(): void {
  console.log('\nCrescendo: each tile count twice, always solvable, ever longer (§3)');
  check('30 levels', MERGE_CRESCENDO_LEVELS === 30);
  let counts = true;
  let powers = true;
  let solves = true;
  let firstBad = '';
  let boards = 0;
  for (let seed = 1; seed <= 60; seed++) {
    for (let level = 1; level <= MERGE_CRESCENDO_LEVELS; level++) {
      const { board, solution } = crescendoPuzzle(seed * 2654435761, level);
      boards++;
      if (tilesLeft(board) !== Math.ceil(level / 2) + 1) { counts = false; firstBad ||= `count seed ${seed} level ${level}`; }
      const m = mass(board);
      if ((m & (m - 1)) !== 0) { powers = false; firstBad ||= `mass seed ${seed} level ${level}`; }
      let b = board;
      for (const d of solution) b = slide(b, d).board;
      if (tilesLeft(b) !== 1) { solves = false; firstBad ||= `solve seed ${seed} level ${level}: ${board.join(',')} by ${solution.join(' ')}`; }
    }
  }
  check(`${boards} levels: each has ceil(level / 2) + 1 tiles`, counts, firstBad);
  check('their tiles add up to one power of two', powers, firstBad);
  check('and its own solution, played out, leaves one tile', solves, firstBad);
  check('levels 1 and 2 are two tiles', tilesLeft(crescendoPuzzle(5, 1).board) === 2 && tilesLeft(crescendoPuzzle(5, 2).board) === 2);
  check('levels 29 and 30 are the full board', tilesLeft(crescendoPuzzle(5, 29).board) === 16 && tilesLeft(crescendoPuzzle(5, 30).board) === 16);
  check('a full-board level can still move', canMove(crescendoPuzzle(5, 30).board));

  let twins = 0;
  let same = 0;
  for (let seed = 1; seed <= 200; seed++) {
    for (let n = 2; n <= 16; n++) {
      twins++;
      if (crescendoPuzzle(seed, 2 * n - 3).board.join() === crescendoPuzzle(seed, 2 * n - 2).board.join()) same++;
    }
  }
  check(`a tile count's two levels are never the same board (${same}/${twins} alike)`, same === 0);

  // The bank's solutions are claimed shortest: the solver, run on every
  // puzzle the game can deal, must agree, and they must grow harder.
  let agree = true;
  const median: number[] = [];
  for (let n = 2; n <= 16; n++) {
    const lengths: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      for (const level of [2 * n - 3, 2 * n - 2]) {
        const p = crescendoPuzzle(seed, level);
        if (n <= 8 && solveDepth(p.board, 400_000) !== p.solution.length) { agree = false; firstBad ||= `solver disagrees seed ${seed} level ${level}`; }
        lengths.push(p.solution.length);
      }
    }
    lengths.sort((x, y) => x - y);
    median.push(lengths[lengths.length >> 1] as number);
  }
  check('the solver agrees each solution is a shortest one (2–8 tiles)', agree, firstBad);
  // Median shortest solution by tile count (index 0 is two tiles).
  const floor = (n: number): number => (n <= 3 ? n : n <= 4 ? 7 : n <= 8 ? 10 : n <= 12 ? 16 : 18);
  const lowest = median.findIndex((m, i) => m < floor(i + 2));
  check(`puzzles take ever more moves (medians ${median.join(' ')})`, lowest < 0, `${lowest + 2} tiles`);
  check('a full board takes at least 20 moves, against 6 before the search', (median[14] as number) >= 20);

  check('the same seed and level is the same puzzle', crescendoPuzzle(9, 7).board.join() === crescendoPuzzle(9, 7).board.join());
  let differ = 0;
  for (let level = 2; level <= 30; level++) if (crescendoPuzzle(9, level).board.join() !== crescendoPuzzle(10, level).board.join()) differ++;
  check(`different seeds deal different puzzles (${differ}/29)`, differ >= 25);
  const turned = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) turned.add(crescendoPuzzle(seed, 7).solution[0] as string);
  check(`the opening move is not always the same direction (${[...turned].join(', ')})`, turned.size >= 3);
}

function aggressive(): void {
  console.log('\naggressive race (§3.1)');
  check('a race can be aggressive', normaliseMergeOptions({ mode: 'race', aggressive: true }).aggressive);
  check('only a race: Crescendo and Highlander never are', !normaliseMergeOptions({ mode: 'crescendo', aggressive: true }).aggressive && !normaliseMergeOptions({ mode: 'highlander', aggressive: true }).aggressive);
  check('anything but true is not aggressive', !normaliseMergeOptions({ mode: 'race', aggressive: 'yes' }).aggressive);

  // A stone stops tiles like a wall, and nothing merges across it.
  const b = rows([2, 2, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
  check('a stone cuts the line: 2 2 ▪ 2 slides to 4 · ▪ 2', same(slide(b, 'left', 2).board, rows([4, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])));
  check('tiles stop against it from the other side', same(slide(rows([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 8]), 'left', 13).board, rows([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 8, 0])));
  check('no stone is the plain slide', same(slide(b, 'left', NO_STONE).board, slide(b, 'left').board));
  const crowded = rows([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 0]);
  check('a spawn never lands on the stone', spawn(crowded, 7, 3, 15)[15] === 0);

  check('a merge into 64 is a big one', bigFusions(rows([32, 32, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]), 'left') === 1);
  check('into 32 is not', bigFusions(rows([16, 16, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]), 'left') === 0);
  check('two in one move count twice', bigFusions(rows([64, 64, 0, 0], [32, 0, 32, 0], [0, 0, 0, 0], [0, 0, 0, 0]), 'right') === 2);
  check('not across a stone', bigFusions(rows([32, 0, 32, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]), 'left', 1) === 0);

  const order = ['a', 'b', 'c', 'd'];
  check('anyone playing but the sender can take one', malusTargets(order, 'b', null).join() === 'a,c,d');
  check('but not whoever took the last one', malusTargets(order, 'a', 'c').join() === 'b,d');
  check('whoever sent the last one can take the next', malusTargets(order, 'c', 'c').join() === 'a,b,d');
  check('with one rival left, they take every one', malusTargets(['a', 'b'], 'a', 'b').join() === 'b');
  check('with nobody left there is no one to send to', malusTargets(['a'], 'a', null).length === 0);

  const board = rows([2, 4, 0, 0], [2, 128, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
  const boom = applyMalus(board, { kind: 'explode', r: 0.99, exp: 0 });
  check('explode takes one of the smallest tiles', boom.cell === 4 && boom.board[4] === 0 && tilesLeft(boom.board) === 3);
  const big = rows([16, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
  check('but only if it is a 2, 4 or 8', applyMalus(big, { kind: 'explode', r: 0, exp: 0 }).board === big);
  const add = applyMalus(board, { kind: 'add', r: 0, exp: 3 });
  check('add drops its tile on an empty cell', add.cell === 2 && add.board[2] === 3 && mass(add.board) === mass(board) + 8);
  check('never on the stone', applyMalus(board, { kind: 'add', r: 0, exp: 1 }, 2).cell === 3);
  check('an add tile is a 2, 4 or 8 whatever it is told', applyMalus(board, { kind: 'add', r: 0, exp: 9 }).board[2] === 3);
  check('a full board takes no tile', applyMalus(crowded.map((e) => e || 1), { kind: 'add', r: 0, exp: 1 }).cell === NO_STONE);
  const stone = applyMalus(board, { kind: 'stone', r: 0.5, exp: 0 });
  check('stone picks an empty cell and leaves the board as it is', stone.board === board && board[stone.cell] === 0);
  check('gravity is a slide down', same(applyMalus(board, { kind: 'gravity', r: 0, exp: 0 }).board, slide(board, 'down').board));
  check('freeze and fog leave the board alone', applyMalus(board, { kind: 'freeze', r: 0, exp: 0 }).board === board && applyMalus(board, { kind: 'fog', r: 0, exp: 0 }).board === board);
  check('the same malus on the same board lands on the same cell', applyMalus(board, { kind: 'add', r: 0.7, exp: 1 }).cell === applyMalus(board, { kind: 'add', r: 0.7, exp: 1 }).cell);
}

sliding();
crescendo();
aggressive();
moving();
sameLuck();
bounds();
modes();
highlander();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
