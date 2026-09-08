import { COLOR_SECTOR_MAX } from './protocol';

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
 * source. The one import, `COLOR_SECTOR_MAX` from `./protocol`, is one
 * direction only — `protocol.ts` imports nothing from here — so this stays a
 * leaf for everything except that one constant.
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

/**
 * The two ends nobody should be asked to guess.
 *
 * **Black and white are not colours to find**, on a wheel or in a room: a black
 * wedge is a hole in the middle of a rainbow, and "point your camera at white"
 * is a game about lightbulbs. They also break the scoring, being the two ends
 * of the redmean axis — a near-black target makes every dark thing a near miss
 * and the round stops discriminating.
 *
 * Deliberately **not** a distance to black: redmean puts a dark red (64, 0, 0)
 * and a very dark grey (32, 32, 32) at almost exactly the same distance from
 * it (0.122 and 0.125 normalised), so one threshold either keeps both or bans
 * both. What actually separates them is what a player sees:
 *
 * - **Value** — `max(r, g, b)`. Below `COLOR_VALUE_FLOOR` a colour reads as
 *   black on a phone at any saturation, dark red included.
 * - **Paleness** — `min(r, g, b)`. Above `COLOR_WHITE_FLOOR` there is not
 *   enough colour left to tell from white on a bright screen.
 */
export const COLOR_VALUE_FLOOR = 72;
export const COLOR_WHITE_FLOOR = 200;

/** Too dark or too pale to be a fair target. */
export function isExtreme(rgb: Rgb): boolean {
  return Math.max(rgb[0], rgb[1], rgb[2]) < COLOR_VALUE_FLOOR || Math.min(rgb[0], rgb[1], rgb[2]) > COLOR_WHITE_FLOOR;
}

/* ------------------------ the three axes of a colour ---------------------- */

/**
 * Hue, saturation and value are the only three axes a colour is built from,
 * in the palette as much as on screen (color-match.md §2.3) — and, since
 * issue #40, **all three are rings on the wheel**. The old model put value on
 * a separate slider; the disc could only ever show `hsv(hue, sat, 1)`, and
 * the slider dimmed it afterwards. That needed two controls to set one
 * colour, and it read, on a real phone, as a slider bolted onto the side of
 * the actual game. Value is now a second radial axis, laid out around the
 * *same* fully-saturated ring saturation already had one side of: light rings
 * inward (pale, tending white), the plain hue in the middle, dark rings
 * outward (dimmed, tending black) — see `shadeSteps` below.
 *
 * Stated as the min/max a component may take, which is what the eye reads:
 *
 * - `max(r, g, b) = 255 x value` — **value is how dark it is allowed to get**,
 *   and a rung with one value step has no dark colours at all.
 * - `min(r, g, b) = 255 x value x (1 - sat)` — **saturation is how pale it is
 *   allowed to get**, and a rung with one saturation step has no light
 *   colours at all.
 */

/** The palest a quantised saturation ever goes. Below it a colour has no
 *  colour left to name: `min(r, g, b)` at value 1 is `255 x (1 - s)`, so
 *  `COLOR_WHITE_FLOOR` (200) is crossed at s = 0.216. A quarter leaves the
 *  palest ring at 191 — pale, still nameable, and never `isExtreme`. */
export const COLOR_SAT_MIN = 0.25;

/** The dimmest a quantised value ever goes. Zero would make a whole ring of the
 *  wheel the same black. 0.4 rather than 0.25 so the dimmest step still clears
 *  `COLOR_VALUE_FLOOR`: 255 x 0.25 is 64, which `isExtreme` bans, and a ring
 *  nobody can pick without landing on black is worse than one fewer ring. */
export const COLOR_LUM_MIN = 0.4;

/** The hues a rung offers, in degrees, starting at red. Evenly spaced, so a
 *  rung with twice as many hues contains every hue of the one before it and
 *  the ladder never takes a colour away. */
export function hueSteps(hues: number): number[] {
  const n = Math.max(1, Math.floor(hues));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((360 * i) / n);
  return out;
}

/** The saturations a rung's LIGHT side offers, palest first, ending at fully
 *  saturated. **One step is fully saturated alone** — no light colours. */
export function saturationSteps(sats: number): number[] {
  const n = Math.max(1, Math.floor(sats));
  if (n === 1) return [1];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(COLOR_SAT_MIN + ((1 - COLOR_SAT_MIN) * i) / (n - 1));
  return out;
}

