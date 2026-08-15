/**
 * The camera feed, and the edge detector that turns it into the radar.
 * Spec: docs/specs/games/ghost-hunt.md §5.2
 *
 * **The camera is never an input to the game.** The ghost's position comes from
 * the server and the aim from the orientation sensor; the feed is scenery.
 * Nothing here tracks, recognises or analyses anything, and no pixel leaves the
 * page — video element → small canvas → this filter → the radar, thrown away frame
 * by frame (spec §10).
 *
 * Everything runs on a deliberately small buffer. Edge detection is per-pixel
 * work, and a full-resolution frame at 30 fps is not something to attempt on a
 * mid-range phone that is also holding a WebSocket open. 160×160 at 15 fps is
 * ~26 k pixels of plain JS per frame, and the chunky result is the aesthetic
 * rather than a compromise: a crisp trace looks like a filter, a coarse one looks
 * like equipment.
 */

/** The side of the square buffer the filter works on — the radar's own canvas. */
export const RADAR_PX = 160;

/** Frames a second. The next lever if this is too slow is 12, not resolution. */
export const RADAR_FPS = 15;

/** Gradient magnitude above which a pixel is drawn as an edge. */
export const EDGE_THRESHOLD = 90;

/**
 * The colour the traced outlines are drawn in — a pale wash of the game's accent.
 *
 * Not white. White outlines on black read as a generic night-vision filter and, more
 * to the point, they were the one thing on the screen ignoring the game's own colour
 * while the radar around them wore it. A light tint of the accent makes the radar and
 * what is inside it one instrument.
 *
 * Kept as three numbers rather than a hex string because it is multiplied per pixel:
 * this is the accent (#34D399) lifted towards white so it still reads as bright at
 * the threshold, where an edge is barely there.
 */
export const EDGE_RGB = [167, 243, 208] as const;

/**
 * How opaque the ground under the trace is, 0–255.
 *
 * Not 255. The radar used to be a solid black disc, on the reasoning that letting the feed
 * through would drown the outlines — true when the disc showed a WIDER view than the
 * screen behind it, because then the two pictures disagreed and the eye had to pick one.
 * Now that the disc is a window onto the same view at the same scale (`paintEdges`), the
 * feed underneath lines up with the trace on top of it and reads as one lens rather than
 * two pictures. At ~55% the room is a suggestion and the outlines still carry.
 */
export const EDGE_GROUND_ALPHA = 140;

/**
 * Sobel edge detection, in place, from RGBA to tinted-on-translucent RGBA.
 *
 * Written as a pure function over a buffer so it can be tested without a camera,
 * a canvas or a DOM — which matters, because "is the radar showing anything" is
 * otherwise only answerable by pointing a phone at a room.
 *
 * Luminance is the cheap integer approximation rather than the exact coefficients:
 * this feeds a threshold, and nobody can see the difference in a 160-pixel dial.
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
  // Translucent ground, opaque edges — see EDGE_GROUND_ALPHA. Written per pixel here and
  // raised to 255 for the pixels that turn out to be edges, below.
  for (let p = 3; p < out.length; p += 4) out[p] = EDGE_GROUND_ALPHA;

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
      // sensor noise that squeaked over the line — scaled into the tint rather than
      // written as grey, so a weak edge is a dim green and not a grey one.
      const v = Math.min(255, 150 + g) / 255;
      const p = i * 4;
      out[p] = EDGE_RGB[0] * v;
      out[p + 1] = EDGE_RGB[1] * v;
      out[p + 2] = EDGE_RGB[2] * v;
      // An edge is the one thing on this canvas that is fully there.
      out[p + 3] = 255;
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
 * ## The window has to match the screen behind it
 *
 * `windowPx` is how much of the source the dial covers, in SOURCE pixels, and getting it
 * wrong is the bug this parameter exists for. It used to take the largest centre square
 * available — the whole 480 of a 640×480 frame — and squeeze it into the 160-pixel dial,
 * while the background behind it was the same frame scaled to COVER a tall phone screen,
 * showing barely a third of that width. So the radar showed a wider, smaller version of
 * the room than the room it was sitting on: the same chair appeared twice, at two sizes,
 * a few centimetres apart.
 *
 * The caller passes the window that corresponds to the dial's own size on screen, so what
 * is inside the dial is exactly what would be behind it. Defaults to the old behaviour for
 * a caller that has no screen to measure.
 */
export function paintEdges(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  windowPx?: number,
): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || sw === 0 || sh === 0) return;

  // Clamped to what there is: a dial bigger than the frame shows the whole frame rather
  // than sampling past its edge, which would smear the border pixels outwards.
  const side = Math.max(16, Math.min(windowPx ?? Math.min(sw, sh), sw, sh));
  ctx.clearRect(0, 0, RADAR_PX, RADAR_PX);
  ctx.drawImage(canvas === source ? canvas : source, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, RADAR_PX, RADAR_PX);

  const frame = ctx.getImageData(0, 0, RADAR_PX, RADAR_PX);
  const out = new Uint8ClampedArray(frame.data.length);
  sobel(frame.data, out, RADAR_PX, RADAR_PX);
  ctx.putImageData(new ImageData(out, RADAR_PX, RADAR_PX), 0, 0);
}
