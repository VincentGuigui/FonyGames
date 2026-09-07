import {
  SCREAM_COUNTDOWN_MS,
  SCREAM_MAX_PLAYERS,
  SCREAM_MIN_ALIVE,
  SCREAM_MIN_PLAYERS,
  SCREAM_REPORT_GRACE_MS,
  SCREAM_WINDOW_MS,
  type PlayerId,
  type ScreamState,
  type ServerMessage,
} from '../shared/protocol';
import { SCREAM_DB_FLOOR, dealPrompt } from '../shared/scream';
import { enoughToStart } from '../shared/players';

/**
 * Scream Meter. Spec: docs/specs/games/scream-meter.md
 *
 * The shortest game in the catalogue and the simplest referee: it owns the
 * prompt, the clock and the ranking, and it does **not** own the loudness — it
 * cannot, because the audio never leaves the phone (§10).
 *
 * That is a deliberate trade and §8 is where it is paid for. There is no way to
 * verify a claimed score without sending audio, so what this file does instead
 * is make the *cheap* cheats not work:
 *
 * - a score is clamped to the range a real microphone can report;
 * - a score that arrives without heartbeats through the window is not counted,
 *   because it cannot have been measured;
 * - `floor` and `peak` are kept beside `score`, so an implausible combination —
 *   a huge score with a silent floor and no peak — is visible.
 *
 * Beyond that this is a party game played in one room where everybody can hear
 * everybody, and the social check is stronger than any server check. Worth
 * writing down rather than pretending otherwise.
 */

export type ScreamReport = {
  score: number;
  peak: number;
  floor: number;
  /** The phone was backgrounded, or joined late, and knows its run is short. */
  partial: boolean;
};

export type ScreamMeter = {
  roundId: number;
  prompt: string;
  phase: 'countdown' | 'window' | 'done';
  startsAt: number;
  endsAt: number;
  /** Everyone in the round. A player is here from the start, at no score. */
  entrants: PlayerId[];
  /** Heartbeats seen per player, the whole reason `scream-alive` exists. */
  alive: Record<PlayerId, number>;
  reports: Record<PlayerId, ScreamReport>;
  left: PlayerId[];
  solo: boolean;
  winner: PlayerId | null;
  draw: boolean;
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<ScreamMeter | null>;
  save(s: ScreamMeter): Promise<void>;
  setAlarm(at: number): Promise<void>;
  random(): number;
};

/**
 * The next thing this game needs waking for: the start of the screaming, then
 * the close plus the reporting grace.
 *
 * The grace is on the alarm rather than being waited out separately, because a
 * phone 300 ms away should lose its own lag and not its score (spec §6).
 */
export function nextDeadline(s: ScreamMeter): number {
  if (s.phase === 'done') return Infinity;
  return s.phase === 'countdown' ? s.startsAt : s.endsAt + SCREAM_REPORT_GRACE_MS;
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startScreamMeter(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [SCREAM_MIN_PLAYERS, SCREAM_MAX_PLAYERS], solo)) return false;

  const now = ctx.now();
  const alive: Record<PlayerId, number> = {};
  for (const id of connected) alive[id] = 0;

  const s: ScreamMeter = {
    roundId,
    prompt: dealPrompt(ctx.random),
    phase: 'countdown',
    startsAt: now + SCREAM_COUNTDOWN_MS,
    endsAt: now + SCREAM_COUNTDOWN_MS + SCREAM_WINDOW_MS,
    entrants: [...connected],
    alive,
    reports: {},
    left: [],
    solo: solo || connected.length <= 1,
    winner: null,
    draw: false,
  };

  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/**
 * "Still here, still sampling."
 *
 * Counted, not stored: the count is the only thing §8 needs, and a list of
 * timestamps would be a list of when somebody was in a room.
 *
 * **Accepted on the same deadline as a score**, close plus the reporting
 * grace, and for the same reason: a phone sampling right up to the close sends
 * its last heartbeats *at* the close, and with 300 ms of lag they arrive after
 * it. Refusing those would make the heartbeat requirement punish latency
 * rather than catch a client that never sampled — which is the one thing it
 * exists to do (spec §6, §8).
 */
export async function onAlive(ctx: Ctx, playerId: PlayerId, roundId: number): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.phase !== 'window') return;
  if (!s.entrants.includes(playerId)) return;
  if (ctx.now() > s.endsAt + SCREAM_REPORT_GRACE_MS) return;
  s.alive[playerId] = (s.alive[playerId] ?? 0) + 1;
  await ctx.save(s);
}

/**
 * One phone's result (spec §6).
 *
 * Accepted up to `SCREAM_REPORT_GRACE_MS` past the close, and only once — a
 * second report is ignored rather than replacing the first, so a phone cannot
 * send a modest score and then improve on it.
 */
