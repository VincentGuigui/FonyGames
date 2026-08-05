import { CM_BOARD_ASPECT, CM_BOARD_H } from '../../../../shared/protocol';

/**
 * Where the floor sits on the canvas. Spec: docs/specs/games/cat-and-mouse.md §5
 *
 * The twin of Sling Puck's `layout.ts`, and shared between the renderer and the
 * pointer handling for the same reason: an icon you can see in one place and grab
 * in another is the bug this file prevents.
 */

export type Floor = {
  /** Top-left of the floor in CSS pixels — board unit (0, 0). */
  left: number;
  top: number;
  w: number;
  h: number;
  /** Pixels per board unit. One number, because the units are isotropic. */
  scale: number;
};

/**
 * Fit a `CM_BOARD_ASPECT` rectangle into the canvas, centred.
 *
 * Letterboxed, never stretched. Every phone is looking at the same floor, so
 * stretching it to each screen would make one catch radius mean a different
 * distance on each — and a diagonal run bend.
 */
export function fit(w: number, h: number): Floor {
  const fw = Math.min(w, h * CM_BOARD_ASPECT);
  const fh = fw / CM_BOARD_ASPECT;
  return {
    left: (w - fw) / 2,
    top: (h - fh) / 2,
    w: fw,
    h: fh,
    scale: fw,
  };
}

/** Board units → CSS pixels. */
export function toScreen(f: Floor, x: number, y: number): { x: number; y: number } {
  return { x: f.left + x * f.scale, y: f.top + y * f.scale };
}

/** CSS pixels → board units. Not clamped: the caller decides what off-floor means. */
export function toBoard(f: Floor, x: number, y: number): { x: number; y: number } {
  return { x: (x - f.left) / f.scale, y: (y - f.top) / f.scale };
}

/** True when a point is on the floor, with `slop` board units of tolerance. */
export function onFloor(x: number, y: number, slop = 0): boolean {
  return x >= -slop && x <= 1 + slop && y >= -slop && y <= CM_BOARD_H + slop;
}
