/**
 * Colour distance, the difficulty ladder, and the palettes they generate.
 * Specs: docs/specs/games/color-match.md §2.3, §2.4 · docs/specs/games/color-hunt.md §2.2
 *
 * Lives in `shared/` because the referee scores and the phone previews the
 * same pick, and a second copy of either the distance or the ladder is a
 * second thing to get wrong — the same reason `spillGeometry.ts` and
 * `goatSplit.ts` are here rather than in a game folder.
 *
 * No DOM, no clock, no randomness that is not passed in: everything below is a
 * pure function of its arguments, so `color.test.ts` can walk the whole ladder
 * without a browser and the referee can deal a target from its own seeded
 * source.
 */

export type Rgb = readonly [number, number, number];

/* -------------------------------- distance ------------------------------- */

/**
 * **Redmean**, the cheap weighted-RGB approximation. Good enough to rank
 * near-misses roughly the way an eye does — it leans on green and shifts its
 * red/blue weighting with the pair's own average red — and it needs no
 * dependency, which a real CIEDE2000 would (AGENTS.md §3.3) for a party game
 * that only ever compares two colours at a time.
 */
export function colorDistance(a: Rgb, b: Rgb): number {
  const rBar = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rBar / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rBar) / 256) * db * db);
}

/** Redmean's own maximum, black against white. Arithmetic, not a tunable. */
export const COLOR_D_MAX = colorDistance([0, 0, 0], [255, 255, 255]);

/** Normalised distance beyond which a pick is worth nothing (color-match §2.4).
 *  A guess — the first number a playtest will move. */
export const COLOR_MISS = 0.35;

/**
 * 0–100. Exact match is 100, `COLOR_MISS` and beyond is 0, linear between.
 * The threshold is flat rather than scaled to the rung, so the early levels are
 * all-or-nothing and the late ones are where partial credit lives
 * (color-match.md §2.4, and §12 Q3 for the argument against).
 */
export function colorScore(pick: Rgb, target: Rgb, miss = COLOR_MISS): number {
  const d = colorDistance(pick, target) / COLOR_D_MAX;
  return Math.round(100 * Math.max(0, 1 - d / miss));
}

/* --------------------------------- luminance ------------------------------ */

/** How many intervals the luminance slider is cut into once it appears. */
export const COLOR_LUM_SPLITS = 4;

/** The dimmest a quantised luminance ever goes. Zero would make every colour on
 *  the slider's bottom step black, which is one indistinguishable answer for a
 *  whole row of the wheel. */
export const COLOR_LUM_MIN = 0.25;

/** Apply a 0..1 luminance as a multiplier (color-match.md §2.3): the wheel says
 *  hue and saturation, the slider says brightness, which is the pair a thumb
 *  can actually separate. */
export function withLuminance(base: Rgb, lum: number): Rgb {
  const k = Math.min(1, Math.max(0, lum));
  return [Math.round(base[0] * k), Math.round(base[1] * k), Math.round(base[2] * k)];
}

/** The luminance values a rung offers, dimmest first. */
export function luminanceSteps(splits = COLOR_LUM_SPLITS): number[] {
  const out: number[] = [];
  for (let i = 0; i <= splits; i++) out.push(COLOR_LUM_MIN + ((1 - COLOR_LUM_MIN) * i) / splits);
  return out;
}

/* ---------------------------------- ladder -------------------------------- */

/**
 * One rung of the difficulty ladder (color-match.md §2.3).
 *
 * **`splits` means intervals, not values** — the issue's own examples say so:
 * 1 split is `{0, 255}`, 2 is `{0, 128, 255}`, 4 is `{0, 64, 128, 192, 255}`.
 * A rung therefore offers `splits + 1` values per component, and 0 splits pins
 * a component to 0.
 */
export type Rung = {
  /** How many of the three components are randomised at `splits`. */
  readonly components: number;
  /** Splits on those components. */
  readonly splits: number;
  /** Splits on the ones left over. 0 pins them to black. */
  readonly restSplits: number;
  /** Is the luminance slider live on this rung? */
  readonly luminance: boolean;
};

/** The ladder as a table rather than a staircase of `if`s: one row per five
 *  levels, transcribed from the issue. Level 46 and up is `rungAt`'s formula. */
