import {
  MERGE_CELLS,
  MERGE_DEFAULT_TARGET,
  MERGE_FOUR_CHANCE,
  MERGE_HIGHLANDER_MS,
  MERGE_MAX_EXPONENT,
  MERGE_MAX_MOVES_PER_S,
  MERGE_MODES,
  MERGE_ROUND_MS,
  MERGE_SIZE,
  MERGE_TARGETS,
  type MergeMode,
  type MergeOptions,
} from './protocol';

/**
 * Merge Rush's rules. Spec: docs/specs/games/merge-rush.md §2
 *
 * Shared by the phone, which plays the round, and the referee, which bounds
 * the one board it is told about — so the bound in spec §8 is the game's own
 * rules and cannot drift from them. DOM-free.
 *
 * A board is `MERGE_CELLS` exponents, row by row: 0 is empty, k is the tile 2^k.
 */

export type Board = readonly number[];
export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

/** One player's round so far. */
export type Game = { board: Board; score: number; moves: number };

/** The value a cell shows: 2^k, or 0 for an empty cell. */
export function tileValue(exponent: number): number {
  return exponent > 0 ? 2 ** exponent : 0;
}

/** Small, fast, good enough for picking a cell — and identical everywhere. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The n-th spawn of a round: which empty cell, and whether it is a 2 or a 4.
 *
 * Depends only on the seed, n and the board it lands on, so two players who
 * make the same moves meet the same tiles (spec §2.1).
 */
export function spawn(board: Board, seed: number, n: number): Board {
  const empty: number[] = [];
  board.forEach((e, i) => {
    if (e === 0) empty.push(i);
  });
  if (empty.length === 0) return board;
  const random = mulberry32(Math.imul(seed ^ 0x9e3779b9, 1) + Math.imul(n + 1, 0x85ebca6b));
  const cell = empty[Math.min(empty.length - 1, Math.floor(random() * empty.length))] as number;
  const next = board.slice();
  next[cell] = random() < MERGE_FOUR_CHANCE ? 2 : 1;
  return next;
}

/** The board every player starts a round on: two spawns on an empty one. */
export function startBoard(seed: number): Board {
  return spawn(spawn(new Array<number>(MERGE_CELLS).fill(0), seed, 0), seed, 1);
}

export function newGame(seed: number): Game {
  return { board: startBoard(seed), score: 0, moves: 0 };
}

/** The four cells of one line, in the order tiles travel toward the wall. */
function line(dir: Dir, i: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < MERGE_SIZE; k++) {
    const r = dir === 'left' ? i : dir === 'right' ? i : dir === 'up' ? k : MERGE_SIZE - 1 - k;
    const c = dir === 'up' ? i : dir === 'down' ? i : dir === 'left' ? k : MERGE_SIZE - 1 - k;
    out.push(r * MERGE_SIZE + c);
  }
  return out;
}

/** Slide and merge one board. `gained` is the value of every tile a merge made. */
export function slide(board: Board, dir: Dir): { board: Board; gained: number; moved: boolean } {
  const next = board.slice();
  let gained = 0;
  for (let i = 0; i < MERGE_SIZE; i++) {
    const cells = line(dir, i);
    const tiles = cells.map((c) => board[c] as number).filter((e) => e > 0);
    const merged: number[] = [];
    for (let k = 0; k < tiles.length; k++) {
      const here = tiles[k] as number;
      if (tiles[k + 1] === here) {
        merged.push(here + 1);
        gained += tileValue(here + 1);
        k++;
      } else {
        merged.push(here);
      }
    }
    cells.forEach((c, k) => {
      next[c] = merged[k] ?? 0;
    });
  }
  return { board: next, gained, moved: next.some((e, i) => e !== board[i]) };
}

/**
 * One move: slide, score, and — only if something moved — the next spawn.
 * Highlander passes `spawns: false`: nothing new ever appears on its board.
 */
export function step(game: Game, dir: Dir, seed: number, spawns = true): { game: Game; moved: boolean } {
  const s = slide(game.board, dir);
  if (!s.moved) return { game, moved: false };
  // Two spawns start the board and every move spawns exactly one.
  const board = spawns ? spawn(s.board, seed, 2 + game.moves) : s.board;
  return { game: { board, score: game.score + s.gained, moves: game.moves + 1 }, moved: true };
}

/** Is there any move left: an empty cell, or two equal neighbours. */
export function canMove(board: Board): boolean {
  for (let i = 0; i < MERGE_CELLS; i++) {
    const e = board[i] as number;
    if (e === 0) return true;
    if (i % MERGE_SIZE < MERGE_SIZE - 1 && board[i + 1] === e) return true;
    if (i + MERGE_SIZE < MERGE_CELLS && board[i + MERGE_SIZE] === e) return true;
  }
  return false;
}

export function bestTile(board: Board): number {
  return tileValue(Math.max(0, ...board));
}

/** The level a board has reached: the exponent of its best tile, so 128 is level 7. */
export function bestLevel(board: Board): number {
  return Math.max(0, ...board);
}

/** The total of every tile on the board. */
export function mass(board: Board): number {
  return board.reduce((sum, e) => sum + tileValue(e), 0);
}

/* ── The referee's bounds (spec §8) ─────────────────────────────────────── */

/** Is this a board the rules could have produced: sixteen whole exponents. */
export function isBoard(board: unknown): board is number[] {
  return (
    Array.isArray(board) &&
    board.length === MERGE_CELLS &&
    board.every((e) => Number.isInteger(e) && e >= 0 && e <= MERGE_MAX_EXPONENT)
  );
}

