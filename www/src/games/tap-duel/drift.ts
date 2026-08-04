import { TARGET_MAX_X, TARGET_MAX_Y, TARGET_MIN_X, TARGET_MIN_Y } from '../../../../shared/protocol';

/**
 * Where the target has wandered to. Spec: docs/specs/games/tap-duel.md §4
 *
 * While the screen says GET READY the target drifts: a straight leg of about 150 px,
 * then a new direction, over and over. So a thumb cannot be parked on it in advance,
 * which is what makes the "bit of accuracy" in the pitch real rather than nominal.
 *
 * ## Why this is arithmetic and not `Math.random()`
 *
 * The server picks the target's position precisely so it is **the same on every
 * screen** — a per-client position would decide the round by luck (roadmap,
 * 2026-08-03). A per-client random walk would hand that straight back: at the instant
 * of the signal each player's target would be somewhere else, so one of them would
 * have a shorter thumb-travel than the others.
 *
 * So the walk is a pure function of `(origin, seed, elapsed)`. Every phone has the
 * same origin, the same seed (the round id) and a **server-corrected clock**, so every
 * phone draws the target in the same place at the same instant, and the position it
 * freezes at when the signal fires is identical for everyone.
 *
 * ## Units
 *
 * Fractions of the viewport, like the server's `target`, and bounded by the same
 * `TARGET_*` box so the drift can never put the target under the chrome.
 *
 * A leg is a fixed fraction of the **width**, with the vertical component divided by a
 * reference aspect ratio rather than the real one. A real aspect would make the path
 * depend on the phone, which is the cross-phone agreement above thrown away for a
 * cosmetic gain; a constant keeps the motion near-isotropic on a typical phone and
 * identical everywhere.
 */

/** One straight leg before a new direction is chosen. */
export const DRIFT_LEG_MS = 700;

/**
 * Leg length as a fraction of viewport width: ~150 px on a 390 px phone, which is
 * about one target's width of travel.
 */
export const DRIFT_LEG = 150 / 390;

/** 390 × 844 — a mid-range phone, used only to keep x and y in proportion. */
const REF_ASPECT = 844 / 390;

/**
 * Legs to walk before giving up.
 *
 * The armed window is at most `FIRE_MAX_MS` (6 s), so nine legs is the real ceiling.
 * The cap is here because `elapsed` comes from a clock: a phone that wakes from sleep
 * with a stale offset could ask for a preposterous time, and this loop must not be the
 * thing that hangs the frame.
 */
const MAX_LEGS = 32;

/**
 * Reflect `v` into `[lo, hi]`, so the target bounces off the box instead of stopping
 * dead against it or being clamped into a corner and staying there.
 *
 * The twin of `foldInto` in `shared/spillGeometry.ts`. Written out rather than imported
 * so Tap Duel does not depend on Spill's geometry for four lines of arithmetic.
 */
function fold(v: number, lo: number, hi: number): number {
  const span = hi - lo;
  if (span <= 0) return lo;
  // Two spans is one full there-and-back, so the pattern repeats on that period.
  const t = (((v - lo) % (2 * span)) + 2 * span) % (2 * span);
  return lo + (t <= span ? t : 2 * span - t);
}

/** Direction of leg `i`, in radians. An integer hash, so successive legs are unalike. */
function angle(seed: number, i: number): number {
  const h = Math.imul((seed | 0) ^ Math.imul(i + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
  return (h / 0x100000000) * Math.PI * 2;
}

/**
 * The target's position `elapsed` ms into the armed window.
 *
 * Pure. Same inputs, same answer, on every phone and in the test harness.
 */
export function driftAt(
  origin: { x: number; y: number },
  seed: number,
  elapsedMs: number,
): { x: number; y: number } {
  let x = origin.x;
  let y = origin.y;
  if (!(elapsedMs > 0)) return { x, y };

  const legs = Math.min(MAX_LEGS, Math.floor(elapsedMs / DRIFT_LEG_MS));
  for (let i = 0; i <= legs; i++) {
    // The last leg is only partly walked — that is what makes this continuous
    // rather than a jump every 700 ms.
    const part =
      i < legs ? 1 : Math.min(1, (elapsedMs - legs * DRIFT_LEG_MS) / DRIFT_LEG_MS);
    const a = angle(seed, i);
    x = fold(x + Math.cos(a) * DRIFT_LEG * part, TARGET_MIN_X, TARGET_MAX_X);
    y = fold(y + (Math.sin(a) * DRIFT_LEG * part) / REF_ASPECT, TARGET_MIN_Y, TARGET_MAX_Y);
  }
  return { x, y };
}
