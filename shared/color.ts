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
 * The wheel says hue and saturation, the slider says value (color-match.md
 * §2.3) — and those three axes are now the *only* way a colour is built, in
 * the palette as much as on screen. The old model randomised RGB components on
 * a grid, which could produce a dark green the wheel had no way to reach: the
 * disc is drawn at full value, so `hsv(hue, sat, 1)` was all a thumb could ever
 * point at (issue: a level 17 target the wheel did not offer).
 *
 * Stated as the min/max a component may take, which is what the eye reads:
 *
 * - `max(r, g, b) = 255 x value` — **value is how dark it is allowed to get**,
 *   and a rung with one value step has no dark colours at all.
 * - `min(r, g, b) = 255 x value x (1 - sat)` — **saturation is how pale it is
 *   allowed to get**, and a rung with one saturation step is the outer ring
 *   alone: no light colours at all.
 */

/** The palest a quantised saturation ever goes. Below it a colour has no
 *  colour left to name: `min(r, g, b)` at value 1 is `255 x (1 - s)`, so
 *  `COLOR_WHITE_FLOOR` (200) is crossed at s = 0.216. A quarter leaves the
 *  palest ring at 191 — pale, still nameable, and never `isExtreme`. */
export const COLOR_SAT_MIN = 0.25;

/** The dimmest a quantised value ever goes. Zero would make a whole ring of the
 *  wheel the same black. 0.4 rather than 0.25 so the dimmest step still clears
 *  `COLOR_VALUE_FLOOR`: 255 x 0.25 is 64, which `isExtreme` bans, and a slider
 *  whose bottom notch is unreachable is worse than a shorter slider. */
export const COLOR_LUM_MIN = 0.4;

/** Apply a 0..1 value as a multiplier (color-match.md §2.3). Scaling all three
 *  components scales HSV's value and leaves hue and saturation alone, which is
 *  exactly why the slider can be a separate control from the disc. */
export function withLuminance(base: Rgb, lum: number): Rgb {
  const k = Math.min(1, Math.max(0, lum));
  return [Math.round(base[0] * k), Math.round(base[1] * k), Math.round(base[2] * k)];
}

/** The hues a rung offers, in degrees, starting at red. Evenly spaced, so a
 *  rung with twice as many hues contains every hue of the one before it and
 *  the ladder never takes a colour away. */
export function hueSteps(hues: number): number[] {
  const n = Math.max(1, Math.floor(hues));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((360 * i) / n);
  return out;
}

/** The saturations a rung offers, palest first. **One step is the outer ring
 *  alone** — fully saturated, no light colours anywhere on the wheel. */
export function saturationSteps(sats: number): number[] {
  const n = Math.max(1, Math.floor(sats));
  if (n === 1) return [1];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(COLOR_SAT_MIN + ((1 - COLOR_SAT_MIN) * i) / (n - 1));
  return out;
}

/** The values a rung offers, dimmest first — the notches on the brightness
 *  slider. **One step is full value alone**: no dark colours, and no slider. */
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
 * of intervals**: `sats: 1` is the outer ring alone, `values: 1` is full value
 * alone. That is the whole point of the shape — a rung says exactly what the
 * wheel offers, so the randomiser cannot ask for a colour the wheel cannot
 * reach. `www/src/games/color-match/wheel.ts` lays out hue around and
 * saturation outward from these same three numbers.
 */
export type Rung = {
  /** How many hues around the disc, evenly spaced from red. */
  readonly hues: number;
  /** How many saturation rings, palest first. 1 means no light colours. */
  readonly sats: number;
  /** How many notches on the brightness slider. 1 means no dark colours, and
   *  no slider at all. */
  readonly values: number;
};

/** Is the brightness slider live on this rung? Derived rather than declared, so
 *  a rung cannot claim a slider it has no values for. */
export function hasLuminance(rung: Rung): boolean {
  return rung.values > 1;
}

/**
 * The ladder: one row per rung, each declaring **how many levels it lasts**.
 *
 * The progression is one axis at a time, which is what makes it teachable:
 * **hue resolution first, then light, then dark.** Up to level 21 the wheel is
 * the outer ring and nothing else — every target is a pure, fully-saturated
 * hue, and getting better means telling 10 degrees of hue apart. Rung 6 adds a
 * pale ring inside it. Rung 7 adds the brightness slider, and only then can a
 * target be dark.
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
 * a round number, so shortening a rung moves it automatically: **3 s** while
 * the answer is one tap on the wheel, **10 s** from the rung that adds the
 * luminance slider, where a level needs two controls set rather than one.
 *
 * Three seconds is short on purpose (issue #38). The whole point of the run is
 * pace, and every level up to the slider is a single tap — the old 5 s and 10 s
 * left the pie draining with nothing left to do. The reaction bonus below is
 * what makes that window worth beating rather than merely surviving.
 */
