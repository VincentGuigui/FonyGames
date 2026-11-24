import { MERGE_SIZE } from '../../../../shared/protocol';
import { NO_STONE, runs, type Board, type Dir } from '../../../../shared/merge';

/**
 * Tiles with an identity, so a move can slide them. Spec: docs/specs/games/double-fusion.md §4
 *
 * `shared/merge.ts` decides what a move does to the board; this follows the
 * same move tile by tile, only to know where each one travelled from and to.
 * It never decides a result — the caller hands it the board the rules produced
 * and the spawn is whatever that board has that the slide did not.
 */

export type Tile = {
  id: number;
  exp: number;
  r: number;
  c: number;
  /** How it arrived: a new tile, or the product of a merge. Drives its pop. */
  born?: 'spawn' | 'merge';
  /** Slid into a merge: still drawn while it travels, then dropped. */
  gone?: boolean;
  /** Blown up by a malus: drawn bursting, then dropped. */
  boom?: boolean;
};

export function tilesFromBoard(board: Board, nextId: number): { tiles: Tile[]; nextId: number } {
  const tiles: Tile[] = [];
  board.forEach((exp, i) => {
    if (exp > 0) tiles.push({ id: nextId++, exp, r: Math.floor(i / MERGE_SIZE), c: i % MERGE_SIZE });
  });
  return { tiles, nextId };
}

export function boardOf(tiles: readonly Tile[]): number[] {
  const board = new Array<number>(MERGE_SIZE * MERGE_SIZE).fill(0);
  for (const t of tiles) if (!t.gone) board[t.r * MERGE_SIZE + t.c] = t.exp;
  return board;
}

/**
 * Move every tile as `slide` would — stopping at the stone, if there is one —
 * then add the spawn that `result` holds.
 *
 * A merged pair both travel to the merge cell and stay `gone` for the length of
 * the slide, under the new tile, which is `born: 'merge'` and pops once they land.
 */
export function moveTiles(
  tiles: readonly Tile[],
  dir: Dir,
  result: Board,
  nextId: number,
  stone = NO_STONE,
): { tiles: Tile[]; nextId: number } {
  const live = tiles.filter((t) => !t.gone);
  const out: Tile[] = [];

  for (let i = 0; i < MERGE_SIZE; i++) for (const run of runs(dir, i, stone)) {
    const cells = run.map((at) => ({ r: Math.floor(at / MERGE_SIZE), c: at % MERGE_SIZE }));
    const here = cells
      .map((cell) => live.find((t) => t.r === cell.r && t.c === cell.c))
      .filter((t): t is Tile => t !== undefined);
    let k = 0;
    for (let n = 0; n < here.length; n++, k++) {
      const a = here[n] as Tile;
      const b = here[n + 1];
      const to = cells[k] as { r: number; c: number };
      if (b && b.exp === a.exp) {
        out.push({ id: a.id, exp: a.exp, r: to.r, c: to.c, gone: true });
        out.push({ id: b.id, exp: b.exp, r: to.r, c: to.c, gone: true });
        out.push({ id: nextId++, exp: a.exp + 1, r: to.r, c: to.c, born: 'merge' });
        n++;
      } else {
        out.push({ id: a.id, exp: a.exp, r: to.r, c: to.c });
      }
    }
  }

  const slid = boardOf(out);
  result.forEach((exp, i) => {
    if (exp > 0 && slid[i] === 0) {
      out.push({ id: nextId++, exp, r: Math.floor(i / MERGE_SIZE), c: i % MERGE_SIZE, born: 'spawn' });
    }
  });
  return { tiles: out, nextId };
}

/** The tiles still on the board once the slide is over. */
export function settled(tiles: readonly Tile[]): Tile[] {
  return tiles.filter((t) => !t.gone).map(({ born: _born, ...t }) => t);
}
