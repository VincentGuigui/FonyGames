/**
 * The camera feed, and the edge detector that turns it into the ring.
 * Spec: docs/specs/games/ghost-hunt.md §5.2
 *
 * **The camera is never an input to the game.** The ghost's position comes from
 * the server and the aim from the orientation sensor; the feed is scenery.
 * Nothing here tracks, recognises or analyses anything, and no pixel leaves the
 * page — video element → small canvas → this filter → the ring, thrown away frame
 * by frame (spec §10).
 *
 * Everything runs on a deliberately small buffer. Edge detection is per-pixel
 * work, and a full-resolution frame at 30 fps is not something to attempt on a
 * mid-range phone that is also holding a WebSocket open. 160×160 at 15 fps is
 * ~26 k pixels of plain JS per frame, and the chunky result is the aesthetic
 * rather than a compromise: a crisp trace looks like a filter, a coarse one looks
 * like equipment.
 */

/** The side of the square buffer the filter works on. */
export const RING_PX = 160;

/** Frames a second. The next lever if this is too slow is 12, not resolution. */
export const RING_FPS = 15;

/** Gradient magnitude above which a pixel is drawn as an edge. */
export const EDGE_THRESHOLD = 90;

/**
 * Sobel edge detection, in place, from RGBA to white-on-black RGBA.
 *
 * Written as a pure function over a buffer so it can be tested without a camera,
 * a canvas or a DOM — which matters, because "is the ring showing anything" is
 * otherwise only answerable by pointing a phone at a room.
 *
 * Luminance is the cheap integer approximation rather than the exact coefficients:
 * this feeds a threshold, and nobody can see the difference in a 160-pixel ring.
 */
export function sobel(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  w: number,
  h: number,
  threshold = EDGE_THRESHOLD,
): void {
  // One luminance pass first: the 3×3 window reads nine neighbours per pixel, so
  // computing luma inside the loop would do the same work nine times over.
  const luma = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    luma[i] = ((src[p] as number) * 77 + (src[p + 1] as number) * 150 + (src[p + 2] as number) * 29) >> 8;
  }

  out.fill(0);
  // Opaque everywhere: the ring is a solid black disc with white lines on it, not
  // a translucent one, or the camera feed shows through and the trace disappears.
  for (let p = 3; p < out.length; p += 4) out[p] = 255;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = luma[i - w - 1] as number;
      const tc = luma[i - w] as number;
      const tr = luma[i - w + 1] as number;
      const ml = luma[i - 1] as number;
      const mr = luma[i + 1] as number;
      const bl = luma[i + w - 1] as number;
      const bc = luma[i + w] as number;
      const br = luma[i + w + 1] as number;

      const gx = tl + 2 * ml + bl - tr - 2 * mr - br;
      const gy = tl + 2 * tc + tr - bl - 2 * bc - br;
      // |gx| + |gy| rather than a hypotenuse: one branch instead of a square root,
      // 26 k times a frame, and the threshold absorbs the difference.
      const g = Math.abs(gx) + Math.abs(gy);

      if (g < threshold) continue;
      // Brightness carries edge strength, so a strong outline reads stronger than
      // sensor noise that squeaked over the line.
      const v = Math.min(255, 120 + g);
      const p = i * 4;
      out[p] = v;
      out[p + 1] = v;
      out[p + 2] = v;
    }
  }
}

export type Camera = {
  video: HTMLVideoElement;
  stop: () => void;
};

/**
 * Open the rear camera.
 *
 * Returns null rather than throwing when it is refused or unavailable: every
 * caller's answer to "no camera" is the same — carry on without the scenery — and
 * losing the feed must never lose the game (spec §7).
 */
export async function startCamera(): Promise<Camera | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
  } catch {
    return null;
  }

  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }

  return {
    video,
    stop: () => {
      /*
       * Tracks are STOPPED, not merely paused, and the element is detached.
       * A paused track keeps the phone's camera indicator lit, which reads as
       * being spied on — and §10 spends a whole section promising otherwise.
       */
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}

/**
 * Paint the centre of `source` through the edge filter onto `canvas`.
 *
 * The centre square only, matching what the ring covers, so the filter never
 * touches pixels that are not going to be drawn.
 */
export function paintEdges(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  sw: number,
  sh: number,
): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || sw === 0 || sh === 0) return;

  const side = Math.min(sw, sh);
  ctx.drawImage(canvas === source ? canvas : source, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, RING_PX, RING_PX);

  const frame = ctx.getImageData(0, 0, RING_PX, RING_PX);
  const out = new Uint8ClampedArray(frame.data.length);
  sobel(frame.data, out, RING_PX, RING_PX);
  ctx.putImageData(new ImageData(out, RING_PX, RING_PX), 0, 0);
}
