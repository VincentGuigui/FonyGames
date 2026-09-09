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
 * ## Where "down" comes from, and why it is a vector
 *
 * The same `deviceorientation` event the steering already reads, so there is no
 * second sensor and no second permission (spec §5).
 *
 * This was first written as an *angle*, and the signs were guessed and wrong in
 * two of the four quadrants. A vector is the honest form, because it can be
 * derived rather than guessed — from the actual device-orientation rotation
 * matrix (`Rz(alpha) Rx(beta) Ry(gamma)`, the W3C's own composition order),
 * gravity in device axes (X right, Y up the screen, Z out of it) is
 *
 *     gx = cos(beta) * sin(gamma)
 *     gy = -sin(beta)
 *     gz = -cos(beta) * cos(gamma)
 *
 * Device X and screen X point the same way — both "right", with no screen
 * rotation in play — so `gx` carries straight over. Only Y needs flipping: the
 * screen's own y runs *down*, i.e. along device −Y. So in screen coordinates
 * gravity points along `(cos(beta) * sin(gamma), sin(beta))`, which every pose
 * then checks out against:
 *
 * **A previous version had `(-sin(gamma), sin(beta) * cos(gamma))`** — missing
 * `beta`'s cosine on the gamma term and carrying a spurious one on the beta
 * term. The two formulas agree at the four poses below, because each one holds
 * `beta` or `gamma` at a value whose cosine is 0 or 1 — but they disagree as
 * soon as *both* are away from those extremes at once, which is any ordinary
 * grip on the phone. Worse than a wrong number: holding a small, steady roll
 * and simply pitching the phone back and forth (beta sweeping through 90°)
 * flips the sign the old formula reported for that roll, which read as the car
 * changing direction on its own from a motion that was not steering at all.
 *
 * **A later version also carried an extra `-` on `gx`**, copied over from
 * `roll.ts`'s own need (below) without noticing the two consumers want
 * opposite things here. It passed every test in this file because the pose
 * table's "right"/"left" labels were guessed to match the wrong sign instead
 * of a real phone — the button then slid to the edge opposite the player's
 * thumb, which is this vector's own stated worst failure mode (above).
 *
 * | Pose | `beta` | `gamma` | Screen direction |
 * | --- | --- | --- | --- |
 * | held upright | 90 | 0 | `(0, 1)` — down the screen |
 * | upside down | −90 | 0 | `(0, −1)` — up the screen |
 * | right edge down | 0 | 90 | `(1, 0)` — screen right |
 * | left edge down | 0 | −90 | `(−1, 0)` — screen left |
 *
 * Note this is a statement about *gravity*, and deliberately independent of the
 * steering's own sign convention in `core/sensors/steer.ts`: the button goes
 * where down is, whichever way tilting happens to steer.
 *
 * ## Why `roll.ts` negates this vector's `x` and this file does not
 *
 * `roll.ts` wants "clockwise on the wrist is clockwise on the road" — but
 * screen-relative gravity turns the *other* way from the device: spin the
 * phone clockwise in your hand and, relative to its own now-rotated screen,
 * the (externally fixed) pull of gravity swings counter-clockwise, the way a
 * car ahead appears to curve one way when you are the one steering the other.
 * `rollAngle` corrects for that with its own `-`. This vector stays the raw,
 * uncorrected screen direction, because the button has no such correction to
 * make — it only ever needs to know which edge is lowest right now.
 */

/** A position on the screen's edge, as a fraction of width and height. */
export type EdgeSpot = {
  /** 0..1 across the viewport. */
  x: number;
  /** 0..1 down the viewport. */
  y: number;
};

/** A direction in screen coordinates: `x` right, `y` down. */
export type ScreenVector = { x: number; y: number };

/** How far in from the very edge the button sits, as a fraction. Keeps it
 *  clear of a rounded corner and the home-bar area. */
export const EDGE_INSET = 0.12;

const RAD = Math.PI / 180;

/**
 * Which way gravity pulls, in screen coordinates. Not normalised — only the
 * direction is ever used, and a phone flat on a table has almost no in-plane
 * gravity at all, which `edgeSpot` handles by falling back to the bottom.
 */
export function downVector(gamma: number | null, beta: number | null): ScreenVector {
  const g = (gamma ?? 0) * RAD;
  const b = (beta ?? 90) * RAD;
  return { x: Math.cos(b) * Math.sin(g), y: Math.sin(b) };
}

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
