/**
 * Device motion access and permission handling.
 * Rules: docs/device-capabilities.md §2 and §4.
 *
 * iOS Safari requires `DeviceMotionEvent.requestPermission()` and refuses it
 * outside a user gesture, so `requestMotion()` must be called straight from a
 * tap handler — never on page load, never after an await.
 */

export type MotionSupport = 'unsupported' | 'needs-permission' | 'ready';

type IosDeviceMotionEvent = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

export function motionSupport(): MotionSupport {
  if (typeof DeviceMotionEvent === 'undefined') return 'unsupported';
  const ios = DeviceMotionEvent as IosDeviceMotionEvent;
  return typeof ios.requestPermission === 'function' ? 'needs-permission' : 'ready';
}

/** Must be called directly from a user gesture. Returns false if denied. */
export async function requestMotion(): Promise<boolean> {
  const support = motionSupport();
  if (support === 'unsupported') return false;
  if (support === 'ready') return true;

  const ios = DeviceMotionEvent as IosDeviceMotionEvent;
  try {
    return (await ios.requestPermission?.()) === 'granted';
  } catch {
    // Thrown when not called from a gesture, or when the user dismissed it.
    return false;
  }
}

export type MotionSample = {
  /** Magnitude of acceleration including gravity, m/s². */
  magnitude: number;
  /**
   * The same reading by axis, device frame, m/s².
   *
   * Magnitude alone is enough to notice a knock (`bump.ts`), but not to tell a phone
   * held upright from one lying flat, or to measure how far the vector *moved* — both
   * of which need the components (`steady.ts`).
   */
  x: number;
  y: number;
  z: number;
  /** performance.now() at the sample. */
  at: number;
};

/**
 * Subscribe to motion. Returns an unsubscribe function.
 *
 * The listener is removed when the tab is hidden and re-added when it returns:
 * a leaked motion listener drains the battery, and the readings while
 * backgrounded are worthless anyway (docs/device-capabilities.md §4).
 */
export function onMotion(handler: (sample: MotionSample) => void): () => void {
  const listener = (event: DeviceMotionEvent): void => {
    const a = event.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    handler({
      magnitude: Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z),
      x: a.x,
      y: a.y,
      z: a.z,
      at: performance.now(),
    });
  };

  let attached = false;
  const attach = (): void => {
    if (attached) return;
    window.addEventListener('devicemotion', listener);
    attached = true;
  };
  const detach = (): void => {
    if (!attached) return;
    window.removeEventListener('devicemotion', listener);
    attached = false;
  };

  const onVisibility = (): void => {
    if (document.hidden) detach();
    else attach();
  };

  attach();
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    detach();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