const LADDER: readonly Rung[] = [
  { components: 1, splits: 1, restSplits: 0, luminance: false }, // 1–5
  { components: 2, splits: 1, restSplits: 0, luminance: false }, // 6–10
  { components: 3, splits: 2, restSplits: 2, luminance: false }, // 11–15
  { components: 3, splits: 4, restSplits: 4, luminance: false }, // 16–20
  { components: 1, splits: 8, restSplits: 4, luminance: false }, // 21–25
  { components: 2, splits: 8, restSplits: 4, luminance: false }, // 26–30
  { components: 3, splits: 8, restSplits: 8, luminance: false }, // 31–35
  { components: 3, splits: 8, restSplits: 8, luminance: true }, // 36–40
  { components: 3, splits: 16, restSplits: 16, luminance: true }, // 41–45
];

/** Where the ladder's table stops and its formula starts. */
export const COLOR_LADDER_ROWS = LADDER.length;

/** The finest the ladder ever gets: a step of 1, every 8-bit value reachable.
 *  The cap is where the colour space runs out, not an arbitrary ceiling. */
export const COLOR_MAX_SPLITS = 255;

/** The rung for a level, 1-based. Past the table, every five levels doubles the
 *  split count until `COLOR_MAX_SPLITS` (color-match.md §2.3). */
export function rungAt(level: number): Rung {
  const n = Math.max(1, Math.floor(level));
  const row = Math.floor((n - 1) / 5);
  const last = LADDER[COLOR_LADDER_ROWS - 1];
  if (row < COLOR_LADDER_ROWS) return LADDER[row] ?? (last as Rung);
  const tier = row - (COLOR_LADDER_ROWS - 1);
  const splits = Math.min(COLOR_MAX_SPLITS, 16 * 2 ** tier);
  return { components: 3, splits, restSplits: splits, luminance: true };
}

/** The values one component may take at `splits` intervals: `splits + 1` of
 *  them, evenly spread over 0..255. `splits` of 0 pins it to black. */
export function componentValues(splits: number): number[] {
  if (splits <= 0) return [0];
  // A whole-number step, clamped at the top — `i * round(255 / splits)`, not
  // `round(i * 255 / splits)`. The two differ by a point or two in the middle
  // and the issue's own example settles it: 4 splits is {0, 64, 128, 192, 255},
  // which the rounded-fraction version would render {0, 64, 128, 191, 255}.
  const step = Math.max(1, Math.round(255 / splits));
  const out: number[] = [];
  for (let i = 0; i <= splits; i++) out.push(Math.min(255, i * step));
  return out;
}

/**
 * Every colour a rung can produce, deduplicated and in a stable order.
 *
 * Deduplicated because the rungs overlap themselves: rung 1 randomises one
 * component out of `{0, 255}`, so picking red-at-0, green-at-0 and blue-at-0
 * are all the same black, and a wheel that drew it three times would be
 * offering the player the same answer under three wedges.
 *
 * The count explodes — 4 colours at level 1, 729 by level 31 — which is why
 * the wheel has two presentations (color-match.md §4.2) and why callers should
 * ask `paletteSize` before asking for the list.
 */
export function palette(rung: Rung): Rgb[] {
  const hot = componentValues(rung.splits);
  const cold = componentValues(rung.restSplits);
  const seen = new Set<number>();
  const out: Rgb[] = [];
  for (const which of choose3(rung.components)) {
    walk(which, hot, cold, (rgb) => {
      const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
      if (seen.has(key)) return;
      seen.add(key);
      out.push(rgb);
    });
  }
  return out;
}

/** How big `palette(rung)` would be, without building it — the wheel asks this
 *  every level and only needs the list below `COLOR_SECTOR_MAX`. */
export function paletteSize(rung: Rung): number {
  // Cheap for the small rungs the sector wheel cares about, and an upper bound
  // that is never consulted for the large ones (a 255-split rung is 16.7M).
  const hot = rung.splits + 1;
  const cold = rung.restSplits <= 0 ? 1 : rung.restSplits + 1;
  if (hot === cold) return hot ** 3;
  return palette(rung).length;
}

/** Which component indices are the randomised ones, for every way of choosing
 *  `k` of the three. */
function choose3(k: number): number[][] {
  const n = Math.min(3, Math.max(0, k));
  const out: number[][] = [];
  for (let mask = 0; mask < 8; mask++) {
    const bits = [0, 1, 2].filter((i) => mask & (1 << i));
    if (bits.length === n) out.push(bits);
  }
  return out;
}

