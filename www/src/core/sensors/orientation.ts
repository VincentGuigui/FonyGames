/**
 * Device attitude, and the direction the phone is pointing.
 * Spec: docs/specs/games/ghost-hunt.md §5.1
 *
 * The fourth interpreter of a device sensor, beside `bump.ts`, `shake.ts` and
 * `steady.ts`, and like them the only place its game reads raw events.
 *
 * ## What "aim" means
 *
 * The aim is where the **back** of the phone points — the −Z axis of the device
 * frame, rotated into the world frame. That is both the natural "hold it up and
 * look through it" gesture and exactly where the rear camera points, so the aim
 * and the picture agree by construction rather than by calibration.
 *
 * ## The compass is deliberately not used
 *
 * `alpha` is an absolute heading only on a `deviceorientationabsolute` event, and
 * indoors a magnetometer reads 20–40° off, disagrees between two phones standing
 * next to each other, and swings as you turn (spec §3). So nothing here trusts
 * alpha as a bearing: the game subtracts a per-player anchor, leaving only
 * *relative* rotation, which fused orientation gives accurately. Elevation is
 * gravity-referenced and needs no calibration at all.
 */

const DEG = Math.PI / 180;

export type OrientationSupport = 'unsupported' | 'needs-permission' | 'ready';

type IosDeviceOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

export function orientationSupport(): OrientationSupport {
  if (typeof DeviceOrientationEvent === 'undefined') return 'unsupported';
  const ios = DeviceOrientationEvent as IosDeviceOrientationEvent;
  return typeof ios.requestPermission === 'function' ? 'needs-permission' : 'ready';
}

/** Must be called directly from a user gesture. Returns false if denied. */
export async function requestOrientation(): Promise<boolean> {
  const support = orientationSupport();
  if (support === 'unsupported') return false;
  if (support === 'ready') return true;

  const ios = DeviceOrientationEvent as IosDeviceOrientationEvent;
  try {
    return (await ios.requestPermission?.()) === 'granted';
  } catch {
    // Thrown when not called from a gesture, or when the user dismissed it.
    return false;
  }
}

/** A direction on the sphere, in degrees. Azimuth 0 is the player's own forward. */
export type Aim = { azimuth: number; elevation: number };

/** A unit vector in the world frame: x east, y north, z up. */
export type Vec3 = { x: number; y: number; z: number };

/**
 * Where the back of the phone points, from a device orientation reading.
 *
 * `alpha`/`beta`/`gamma` are intrinsic Z-X'-Y'' rotations, per the W3C
 * definition. This builds the third column of that rotation matrix and negates
 * it, which is `R · (0, 0, −1)` without materialising the other six numbers.
 */
export function aimVector(alpha: number, beta: number, gamma: number): Vec3 {
  const a = alpha * DEG;
  const b = beta * DEG;
  const g = gamma * DEG;

  const cA = Math.cos(a);
  const sA = Math.sin(a);
  const cB = Math.cos(b);
  const sB = Math.sin(b);
  const cG = Math.cos(g);
  const sG = Math.sin(g);

  return {
    x: -(cA * sG + cG * sA * sB),
    y: -(sA * sG - cA * cG * sB),
    z: -(cB * cG),
  };
}

/** A world vector as an azimuth/elevation pair, in degrees. */
export function toAim(v: Vec3): Aim {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return {
    // atan2(x, y): 0° is north/forward, growing clockwise, which is how a person
    // describes a direction — "45° to your right", not "45° anticlockwise from x".
    azimuth: Math.atan2(v.x, v.y) / DEG,
    elevation: Math.asin(Math.min(1, Math.max(-1, v.z / len))) / DEG,
  };
}

/** An azimuth/elevation pair as a unit vector. The inverse of `toAim`. */
export function toVector(aim: Aim): Vec3 {
  const az = aim.azimuth * DEG;
  const el = aim.elevation * DEG;
  const c = Math.cos(el);
  return { x: Math.sin(az) * c, y: Math.cos(az) * c, z: Math.sin(el) };
}

/** Fold an angle in degrees into −180…180. */
export function wrapDeg(deg: number): number {
  const w = ((deg + 180) % 360 + 360) % 360;
  return w - 180;
}

/**
 * The angle between two directions on the sphere, in degrees.
 *
 * Spherical law of cosines rather than a dot product of rebuilt vectors: one
 * fewer place for a normalisation to go wrong, and this is the number the whole
 * game is decided by.
 */
export function angleBetween(a: Aim, b: Aim): number {
  const e1 = a.elevation * DEG;
  const e2 = b.elevation * DEG;
  const dAz = wrapDeg(a.azimuth - b.azimuth) * DEG;
  const cos = Math.sin(e1) * Math.sin(e2) + Math.cos(e1) * Math.cos(e2) * Math.cos(dAz);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / DEG;
}

export type OrientationReading = {
  /** Aim relative to the anchor, or the raw aim when nothing is anchored yet. */
  aim: Aim;
  /** Has any event arrived at all? Zero is not the same as "not reporting". */
  samples: number;
};

export type OrientationTracker = {
  read: () => OrientationReading;
  /** Make the current aim azimuth 0. The player's forward (spec §3). */
  anchor: () => void;
  /** Has the tracker ever seen an event? Used to gate calibration. */
  ready: () => boolean;
  stop: () => void;
};

/**
 * Start watching device orientation.
 *
 * No screen-rotation correction: the aim is the direction the phone's BACK points,
 * which does not move when the screen rotates — only the picture on it does. A
 * correction here would be right for a screen-space arrow and wrong for this.
 */
export function trackOrientation(): OrientationTracker {
  let latest: Aim = { azimuth: 0, elevation: 0 };
  let anchorAz = 0;
  let samples = 0;

  const listener = (e: DeviceOrientationEvent): void => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    samples += 1;
    latest = toAim(aimVector(e.alpha, e.beta, e.gamma));
  };

  window.addEventListener('deviceorientation', listener);

  return {
    read: () => ({
      aim: { azimuth: wrapDeg(latest.azimuth - anchorAz), elevation: latest.elevation },
      samples,
    }),
    anchor: () => {
      anchorAz = latest.azimuth;
    },
    ready: () => samples > 0,
    stop: () => window.removeEventListener('deviceorientation', listener),
  };
}
