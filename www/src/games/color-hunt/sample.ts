import { COLOR_HUNT_SAMPLE } from '../../../../shared/protocol';
import type { Rgb } from '../../../../shared/color';

/**
 * The magnifier: what the middle of the camera feed actually is.
 * Spec: docs/specs/games/color-hunt.md §5, §10
 *
 * **This is the only place in the codebase that reads a camera pixel.** Ghost
 * Hunt and UFO Hunt draw the feed and read nothing; this game averages a
 * 10x10 patch from the centre of it. The patch never leaves the phone — it is
 * averaged here and what goes on the wire is three integers (§10) — and the
 * canvas it is drawn into is 10x10, so there is nowhere for a frame to be kept
 * even by accident.
 *
 * `meanOf` takes a raw RGBA buffer rather than a video, so the arithmetic is
 * testable without a browser: the same split `pass-the-bomb/shockwave.ts`
 * makes for its own pixel sampling.
 */

/** Average an RGBA buffer, ignoring alpha. Null on an empty one. */
export function meanOf(data: ArrayLike<number>): Rgb | null {
  const pixels = Math.floor(data.length / 4);
  if (pixels <= 0) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < pixels; i++) {
    r += data[i * 4] ?? 0;
    g += data[i * 4 + 1] ?? 0;
    b += data[i * 4 + 2] ?? 0;
  }
  return [Math.round(r / pixels), Math.round(g / pixels), Math.round(b / pixels)];
}

/**
 * Where the sampled square sits in a video frame: the centre of the SQUARE the
 * player is shown, not of the raw sensor frame.
 *
 * The feed is displayed cropped to a square (spec §4), so on a 16:9 sensor the
 * sides are off screen. Sampling the raw frame's centre would still land in
 * the middle — but the size of the patch relative to what is displayed would
 * change with the sensor's aspect, so a 10x10 patch would cover a different
 * amount of the world on different phones. Measuring against the short side
 * keeps it the same everywhere.
 */
export function centreRect(width: number, height: number, patch = COLOR_HUNT_SAMPLE): { sx: number; sy: number; size: number } {
  const short = Math.max(1, Math.min(width, height));
  // The displayed square is `short` across; the patch is that fraction of it.
  const size = Math.max(1, Math.round((patch / 100) * short));
  return { sx: Math.round(width / 2 - size / 2), sy: Math.round(height / 2 - size / 2), size };
}

export type Magnifier = {
  /** Read the centre of the current frame. Null before the feed has a size. */
  read: () => Rgb | null;
};

/** A magnifier over a live video element. The canvas is created once and is
 *  `COLOR_HUNT_SAMPLE` square — the patch is scaled down into it, so the
 *  average is over the whole patch however large the sensor is. */
export function magnifier(video: HTMLVideoElement): Magnifier {
  const canvas = document.createElement('canvas');
  canvas.width = COLOR_HUNT_SAMPLE;
  canvas.height = COLOR_HUNT_SAMPLE;
  // `willReadFrequently` is the whole point of this canvas.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  return {
    read: () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!ctx || w === 0 || h === 0) return null;
      const { sx, sy, size } = centreRect(w, h);
      try {
        ctx.drawImage(video, sx, sy, size, size, 0, 0, COLOR_HUNT_SAMPLE, COLOR_HUNT_SAMPLE);
        return meanOf(ctx.getImageData(0, 0, COLOR_HUNT_SAMPLE, COLOR_HUNT_SAMPLE).data);
      } catch {
        // A frame that is not yet decodable, or a tainted canvas on a browser
        // that disagrees about the stream's origin. Either way: no reading,
        // not a crash mid-round.
        return null;
      }
    },
  };
}
