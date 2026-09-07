/**
 * Scream Meter's scoring. Spec: docs/specs/games/scream-meter.md §2, §5, §8
 *
 * Shared because the phone computes the score and the referee has to be able to
 * check it is even possible (§8) — and because the choice of *what* to score is
 * the whole design of the game, so it belongs somewhere a test can reach it
 * rather than inside a `<canvas>` loop.
 *
 * Must stay DOM-free: it typechecks under tsconfig.worker.json, and the mic
 * itself lives in `www/src/core/sensors/loudness.ts`.
 *
 * ## Why the loudest sustained three seconds, and not the peak
 *
 * This is the one scoring decision the spec spends most of its §2 on, and it is
 * also the anti-cheat (§8):
 *
 * - **the peak** rewards one bark, or a knuckle on the microphone — the real
 *   exploit, and a very loud one;
 * - **the whole window** rewards whoever can hold a note for ten seconds, which
 *   is a breath-holding contest rather than a screaming one;
 * - **the loudest three seconds** rewards a real scream with a lungful behind
 *   it, lets you take a breath first, and cannot be faked by a tap.
 */

/**
 * Root-mean-square amplitude to dBFS.
 *
 * `0` dBFS is a full-scale signal and everything real is negative. Silence is
 * mathematically `-Infinity`, which is useless to average, so it floors at
 * `SCREAM_DB_FLOOR` — a value quieter than any microphone actually reports.
 */
export const SCREAM_DB_FLOOR = -80;

export function rmsToDbfs(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return SCREAM_DB_FLOOR;
  return Math.max(SCREAM_DB_FLOOR, Math.min(0, 20 * Math.log10(Math.min(1, rms))));
}

/**
 * How many dB above the room's own floor counts as a full 100.
 *
 * A quiet room floors around −55 dBFS on a phone microphone and a real scream
 * held at arm's length reaches about −10, so 45 dB is the span the game has to
 * work with. A guess, and §12 Q2's question about whether one floor makes two
 * different phones comparable is really a question about this number.
 */
export const SCREAM_DB_SPAN = 45;

/**
 * A score out of 100, from the loudest sustained level and the room's own
 * floor.
 *
 * **Relative to the floor, per round.** Two phones in one room are never the
 * same microphone, and this is the cheapest thing that makes them comparable —
 * and doing it per round rather than once means a noisy room does not advantage
 * whoever joined late (spec §5).
 */
export function screamScore(loudestDb: number, floorDb: number): number {
  if (!Number.isFinite(loudestDb) || !Number.isFinite(floorDb)) return 0;
  const above = loudestDb - floorDb;
  return Math.max(0, Math.min(100, Math.round((above / SCREAM_DB_SPAN) * 100)));
}

/**
 * The mean level over the loudest contiguous `windowMs` of a run of samples.
 *
 * Samples are assumed evenly spaced at `intervalMs` — which is what the mic
 * tracker guarantees by sampling on a timer rather than on animation frames.
 *
 * A sliding window rather than a resampling: it is exact, it is O(n), and the
 * whole run is 300 samples.
 *
 * Returns `SCREAM_DB_FLOOR` for an empty run, and for a run **shorter** than
 * the window it averages what there is — a phone that was backgrounded for
 * half the round reports what it managed and is flagged `partial` rather than
 * being silently scored as if it had the full ten seconds (spec §7).
 */
export function loudestWindow(db: readonly number[], windowMs: number, intervalMs: number): number {
  if (db.length === 0) return SCREAM_DB_FLOOR;
  const span = Math.max(1, Math.min(db.length, Math.round(windowMs / Math.max(1, intervalMs))));

  let sum = 0;
  for (let i = 0; i < span; i++) sum += db[i] as number;
  let best = sum;
  for (let i = span; i < db.length; i++) {
    sum += (db[i] as number) - (db[i - span] as number);
    if (sum > best) best = sum;
  }
  return best / span;
}

/** The single loudest sample. Reported alongside the score so an implausible
 *  combination is visible (spec §8), and used as the tie-break (spec §2). */
export function peakOf(db: readonly number[]): number {
  let best = SCREAM_DB_FLOOR;
  for (const value of db) if (value > best) best = value;
  return best;
}

/**
 * The room's own noise floor: the mean of the calibration samples.
 *
 * The mean rather than the minimum, because a minimum over a second of samples
 * is whatever the quietest single frame happened to be, which is noise about
 * noise.
 */
export function floorOf(db: readonly number[]): number {
  if (db.length === 0) return SCREAM_DB_FLOOR;
  let sum = 0;
  for (const value of db) sum += value;
  return sum / db.length;
}

/**
 * The prompts, purely theatrical. Spec §3.
 *
 * **The prompt is never scored**, and the spec says so out loud precisely so
 * nobody later "improves" it into a check: a vowel is pronounced differently in
 * every accent in the room, and pitch detection would punish anyone whose voice
 * sits where it sits. It is a costume.
 */
export const SCREAM_PROMPTS = ['aaa', 'eee', 'ooo', 'iii', 'high', 'low'] as const;

export type ScreamPrompt = typeof SCREAM_PROMPTS[number];

/** One prompt, from an injected 0..1 — the referee's own randomness. */
export function dealPrompt(random: () => number): ScreamPrompt {
  const at = Math.min(SCREAM_PROMPTS.length - 1, Math.floor(random() * SCREAM_PROMPTS.length));
  return SCREAM_PROMPTS[at] as ScreamPrompt;
}

/** Is this a prompt we know? Guards a payload without trusting it. */
export function isScreamPrompt(value: unknown): value is ScreamPrompt {
  return typeof value === 'string' && (SCREAM_PROMPTS as readonly string[]).includes(value);
}
