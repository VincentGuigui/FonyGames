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
/** Direction changes every 1.2 s ± 0.2 s, deterministically per round/leg. */
export const DRIFT_LEG_MS = 1_200;
export const DRIFT_LEG_MIN_MS = 1_000;
export const DRIFT_LEG_MAX_MS = 1_400;

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
 * The armed window is at most `FIRE_MAX_MS` (6 s) and the drift runs at up to
 * `DRIFT_SPEED_MAX`, so about twenty legs is the real ceiling.
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

function legDuration(seed: number, i: number): number {
  const h = Math.imul((seed | 0) ^ Math.imul(i + 17, 0x27d4eb2d), 0x165667b1) >>> 0;
  return DRIFT_LEG_MIN_MS + Math.floor((h / 0x100000000) * (DRIFT_LEG_MAX_MS - DRIFT_LEG_MIN_MS + 1));
}

/**
 * The target's position `elapsed` ms into the armed window.
 *
 * Pure. Same inputs, same answer, on every phone and in the test harness.
 *
 * `speed` scales the CLOCK rather than the leg length, which is what makes the ramp free:
 * the walk is already a function of elapsed time, so running that clock faster covers the
 * same path more quickly and turns corners sooner. Scaling the leg length instead would
 * have made a fast target take longer strides in the same rhythm, which reads as teleporting
 * rather than as hurrying. The server sends it (`driftSpeed` in protocol.ts) so no two
 * phones can disagree.
 */
export function driftAt(
  origin: { x: number; y: number },
  seed: number,
  elapsedMs: number,
  speed = 1,
): { x: number; y: number } {
  let x = origin.x;
  let y = origin.y;
  let walked = elapsedMs * (Number.isFinite(speed) && speed > 0 ? speed : 1);
  if (!(walked > 0)) return { x, y };

  for (let i = 0; i < MAX_LEGS && walked > 0; i++) {
    const duration = legDuration(seed, i);
    const part = Math.min(1, walked / duration);
    const a = angle(seed, i);
    x = fold(x + Math.cos(a) * DRIFT_LEG * part, TARGET_MIN_X, TARGET_MAX_X);
    y = fold(y + (Math.sin(a) * DRIFT_LEG * part) / REF_ASPECT, TARGET_MIN_Y, TARGET_MAX_Y);
    walked -= duration;
  }
  return { x, y };
}
