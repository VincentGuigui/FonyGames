import { onMotion, type MotionSample } from './motion';

/**
 * Bump detection — two phones gently tapped together.
 *
 * This is the reference implementation of the algorithm defined once in
 * docs/device-capabilities.md §3. Every game that uses bumps goes through here;
 * none reimplements it.
 *
 * The detector only ever says "this phone felt a knock". It is the **server**
 * that pairs two knocks into a contact, so a single unpaired spike — someone
 * putting their phone down — means nothing.
 *
 * ## What a knock is: a sharp EDGE, not a moment of stillness
 *
 * The first version required 150 ms of near-stillness before a spike would count, where
 * "not still" meant any sample half the knock threshold above the baseline. That is the
 * bug this file was rewritten for: **you swing a phone to meet another one**, and the
 * swing is 6–10 m/s² of perfectly ordinary movement, so the run-up disqualified the very
 * knock it led to. Two phones both had to pass that test in the same tenth of a second, so
 * the failure compounded — a room of people knocking phones together and nothing
 * happening.
 *
 * What separates a knock from a swing is not calm beforehand, it is **how fast the reading
 * changes**: a contact is a step of tens of m/s² between consecutive samples (~16 ms
 * apart), while even a violent swing ramps over a hundred milliseconds or more. So the
 * test is the rising edge — this sample is over the line and the one before it was not,
 * with a big jump between them.
 *
 * Continuous shaking is rejected on its own terms instead of as a side effect: if most of
 * the last half second has been over the line, this phone is being waved about, and
 * nothing it reports is a knock.
 */

/** Spike above the rolling baseline that counts as a knock, m/s². */
export const BUMP_THRESHOLD = 12;

/** No second bump accepted within this window. Also the anti-spam floor. */
export const BUMP_THROTTLE_MS = 300;

/**
 * How much the reading must JUMP between two consecutive samples, m/s².
 *
 * The edge test, and the one that tells a knock from a hard swing. Sensors deliver every
 * ~16 ms; a phone hitting another phone gains its whole spike inside one or two of those,
 * a swung arm takes ten. Set below the threshold on purpose — the spike does not have to
 * arrive in a single sample, it has to arrive *fast*.
 */
export const BUMP_JERK = 7;

/** A phone over the line for more than this fraction of `SHAKE_WINDOW_MS` is being waved. */
const SHAKE_FRACTION = 0.5;
const SHAKE_WINDOW_MS = 500;

/** Rolling baseline smoothing. Low so gravity tracks, high enough to ignore a knock. */
const BASELINE_ALPHA = 0.02;

export type BumpDetector = {
  stop: () => void;
};

/**
 * The counting itself, with no sensor attached.
 *
 * Split out so the rule can be tested against a hand-written stream of samples rather than
 * against a DOM — "was that a knock or a swing" is the whole game here, and it is not
 * something to settle by waving a phone about and hoping.
 */
export function bumpCounter(threshold = BUMP_THRESHOLD, jerk = BUMP_JERK) {
  // Seeded at gravity so the first samples do not read as a huge spike.
  let baseline = 9.81;
  let lastBumpAt = -Infinity;
  let prevDelta = 0;
  /** Times of recent over-the-line samples, for the anti-shake rule. */
  let hot: number[] = [];

  return {
    /** Feed one sample. Returns true when it was a knock. */
    feed(magnitude: number, at: number): boolean {
      const delta = Math.abs(magnitude - baseline);

      // Track the baseline only while nothing much is happening, so a real knock does not
      // drag it up and mask the next one. The gate is the full threshold now, not half of
      // it: a phone being carried towards another phone is still a phone at rest as far as
      // "what does gravity read" is concerned.
      if (delta < threshold) baseline += (magnitude - baseline) * BASELINE_ALPHA;

      if (delta >= threshold) hot.push(at);
      hot = hot.filter((t) => at - t < SHAKE_WINDOW_MS);

      const rising = delta >= threshold && prevDelta < threshold;
      const sharp = delta - prevDelta >= jerk;
      const throttled = at - lastBumpAt < BUMP_THROTTLE_MS;
      /*
       * Sustained agitation, measured in samples rather than in time: at ~60 Hz half a
       * second is ~30 samples, and being over the line for more than half of them is
       * shaking, not a series of knocks. A real knock leaves one or two hot samples.
       */
      const shaking = hot.length > (SHAKE_WINDOW_MS / 16) * SHAKE_FRACTION;

      prevDelta = delta;

      if (!rising || !sharp || throttled || shaking) return false;

      lastBumpAt = at;
      return true;
    },
  };
}

/**
 * Start listening. `onBump` fires with `performance.now()` of the spike; the
 * caller converts to server time before sending.
 */
export function detectBumps(onBump: (at: number) => void): BumpDetector {
  const counter = bumpCounter();

  const stop = onMotion((s: MotionSample) => {
    if (counter.feed(s.magnitude, s.at)) onBump(s.at);
  });

  return { stop };
}
