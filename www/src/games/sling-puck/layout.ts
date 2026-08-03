import { BOARD_ASPECT, BOARD_H } from './physics';

/**
 * Where the board sits on the canvas, and how to get between board units and
 * pixels. Spec: docs/specs/games/sling-puck.md §4 (units), §8 (screens)
 *
 * Shared by the renderer and the pointer handling for the same reason Goat
 * Siege's `layout.ts` exists: a puck you can see in one place and grab in
 * another is the bug this file prevents.
 */

export type Board = {
  /** Top-left of the board in CSS pixels. */
  left: number;
  top: number;
  /** Board size in CSS pixels. */
  w: number;
  h: number;
  /** Pixels per board unit — one number, because the units are isotropic. */
  scale: number;
};

/**
 * Fit a `BOARD_ASPECT` rectangle into the canvas, centred, leaving a margin.
 *
 * Letterboxed rather than stretched: the board must be the same board on both
 * phones, and stretching it to each screen would make one radius mean two
 * different distances (spec §4).
 */
export function fit(w: number, h: number): Board {
  const bw = Math.min(w, h * BOARD_ASPECT);
  const bh = bw / BOARD_ASPECT;
  return {
    left: (w - bw) / 2,
    top: (h - bh) / 2,
    w: bw,
    h: bh,
    scale: bw,
  };
}

/** Board units → CSS pixels. */
export function toScreen(b: Board, x: number, y: number): { x: number; y: number } {
  return { x: b.left + x * b.scale, y: b.top + y * b.scale };
}

/** CSS pixels → board units. Not clamped: the caller decides what off-board means. */
export function toBoard(b: Board, x: number, y: number): { x: number; y: number } {
  return { x: (x - b.left) / b.scale, y: (y - b.top) / b.scale };
}

/** True when a point is inside the board, with `slop` board units of tolerance. */
export function onBoard(x: number, y: number, slop = 0): boolean {
  return x >= -slop && x <= 1 + slop && y >= -slop && y <= BOARD_H + slop;
}
