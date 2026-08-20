/**
 * Left/right tilt, as a single −1..1 steer value.
 * Spec: docs/specs/games/neon-fall.md §5
 *
 * The fifth interpreter of a device sensor, beside `bump.ts`, `shake.ts`, `steady.ts`
 * and `orientation.ts`, and like them the only place Neon Fall reads a raw
 * `deviceorientation` event.
 *
 * Unlike `orientation.ts`'s full aim vector, this game only ever needs one axis —
 * `gamma`, the phone's roll — so it reads that alone rather than building the whole
 * rotation Ghost Hunt needs for its compass-relative aim.
 *
 * Calibrated once, explicitly (`calibrate()`), not on the first sample — the round's
 * pre-round rules panel is the "hold your phone how you like" moment
 * (device-capabilities.md §4), and calibrating any earlier would anchor on however
 * the phone happened to be held while the player was still reading the rules.
 *
 * Low-pass filtered (device-capabilities.md §4) with a simple exponential average —
 * raw `gamma` is jittery enough on a real phone that an unfiltered steer would read
 * as a hand tremor, not a tilt.
 */

/** How many degrees of tilt reach full steer. A guess — needs a playtest. */
export const SENSITIVITY_DEG = 20;

/** Exponential smoothing factor. Higher tracks faster; lower is steadier. */
export const SMOOTHING = 0.25;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export type SteerFilter = {
  /** Feed one raw `gamma` reading, in degrees. */
  sample: (gamma: number) => void;
  /** Anchor the last-sampled gamma as centre, and clear the filter's memory. */
  calibrate: () => void;
  /** The current filtered steer, −1..1. */
  read: () => number;
};

/**
 * The pure math, DOM-free and exported for the test — the calibration and the
 * clamp are the whole rule, and worth asserting rather than eyeballing.
 */
export function steerFilter(sensitivityDeg = SENSITIVITY_DEG, smoothing = SMOOTHING): SteerFilter {
  let latestGamma = 0;
  let ref = 0;
  let filtered = 0;

  return {
    sample: (gamma) => {
      latestGamma = gamma;
      const raw = clamp((gamma - ref) / sensitivityDeg, -1, 1);
      filtered += (raw - filtered) * smoothing;
    },
    calibrate: () => {
      ref = latestGamma;
      filtered = 0;
    },
    read: () => filtered,
  };
}

export type SteerTracker = {
  read: () => number;
  calibrate: () => void;
  /** Has the tracker seen a real reading yet? */
  ready: () => boolean;
  stop: () => void;
};

/** Start watching. Nothing is reported until the first real `deviceorientation` event. */
export function trackSteer(sensitivityDeg = SENSITIVITY_DEG): SteerTracker {
  const filter = steerFilter(sensitivityDeg);
  let samples = 0;

  const listener = (e: DeviceOrientationEvent): void => {
    if (e.gamma === null) return;
    samples += 1;
    filter.sample(e.gamma);
  };

  window.addEventListener('deviceorientation', listener);

  return {
    read: filter.read,
    calibrate: filter.calibrate,
    ready: () => samples > 0,
    stop: () => window.removeEventListener('deviceorientation', listener),
  };
}
