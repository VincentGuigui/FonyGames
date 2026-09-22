/**
 * Which way gravity pulls, in screen coordinates — from a raw
 * `deviceorientation` reading, no calibration and no reference pose.
 *
 * Shared, because two games want the identical vector for unrelated reasons:
 * Tilt Race's reverse button follows the lowest screen edge
 * (`games/tilt-race/gravityButton.ts`, which owns the note on why that file
 * does not negate `x` and `roll.ts` does), and a Crowd Race player walks
 * "whichever way is up, as gravity currently sees it"
 * (docs/specs/games/crowd-race.md §5) — the same primitive, opposite sign.
 *
 * Derived from the actual device-orientation rotation matrix
 * (`Rz(alpha) Rx(beta) Ry(gamma)`, the W3C's own composition order): gravity
 * in device axes (X right, Y up the screen, Z out of it) is
 *
 *     gx = cos(beta) * sin(gamma)
 *     gy = -sin(beta)
 *
 * Device X and screen X point the same way — both "right", with no screen
 * rotation in play — so `gx` carries straight over. Only Y needs flipping:
 * the screen's own y runs *down*, i.e. along device −Y. So in screen
 * coordinates gravity points along `(cos(beta) * sin(gamma), sin(beta))`.
 * `gravityButton.test.ts` pins this pose by pose; nothing here repeats that
 * table since the vector itself did not move.
 */

/** A direction in screen coordinates: `x` right, `y` down. */
export type ScreenVector = { x: number; y: number };

const RAD = Math.PI / 180;

/**
 * Which way gravity pulls, in screen coordinates. Not normalised — only the
 * direction is ever used, and a phone flat on a table has almost no in-plane
 * gravity at all, which each caller handles in its own way (Tilt Race's
 * button falls back to the bottom; Crowd Race holds the last heading).
 */
export function downVector(gamma: number | null, beta: number | null): ScreenVector {
  const g = (gamma ?? 0) * RAD;
  const b = (beta ?? 90) * RAD;
  return { x: Math.cos(b) * Math.sin(g), y: Math.sin(b) };
}
