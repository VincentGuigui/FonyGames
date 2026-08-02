import { SPILL_AIM_FRACTION } from './protocol';

/**
 * Spill's shared coordinate frame. Spec: docs/specs/games/spill.md §2
 *
 * Both the worker (which referees every flick) and the browser (which draws the
 * layout diagram and the aim preview) have to agree on this exactly, so it lives
 * here rather than being written twice. It must stay DOM-free.
 *
 * **The table frame is the view from above**, and it uses the same handedness as
 * a canvas: x right, y down, angles measured *clockwise from up*. Keeping one
 * handedness everywhere is what stops the aiming maths quietly mirroring itself
 * somewhere between the two codebases.
 *
 * Seat `k` of `n` sits at table angle `αₖ = 2πk/n`, so seat 0 is at the top of
 * the diagram. Every phone is laid out with its **top edge pointing at the table
 * centre**, which is the one convention players are asked to follow — so the
 * screen-up direction of seat `k` is the table bearing `αₖ + π`.
 */

/** Where seat `k` sits, on a unit circle around the table centre. */
export function seatPos(k: number, n: number): { x: number; y: number } {
  const a = (2 * Math.PI * k) / n;
  return { x: Math.sin(a), y: -Math.cos(a) };
}

/** Fold any angle into (-π, π]. */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** The table bearing you must travel along to get from seat `k` to seat `j`. */
export function bearingBetween(k: number, j: number, n: number): number {
  const from = seatPos(k, n);
  const to = seatPos(j, n);
  return Math.atan2(to.x - from.x, -(to.y - from.y));
}

/** A flick at screen angle `screenAngle` from seat `k`, as a table bearing. */
export function flickBearing(k: number, screenAngle: number, n: number): number {
  return (2 * Math.PI * k) / n + Math.PI + screenAngle;
}

/** How far off a perfect flick may be and still land on a phone. */
export function aimTolerance(n: number): number {
  return (SPILL_AIM_FRACTION * Math.PI) / n;
}

/**
 * Which seat a flick hits, or null when the water sails off the table.
 *
 * `screenAngle` is radians **clockwise from the top of the thrower's screen** —
 * for a drag of (dx, dy) in canvas pixels that is `Math.atan2(dx, -dy)`.
 */
export function aimSeat(from: number, screenAngle: number, n: number): number | null {
  const bearing = flickBearing(from, screenAngle, n);

  let best: number | null = null;
  let bestErr = Infinity;
  for (let j = 0; j < n; j++) {
    if (j === from) continue;
    const err = Math.abs(wrapAngle(bearing - bearingBetween(from, j, n)));
    if (err < bestErr) {
      bestErr = err;
      best = j;
    }
  }

  return bestErr <= aimTolerance(n) ? best : null;
}

/**
 * The screen angle that hits seat `j` dead-on. The client uses this to draw the
 * layout diagram from the player's own point of view — a target drawn at this
 * angle on their screen is a target they can flick straight at.
 */
export function screenAngleTo(from: number, to: number, n: number): number {
  return wrapAngle(bearingBetween(from, to, n) - flickBearing(from, 0, n));
}