export const COLOR_ACTION_TIERS: readonly { readonly upTo: number; readonly ms: number }[] = [
  { upTo: RUNG_ENDS[LADDER.findIndex((row) => hasLuminance(row.rung)) - 1] ?? 26, ms: 3_000 },
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
 * Every colour a rung's **disc** can produce, at full value, in the order the
 * wheel lays them out: palest ring first, and hue by hue around each ring.
 *
 * The order is load-bearing rather than cosmetic — `wheel.ts` maps index `i` to
 * ring `floor(i / hues)` and slot `i % hues`, so a palette in any other order
 * would put the colours somewhere other than where the hit test looks for them.
 *
 * Brightness is not in here: it is the slider's axis, and a dealt target is a
 * palette entry under one of `valueSteps(rung.values)` (`dealTarget`).
 */
export function palette(rung: Rung): Rgb[] {
  const out: Rgb[] = [];
  for (const s of saturationSteps(rung.sats)) {
    for (const h of hueSteps(rung.hues)) out.push(hsvToRgb(h, s, 1));
  }
  return out;
}

/** How big `palette(rung)` is, without building it. Exact, not a bound: the
 *  grid has no duplicates to remove and no extremes to filter, because
 *  `COLOR_SAT_MIN` and `COLOR_LUM_MIN` are chosen so nothing on it can be
 *  either (asserted in `color.test.ts`). */
export function paletteSize(rung: Rung): number {
  return Math.max(1, Math.floor(rung.hues)) * Math.max(1, Math.floor(rung.sats));
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
 * **Every target is a colour the wheel offers**, by construction rather than by
 * check: it is one of `palette(rung)` under one of `valueSteps(rung.values)`,
 * which is exactly the set a thumb can reach (issue: a dark green dealt at
 * level 17 while the disc showed only light and bright colours).
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
): { rgb: Rgb; base: Rgb; lum: number; repeat: boolean } {
  const rung = rungAt(level);
  const hues = hueSteps(rung.hues);
  const sats = saturationSteps(rung.sats);
  const lums = valueSteps(rung.values);
  // Clamped rather than rejected, so a degenerate `rand` — one a test pins to a
  // constant — picks a colour instead of spinning.
  const draw = (n: number): number => Math.min(n - 1, Math.max(0, Math.floor(rand() * n)));

  if (hues.length * sats.length * lums.length <= ENUMERABLE) {
    const all: { base: Rgb; lum: number }[] = [];
    const fresh: { base: Rgb; lum: number }[] = [];
    for (const s of sats) {
      for (const h of hues) {
        const base = hsvToRgb(h, s, 1);
        for (const lum of lums) {
          const one = { base, lum };
          all.push(one);
          if (!used.has(colorKey(withLuminance(base, lum)))) fresh.push(one);
        }
      }
    }
    const pool = fresh.length > 0 ? fresh : all;
    const one = pool[draw(pool.length)] ?? { base: [255, 0, 0] as Rgb, lum: 1 };
    return { rgb: withLuminance(one.base, one.lum), base: one.base, lum: one.lum, repeat: fresh.length === 0 };
  }

  // Too many to list. One draw per axis; a repeat is reported rather than
  // avoided, which at this size is a coincidence rather than a pattern.
  const base = hsvToRgb(hues[draw(hues.length)] ?? 0, sats[draw(sats.length)] ?? 1, 1);
  const lum = lums[draw(lums.length)] ?? 1;
  const rgb = withLuminance(base, lum);
  return { rgb, base, lum, repeat: used.has(colorKey(rgb)) };
}

/**
 * Snap a freely-dragged colour onto the rung's own grid — what the continuous
 * disc does (color-match.md §4.2).
 *
 * Quantised in HSV, on the two axes the disc actually has, and returned at full
 * value: brightness is the slider's, and a disc that returned a dimmed colour
 * would be answering for a control the player has not touched. Hue is snapped
 * the short way round the circle, so 350 degrees lands on red rather than on
 * the last step before it.
 */
export function snapToRung(rgb: Rgb, rung: Rung): Rgb {
  const hues = hueSteps(rung.hues);
  const sats = saturationSteps(rung.sats);
  const h = Math.max(0, hueOf(rgb));
  const s = satOf(rgb);
  let bestH = hues[0] ?? 0;
  for (const c of hues) if (hueGap(c, h) < hueGap(bestH, h)) bestH = c;
  let bestS = sats[0] ?? 1;
  for (const c of sats) if (Math.abs(c - s) < Math.abs(bestS - s)) bestS = c;
  return hsvToRgb(bestH, bestS, 1);
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
