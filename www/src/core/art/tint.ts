/**
 * Hue-rotate a raster source toward a target colour. Contract: docs/design/illustrations.md §4
 *
 * The art is painted once in a fixed reference hue — pure magenta,
 * `ART_REFERENCE_HUE` — and every opaque, non-grey pixel's hue is shifted by
 * the same delta toward whichever colour a player's avatar asks for. That is
 * what keeps this a *recolour* rather than a *flatten*:
 *
 * - **black, white and every true grey are untouched.** They have no hue to
 *   rotate (saturation 0), so shading, outlines and highlights survive the
 *   trip exactly — this is the property a flat `source-in` fill cannot have,
 *   since it replaces every opaque pixel's colour outright regardless of
 *   what it was.
 * - **two differently-hued details stay differently hued.** A magenta hull
 *   and a green accent painted at a different hue in the source are still at
 *   that same relative offset after the shift, just both carried to a new
 *   absolute hue — nothing collapses into a single flat colour.
 *
 * `ART_REFERENCE_HUE` is a fact about the committed art, not a free
 * parameter: `www/src/games/gravity-shooter/art/ship.png` and
 * `www/src/games/tilt-race/art/car.png` are painted in magenta specifically
 * so this constant has one real answer. If either is ever repainted in a
 * different base hue, this constant moves with it — nothing else changes.
 */
export const ART_REFERENCE_HUE = 300;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hueToRgbChannel(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = h / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueToRgbChannel(p, q, hn + 1 / 3) * 255),
    Math.round(hueToRgbChannel(p, q, hn) * 255),
    Math.round(hueToRgbChannel(p, q, hn - 1 / 3) * 255),
  ];
}

/** `#rrggbb` (or `#rgb`) to a hue in 0..360. Grey/black/white input (no hue
 *  of its own), or a string that is not a hex colour at all, falls back to
 *  `ART_REFERENCE_HUE` — a delta of 0, i.e. the art's own colour, since
 *  "rotate to no hue" is not a request this can honour and leaving the art
 *  alone is the least surprising thing to do. Exported for its own test —
 *  the parsing (3-digit hex, case, the two fallback cases) is the one part
 *  of this file that has nothing to do with canvas. */
export function hexHue(hex: string): number {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  const digits = m?.[1];
  if (!digits) return ART_REFERENCE_HUE;
  const full = digits.length === 3 ? digits.split('').map((c) => c + c).join('') : digits;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const [h, s] = rgbToHsl(r, g, b);
  return s === 0 ? ART_REFERENCE_HUE : h;
}

/**
 * One pixel's hue rotation by `delta` degrees — the whole per-pixel rule
 * `tinted()` applies to a raster, pulled out DOM-free so it has its own
 * test rather than only ever running inside a `<canvas>`. A true grey
 * (`r === g === b`, which includes black and white) is returned completely
 * unchanged rather than round-tripped through HSL, so it comes back
 * bit-for-bit identical rather than merely close.
 */
export function rotatedPixel(r: number, g: number, b: number, delta: number): [number, number, number] {
  if (r === g && g === b) return [r, g, b];
  const [h, s, l] = rgbToHsl(r, g, b);
  const hue = ((h + delta) % 360 + 360) % 360;
  return hslToRgb(hue, s, l);
}

/**
 * Recolour a raster source by hue-rotating it toward `color`, at `width` x
 * `height`. `color` is a `#rrggbb`/`#rgb` hex string — the same shape every
 * other accent colour in this codebase already uses.
 */
export function tinted(source: CanvasImageSource, width: number, height: number, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(source, 0, 0, width, height);

  const delta = hexHue(color) - ART_REFERENCE_HUE;
  if (delta === 0) return canvas;

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const [nr, ng, nb] = rotatedPixel(data[i] as number, data[i + 1] as number, data[i + 2] as number, delta);
    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
