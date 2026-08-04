/**
 * SVG art, rasterised once and blitted. Contract: docs/design/illustrations.md §4
 *
 * Canvas cannot draw an SVG file, so each piece of art is loaded into an `Image` and
 * rasterised into a plain `<canvas>` at the sizes actually asked for. Three decisions
 * in here are load-bearing:
 *
 * - **Nothing is awaited.** `at()` returns `null` while a file is loading and forever
 *   if it failed, so a render loop calls it inside the frame and draws its existing
 *   procedural shape on `null`. A missing file must not stop a round
 *   (AGENTS.md §4: degrade, never dead-end), and it also means adopting a sprite is
 *   revertible in one commit.
 * - **Rasters are bucketed and evicted.** A goat's drawn radius changes every frame;
 *   caching per exact size would allocate a canvas per frame.
 * - **A canvas, not the `Image`, is the blit source.** `drawImage` of an SVG `<img>`
 *   re-rasterises the vector on some engines on *every* call. Copying pixels once and
 *   blitting the copy is the point of the whole module.
 */

/** A rasterised piece of art, ready to blit. */
export type Sprite = {
  readonly source: CanvasImageSource;
  /** Size in CSS pixels at the scale it was rasterised for. */
  readonly w: number;
  readonly h: number;
};

export type SpriteSheet = {
  /**
   * The art rasterised to `w` CSS pixels wide at `dpr`.
   *
   * Null while loading and null forever if it failed. Never blocks, never throws.
   */
  at(w: number, dpr: number): Sprite | null;
  /** Resolves true once decoded, false if it failed. Never rejects. */
  loaded(): Promise<boolean>;
};

/**
 * Device-pixel width a request rounds up to.
 *
 * Exported because it is the only arithmetic here worth a test: without bucketing, a
 * continuously-scaling sprite allocates a canvas every frame.
 */
export function bucket(cssWidth: number, dpr: number): number {
  return Math.max(8, Math.ceil((cssWidth * dpr) / 8) * 8);
}

/** How many sizes of one piece of art are kept before the oldest is dropped. */
const MAX_RASTERS = 6;

type Sheet = SpriteSheet & { readonly url: string };

const sheets = new Map<string, Sheet>();

/**
 * Load a piece of art. Idempotent per URL — two callers share one decode.
 *
 * Call at module scope in a `render.ts` so the fetch starts when the game's chunk
 * executes, well before a board mounts.
 */
export function art(url: string): SpriteSheet {
  const existing = sheets.get(url);
  if (existing) return existing;

  let state: 'loading' | 'ok' | 'failed' = 'loading';
  const rasters = new Map<number, HTMLCanvasElement>();
  let ratio = 1;

  const img = new Image();
  const settled = new Promise<boolean>((resolve) => {
    img.addEventListener('load', () => {
      // `naturalWidth > 0` rather than `decode()`: decode() has been flaky in Safari
      // for SVGs, and a rejection there means a permanently blank sprite. This is
      // also why every sprite file must declare width, height AND viewBox — without
      // an intrinsic size naturalWidth is 0 or 300 depending on the engine.
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        ratio = img.naturalWidth / img.naturalHeight;
        state = 'ok';
        resolve(true);
      } else {
        state = 'failed';
        resolve(false);
      }
    });
    img.addEventListener('error', () => {
      state = 'failed';
      resolve(false);
    });
  });
  img.src = url;

  const sheet: Sheet = {
    url,
    loaded: () => settled,
    at(w, dpr) {
      if (state !== 'ok' || !(w > 0)) return null;

      const px = bucket(w, dpr);
      let raster = rasters.get(px);
      if (!raster) {
        raster = document.createElement('canvas');
        raster.width = px;
        raster.height = Math.max(1, Math.round(px / ratio));
        const rctx = raster.getContext('2d');
        if (!rctx) return null;
        rctx.drawImage(img, 0, 0, raster.width, raster.height);

        if (rasters.size >= MAX_RASTERS) {
          // Insertion order is iteration order, so the first key is the oldest.
          const oldest = rasters.keys().next().value;
          if (oldest !== undefined) rasters.delete(oldest);
        }
        rasters.set(px, raster);
      } else {
        // Touch it, so the least recently *used* size is the one evicted.
        rasters.delete(px);
        rasters.set(px, raster);
      }

      // Back in CSS pixels, which is the space every render loop draws in: all of
      // them cap dpr at 2 and setTransform(dpr, 0, 0, dpr, 0, 0).
      return { source: raster, w: raster.width / dpr, h: raster.height / dpr };
    },
  };

  sheets.set(url, sheet);
  return sheet;
}
