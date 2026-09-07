import { ASTEROID_REACH } from './game';

/**
 * Which of the ship sheet's 25 poses to draw. Spec: docs/specs/games/asteroid-race.md §13
 *
 * **No DOM in this file** — the same split `pass-the-bomb/shockwave.ts` makes,
 * and for the same reason: `render.ts` reads `window.matchMedia` and builds an
 * `Image` at module scope, so nothing in it can be imported by a test on plain
 * Node (docs/testing.md §1.1). The pose is a *stated rule* now that it is
 * banded rather than linear, so it belongs somewhere it can be asserted.
 * `reducedMotion` is therefore a parameter here rather than a media query;
 * `render.ts` keeps owning the query itself.
 */

/** Column 0 is the sheet's own "viewed from the right" pose and column 4 its
 *  "viewed from the left" (row 0 "from above", row 4 "from below") — a hull
 *  offset to the right or climbing toward the tube's own "up" walks toward the
 *  higher index on each axis, the same direction both axes use. Untested on a
 *  real thumb (spec §12): if a bank reads backwards, this is the one place to
 *  flip it. */
export const SHIP_SHEET_COLS = 5;
export const SHIP_SHEET_ROWS = 5;

/**
 * How the hull's range of movement is shared out between the poses on one
 * axis, as cumulative fractions of `ASTEROID_REACH`: the neutral pose owns the
 * middle **40%** of the range, the two small banks **40%** between them, and
 * the two hard banks the outer **20%**.
 *
 * Quantising linearly with `Math.round` — which is what this did first — gives
 * the neutral pose only the middle 25% and hands the hard banks 25% of their
 * own, so a ship flying straight almost never looked like it, and the sheet's
 * edge frames turned up during ordinary steering. The poses are not evenly
 * spaced camera angles to be sampled evenly; the middle one is the resting
 * state and has to read as one.
 */
const BANDS = [0.4, 0.8];

function clampUnit(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

/** How many steps out from the middle frame an offset of `n` (−1..1) sits. */
function stepFrom(n: number): number {
  const a = Math.abs(n);
  let i = 0;
  // `?? 1` is unreachable — the bounds check has already run — but `noUncheckedIndexedAccess`
  // cannot see that, and a cast would hide a real out-of-range read later.
  while (i < BANDS.length && a > (BANDS[i] ?? 1)) i += 1;
  return Math.sign(n) * i;
}

function axis(offset: number, frames: number): number {
  const middle = (frames - 1) / 2;
  return middle + stepFrom(clampUnit(offset / ASTEROID_REACH));
}

/**
 * `x`/`y` are the hull's own offset from the tube's axis, in world units —
 * `run.x`/`run.y` — **not the steer that is currently moving it**. The offset
 * is bounded to `±ASTEROID_REACH` by the flight itself, so the sheet's edge
 * frames mean "at the wall" and the middle one means "on the axis". Reading
 * the raw tilt instead would pin an extreme frame for as long as the phone
 * stayed tilted that hard, long after the hull had stopped at the wall with
 * nowhere further to lean — and it would fight the steer's own recentring
 * (`core/sensors/steer.ts`), which fades a held tilt back toward neutral: a
 * pose driven by tilt would keep banking hard after the tilt had already
 * stopped meaning anything.
 */
export function shipFrame(x: number, y: number, reducedMotion: boolean): { col: number; row: number } {
  const middle = { col: (SHIP_SHEET_COLS - 1) / 2, row: (SHIP_SHEET_ROWS - 1) / 2 };
  // `prefers-reduced-motion` freezes the ship on its own centre frame (§11).
  if (reducedMotion) return middle;
  return { col: axis(x, SHIP_SHEET_COLS), row: axis(y, SHIP_SHEET_ROWS) };
}

/** The bands and the sheet have to stay in step: two thresholds is exactly the
 *  two steps a five-frame axis has either side of its middle. Exported so the
 *  test can pin it rather than restate the numbers. */
export const POSE_BANDS: readonly number[] = BANDS;