/** The values a rung's DARK side offers, dimmest first, ending at full value.
 *  **One step is full value alone** — no dark colours. */
export function valueSteps(values: number): number[] {
  const n = Math.max(1, Math.floor(values));
  if (n === 1) return [1];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(COLOR_LUM_MIN + ((1 - COLOR_LUM_MIN) * i) / (n - 1));
  return out;
}

/** 0..360, and -1 for a grey, which has no hue at all. */
export function hueOf(c: Rgb): number {
  const hi = Math.max(c[0], c[1], c[2]);
  const lo = Math.min(c[0], c[1], c[2]);
  if (hi === lo) return -1;
  const d = hi - lo;
  const h =
    hi === c[0] ? ((c[1] - c[2]) / d + 6) % 6 : hi === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
  return h * 60;
}

/** 0..1. */
export function satOf(c: Rgb): number {
  const hi = Math.max(c[0], c[1], c[2]);
  return hi === 0 ? 0 : (hi - Math.min(c[0], c[1], c[2])) / hi;
}

/** 0..1 — `max(r, g, b) / 255`, the HSV value a colour was drawn at. */
export function valueOf(c: Rgb): number {
  return Math.max(c[0], c[1], c[2]) / 255;
}

/** The shorter way round the circle between two hues, in degrees. */
export function hueGap(a: number, b: number): number {
  const d = (((a - b) % 360) + 360) % 360;
  return Math.min(d, 360 - d);
}

/* ---------------------------------- ladder -------------------------------- */

/**
 * One rung of the difficulty ladder (color-match.md §2.3).
 *
 * Three counts, one per axis, and **every one of them is a count of steps, not
 * of intervals**: `sats: 1` means no light colours, `values: 1` means no dark
 * ones. That is the whole point of the shape — a rung says exactly what the
 * wheel offers, so the randomiser cannot ask for a colour the wheel cannot
 * reach. `shadeSteps` below turns these two counts into the wheel's own rings;
 * `www/src/games/color-match/wheel.ts` lays hue around them.
 */
export type Rung = {
  /** How many hues around the disc, evenly spaced from red. */
  readonly hues: number;
  /** How many saturation steps the light side offers, palest to plain. 1
   *  means no light colours — the plain ring is the innermost thing there is. */
  readonly sats: number;
  /** How many value steps the dark side offers, plain to dimmest. 1 means no
   *  dark colours — the plain ring is the outermost thing there is. */
  readonly values: number;
};

/**
 * The wheel's own rings, hub to rim, as `{s, v}` pairs ready for `hsvToRgb`.
 * **Issue #40**: value used to be a slider's job, applied to a disc colour
 * after the fact; it is now a second radial axis, laid out around the one
 * ring saturation already had at full value.
 *
 * `sats - 1` light rings first — palest at the hub, working out to (but not
 * including) fully saturated — then the one **plain** ring both axes agree
 * on (`s: 1, v: 1`, the "the colour, at full strength" every rung has always
 * had), then `values - 1` dark rings, working out from (but not including)
 * full value to the dimmest. Total length `sats + values - 1`: the plain ring
 * is counted once, not twice, which is what `paletteSize` reads off directly
 * rather than restating.
 *
 * `sats: 1, values: 1` — the ladder's first five rungs — collapses to a
 * single entry: the plain ring alone, exactly the pure-hue wheel levels 1–21
 * always drew.
 */
export function shadeSteps(rung: Rung): { s: number; v: number }[] {
  const sats = saturationSteps(rung.sats);
  const values = valueSteps(rung.values);
  const out: { s: number; v: number }[] = [];
  for (let i = 0; i < sats.length - 1; i++) out.push({ s: sats[i] ?? 1, v: 1 });
  out.push({ s: 1, v: 1 });
  for (let i = values.length - 2; i >= 0; i--) out.push({ s: 1, v: values[i] ?? 1 });
  return out;
}

