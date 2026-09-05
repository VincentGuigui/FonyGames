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
  let hasSample = false;
  // Set when `calibrate()` is called before any real reading has arrived —
  // every caller in this codebase creates a tracker and calibrates it in the
  // same synchronous tick (see `trackSteer2`'s own doc comment), which is
  // always before the browser's first async `deviceorientation` event can
  // possibly fire. Without this, that calibration anchored `ref` at its
  // default of 0 — a real, valid orientation (flat, screen up) — regardless
  // of how the phone was actually being held. Roll's own neutral pose is
  // already close to 0 (holding a phone upright naturally has gamma≈0), so
  // this was invisible there; pitch's neutral pose is close to 90° (the same
  // upright hold has beta≈90), so the bogus zero pinned Asteroid Race's
  // vertical steer at full deflection from the first real sample onward —
  // the only way to bring it back toward centre was to physically bring the
  // phone's own beta toward 0, which is pointing it at the floor.
  let pendingCalibrate = false;

  return {
    sample: (gamma) => {
      latestGamma = gamma;
      hasSample = true;
      if (pendingCalibrate) {
        ref = gamma;
        filtered = 0;
        pendingCalibrate = false;
      }
      const raw = clamp((gamma - ref) / sensitivityDeg, -1, 1);
      filtered += (raw - filtered) * smoothing;
    },
    calibrate: () => {
      if (hasSample) {
        ref = latestGamma;
        filtered = 0;
      } else {
        pendingCalibrate = true;
      }
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

/* ------------------------------------------------------------------ */
/* Two axes: a flight stick rather than a lane steer                    */
/* Spec: docs/specs/games/asteroid-race.md §5                           */
/* ------------------------------------------------------------------ */

/**
 * How many degrees of **pitch** reach full vertical steer. A little coarser
 * than the roll figure above, because a phone is held at whatever pitch is
 * comfortable and drifts there, so the same 20° that reads as a deliberate
 * roll reads as a fidget in beta — but only a little: at 30° a full climb
 * needed a tip so large that flying up read as not working at all. A guess,
 * like every other number in that spec.
 */
export const PITCH_SENSITIVITY_DEG = 22;

export type Steer2 = { x: number; y: number };

export type Steer2Filter = {
  /** Feed one raw reading: `gamma` is roll, `beta` is pitch, both in degrees. */
  sample: (gamma: number, beta: number) => void;
  /** Anchor the last-sampled pair as centre, and clear the filter's memory. */
  calibrate: () => void;
  /** The current filtered steer. `x` is right-positive, `y` is up-positive. */
  read: () => Steer2;
};

/**
 * The same filter as `steerFilter`, on both axes — Asteroid Race flies a tube
 * rather than five lanes, so it needs up and down as well as left and right
 * (spec §5).
 *
 * Deliberately two independent `steerFilter`s rather than a new
 * implementation: the calibration and the clamp are the whole rule, they are
 * already tested, and a second copy of them is a second thing to get wrong.
 * `beta` is inverted here so that tipping the phone's top edge AWAY from you —
 * the gesture a flight stick makes for "climb" — reads as positive `y`.
 */
export function steer2Filter(
  rollDeg = SENSITIVITY_DEG,
  pitchDeg = PITCH_SENSITIVITY_DEG,
  smoothing = SMOOTHING,
): Steer2Filter {
  const roll = steerFilter(rollDeg, smoothing);
  const pitch = steerFilter(pitchDeg, smoothing);
  return {
    sample: (gamma, beta) => {
      roll.sample(gamma);
      pitch.sample(beta);
    },
    calibrate: () => {
      roll.calibrate();
      pitch.calibrate();
    },
    read: () => ({ x: roll.read(), y: -pitch.read() }),
  };
}

export type Steer2Tracker = {
  read: () => Steer2;
  calibrate: () => void;
  ready: () => boolean;
  stop: () => void;
};

/** Start watching both axes. Nothing is reported until the first real event. */
export function trackSteer2(rollDeg = SENSITIVITY_DEG, pitchDeg = PITCH_SENSITIVITY_DEG): Steer2Tracker {
  const filter = steer2Filter(rollDeg, pitchDeg);
  let samples = 0;

  const listener = (e: DeviceOrientationEvent): void => {
    // Both or neither: a reading with one axis missing would calibrate one
    // filter against a real value and the other against a zero it never saw.
    if (e.gamma === null || e.beta === null) return;
    samples += 1;
    filter.sample(e.gamma, e.beta);
  };

  window.addEventListener('deviceorientation', listener);

  return {
    read: filter.read,
    calibrate: filter.calibrate,
    ready: () => samples > 0,
    stop: () => window.removeEventListener('deviceorientation', listener),
  };
}
