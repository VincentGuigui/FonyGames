import { RHINO_MAX_STEP, RHINO_PUPIL_DAMP, RHINO_PUPIL_SPRING } from '../../../../shared/protocol';
import { downVector } from '../../core/sensors/gravity';

/**
 * Counting spins, and the dizzy eyes that show them.
 * Spec: docs/specs/games/rhino-spin.md §2.1, §4
 *
 * DOM-free so both can be tested without a phone.
 */

export type Spinner = {
  /** Gravity's screen angle at the last accepted sample, radians. */
  last: number | null;
  /** Unwrapped total sweep since the round began, signed. */
  swept: number;
};

export function newSpinner(): Spinner {
  return { last: null, swept: 0 };
}

/** Shortest signed angle from `a` to `b`, in −π..π. */
function delta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Fold one sensor reading in.
 *
 * A phone lying flat has no screen-plane gravity direction, so its reading is
 * dropped: resting on a table must not drift a count upwards. A step past
 * `RHINO_MAX_STEP` is a glitch — a real phone cannot turn most of a circle
 * between two samples — and is dropped without breaking the chain.
 */
export function feed(s: Spinner, gamma: number | null, beta: number | null): Spinner {
  const down = downVector(gamma, beta);
  if (Math.hypot(down.x, down.y) < 0.15) return s;

  const angle = Math.atan2(down.y, down.x);
  if (s.last === null) return { last: angle, swept: s.swept };

  const step = delta(s.last, angle);
  if (Math.abs(step) > RHINO_MAX_STEP) return { last: angle, swept: s.swept };
  return { last: angle, swept: s.swept + step };
}

/**
 * Completed rotations either way round.
 *
 * The epsilon is not cosmetic: a sweep accumulated from dozens of samples lands
 * a few ulps either side of a whole turn, and without it a clean single spin
 * floors to zero half the time.
 */
export function spins(s: Spinner): number {
  return Math.floor((Math.abs(s.swept) + 1e-6) / (Math.PI * 2));
}

export type Eyes = {
  /** Where the pupils sit, radians round the rim. */
  angle: number;
  /** How fast that is changing, radians per second. */
  rate: number;
};

export function newEyes(): Eyes {
  return { angle: Math.PI / 2, rate: 0 };
}

/**
 * The pupils chase gravity through a damped spring, so they overshoot, keep
 * rolling after the phone stops, and wind down on their own. Snapping them to
 * the gravity angle would be accurate and would not look dizzy at all.
 *
 * `target` is null when the phone is flat and there is nothing to chase; the
 * eyes then just coast, which is the same thing they do after the round.
 */
export function spinEyes(e: Eyes, target: number | null, dtMs: number): Eyes {
  const dt = Math.min(0.05, Math.max(0, dtMs) / 1000);
  let rate = e.rate;
  if (target !== null) rate += delta(e.angle, target) * RHINO_PUPIL_SPRING * dt;
  rate -= rate * RHINO_PUPIL_DAMP * dt;
  return { angle: e.angle + rate * dt, rate };
}

/** Gravity's screen angle, or null when the phone is too flat to have one. */
export function gravityAngle(gamma: number | null, beta: number | null): number | null {
  const down = downVector(gamma, beta);
  if (Math.hypot(down.x, down.y) < 0.15) return null;
  return Math.atan2(down.y, down.x);
}
