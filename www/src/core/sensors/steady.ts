import { onMotion, type MotionSample } from './motion';
import { STEADY_HOLD_CONE_DEG } from '../../../../shared/protocol';

/**
 * How still a phone is being held — the opposite question to `bump.ts`.
 * Spec: docs/specs/games/steady-hand.md §2.1
 *
 * This is the third interpreter of the accelerometer beside `bump.ts` and the shake
 * detector, and like them it is the only place its game reads a raw sample.
 *
 * ## Wobble is a change, not a magnitude
 *
 * Gravity is 9.81 m/s² and always there, so the *magnitude* of acceleration says
 * almost nothing about whether a phone is moving — a phone sitting on a table and a
 * phone in freefall both read a constant number. What matters is how much the vector
 * moved since the last sample:
 *
 *     wobble = |a(t) - a(t-1)|
 *
 * ## And it is reported as a maximum, not a mean
 *
 * A flinch is exactly what the game is looking for, and a mean over 200 ms would
 * bury one. The detector keeps the worst sample of the current window and hands it
 * over when asked.
 */

export type SteadyReading = {
  /** Worst wobble seen since the last read, in m/s². */
  w: number;
  /** Is the phone still being held up, rather than lying flat? */
  held: boolean;
  /**
   * How many samples the window actually contained.
   *
   * **Zero is not the same as still**, and conflating them handed the game away: a
   * window with no samples has `w === 0`, which reads as a flawless hold. Reporting it
   * refreshes the referee's `lastSeen`, so the silence rule — the one thing stopping
   * "turn the sensor off and win" — could never fire. The caller must not send a
   * reading it did not take (spec §8).
   */
  samples: number;
};

export type SteadyDetector = {
  /** Take the worst reading since the last call, and start a fresh window. */
  read: () => SteadyReading;
  stop: () => void;
};

/**
 * Is the phone upright enough to count as held?
 *
 * With the screen facing the player, gravity runs down the device's **Y** axis. Lying
 * flat on a table puts almost all of it on **Z** instead. So the angle between the
 * gravity vector and the device's Z axis separates the two cleanly, and the cone is
 * generous because "held up" covers a lot of comfortable postures.
 *
 * Exported for the test: the boundary is the whole point of the rule, and a rule that
 * eliminates people is worth asserting rather than eyeballing.
 */
export function isHeld(x: number, y: number, z: number, coneDeg = STEADY_HOLD_CONE_DEG): boolean {
  const mag = Math.hypot(x, y, z);
  // No reading at all — do not accuse anyone of putting the phone down on the strength
  // of a zero vector, which is what a sensor returns while it is warming up.
  if (mag < 1) return true;

  // Angle between gravity and the screen normal. 0° is flat on its back, 180° flat on
  // its face, 90° is upright.
  const flatness = Math.abs(Math.acos(Math.min(1, Math.max(-1, z / mag))) * (180 / Math.PI) - 90);

  return flatness < 90 - coneDeg;
}

/** Start watching. Nothing is reported until `read()` is called. */
export function detectSteady(): SteadyDetector {
  let worst = 0;
  let held = true;
  let samples = 0;
  let prev: { x: number; y: number; z: number } | null = null;

  const stop = onMotion((s: MotionSample) => {
    const { x, y, z } = s;
    samples += 1;

    if (prev) {
      const d = Math.hypot(x - prev.x, y - prev.y, z - prev.z);
      if (d > worst) worst = d;
    }
    prev = { x, y, z };

    // A single flat sample does not mean the phone was put down — the referee needs it
    // sustained (spec §2.3) — so this reports the instantaneous truth and lets the
    // server decide.
    held = isHeld(x, y, z);
  });

  return {
    read: () => {
      const out = { w: worst, held, samples };
      worst = 0;
      samples = 0;
      return out;
    },
    stop,
  };
}