export async function onScore(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  rawScore: unknown,
  rawPeak: unknown,
  rawFloor: unknown,
  rawPartial: unknown,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId) return;
  if (s.phase === 'countdown' || s.phase === 'done') return;
  if (!s.entrants.includes(playerId) || playerId in s.reports) return;
  if (ctx.now() > s.endsAt + SCREAM_REPORT_GRACE_MS) return;

  if (typeof rawScore !== 'number' || !Number.isFinite(rawScore)) return;

  /*
   * A score with no heartbeats behind it was not measured (spec §8). The bar is
   * deliberately low — this only has to catch a client that did not even
   * pretend to sample — and it is checked here rather than at the ranking so
   * the phone's own screen is not left claiming a score the room will not
   * honour.
   */
  if ((s.alive[playerId] ?? 0) < SCREAM_MIN_ALIVE) return;

  s.reports[playerId] = {
    // Clamped to the range a real microphone can report (spec §8).
    score: Math.max(0, Math.min(100, Math.round(rawScore))),
    peak: clampDb(rawPeak),
    floor: clampDb(rawFloor),
    partial: rawPartial === true,
  };
  await ctx.save(s);
  broadcast(ctx, s);

  // Everybody in: rank now rather than making a room of two wait out the grace.
  const stillOut = s.entrants.filter((id) => !(id in s.reports) && !s.left.includes(id));
  if (stillOut.length === 0) await finish(ctx, s);
}

function clampDb(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return SCREAM_DB_FLOOR;
  return Math.max(SCREAM_DB_FLOOR, Math.min(0, raw));
}

/**
 * The clock. Two things happen on it: the screaming starts, and the window
 * closes and gets ranked.
 *
 * Returns true when the round is over.
 */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase === 'done') return false;
  if (ctx.now() < nextDeadline(s)) return false;

  if (s.phase === 'countdown') {
    s.phase = 'window';
    await ctx.save(s);
    broadcast(ctx, s);
    await ctx.setAlarm(nextDeadline(s));
    return false;
  }

  await finish(ctx, s);
  return true;
}

/**
 * A player vanished mid-window: no score, listed as left, and the round does
 * not wait for them (spec §7).
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase === 'done') return;
  if (!s.entrants.includes(playerId) || s.left.includes(playerId)) return;
  s.left.push(playerId);

  const stillOut = s.entrants.filter((id) => !(id in s.reports) && !s.left.includes(id));
  if (stillOut.length === 0 && s.phase === 'window') {
    await finish(ctx, s);
    return;
  }
  await ctx.save(s);
  broadcast(ctx, s);
}

/**
 * Rank the room.
 *
 * Highest score wins; a tie is broken by peak loudness, and a tie on both is a
 * draw that says so. **Everybody silent is a draw too**, not an error — it is a
 * legitimate outcome of a game where the room might just be too polite (spec
 * §7).
 */
async function finish(ctx: Ctx, s: ScreamMeter): Promise<void> {
  let winner: PlayerId | null = null;
  let best = { score: -1, peak: -Infinity };
  let tie = false;

  if (!s.solo) {
    for (const id of s.entrants) {
      const report = s.reports[id];
      if (!report || report.score <= 0) continue;
      if (report.score > best.score || (report.score === best.score && report.peak > best.peak)) {
        best = { score: report.score, peak: report.peak };
        winner = id;
        tie = false;
      } else if (report.score === best.score && report.peak === best.peak) {
        tie = true;
      }
    }
  }

  s.phase = 'done';
  s.winner = tie ? null : winner;
  // A draw covers both shapes: nobody scored at all, and a genuine tie at the
  // top after the peak tie-break.
  s.draw = tie || (!s.solo && winner === null);
  await ctx.save(s);
  broadcast(ctx, s);
}

/** The round as every phone needs it. */
export function toState(s: ScreamMeter): ScreamState {
  const open = s.phase !== 'done';
  const scores: ScreamState['scores'] = {};
  // Nothing numeric goes out until the close: eight live meters would be
  // unreadable at this size and would put eight streams on the wire for a
  // ten-second round (spec §4). The reveal is the payoff instead.
  if (!open) {
    for (const [id, report] of Object.entries(s.reports)) {
      scores[id] = { score: report.score, peak: report.peak, partial: report.partial };
    }
  }
  return {
    roundId: s.roundId,
    prompt: s.prompt,
    phase: s.phase,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    // Presence only, which is what the row of avatars lighting up needs.
    reported: Object.keys(s.reports),
    scores,
    winner: s.winner,
    draw: s.draw,
  };
}

function broadcast(ctx: Ctx, s: ScreamMeter): void {
  ctx.broadcast({ t: 'scream', s: ctx.nextSeq(), d: toState(s) });
}
