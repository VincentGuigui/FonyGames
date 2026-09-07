import { componentValues, palette, snapToRung, type Rgb, type Rung } from '../../../../shared/color';

/**
 * The wheel's geometry. Spec: docs/specs/games/color-match.md §4.2
 *
 * **No DOM in this file.** The layout and the hit test are pure functions of a
 * rung and a pointer position, so they can be asserted rather than eyeballed —
 * the same split `asteroid-race/pose.ts` and `pass-the-bomb/shockwave.ts` make.
 * `ColorWheel.tsx` draws what these return and owns every pixel.
 *
 * The wheel has two presentations, and which one is on depends on how many
 * colours the rung can actually produce rather than on the level number: while
 * the palette is small the reachable colours are drawn as wedges and a tap
 * picks one exactly, so an early level cannot be lost to a shaky thumb; once
 * there are more colours than wedges worth drawing, it becomes a continuous
 * hue/saturation disc that snaps to the rung on release.
 */

export type Sector = {
  /** The colour this wedge offers. */
  rgb: Rgb;
  /** Ring index, 0 at the centre. */
  ring: number;
  /** Inner and outer radius, as fractions of the disc's own radius. */
  r0: number;
  r1: number;
  /** Start and end angle, in radians, clockwise from twelve o'clock. */
  a0: number;
  a1: number;
};

/** The innermost radius a wedge ever starts at. The hole in the middle is
 *  where the current pick is previewed, and it stops the first ring's wedges
 *  from converging into an unpickable point. */
export const WHEEL_HUB = 0.28;

/**
 * How the reachable colours are ordered around the disc.
 *
 * By hue first, then by how bright they are: that puts every red together and
 * walks outward from dark to light, which is the only ordering where dragging
 * a thumb feels like moving through colours rather than through a list. A
 * palette sorted by raw RGB triple looks arbitrary on screen even though it is
 * perfectly ordered as numbers.
 */
export function sortForWheel(colors: readonly Rgb[]): Rgb[] {
  return [...colors].sort((a, b) => {
    const ha = hueOf(a);
    const hb = hueOf(b);
    if (ha !== hb) return ha - hb;
    const sa = satOf(a);
    const sb = satOf(b);
    if (sa !== sb) return sa - sb;
    return max3(a) - max3(b);
  });
}

function max3(c: Rgb): number {
  return Math.max(c[0], c[1], c[2]);
}

function min3(c: Rgb): number {
  return Math.min(c[0], c[1], c[2]);
}

/** 0..360. Grey has no hue at all, so it is parked at -1 and sorts first —
 *  which puts the whole greyscale run together at twelve o'clock instead of
 *  scattering it through the colours. */
export function hueOf(c: Rgb): number {
  const hi = max3(c);
  const lo = min3(c);
  if (hi === lo) return -1;
  const d = hi - lo;
  const h =
    hi === c[0] ? ((c[1] - c[2]) / d + 6) % 6 : hi === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
  return h * 60;
}

export function satOf(c: Rgb): number {
  const hi = max3(c);
  return hi === 0 ? 0 : (hi - min3(c)) / hi;
}

/** How many rings a palette of `n` colours is laid out in. Roughly three times
 *  as many wedges around as rings out, which keeps a wedge about as wide as it
 *  is tall at the radius a thumb actually lands on. */
export function ringsFor(n: number): number {
  return Math.max(1, Math.round(Math.sqrt(Math.max(1, n) / 3)));
}

/** Lay a rung's palette out as wedges. Empty when the rung is too big to draw
 *  this way — ask `isSectorRung` first. */
export function sectorsFor(rung: Rung, sectorMax: number): Sector[] {
  const colors = sortForWheel(palette(rung));
  if (colors.length === 0 || colors.length > sectorMax) return [];
  const rings = ringsFor(colors.length);
  const per = Math.ceil(colors.length / rings);
  const band = (1 - WHEEL_HUB) / rings;

  return colors.map((rgb, i) => {
    const ring = Math.floor(i / per);
    const slot = i % per;
    // The last ring may be short; its wedges widen to fill the circle rather
    // than leaving a gap that looks like a missing colour.
    const inRing = Math.min(per, colors.length - ring * per);
    const step = (Math.PI * 2) / inRing;
    return {
      rgb,
      ring,
      r0: WHEEL_HUB + ring * band,
      r1: WHEEL_HUB + (ring + 1) * band,
      a0: slot * step,
      a1: (slot + 1) * step,
    };
  });
}

/** Is this rung small enough to draw as wedges (spec §4.2)? */
export function isSectorRung(rung: Rung, sectorMax: number): boolean {
  const hot = rung.splits + 1;
  const cold = rung.restSplits <= 0 ? 1 : rung.restSplits + 1;
  // A cheap upper bound first, so a 255-split rung is never enumerated just to
  // discover it is far too big.
  if (hot ** 3 > sectorMax && cold ** 3 > sectorMax && hot > 1) return false;
  return palette(rung).length <= sectorMax;
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
  const a = (Math.atan2(nx, -ny) + Math.PI * 2) % (Math.PI * 2);
  for (const s of sectors) {
    if (r >= s.r0 && r <= s.r1 && a >= s.a0 && a < s.a1) return s;
  }
  return null;
}

/**
 * What a pointer is pointing at on the continuous disc: hue around,
 * saturation outward, full value — brightness is the slider's job, not the
 * wheel's (spec §2.3) — then snapped onto the rung's own grid.
 *
 * Returns the *snapped* colour, because that is what will be scored: showing
 * the free colour and submitting a different one is the kind of gap a player
 * discovers by losing.
 */
export function continuousAt(rung: Rung, nx: number, ny: number): Rgb | null {
  const r = Math.hypot(nx, ny);
  if (r > 1) return null;
  const a = (Math.atan2(nx, -ny) + Math.PI * 2) % (Math.PI * 2);
  const hue = (a / (Math.PI * 2)) * 360;
  const sat = Math.min(1, r / 1);
  return snapToRung(hsv(hue, sat, 1), rung);
}

/** HSV to RGB. A local copy rather than `shared/color.ts`'s, which exists for
 *  Color Hunt's six fixed targets — this one is called on every pointer move
 *  and wants no import cycle through the hunt's constants. */
function hsv(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

/** Where a colour sits on the continuous disc, so the cursor can be drawn on
 *  top of the pick rather than wherever the thumb last was. */
export function positionOf(rgb: Rgb): { nx: number; ny: number } {
  const hue = hueOf(rgb);
  const a = ((hue < 0 ? 0 : hue) / 360) * Math.PI * 2;
  const r = satOf(rgb);
  return { nx: Math.sin(a) * r, ny: -Math.cos(a) * r };
}

/** The colour a level opens on, before the player has touched anything: the
 *  middle of the rung's own range on every component. Not black — a default
 *  that is itself a plausible answer at level 1 would hand a free 100 to
 *  whoever never moved. */
export function neutralFor(rung: Rung): Rgb {
  const values = componentValues(Math.max(rung.splits, rung.restSplits));
  const mid = values[Math.floor(values.length / 2)] ?? 128;
  return [mid, mid, mid];
}
