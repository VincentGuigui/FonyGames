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
 */

/** Spike above the rolling baseline that counts as a knock, m/s². */
export const BUMP_THRESHOLD = 12;

/** No second bump accepted within this window. Also the anti-spam floor. */
export const BUMP_THROTTLE_MS = 300;

/** The run-up must be calm for this long before a spike counts. */
export const CALM_BEFORE_MS = 150;

/** Rolling baseline smoothing. Low so gravity tracks, high enough to ignore a knock. */
const BASELINE_ALPHA = 0.02;

export type BumpDetector = {
  stop: () => void;
};

/**
 * Start listening. `onBump` fires with `performance.now()` of the spike; the
 * caller converts to server time before sending.
 */
export function detectBumps(onBump: (at: number) => void): BumpDetector {
  // Seeded at gravity so the first samples do not read as a huge spike.
  let baseline = 9.81;
  let lastBumpAt = -Infinity;
  // Seeded to "now", NOT -Infinity: a detector started while the phone is
  // already being shaken would otherwise treat its very first sample as calm
  // and fire one spurious bump before it has observed anything.
  let lastAgitatedAt = performance.now();

  const stop = onMotion((s: MotionSample) => {
    const delta = Math.abs(s.magnitude - baseline);

    // Read BEFORE updating: the spike we are judging must not count as its own
    // run-up agitation, or nothing would ever qualify as calm.
    const wasCalm = s.at - lastAgitatedAt > CALM_BEFORE_MS;

    // Track the baseline only while calm, so a real knock does not drag it up
    // and mask the next one.
    if (delta < BUMP_THRESHOLD / 2) {
      baseline += (s.magnitude - baseline) * BASELINE_ALPHA;
    } else {
      lastAgitatedAt = s.at;
    }

    if (delta < BUMP_THRESHOLD) return;

    // A knock is a spike out of stillness. Continuous shaking never settles, so
    // `lastAgitatedAt` stays recent and nothing fires — which is what makes
    // waving the phone around useless (docs/device-capabilities.md §3).
    const throttled = s.at - lastBumpAt < BUMP_THROTTLE_MS;
    if (!wasCalm || throttled) return;

    lastBumpAt = s.at;
    onBump(s.at);
  });

  return { stop };
}
