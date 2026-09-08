import {
  hsvToRgb,
  hueGap,
  hueOf,
  hueSteps,
  palette,
  paletteSize,
  satOf,
  shadeSteps,
  valueOf,
  type Rgb,
  type Rung,
} from '../../../../shared/color';

export { hueOf, satOf } from '../../../../shared/color';

/**
 * The wheel's geometry. Spec: docs/specs/games/color-match.md §4.2
 *
 * **No DOM in this file.** The layout and the hit test are pure functions of a
 * rung and a pointer position, so they can be asserted rather than eyeballed —
 * the same split `asteroid-race/pose.ts` and `pass-the-bomb/shockwave.ts` make.
 * `ColorWheel.tsx` draws what these return and owns every pixel.
 *
 * **One geometry, two presentations.** Hue runs around the disc and shade
 * outward, always: ring `i` is `shadeSteps(rung)[i]`, wedge `j` is
 * `hueSteps(rung.hues)[j]`, and both presentations read the same two grids.
 * While the palette is small enough the wedges are drawn one per colour and a
 * tap picks one exactly; past that the disc is drawn as a smooth sweep and the
 * same hit test quantises what the thumb lands on. Either way **the only
 * colours the wheel can return are the colours the rung offers**, which is what
 * makes the randomiser's targets reachable by construction rather than by luck.
 *
 * **Since issue #40, "outward" runs light-plain-dark, not just pale-to-full.**
 * `shadeSteps` already lays that out as one ordered list; this file only ever
 * asks it "how many rings" and "what shade is ring `i`", so it does not care
 * that the middle of that list is special — it reads the same either side.
 */

export type Sector = {
  /** The colour this wedge offers. */
  rgb: Rgb;
  /** Ring index, 0 at the centre and palest. */
  ring: number;
  /** Inner and outer radius, as fractions of the disc's own radius. */
  r0: number;
  r1: number;
  /** Start and end angle, in radians, clockwise from twelve o'clock. `a0` is
   *  negative on the first wedge: each hue is **centred** on its own angle, so
   *  red sits at twelve o'clock rather than starting there. */
  a0: number;
  a1: number;
};

/** The innermost radius a wedge ever starts at. The hole in the middle is
 *  where the current pick is previewed, and it stops the first ring's wedges
 *  from converging into an unpickable point. */
export const WHEEL_HUB = 0.28;

const TWO_PI = Math.PI * 2;

/** The radius band ring `i` of `rings` total occupies, out from the hub. */
export function ringBand(rings: number, ring: number): { r0: number; r1: number } {
  const n = Math.max(1, Math.floor(rings));
  const band = (1 - WHEEL_HUB) / n;
  return { r0: WHEEL_HUB + ring * band, r1: WHEEL_HUB + (ring + 1) * band };
}

/** Which ring a radius falls in, of `rings` total. Everything inside the hub
 *  belongs to the innermost ring rather than to nothing — a thumb that slips
 *  onto the preview disc should not silently pick a colour from the far side
 *  of the wheel. */
export function ringAt(r: number, rings: number): number {
  const n = Math.max(1, Math.floor(rings));
  const t = (r - WHEEL_HUB) / (1 - WHEEL_HUB);
  return Math.min(n - 1, Math.max(0, Math.floor(t * n)));
}

/** Which hue step an angle falls on, nearest rather than containing, because
 *  each hue is centred on its own angle. */
export function hueIndexAt(a: number, hues: number): number {
  const n = Math.max(1, Math.floor(hues));
  return ((Math.round((a / TWO_PI) * n) % n) + n) % n;
}

/** Lay a rung's palette out as wedges. Empty when the rung is too big to draw
 *  this way — ask `isSectorRung` first. */
export function sectorsFor(rung: Rung, sectorMax: number): Sector[] {
  if (paletteSize(rung) > sectorMax) return [];
  const hues = Math.max(1, Math.floor(rung.hues));
  const rings = shadeSteps(rung).length;
  const step = TWO_PI / hues;
  return palette(rung).map((rgb, i) => {
    const ring = Math.floor(i / hues);
    const slot = i % hues;
    const { r0, r1 } = ringBand(rings, ring);
    return { rgb, ring, r0, r1, a0: (slot - 0.5) * step, a1: (slot + 0.5) * step };
  });
}

