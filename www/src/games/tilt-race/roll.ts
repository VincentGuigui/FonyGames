import { downVector } from './gravityButton';

/**
 * How far the phone has been rotated in its own plane, measured from upright.
 * Spec: docs/specs/games/tilt-race.md §2.1, §5
 *
 * **This is the steering wheel, and it is 1:1**: turn the phone through a
 * quarter, a half or a whole circle and the car's heading turns by exactly the
 * same angle. The map is drawn in a fixed orientation, so what the player sees
 * is a car rotating inside a track that stays put — which is why the mapping
 * can be absolute at all. A rate-based steer (tilt harder, turn faster) was the
 * first design and it is what the "1:1" here replaces.
 *
 * **Measured from upright, not from wherever the round happened to start.**
 * The earlier version zeroed on the first reading after a round began — "hold
 * it however you like" — so a car's heading at the green light matched
 * whatever direction the TRACK happened to start facing, not the phone.
 * Holding the phone upright could still show the car pointing sideways, and
 * every correction the player made was measured against that arbitrary
 * baseline rather than against upright — which read as the car turning
 * further than the wrist did. `drive.ts`'s `TILT_UPRIGHT_HEADING` is the
 * other half of the fix: `rollAngle` below is 0 at upright, always, and nothing
 * in this file shifts that zero any more.
 *
 * ## Why `gamma` cannot be the instrument
 *
 * `deviceorientation`'s `gamma` only spans −90..90 and folds back on itself
 * past vertical, so it cannot describe a phone turned right round — and turning
 * right round is the whole control. The in-plane direction of **gravity** can:
 * it sweeps a full circle as the phone rotates in its own plane, with no fold
 * and no gimbal, and `gravityButton.ts` already derives it (and tests it pose
 * by pose) for the reverse button. One instrument, two consumers.
 *
 * Held upright, gravity points down the screen and the angle is 0. Rotating the
 * phone clockwise brings its right edge down, which swings gravity toward
 * screen-right and the angle up — so **clockwise on the wrist is clockwise on
 * the road**, the sign the first version had backwards.
 *
 * DOM-free: no event listener in here, only the maths, so `roll.test.ts` can
 * turn a phone right round without a phone.
 */

/**
 * How much in-plane gravity a reading needs before it means anything.
 *
 * A phone flat on a table has almost none — the whole vector is out through the
 * screen — and its in-plane *direction* is then pure noise, which would spin the
 * car on its own. Below this the tracker holds its last angle rather than
 * following the noise. 0.25 is about 15 degrees off flat.
 */
export const ROLL_MIN_GRAVITY = 0.25;

/**
 * The phone's in-plane rotation, in radians, or null when it is too flat to
 * say. 0 is upright; clockwise is positive.
 */
export function rollAngle(gamma: number | null, beta: number | null): number | null {
  const down = downVector(gamma, beta);
  if (Math.hypot(down.x, down.y) < ROLL_MIN_GRAVITY) return null;
  // `down` is screen-relative gravity (`gravityButton.ts`'s own docstring has
  // the why): it swings screen-*left* when the phone turns clockwise, since
  // that is the mirror image of the device spinning the other way. This flips
  // it back, so `down` is (0, 1) when upright and this measures from straight
  // down, growing as the phone turns clockwise rather than shrinking.
  return Math.atan2(-down.x, down.y);
}

/** Shortest signed angle from `a` to `b`, in −π..π. */
function delta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export type RollTracker = {
  /** Feed one `deviceorientation` reading. */
  sample: (gamma: number | null, beta: number | null) => void;
  /** Discard the running total and re-sync to whatever the very next reading
   *  says, rather than trusting a `delta` against a possibly stale `last` —
   *  for a reused tracker; a freshly created one does not need it. */
  calibrate: () => void;
  /** Total rotation from upright, in radians, 0 there and growing the same
   *  clockwise-positive way `rollAngle` does. Unbounded, and continuous
   *  through as many whole turns as the player cares to make. */
  read: () => number;
};

/**
 * A roll tracker that **accumulates** rather than reporting an angle.
 *
 * `rollAngle` wraps at ±π, and a control that jumped by a full turn as the
 * player passed upside-down would be useless. So each sample adds the *short
 * way round* from the previous one to a running total: a phone turned twice
 * clockwise reads 4π, and the car has turned twice.
 *
 * There is no smoothing and no dead zone, both deliberately. Gravity's in-plane
 * direction is a far steadier signal than raw `gamma` — it is an angle of a
 * vector rather than one of its components — and a dead zone would break the
 * one property the control is for: that the wrist and the car agree exactly.
 */
export function rollTracker(): RollTracker {
  let last: number | null = null;
  let total = 0;
  let pendingCalibrate = false;

  return {
    sample: (gamma, beta) => {
      const now = rollAngle(gamma, beta);
      if (now === null) return;
      if (pendingCalibrate || last === null) {
        // Seeded with the reading itself, not zeroed: `total` IS the angle
        // from upright, and the first sample already says what that is.
        last = now;
        total = now;
        pendingCalibrate = false;
        return;
      }
      total += delta(last, now);
      last = now;
    },
    calibrate: () => {
      pendingCalibrate = true;
    },
    read: () => total,
  };
}
