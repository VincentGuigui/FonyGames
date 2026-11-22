/**
 * Builds shared/crescendoBank.ts — `npm run bank:crescendo`. Not shipped.
 *
 * Crescendo's puzzles are searched for once, here, rather than at runtime: a
 * hard board (long shortest solution) takes up to seconds to find on 16 tiles.
 * Each starts from a board solvable by construction (descending chains that
 * collapse row by row), then hill-climbs: move or swap a tile, keep the change
 * if the board stays solvable and its shortest solution does not shrink.
 * Moving tiles never changes the total, so it stays one power of two.
 */
import { writeFileSync } from 'node:fs';
import { DIRS, slide, tilesLeft, type Board, type Dir } from '../shared/merge';
import { CRESCENDO_VARIANTS } from '../shared/crescendoBank';
import { MERGE_CELLS, MERGE_SIZE } from '../shared/protocol';

const ITERATIONS = 1000;
/** Boards climbed per tile count; the hardest distinct ones are kept. */
const CANDIDATES = 12;
const STATE_CAP = 400_000;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shortest solution, or null if there is none within STATE_CAP boards. */
function solve(start: Board): Dir[] | null {
  if (tilesLeft(start) === 1) return [];
  const from = new Map<string, [string, Dir] | null>([[start.join(), null]]);
  let frontier: Board[] = [start];
  while (frontier.length) {
    const next: Board[] = [];
    for (const b of frontier) {
      for (const d of DIRS) {
        const s = slide(b, d);
        if (!s.moved) continue;
        const key = s.board.join();
        if (from.has(key)) continue;
        from.set(key, [b.join(), d]);
        if (tilesLeft(s.board) === 1) {
          const path: Dir[] = [];
          for (let at = from.get(key); at; at = from.get(at[0])) path.unshift(at[1]);
          return path;
        }
        if (from.size > STATE_CAP) return null;
        next.push(s.board);
      }
    }
    frontier = next;
  }
  return null;
}

/** A solvable board of `n` tiles: rows of descending chains ending in a pair. */
function seedBoard(n: number, random: () => number): Board {
  const pick = (k: number): number => Math.floor(random() * k);
  const rowsUsed = Math.ceil(n / MERGE_SIZE) + pick(Math.min(MERGE_SIZE, n) - Math.ceil(n / MERGE_SIZE) + 1);
  const lengths = new Array<number>(rowsUsed).fill(1);
  for (let left = n - rowsUsed; left > 0; ) {
    const i = pick(rowsUsed);
    if ((lengths[i] as number) < MERGE_SIZE) {
      lengths[i] = (lengths[i] as number) + 1;
      left--;
    }
  }
  const fall = (i: number): number => (rowsUsed === 1 ? 0 : Math.min(i, rowsUsed - 2));
  const k = Math.max(1, ...lengths.map((m, i) => m + fall(i))) + pick(2);
  const board = new Array<number>(MERGE_CELLS).fill(0);
  lengths.forEach((m, r) => {
    const c = k - fall(r);
    const chain = m === 1 ? [c] : [...Array.from({ length: m - 1 }, (_, j) => c - 1 - j), c - m + 1];
    const cols = [0, 1, 2, 3].sort(() => random() - 0.5).slice(0, m).sort((a, b) => a - b);
    cols.forEach((col, j) => {
      board[r * MERGE_SIZE + col] = chain[j] as number;
    });
  });
  return board;
}

function perturb(b: Board, random: () => number): Board {
  const out = b.slice();
  const tiles = out.flatMap((e, i) => (e ? [i] : []));
  const empty = out.flatMap((e, i) => (e ? [] : [i]));
  const some = (xs: number[]): number => xs[Math.floor(random() * xs.length)] as number;
  if (random() < 0.7 && empty.length) {
    const from = some(tiles);
    out[some(empty)] = out[from] as number;
    out[from] = 0;
  } else {
    const a = some(tiles);
    const c = some(tiles);
    [out[a], out[c]] = [out[c] as number, out[a] as number];
  }
  return out;
}

function climb(n: number, seed: number): { board: Board; path: Dir[] } {
  const random = rng(seed);
  let board = seedBoard(n, random);
  let path = solve(board) as Dir[];
  for (let i = 0; i < ITERATIONS; i++) {
    const cand = perturb(board, random);
    const p = solve(cand);
    if (p && p.length >= path.length) {
      board = cand;
      path = p;
    }
  }
  return { board, path };
}

const LETTER: Record<Dir, string> = { up: 'u', down: 'd', left: 'l', right: 'r' };

/** The board's key up to turning and mirroring, so a rotated copy is not a new puzzle. */
function shape(b: Board): string {
  const forms: string[] = [];
  for (const [flip, turns] of [[false, 0], [false, 1], [false, 2], [false, 3], [true, 0], [true, 1], [true, 2], [true, 3]] as const) {
    let cells = b.slice();
    if (flip) cells = cells.map((_, i) => cells[Math.floor(i / MERGE_SIZE) * MERGE_SIZE + (MERGE_SIZE - 1 - (i % MERGE_SIZE))] as number);
    for (let t = 0; t < turns; t++) cells = cells.map((_, i) => cells[(MERGE_SIZE - 1 - (i % MERGE_SIZE)) * MERGE_SIZE + Math.floor(i / MERGE_SIZE)] as number);
    forms.push(cells.join());
  }
  return forms.sort()[0] as string;
}

const rows: string[] = [];
for (let n = 2; n <= MERGE_CELLS; n++) {
  const seen = new Set<string>();
  const found: { board: Board; path: Dir[] }[] = [];
  for (let attempt = 0; attempt < CANDIDATES * 4 && found.length < CANDIDATES; attempt++) {
    const r = climb(n, n * 7919 + attempt * 104729);
    const key = shape(r.board);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(r);
  }
  found.sort((a, b) => b.path.length - a.path.length);
  const kept = found.slice(0, CRESCENDO_VARIANTS);
  console.log(`${n} tiles: shortest solutions ${kept.map((f) => f.path.length).join(' ')} (${found.length} candidates)`);
  rows.push(
    `  [${kept.map((f) => `['${f.board.map((e) => e.toString(36)).join('')}', '${f.path.map((d) => LETTER[d]).join('')}']`).join(', ')}],`,
  );
}

writeFileSync(
  'shared/crescendoBank.ts',
  `// Generated by \`npm run bank:crescendo\` (shared/crescendoBank.gen.ts). Do not edit.
// Row n − 2 holds the puzzles of n tiles: [cells as base-36 exponents, a shortest solution as u/d/l/r].

export const CRESCENDO_VARIANTS = ${CRESCENDO_VARIANTS};

export const CRESCENDO_BANK: readonly (readonly (readonly [string, string])[])[] = [
${rows.join('\n')}
];
`,
);
