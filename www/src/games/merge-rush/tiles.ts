import { MERGE_SIZE } from '../../../../shared/protocol';
import type { Board, Dir } from '../../../../shared/merge';

/**
 * Tiles with an identity, so a move can slide them. Spec: docs/specs/games/merge-rush.md §4
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
};

export function tilesFromBoard(board: Board, nextId: number): { tiles: Tile[]; nextId: number } {
  const tiles: Tile[] = [];
  board.forEach((exp, i) => {
    if (exp > 0) tiles.push({ id: nextId++, exp, r: Math.floor(i / MERGE_SIZE), c: i % MERGE_SIZE });
  });
  return { tiles, nextId };
}

/** The cells of line `i`, in the order tiles travel toward the wall. */
function line(dir: Dir, i: number): { r: number; c: number }[] {
  const out: { r: number; c: number }[] = [];
  for (let k = 0; k < MERGE_SIZE; k++) {
    const far = MERGE_SIZE - 1 - k;
    if (dir === 'left') out.push({ r: i, c: k });
    else if (dir === 'right') out.push({ r: i, c: far });
    else if (dir === 'up') out.push({ r: k, c: i });
    else out.push({ r: far, c: i });
  }
  return out;
}

export function boardOf(tiles: readonly Tile[]): number[] {
  const board = new Array<number>(MERGE_SIZE * MERGE_SIZE).fill(0);
  for (const t of tiles) if (!t.gone) board[t.r * MERGE_SIZE + t.c] = t.exp;
  return board;
}

/**
 * Move every tile as `slide` would, then add the spawn that `result` holds.
 *
 * A merged pair both travel to the merge cell and stay `gone` for the length of
 * the slide, under the new tile, which is `born: 'merge'` and pops once they land.
 */
export function moveTiles(
  tiles: readonly Tile[],
  dir: Dir,
  result: Board,
  nextId: number,
): { tiles: Tile[]; nextId: number } {
  const live = tiles.filter((t) => !t.gone);
  const out: Tile[] = [];

  for (let i = 0; i < MERGE_SIZE; i++) {
    const cells = line(dir, i);
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