/** Is this rung small enough to draw as wedges (spec §4.2)? */
export function isSectorRung(rung: Rung, sectorMax: number): boolean {
  return paletteSize(rung) <= sectorMax;
}

/** Is `a` inside the arc `[a0, a1)`, given either end may sit outside 0..2pi? */
function inArc(a: number, a0: number, a1: number): boolean {
  const rel = (((a - a0) % TWO_PI) + TWO_PI) % TWO_PI;
  return rel < a1 - a0;
}

/**
 * What a pointer at `(nx, ny)` — offsets from the disc's centre, in units of
 * its radius — is pointing at on a sector wheel. Null outside the disc or
 * inside the hub.
 */
export function sectorAt(sectors: readonly Sector[], nx: number, ny: number): Sector | null {
  const r = Math.hypot(nx, ny);
  if (r < WHEEL_HUB || r > 1) return null;
  // Clockwise from twelve o'clock, which is how the wedges are laid out.
  const a = (Math.atan2(nx, -ny) + TWO_PI) % TWO_PI;
  for (const s of sectors) {
    if (r >= s.r0 && r <= s.r1 && inArc(a, s.a0, s.a1)) return s;
  }
  return null;
}

/**
 * What a pointer is pointing at on the continuous disc: hue around, shade
 * outward — light rings in, dark rings out (`shadeSteps`) — quantised onto
 * the rung's own two grids.
 *
 * Returns the *quantised* colour, because that is what will be scored: showing
 * the free colour and submitting a different one is the kind of gap a player
 * discovers by losing.
 */
export function continuousAt(rung: Rung, nx: number, ny: number): Rgb | null {
  const r = Math.hypot(nx, ny);
  if (r > 1) return null;
  const a = (Math.atan2(nx, -ny) + TWO_PI) % TWO_PI;
  const hues = hueSteps(rung.hues);
  const shades = shadeSteps(rung);
  const shade = shades[ringAt(r, shades.length)] ?? { s: 1, v: 1 };
  return hsvToRgb(hues[hueIndexAt(a, rung.hues)] ?? 0, shade.s, shade.v);
}

/**
 * Where a colour sits on the disc, so the cursor can be drawn on top of the
 * pick rather than wherever the thumb last was.
 *
 * Hue and shade only — a target off the plain ring is still at its hue's own
 * angle, not off the wheel — and null for a colour that has no hue at all:
 * the neutral grey a level opens on, most of all, because a cursor parked on
 * a colour nobody chose reads as a choice.
 */
export function positionOf(rgb: Rgb, rung: Rung): { nx: number; ny: number } | null {
  const h = hueOf(rgb);
  if (h < 0) return null;
  const hues = hueSteps(rung.hues);
  const shades = shadeSteps(rung);
  const s = satOf(rgb);
  const v = valueOf(rgb);
  let hi = 0;
  for (let i = 1; i < hues.length; i++) if (hueGap(hues[i] ?? 0, h) < hueGap(hues[hi] ?? 0, h)) hi = i;
  let si = 0;
  let bestD = Infinity;
  for (let i = 0; i < shades.length; i++) {
    const shade = shades[i] ?? { s: 1, v: 1 };
    const d = (shade.s - s) ** 2 + (shade.v - v) ** 2;
    if (d < bestD) {
      bestD = d;
      si = i;
    }
  }
  const { r0, r1 } = ringBand(shades.length, si);
  const a = (hi / hues.length) * TWO_PI;
  const r = (r0 + r1) / 2;
  return { nx: Math.sin(a) * r, ny: -Math.cos(a) * r };
}

/** The colour a level opens on, before the player has touched anything: a mid
 *  grey, which is the one colour no rung ever offers (`COLOR_SAT_MIN` keeps
 *  every grid colour above zero saturation). A default that was itself a
 *  plausible answer would hand a free 100 to whoever never moved. */
export function neutralFor(): Rgb {
  return [128, 128, 128];
}