/**
 * The ladder: one row per rung, each declaring **how many levels it lasts**.
 *
 * The progression is one axis at a time, which is what makes it teachable:
 * **hue resolution first, then light, then dark.** Up to level 21 the wheel is
 * one ring and nothing else — every target is a pure, fully-saturated hue,
 * and getting better means telling 10 degrees of hue apart. Rung 6 adds a
 * pale ring inside it. Rung 7 adds a dark ring outside it, and only then can a
 * target be dark — no separate control, just the wheel growing a second way
 * (issue #40; `shadeSteps` above).
 *
 * **A rung may not outlast the colours it adds** — cumulatively, not just what
 * its own palette holds, because of the "never ask twice in a session" rule
 * (§2.3b). Doubling the hue count keeps every hue of the rung before it, so
 * what a rung contributes is what is genuinely new: rung 2 adds three hues,
 * rung 5 adds twenty-four, rung 6 adds a whole ring. `color.test.ts` asserts
 * the rule itself rather than these numbers.
 */
const LADDER: readonly { readonly levels: number; readonly rung: Rung }[] = [
  { levels: 3, rung: { hues: 3, sats: 1, values: 1 } },
  { levels: 3, rung: { hues: 6, sats: 1, values: 1 } },
  { levels: 5, rung: { hues: 12, sats: 1, values: 1 } },
  { levels: 5, rung: { hues: 24, sats: 1, values: 1 } },
  { levels: 5, rung: { hues: 36, sats: 1, values: 1 } },
  { levels: 5, rung: { hues: 36, sats: 2, values: 1 } },
  { levels: 5, rung: { hues: 36, sats: 2, values: 2 } },
  { levels: 5, rung: { hues: 48, sats: 3, values: 3 } },
  { levels: 5, rung: { hues: 60, sats: 4, values: 4 } },
];

/** The last level of each rung: 3, 6, 11, 16, 21, 26, 31, 36, 41. Derived
 *  rather than written, so a rung's span and its boundary cannot disagree. */
export const RUNG_ENDS: readonly number[] = LADDER.reduce<number[]>((acc, row) => {
  acc.push((acc[acc.length - 1] ?? 0) + row.levels);
  return acc;
}, []);

/** Where the ladder's table stops and its formula starts. */
export const COLOR_LADDER_ROWS = LADDER.length;
export const COLOR_LADDER_END = RUNG_ENDS[RUNG_ENDS.length - 1] ?? 0;

/** How long each rung of the ladder runs, past the table. */
const TIER_LEVELS = 5;

/** One hue per degree is where the circle runs out; sixteen steps on the other
 *  two is where a thumb does. Caps, not tunables. */
export const COLOR_MAX_HUES = 360;
export const COLOR_MAX_STEPS = 16;

/** The rung for a level, 1-based. Past the table, every five levels doubles the
 *  hues and adds a step to each of the other two, up to the caps
 *  (color-match.md §2.3). */
export function rungAt(level: number): Rung {
  const n = Math.max(1, Math.floor(level));
  for (let i = 0; i < LADDER.length; i++) {
    if (n <= (RUNG_ENDS[i] ?? 0)) return LADDER[i]?.rung ?? (LADDER[0]!.rung as Rung);
  }
  const tier = Math.floor((n - COLOR_LADDER_END - 1) / TIER_LEVELS) + 1;
  const last = LADDER[COLOR_LADDER_ROWS - 1]?.rung ?? { hues: 60, sats: 4, values: 4 };
  return {
    hues: Math.min(COLOR_MAX_HUES, last.hues * 2 ** tier),
    sats: Math.min(COLOR_MAX_STEPS, last.sats + tier),
    values: Math.min(COLOR_MAX_STEPS, last.values + tier),
  };
}

/* ------------------------ how long a level gives you ---------------------- */

/**
 * The action window, by level (color-match.md §2.2).
 *
 * Two tiers, and the step is **derived from the ladder** rather than written as
 * a round number, so shortening a rung moves it automatically: **3 s** while a
 * wedge can be tapped exactly, **10 s** once the wheel goes continuous and the
 * answer is a precise drag rather than a tap (§4.2).
 *
 * Three seconds is short on purpose (issue #38). The whole point of the run is
 * pace, and every level with an exact wedge to tap is fast by nature — the old
 * 5 s and 10 s left the pie draining with nothing left to do. The reaction
 * bonus below is what makes that window worth beating rather than merely
 * surviving.
 *
 * **Since issue #40** this is no longer about a second control: there has
 * never been more than one, the wheel. The tier now follows the same count
 * that decides which of the wheel's two presentations is on screen —
 * `paletteSize(rung) <= COLOR_SECTOR_MAX` — because free-hand precision, not
 * a second thing to set, is what actually costs a player time past that
 * point.
 */
