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

/* --------------------------------- luminance ------------------------------ */

/** How many intervals the luminance slider is cut into once it appears. */
export const COLOR_LUM_SPLITS = 4;

/** The dimmest a quantised luminance ever goes. Zero would make every colour on
 *  the slider's bottom step black, which is one indistinguishable answer for a
 *  whole row of the wheel. 0.4 rather than 0.25 so the dimmest step of a
 *  single-channel colour still clears `COLOR_VALUE_FLOOR`: 255 x 0.25 is 64,
 *  which `isExtreme` bans, and a slider whose bottom notch is unreachable is
 *  worse than a shorter slider. */
export const COLOR_LUM_MIN = 0.4;

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
      // Black and white are never on offer (`COLOR_EXTREME`), so the wheel
      // never draws a wedge nobody should be asked to pick.
      if (isExtreme(rgb)) return;
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
  // An upper bound first, so a 255-split rung is never enumerated just to
  // discover it is far too big. The bound ignores both de-duplication and the
  // extreme filter, which only ever make the real count smaller.
  const hot = rung.splits + 1;
  const cold = rung.restSplits <= 0 ? 1 : rung.restSplits + 1;
  if (Math.max(hot, cold) ** 3 > 4096) return Math.max(hot, cold) ** 3;
  return palette(rung).length;
}

/** Which component indices are the randomised ones, for every way of choosing
 *  `k` of the three. Exported so `dealTarget` can index into it rather than
 *  drawing indices until it happens to get distinct ones — a rejection loop
 *  there never terminates on a degenerate `rand` (one that always returns the
 *  same number), which is exactly what a test injects. */
export function choose3(k: number): number[][] {
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

/** A colour as a map key, for the "never twice in one session" rule. */
export function colorKey(rgb: Rgb): string {
  return `${rgb[0]},${rgb[1]},${rgb[2]}`;
}

/** Above this many colours a rung is sampled rather than enumerated. The
 *  ladder's last rungs run to millions, so listing them to pick one is not an
 *  option; below it, enumerating is both cheap and exact. */
const ENUMERABLE = 50_000;

/**
 * Deal a target for a level. `rand` is a 0..1 source passed in rather than
 * `Math.random` read here, so the referee owns the randomness and a test can
 * pin a level to an exact colour.
 *
 * `used` is every colour this session has already asked for (`colorKey`).
 * **A session never asks twice for the same colour** — except when a rung has
 * nothing left to offer, which is not hypothetical: the first rung is red,
 * green and blue and lasts five levels, so levels 4 and 5 must repeat. When
 * that happens the deal falls back to the whole palette rather than failing,
 * and `repeat` says so, so a caller can tell the difference.
 */
export function dealTarget(
  level: number,
  rand: () => number,
  used: ReadonlySet<string> = new Set(),
): { rgb: Rgb; base: Rgb; lum: number; repeat: boolean } {
  const rung = rungAt(level);
  const steps = luminanceSteps();
  const lum = rung.luminance ? (steps[Math.min(steps.length - 1, Math.floor(rand() * steps.length))] ?? 1) : 1;

  if (paletteSize(rung) <= ENUMERABLE) {
    const all = palette(rung);
    const fresh = all.filter((c) => !used.has(colorKey(withLuminance(c, lum))));
    const pool = fresh.length > 0 ? fresh : all;
    const base = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))] ?? [255, 0, 0];
    return { rgb: withLuminance(base, lum), base, lum, repeat: fresh.length === 0 };
  }

  // Too many to list. Draw one and nudge it off black or white if it landed
  // there — deterministically, so no random source can make this spin.
  const hot = componentValues(rung.splits);
  const cold = componentValues(rung.restSplits);
  const ways = choose3(rung.components);
  const which = new Set(ways[Math.min(ways.length - 1, Math.floor(rand() * ways.length))] ?? []);
  const comp = (i: number): number => {
    const from = which.has(i) ? hot : cold;
    return from[Math.min(from.length - 1, Math.floor(rand() * from.length))] ?? 0;
  };
  const base = liftOffExtremes([comp(0), comp(1), comp(2)], lum, hot, cold, which);
  const rgb = withLuminance(base, lum);
  return { rgb, base, lum, repeat: used.has(colorKey(rgb)) };
}

/**
 * Move a colour that would land on black or white onto the nearest allowed
 * value on its own grid. Raising the brightest component fixes a dark one;
 * dropping the dimmest fixes a pale one. Both stay on the rung.
 *
 * **Judged on the colour after its luminance**, not on the base: dimming is
 * what pushes a mid colour under the floor, so checking the base alone lets a
 * near-black through the moment the slider is live. Raising the brightest
 * component to the grid's own top is always enough — 255 x `COLOR_LUM_MIN`
 * clears the floor with room to spare.
 */
function liftOffExtremes(rgb: Rgb, lum: number, hot: number[], cold: number[], which: ReadonlySet<number>): Rgb {
  if (!isExtreme(withLuminance(rgb, lum))) return rgb;
  const out: number[] = [...rgb];
  const gridFor = (i: number): number[] => (which.has(i) ? hot : cold);

  if (Math.max(...out) * lum < COLOR_VALUE_FLOOR) {
    let at = 0;
    for (let i = 1; i < 3; i++) if ((out[i] ?? 0) > (out[at] ?? 0)) at = i;
    const grid = gridFor(at);
    out[at] = grid[grid.length - 1] ?? 255;
  }
  // Dimming never makes a colour paler, so this one only ever reads the base.
  if (Math.min(...out) > COLOR_WHITE_FLOOR) {
    let at = 0;
    for (let i = 1; i < 3; i++) if ((out[i] ?? 0) < (out[at] ?? 0)) at = i;
    const grid = gridFor(at);
    out[at] = grid[0] ?? 0;
  }
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
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