function walk(which: number[], hot: number[], cold: number[], emit: (rgb: Rgb) => void): void {
  const pick = (i: number, acc: number[]): void => {
    if (i === 3) {
      emit([acc[0] ?? 0, acc[1] ?? 0, acc[2] ?? 0]);
      return;
    }
    for (const v of which.includes(i) ? hot : cold) pick(i + 1, [...acc, v]);
  };
  pick(0, []);
}

/**
 * Deal a target for a level. `rand` is a 0..1 source passed in rather than
 * `Math.random` read here, so the referee owns the randomness and a test can
 * pin a level to an exact colour.
 */
export function dealTarget(level: number, rand: () => number): { rgb: Rgb; base: Rgb; lum: number } {
  const rung = rungAt(level);
  const hot = componentValues(rung.splits);
  const cold = componentValues(rung.restSplits);
  const which = new Set<number>();
  while (which.size < Math.min(3, rung.components)) which.add(Math.floor(rand() * 3) % 3);
  const comp = (i: number): number => {
    const from = which.has(i) ? hot : cold;
    return from[Math.min(from.length - 1, Math.floor(rand() * from.length))] ?? 0;
  };
  const base: Rgb = [comp(0), comp(1), comp(2)];
  const steps = luminanceSteps();
  const lum = rung.luminance ? (steps[Math.min(steps.length - 1, Math.floor(rand() * steps.length))] ?? 1) : 1;
  return { rgb: withLuminance(base, lum), base, lum };
}

/** Snap a freely-dragged colour onto the rung's own grid — what the continuous
 *  wheel does on release (color-match.md §4.2). */
export function snapToRung(rgb: Rgb, rung: Rung): Rgb {
  const values = componentValues(Math.max(rung.splits, rung.restSplits));
  const near = (v: number): number => {
    let best = values[0] ?? 0;
    for (const c of values) if (Math.abs(c - v) < Math.abs(best - v)) best = c;
    return best;
  };
  return [near(rgb[0]), near(rgb[1]), near(rgb[2])];
}

/* -------------------------- Color Hunt's own targets ---------------------- */

/**
 * The six primaries and secondaries, at a saturation and value a real object
 * can plausibly be (color-hunt.md §2.2). A pure `#FF0000` is not findable in a
 * room — a red book under a warm bulb is nowhere near it — so the target is the
 * hue at `COLOR_HUNT_TARGET_S`/`_V` instead.
 */
export const COLOR_HUNT_TARGET_S = 0.85;
export const COLOR_HUNT_TARGET_V = 0.8;

export type HuntTarget = { readonly key: string; readonly hue: number };

export const HUNT_TARGETS: readonly HuntTarget[] = [
  { key: 'red', hue: 0 },
  { key: 'yellow', hue: 60 },
  { key: 'green', hue: 120 },
  { key: 'cyan', hue: 180 },
  { key: 'blue', hue: 240 },
  { key: 'magenta', hue: 300 },
];

/** HSV to RGB, for the hunt's own six. Kept here rather than in a game folder
 *  because the referee deals the target and the phone draws it. */
export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

export function huntColor(target: HuntTarget): Rgb {
  return hsvToRgb(target.hue, COLOR_HUNT_TARGET_S, COLOR_HUNT_TARGET_V);
}

/**
 * Pick the next hunt target, never the same one twice running — a repeat reads
 * as the round not having advanced, which matters more here than in Color
 * Match because there is no reveal between rounds to separate them
 * (color-hunt.md §2).
 */
export function nextHuntTarget(previousKey: string | null, rand: () => number): HuntTarget {
  const pool = HUNT_TARGETS.filter((t) => t.key !== previousKey);
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))] ?? HUNT_TARGETS[0]!;
}

/* --------------------------------- shared --------------------------------- */

/** Three scoreless rounds in a row ends a run, in both games — for two
 *  different reasons, which color-match.md §2.1 and color-hunt.md §2.1 each
 *  state. Same number, same name, deliberately. */
export const COLOR_BARREN_ROUNDS = 3;

/** How late a pick may arrive and still count. The referee waits this long past
 *  the deadline before scoring, so a phone loses points to its own lag only
 *  when it is genuinely slow rather than merely far away. */
export const COLOR_PICK_GRACE_MS = 400;

/** Parse anything off the wire into a real colour, or null. The referee never
 *  trusts a payload: a claimed score is ignored entirely (it can only claim a
 *  colour), and a colour outside 0..255 is not one. */
export function asRgb(v: unknown): Rgb | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out: number[] = [];
  for (const n of v) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    out.push(Math.round(Math.min(255, Math.max(0, n))));
  }
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
}