export const COLOR_ACTION_TIERS: readonly { readonly upTo: number; readonly ms: number }[] = [
  { upTo: RUNG_ENDS[LADDER.findIndex((row) => paletteSize(row.rung) > COLOR_SECTOR_MAX) - 1] ?? 21, ms: 3_000 },
  { upTo: Infinity, ms: 10_000 },
];

/** Both the referee and the pie read this, so the bar on screen cannot
 *  disagree with the deadline being enforced. */
export function colorActionMs(level: number): number {
  for (const tier of COLOR_ACTION_TIERS) if (level <= tier.upTo) return tier.ms;
  return COLOR_ACTION_TIERS[COLOR_ACTION_TIERS.length - 1]?.ms ?? 10_000;
}

/* --------------------------- what a level is worth ------------------------ */

/**
 * How the reaction time turns accuracy into points (issue #38).
 *
 * The action window is cut into **five equal slices**, and which slice the
 * player's own final answer landed in scales their accuracy: answer in the
 * first fifth and it is worth half again, dawdle into the last fifth and it is
 * worth half. Same shape as Color Hunt's own "the clock is the score", but
 * multiplicative rather than additive, so a fast wrong answer still scores
 * nothing and precision stays the thing being rewarded.
 *
 * One multiplier per slice, first slice first.
 */
export const COLOR_REACTION_MULTIPLIERS: readonly number[] = [1.5, 1.2, 1, 0.75, 0.5];

/** Which slice a reaction landed in, and what it multiplies by. `reactionMs`
 *  is measured from the level opening; anything at or past the window is the
 *  last slice, and a missing answer never reaches here at all. */
export function reactionMultiplier(reactionMs: number, actionMs: number): number {
  const slices = COLOR_REACTION_MULTIPLIERS.length;
  const window = Math.max(1, actionMs);
  const at = Math.min(window - 1, Math.max(0, reactionMs));
  const slice = Math.min(slices - 1, Math.floor((at / window) * slices));
  return COLOR_REACTION_MULTIPLIERS[slice] ?? 1;
}

/**
 * A level's points: the accuracy of the colour, bent by how fast it was set
 * (issue #38). Rounded once, at the end, so the number on screen is the number
 * added to the total.
 */
export function colorPoints(accuracy: number, reactionMs: number, actionMs: number): number {
  if (accuracy <= 0) return 0;
  return Math.round(accuracy * reactionMultiplier(reactionMs, actionMs));
}

/**
 * Every colour a rung's **disc** can produce, in the order the wheel lays
 * them out: the innermost ring first (light before plain before dark — see
 * `shadeSteps`), and hue by hue around each ring.
 *
 * The order is load-bearing rather than cosmetic — `wheel.ts` maps index `i`
 * to ring `floor(i / hues)` and slot `i % hues`, so a palette in any other
 * order would put the colours somewhere other than where the hit test looks
 * for them.
 *
 * **Since issue #40, brightness is in here.** It used to be a slider's own
 * multiplier applied to a disc colour after the fact; every ring `shadeSteps`
 * lays out is now a real, distinct colour a tap or a drag can land on.
 */
export function palette(rung: Rung): Rgb[] {
  const out: Rgb[] = [];
  for (const shade of shadeSteps(rung)) {
    for (const h of hueSteps(rung.hues)) out.push(hsvToRgb(h, shade.s, shade.v));
  }
  return out;
}

/** How big `palette(rung)` is, without building it. Exact, not a bound: the
 *  grid has no duplicates to remove and no extremes to filter, because
 *  `COLOR_SAT_MIN` and `COLOR_LUM_MIN` are chosen so nothing on it can be
 *  either (asserted in `color.test.ts`). `sats + values - 1`, not `sats x
 *  values`: the plain ring is one entry both axes agree on, not two. */
export function paletteSize(rung: Rung): number {
  const sats = Math.max(1, Math.floor(rung.sats));
  const values = Math.max(1, Math.floor(rung.values));
  return Math.max(1, Math.floor(rung.hues)) * (sats + values - 1);
}

/** A colour as a map key, for the "never twice in one session" rule. */
export function colorKey(rgb: Rgb): string {
  return `${rgb[0]},${rgb[1]},${rgb[2]}`;
}

