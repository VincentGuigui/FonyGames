import {
  BLINK_DEFAULT_DURATION,
  BLINK_DEFAULT_LIGHTS,
  BLINK_DURATION_CHOICES,
  BLINK_LIGHT_CHOICES,
  BLINK_MAX_RATE,
  BLINK_MISS_LIMIT,
  BLINK_ON_FRACTION,
  BLINK_RAMP_MS,
  BLINK_START_RATE,
  type BlinkOptions,
} from './protocol';

/**
 * Blink Tapper's cadence and scoring. Spec: docs/specs/games/blink-tapper.md §2
 *
 * Shared by the phone, which plays the round, and the referee, which bounds the
 * one report it gets — so the bound in spec §8 is the phone's own schedule and
 * cannot drift from it.
 *
 * Time is ms since the first blink throughout.
 */

const A = BLINK_START_RATE / 1000;
const B = (BLINK_MAX_RATE - BLINK_START_RATE) / 1000 / BLINK_RAMP_MS;
const AT_RAMP = A * BLINK_RAMP_MS + (B * BLINK_RAMP_MS * BLINK_RAMP_MS) / 2;

/** Blinks per second at time `t`: linear in the rate, not the interval (§2.1). */
export function blinkRate(t: number): number {
  const c = Math.min(Math.max(0, t), BLINK_RAMP_MS);
  return BLINK_START_RATE + ((BLINK_MAX_RATE - BLINK_START_RATE) * c) / BLINK_RAMP_MS;
}

/**
 * How many blinks have gone by at `t`, fractionally — the integral of the rate.
 *
 * The integer part is the blink under way and the fraction is how far through
 * it the light is, so "is it lit" is one comparison. That is also the whole of
 * the referee's bound: nobody can have hit more blinks than have started.
 */
export function blinksAt(t: number): number {
  if (t <= 0) return 0;
  if (t <= BLINK_RAMP_MS) return A * t + (B * t * t) / 2;
  return AT_RAMP + (BLINK_MAX_RATE / 1000) * (t - BLINK_RAMP_MS);
}

/** The most hits a phone could honestly claim after `t` of play. */
export function maxHits(t: number): number {
  return t <= 0 ? 0 : Math.floor(blinksAt(t)) + 1;
}

/** The host's options, from whatever arrived: anything unknown falls back to
 *  the default rather than to a neighbour. */
export function normaliseBlinkOptions(raw: unknown): BlinkOptions {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const lights = (BLINK_LIGHT_CHOICES as readonly unknown[]).includes(o['lights'])
    ? (o['lights'] as number)
    : BLINK_DEFAULT_LIGHTS;
  const duration = (BLINK_DURATION_CHOICES as readonly unknown[]).includes(o['duration'])
    ? (o['duration'] as number)
    : BLINK_DEFAULT_DURATION;
  return { lights, duration };
}

/** One phone's round. */
export type Blinker = {
  lights: number;
  /** 0 is `unlimited`. */
  duration: number;
  hits: number;
  misses: number;
  /** Every blink below this index has been scored, one way or the other. */
  settled: number;
  /** The blink that was tapped in time, which is dark for the rest of it. */
  tapped: number;
  done: boolean;
};

export function newBlinker(options: BlinkOptions): Blinker {
  return { lights: options.lights, duration: options.duration, hits: 0, misses: 0, settled: 0, tapped: -1, done: false };
}

export function blinkScore(b: Pick<Blinker, 'hits' | 'misses'>): number {
  return b.hits - b.misses;
}

/** Share of taps and blinks that were hits, as a whole percent; null when
 *  there was nothing to score, which is not the same as 0%. */
export function blinkAccuracy(f: Pick<Blinker, 'hits' | 'misses'>): number | null {
  const total = f.hits + f.misses;
  return total > 0 ? Math.round((f.hits / total) * 100) : null;
}

/**
 * Score every blink that has gone dark by `t`.
 *
 * A blink that closes untapped is a miss. Counted by index rather than by
 * frames seen: at 30 a second a blink is two frames long, and a phone that
 * drops a frame — or comes back from the background — has still let every one
 * of those blinks go by (spec §7).
 */
export function advance(b: Blinker, t: number): Blinker {
  if (b.done) return b;
  const end = b.duration > 0 ? Math.min(t, b.duration) : t;
  const n = blinksAt(end);
  const k = Math.floor(n);
  const closed = n - k >= BLINK_ON_FRACTION ? k + 1 : k;
  let misses = b.misses;
  if (closed > b.settled) {
    const hitInside = b.tapped >= b.settled && b.tapped < closed ? 1 : 0;
    misses += closed - b.settled - hitInside;
  }
  const out = { ...b, misses, settled: Math.max(b.settled, closed) };
  return finishIfOver(out, t);
}

/** Which light is on at `t`, or null when it is dark. */
export function litLight(b: Blinker, t: number): number | null {
  if (b.done || t < 0) return null;
  const n = blinksAt(t);
  const k = Math.floor(n);
  if (n - k >= BLINK_ON_FRACTION || k === b.tapped) return null;
  return k % b.lights;
}

/**
 * A tap on light `light` at `t`: the lit one is a point and goes dark until the
 * next blink; anything else — a dark light, the wrong light — is a miss, which
 * is what stops a thumb mashing every light scoring every blink.
 */
export function tapLight(b: Blinker, t: number, light: number): Blinker {
  const now = advance(b, t);
  if (now.done || t < 0) return now;
  const lit = litLight(now, t);
  if (lit !== null && lit === light) {
    return finishIfOver({ ...now, hits: now.hits + 1, tapped: Math.floor(blinksAt(t)) }, t);
  }
  return finishIfOver({ ...now, misses: now.misses + 1 }, t);
}

function finishIfOver(b: Blinker, t: number): Blinker {
  if (b.duration > 0) return t >= b.duration ? { ...b, done: true } : b;
  if (b.misses >= BLINK_MISS_LIMIT) return { ...b, misses: BLINK_MISS_LIMIT, done: true };
  return b;
}
