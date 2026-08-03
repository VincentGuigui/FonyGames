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
  /** Top-left of the **play area** in CSS pixels — board unit (0, 0). */
  left: number;
  top: number;
  /** Play area size in CSS pixels. */
  w: number;
  h: number;
  /** Pixels per board unit — one number, because the units are isotropic. */
  scale: number;
  /** Wall thickness in CSS pixels. Drawn *outside* the play area (see below). */
  lip: number;
};

/**
 * Fit a `BOARD_ASPECT` rectangle into the canvas, centred, and hand back the
 * **play area** inside it.
 *
 * Letterboxed rather than stretched: the board must be the same board on both
 * phones, and stretching it to each screen would make one radius mean two
 * different distances (spec §4).
 *
 * The walls get their own margin outside the play area rather than being painted
 * over its edge. Board unit 0 is where the physics stops a puck, so a wall drawn
 * inwards from there overlaps every puck resting against it — which is exactly
 * how the outermost pucks in the opening rack first looked.
 */
export function fit(w: number, h: number): Board {
  const outerW = Math.min(w, h * BOARD_ASPECT);
  const lip = Math.max(5, outerW * 0.022);
  const bw = outerW - lip * 2;
  const bh = bw / BOARD_ASPECT;
  return {
    left: (w - bw) / 2,
    top: (h - bh) / 2,
    w: bw,
    h: bh,
    scale: bw,
    lip,
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