/** Above this many targets a rung is sampled rather than enumerated. The
 *  ladder's last rungs run to tens of thousands, so listing them to pick one
 *  stops being free; below it, enumerating is both cheap and exact. */
const ENUMERABLE = 50_000;

/**
 * Deal a target for a level. `rand` is a 0..1 source passed in rather than
 * `Math.random` read here, so the referee owns the randomness and a test can
 * pin a level to an exact colour.
 *
 * **Every target is a colour the wheel offers**, by construction rather than
 * by check: it is one of `palette(rung)`, which is exactly the set a thumb
 * can reach (issue: a dark green dealt at level 17 while the disc showed only
 * light and bright colours). Since issue #40 that is a single grid — hue by
 * ring — rather than a base colour times a separate slider notch.
 *
 * `used` is every colour this session has already asked for (`colorKey`).
 * **A session never asks twice for the same colour** — except when a rung has
 * nothing left to offer, which is not hypothetical: the first rung is red,
 * green and blue and lasts three levels. When that happens the deal falls back
 * to the whole palette rather than failing, and `repeat` says so.
 */
export function dealTarget(
  level: number,
  rand: () => number,
  used: ReadonlySet<string> = new Set(),
): { rgb: Rgb; repeat: boolean } {
  const rung = rungAt(level);
  const hues = hueSteps(rung.hues);
  const shades = shadeSteps(rung);
  // Clamped rather than rejected, so a degenerate `rand` — one a test pins to a
  // constant — picks a colour instead of spinning.
  const draw = (n: number): number => Math.min(n - 1, Math.max(0, Math.floor(rand() * n)));

  if (hues.length * shades.length <= ENUMERABLE) {
    const all: Rgb[] = [];
    const fresh: Rgb[] = [];
    for (const shade of shades) {
      for (const h of hues) {
        const rgb = hsvToRgb(h, shade.s, shade.v);
        all.push(rgb);
        if (!used.has(colorKey(rgb))) fresh.push(rgb);
      }
    }
    const pool = fresh.length > 0 ? fresh : all;
    const rgb = pool[draw(pool.length)] ?? ([255, 0, 0] as Rgb);
    return { rgb, repeat: fresh.length === 0 };
  }

  // Too many to list. One draw per axis; a repeat is reported rather than
  // avoided, which at this size is a coincidence rather than a pattern.
  const h = hues[draw(hues.length)] ?? 0;
  const shade = shades[draw(shades.length)] ?? { s: 1, v: 1 };
  const rgb = hsvToRgb(h, shade.s, shade.v);
  return { rgb, repeat: used.has(colorKey(rgb)) };
}

/**
 * Snap a freely-dragged colour onto the rung's own grid — what the continuous
 * disc does (color-match.md §4.2).
 *
 * Quantised in HSV, on all three axes since issue #40: nearest hue the short
 * way round the circle, and nearest `{s, v}` pair among `shadeSteps(rung)` by
 * plain Euclidean distance in that plane — good enough for a grid whose
 * neighbours are never far apart, and it is only ever asked to settle a point
 * already close to a ring, not to classify an arbitrary colour.
 */
export function snapToRung(rgb: Rgb, rung: Rung): Rgb {
  const hues = hueSteps(rung.hues);
  const shades = shadeSteps(rung);
  const h = Math.max(0, hueOf(rgb));
  const s = satOf(rgb);
  const v = valueOf(rgb);
  let bestH = hues[0] ?? 0;
  for (const c of hues) if (hueGap(c, h) < hueGap(bestH, h)) bestH = c;
  let best = shades[0] ?? { s: 1, v: 1 };
  let bestD = Infinity;
  for (const shade of shades) {
    const d = (shade.s - s) ** 2 + (shade.v - v) ** 2;
    if (d < bestD) {
      bestD = d;
      best = shade;
    }
  }
  return hsvToRgb(bestH, best.s, best.v);
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
 * Pick a hunt target this session has not asked for yet.
 *
 * **Null when all six are gone**, which is a real ending rather than an error:
 * there are only six primaries and secondaries, so a hunt is at most six rounds
 * long by construction (color-hunt.md §2.2). Not-twice-running falls out of
 * not-twice-at-all for free.
 */
export function nextHuntTarget(used: ReadonlySet<string>, rand: () => number): HuntTarget | null {
  const pool = HUNT_TARGETS.filter((t) => !used.has(t.key));
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))] ?? null;
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
