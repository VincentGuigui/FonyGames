import { onMotion, type MotionSample } from './motion';
import { SHAKE_REFRACTORY_MS, SHAKE_THRESHOLD } from '../../../../shared/protocol';

/**
 * Shake detection — counting how many times a phone changed direction.
 * Spec: docs/specs/games/shake-rush.md §2.1
 *
 * The fourth interpreter of the accelerometer, beside `bump.ts` and `steady.ts`,
 * and like them the only place its game reads a raw sample.
 *
 * ## A shake is a reversal, not a magnitude
 *
 * The obvious implementation — sum the acceleration — is wrong in a way that
 * matters. It rewards violence: the harder you swing, the bigger the number, so
 * the winning strategy becomes swinging a phone as hard as a human can, which is
 * how a phone leaves someone's hand and hits a wall. Counting **direction
 * reversals** makes a gentle fast shake beat a wild slow one, and it equalises
 * the hardware too, since peak magnitude varies with a phone's mass and case
 * while a count of reversals does not.
 *
 * ## Per axis, with one shared refractory
 *
 * Each axis is high-passed against its own slow baseline — which is what removes
 * gravity, whichever way the phone is being held — and a reversal is a crossing
 * of `SHAKE_THRESHOLD` in the opposite direction to the last one on that axis.
 * The refractory is **shared across axes** rather than per axis: a real shake is
 * never aligned to one of them, so one physical movement crosses two or three and
 * would otherwise be counted two or three times.
 */

/** How fast the per-axis baseline tracks. Slow enough that a shake cannot drag it. */
const BASELINE_ALPHA = 0.02;

export type ShakeReading = {
  /** Reversals since the last read. */
  n: number;
  /**
   * How many samples the window contained.
   *
   * Zero is not the same as "did not move": an empty window is a phone whose
   * sensor has stopped, and reporting it as a real frame is what would keep a
   * backgrounded runner from ever being marked `away` (spec §7). Same lesson as
   * `steady.ts`, learnt the same way.
   */
  samples: number;
};

export type ShakeDetector = {
  /** Take the count since the last call, and start a fresh window. */
  read: () => ShakeReading;
  stop: () => void;
};

/**
 * The counting itself, with no sensor attached.
 *
 * Split out so the rule can be tested against a hand-written stream of samples
 * rather than against a DOM: this is the function that decides who wins, and
 * "did that count as a shake" is not something to eyeball.
 */
export function shakeCounter(threshold = SHAKE_THRESHOLD, refractoryMs = SHAKE_REFRACTORY_MS) {
  /** Per axis: its slow baseline, and the direction of its last counted crossing. */
  type Axis = { baseline: number; lastDir: -1 | 0 | 1 };
  const axes: [Axis, Axis, Axis] = [
    { baseline: 0, lastDir: 0 },
    { baseline: 0, lastDir: 0 },
    { baseline: 0, lastDir: 0 },
  ];
  let seeded = false;
  let lastShakeAt = -Infinity;

  return {
    /** Feed one sample. Returns 1 if it completed a reversal, 0 otherwise. */
    feed(x: number, y: number, z: number, at: number): number {
      const reading = [
        [x, axes[0]],
        [y, axes[1]],
        [z, axes[2]],
      ] as const;

      // Seed from the first sample rather than from zero, or the phone's resting
      // gravity reads as a violent shake for the first second of every round.
      if (!seeded) {
        for (const [v, ax] of reading) ax.baseline = v;
        seeded = true;
        return 0;
      }

      let counted = 0;

      for (const [v, ax] of reading) {
        const f = v - ax.baseline;

        // Track the baseline only while this axis is calm — the same reason as
        // `bump.ts`: a real movement must not drag the baseline up behind it and
        // mask the next one.
        if (Math.abs(f) < threshold / 2) ax.baseline += (v - ax.baseline) * BASELINE_ALPHA;

        if (Math.abs(f) < threshold) continue;

        const dir = f > 0 ? 1 : -1;
        // Same direction as this axis' last crossing: still the same swing, not a
        // new one. A reversal is what counts.
        if (dir === ax.lastDir) continue;

        ax.lastDir = dir;

        // The refractory is global, so one physical shake that crosses two axes
        // scores once. It is read after `lastDir` is updated, so a suppressed
        // crossing still arms the next reversal.
        if (at - lastShakeAt < refractoryMs) continue;

        lastShakeAt = at;
        counted = 1;
      }

      return counted;
    },
  };
}

/** Start watching. Nothing is reported until `read()` is called. */
export function detectShakes(): ShakeDetector {
  const counter = shakeCounter();
  let n = 0;
  let samples = 0;

  const stop = onMotion((s: MotionSample) => {
    samples += 1;
    n += counter.feed(s.x, s.y, s.z, s.at);
  });

  return {
    read: () => {
      const out = { n, samples };
      n = 0;
      samples = 0;
      return out;
    },
    stop,
  };
}
