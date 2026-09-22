/**
 * Where the reverse button sits. Spec: docs/specs/games/tilt-race.md §2, §5
 *
 * The issue asks for a button that "stays always at the bottom (using down
 * gsensor), and follows edges of the screen", and that "is fixed when pressed
 * and falls into place when released".
 *
 * DOM-free and pure, so the placement rule can be tested without a phone —
 * which matters more here than usual, because the whole rule is signs, and the
 * failure mode is a button on the opposite edge from the player's thumb, which
 * reads as the control being broken rather than misplaced.
 *
 * `downVector` — the direction gravity pulls, in screen coordinates, from a
 * raw `deviceorientation` reading — now lives in `core/sensors/gravity.ts`,
 * which has its derivation and the two sign bugs it has already had. Moved
 * there once Crowd Race needed the identical vector for a second, unrelated
 * reason; re-exported here so nothing importing it from this file had to
 * change.
 *
 * ## Why `roll.ts` negates this vector's `x` and this file does not
 *
 * `roll.ts` wants "clockwise on the wrist is clockwise on the road" — but
 * screen-relative gravity turns the *other* way from the device: spin the
 * phone clockwise in your hand and, relative to its own now-rotated screen,
 * the (externally fixed) pull of gravity swings counter-clockwise, the way a
 * car ahead appears to curve one way when you are the one steering the other.
 * `rollAngle` corrects for that with its own `-`. This file uses the raw,
 * uncorrected screen direction, because the button has no such correction to
 * make — it only ever needs to know which edge is lowest right now.
 */

import { downVector, type ScreenVector } from '../../core/sensors/gravity';

export { downVector, type ScreenVector };

/** A position on the screen's edge, as a fraction of width and height. */
export type EdgeSpot = {
  /** 0..1 across the viewport. */
  x: number;
  /** 0..1 down the viewport. */
  y: number;
};

/** How far in from the very edge the button sits, as a fraction. Keeps it
 *  clear of a rounded corner and the home-bar area. */
export const EDGE_INSET = 0.12;

/**
 * Follow a direction to a point on the screen's edge.
 *
 * The edge, not a circle: the issue says the button follows the edges, and a
 * circular path would put it in the middle of the board on a portrait screen.
 * So this casts a ray from the centre and stops at whichever edge it meets
 * first — the standard ray-to-rectangle clip, in fractional coordinates so it
 * needs no pixel sizes.
 *
 * A phone lying flat has no in-plane direction to follow, so the button goes
 * to the bottom rather than to wherever the noise points.
 */
export function edgeSpot(dir: ScreenVector, inset = EDGE_INSET): EdgeSpot {
  const size = Math.hypot(dir.x, dir.y);
  const dx = size < 0.05 ? 0 : dir.x / size;
  const dy = size < 0.05 ? 1 : dir.y / size;
  const reach = 0.5 - inset;
  const tx = Math.abs(dx) < 1e-6 ? Infinity : reach / Math.abs(dx);
  const ty = Math.abs(dy) < 1e-6 ? Infinity : reach / Math.abs(dy);
  const t = Math.min(tx, ty);
  return {
    x: Math.min(1 - inset, Math.max(inset, 0.5 + dx * t)),
    y: Math.min(1 - inset, Math.max(inset, 0.5 + dy * t)),
  };
}

/**
 * The button's live position, given the phone's orientation and whether it is
 * currently held.
 *
 * **Held means frozen** (the issue's own rule): a button that slid out from
 * under a thumb already on it would be unusable, so the position stops
 * updating for as long as it is pressed and falls back into place on release.
 */
export function reverseSpot(
  gamma: number | null,
  beta: number | null,
  held: boolean,
  frozen: EdgeSpot | null,
): EdgeSpot {
  if (held && frozen) return frozen;
  return edgeSpot(downVector(gamma, beta));
}

/**
 * How far to turn the button's face so its own "up" is the real world's up,
 * radians clockwise (issue #43).
 *
 * The button slides round the screen's edge to stay under the lowest thumb,
 * but its arrow stayed pinned to the screen, so held sideways it pointed along
 * the ground. Turning the face by gravity's own screen angle keeps the arrow
 * pointing at the real floor whatever the phone is doing.
 *
 * Screen-down is `(0, 1)`, which is `PI/2` in `atan2` terms, so that is the
 * offset taken off. Frozen while held, for the same reason the position is:
 * nothing about the button may move under a thumb already on it.
 */
export function reverseSpin(
  gamma: number | null,
  beta: number | null,
  held: boolean,
  frozen: number | null,
): number {
  if (held && frozen !== null) return frozen;
  const down = downVector(gamma, beta);
  // Flat on a table there is no screen-down to point at; leave the face alone
  // rather than snapping it a quarter turn on a reading of nothing.
  if (Math.hypot(down.x, down.y) < 1e-6) return 0;
  return Math.atan2(down.y, down.x) - Math.PI / 2;
}