/** The most moves a thumb could have made in `elapsedMs`. */
export function maxMoves(elapsedMs: number): number {
  return Math.floor((Math.max(0, elapsedMs) / 1000) * MERGE_MAX_MOVES_PER_S) + 1;
}

/**
 * The most mass a board can hold after `moves`: what it started with, plus at
 * most a 4 for every move. Every tile on a board came from a spawn.
 */
export function maxMass(startMass: number, moves: number): number {
  return startMass + 4 * moves;
}

/**
 * The most a player can have scored. A unit of mass is merged at most once per
 * doubling, so it can score at most `MERGE_MAX_EXPONENT` times over.
 */
export function maxScore(startMass: number, moves: number): number {
  return MERGE_MAX_EXPONENT * maxMass(startMass, moves);
}

/* ── Modes (spec §3) ─────────────────────────────────────────────────────── */

export function tilesLeft(board: Board): number {
  return board.filter((e) => e > 0).length;
}

/** The host's choice, from whatever arrived; anything unknown is the default. */
export function normaliseMergeOptions(raw: unknown): MergeOptions {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const mode = (MERGE_MODES as readonly unknown[]).includes(o['mode']) ? (o['mode'] as MergeMode) : 'time-attack';
  const target = (MERGE_TARGETS as readonly unknown[]).includes(o['target']) ? (o['target'] as number) : MERGE_DEFAULT_TARGET;
  return { mode, target: mode === 'race' ? target : 0 };
}

/** The countdown a mode runs on; 0 for a race, which has none. */
export function roundMsFor(mode: MergeMode): number {
  return mode === 'time-attack' ? MERGE_ROUND_MS : mode === 'highlander' ? MERGE_HIGHLANDER_MS : 0;
}

/** Has this board won the round outright: the target tile in a race, one tile in Highlander. */
export function hasWon(mode: MergeMode, target: number, board: Board): boolean {
  if (mode === 'race') return bestLevel(board) >= target;
  if (mode === 'highlander') return tilesLeft(board) === 1;
  return false;
}

export type Ranked = { score: number; moves: number; board: Board; solvedMs?: number | undefined };

/**
 * Who is ahead, by each mode's own measure; a full tie keeps the order it was
 * given in, which is join order. Time Attack is the score; a race is the
 * biggest tile, then the score; Highlander is the fewest tiles left, then the
 * quicker solve. Fewer moves breaks every tie.
 */
export function compareEntries(mode: MergeMode): (a: Ranked, b: Ranked) => number {
  return (a, b) => {
    if (mode === 'highlander') {
      const t = tilesLeft(a.board) - tilesLeft(b.board);
      if (t !== 0) return t;
      // Two players on one tile: the quicker solve, restarts and all.
      if (a.solvedMs !== undefined && b.solvedMs !== undefined && a.solvedMs !== b.solvedMs) return a.solvedMs - b.solvedMs;
    } else {
      if (mode === 'race') {
        const l = bestLevel(b.board) - bestLevel(a.board);
        if (l !== 0) return l;
      }
      if (b.score !== a.score) return b.score - a.score;
    }
    return a.moves - b.moves;
  };
}

/**
 * The fewest moves that bring a board down to one tile with nothing spawning,
 * or null if that cannot be done within `maxStates` boards. Breadth first, so
 * the first one-tile board found is the shortest solution.
 */
export function solveDepth(start: Board, maxStates = 20_000): number | null {
  if (tilesLeft(start) === 1) return 0;
  const seen = new Set<string>([start.join(',')]);
  let frontier: Board[] = [start];
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: Board[] = [];
    for (const board of frontier) {
      for (const dir of DIRS) {
        const s = slide(board, dir);
        if (!s.moved) continue;
        if (tilesLeft(s.board) === 1) return depth;
        const key = s.board.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        if (seen.size > maxStates) return null;
        next.push(s.board);
      }
    }
    frontier = next;
  }
  return null;
}

/** The fewest moves a Highlander puzzle may be solved in, so it is a puzzle. */
export const PUZZLE_MIN_DEPTH = 6;

/**
 * Highlander's board: tiles that add up to one power of two, placed so the
 * board can be merged down to that one tile — proved by solving it, not hoped.
 *
 * Built by splitting a single tile in halves until there are enough pieces,
 * which keeps the total a power of two by construction; the solver then rejects
 * any placement that cannot be finished, or finishes too quickly to be a puzzle.
 */
export function puzzle(seed: number): Board {
  for (let attempt = 0; attempt < 400; attempt++) {
    const random = mulberry32(Math.imul(seed ^ 0x2545f491, 1) + Math.imul(attempt + 1, 0x27d4eb2d));
    const top = 5 + Math.floor(random() * 2);
    const count = 5 + Math.floor(random() * 3);
    const pieces = [top];
    while (pieces.length < count) {
      const splittable = pieces.map((e, i) => (e >= 2 ? i : -1)).filter((i) => i >= 0);
      if (splittable.length === 0) break;
      const at = splittable[Math.floor(random() * splittable.length)] as number;
      const e = pieces[at] as number;
      pieces.splice(at, 1, e - 1, e - 1);
    }
    const cells = Array.from({ length: MERGE_CELLS }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cells[i], cells[j]] = [cells[j] as number, cells[i] as number];
    }
    const board = new Array<number>(MERGE_CELLS).fill(0);
    pieces.forEach((e, i) => {
      board[cells[i] as number] = e;
    });
    const depth = solveDepth(board);
    if (depth !== null && depth >= PUZZLE_MIN_DEPTH) return board;
  }
  // Never reached in practice (the tests sweep hundreds of seeds); a known
  // solvable board rather than an endless loop if it ever were.
  return [1, 0, 0, 1, 0, 2, 0, 0, 0, 0, 3, 0, 4, 0, 0, 5];
}
