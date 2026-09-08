import {
  SCREAM_COUNTDOWN_MS,
  SCREAM_MAX_PLAYERS,
  SCREAM_MIN_ALIVE,
  SCREAM_MIN_PLAYERS,
  SCREAM_REPORT_GRACE_MS,
  SCREAM_REVEAL_MS,
  SCREAM_ROUNDS,
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
 * The referee owns the prompt, the clock and the ranking, and it does **not**
 * own the loudness — it cannot, because the audio never leaves the phone
 * (§10). That is a deliberate trade and §8 is where it is paid for. There is
 * no way to verify a claimed score without sending audio, so what this file
 * does instead is make the *cheap* cheats not work:
 *
 * - a score is clamped to the range a real microphone can report;
 * - a score that arrives without heartbeats through the window is not
 *   counted, because it cannot have been measured;
 * - `floor` and `peak` are kept beside `score`, so an implausible combination
 *   — a huge score with a silent floor and no peak — is visible.
 *
 * Beyond that this is a party game played in one room where everybody can
 * hear everybody, and the social check is stronger than any server check.
 * Worth writing down rather than pretending otherwise.
 *
 * ## A match is ten rounds, not one
 *
 * `SCREAM_ROUNDS` prompts, back to back, each its own countdown and window,
 * each adding a score to a running `totals`. Between one round's close and
 * the next round's countdown sits `'reveal'` — long enough to read that
 * round's numbers — and the shape is deliberately the one Color Match's
 * ladder already uses: `armRound` for "deal the next one", `finishRound` for
 * "score this one and hold the reveal", `finishMatch` only once, at the very
 * end, for the total that actually decides the winner.
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
  /** 1-based, current round of `SCREAM_ROUNDS`. */
  round: number;
  prompt: string;
  phase: 'countdown' | 'window' | 'reveal' | 'done';
  startsAt: number;
  endsAt: number;
  /** When the 'reveal' phase ends and either the next round is armed or the
   *  match finishes. Meaningless outside 'reveal'. */
  revealEndsAt: number;
  /** Everyone in the match. A player is here from the start, at no score. */
  entrants: PlayerId[];
  /** Heartbeats seen per player THIS ROUND, the whole reason `scream-alive` exists. */
  alive: Record<PlayerId, number>;
  reports: Record<PlayerId, ScreamReport>;
  /** This round's live 0..1 levels, purely visual — never scored, never kept
   *  once the round closes (spec §4, §10). */
  levels: Record<PlayerId, number>;
  /** Running sum of every completed round's score, per player. */
  totals: Record<PlayerId, number>;
  /** The best peak seen from each player across the whole match — the match's
   *  own tie-break, generalising the single-round rule (spec §2). Server-only:
   *  a phone has no use for anyone else's peak mid-match. */
  bestPeak: Record<PlayerId, number>;
  left: PlayerId[];
  solo: boolean;
  /** The MATCH winner, set only once by `finishMatch`. */
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
 * The next thing this game needs waking for: the start of the screaming, the
 * close plus the reporting grace, or the end of the reveal.
 *
 * The grace is on the alarm rather than being waited out separately, because a
 * phone 300 ms away should lose its own lag and not its score (spec §6).
 */
export function nextDeadline(s: ScreamMeter): number {
  if (s.phase === 'done') return Infinity;
  if (s.phase === 'countdown') return s.startsAt;
  if (s.phase === 'window') return s.endsAt + SCREAM_REPORT_GRACE_MS;
  return s.revealEndsAt;
}

/** Deal a fresh prompt and open the next round's countdown. Mutates `s`. */
function armRound(ctx: Ctx, s: ScreamMeter, round: number): void {
  const now = ctx.now();
  const alive: Record<PlayerId, number> = {};
  for (const id of s.entrants) alive[id] = 0;

  s.round = round;
  s.prompt = dealPrompt(ctx.random);
  s.phase = 'countdown';
  s.startsAt = now + SCREAM_COUNTDOWN_MS;
  s.endsAt = s.startsAt + SCREAM_WINDOW_MS;
  s.alive = alive;
  s.reports = {};
  s.levels = {};
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startScreamMeter(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [SCREAM_MIN_PLAYERS, SCREAM_MAX_PLAYERS], solo)) return false;

  const totals: Record<PlayerId, number> = {};
  const bestPeak: Record<PlayerId, number> = {};
  for (const id of connected) {
    totals[id] = 0;
    bestPeak[id] = SCREAM_DB_FLOOR;
  }

  const s: ScreamMeter = {
    roundId,
    round: 0,
    prompt: '',
    phase: 'countdown',
    startsAt: 0,
    endsAt: 0,
    revealEndsAt: 0,
    entrants: [...connected],
    alive: {},
    reports: {},
    levels: {},
    totals,
    bestPeak,
    left: [],
    solo: solo || connected.length <= 1,
    winner: null,
    draw: false,
  };
  armRound(ctx, s, 1);

  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/**
 * "Still here, still sampling."
 *
 * Counted, not stored: the count is the only thing §8 needs, and a list of
 * timestamps would be a list of when somebody was in a room. `round` has to
 * match the round in flight, or a straggler from the round that just closed
 * could count toward the next one's minimum.
 *
 * **Accepted on the same deadline as a score**, close plus the reporting
 * grace, and for the same reason: a phone sampling right up to the close sends
 * its last heartbeats *at* the close, and with 300 ms of lag they arrive after
 * it. Refusing those would make the heartbeat requirement punish latency
 * rather than catch a client that never sampled — which is the one thing it
 * exists to do (spec §6, §8).
 */
export async function onAlive(ctx: Ctx, playerId: PlayerId, roundId: number, round: number): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.round !== round || s.phase !== 'window') return;
  if (!s.entrants.includes(playerId)) return;
  if (ctx.now() > s.endsAt + SCREAM_REPORT_GRACE_MS) return;
  s.alive[playerId] = (s.alive[playerId] ?? 0) + 1;
  await ctx.save(s);
}

/**
 * "This is roughly how loud I am right now" — purely visual, for the OTHER
 * players' side meters (spec §4). Unlike a heartbeat, this one IS broadcast:
 * the entire point is that the room sees it, at whatever cadence a phone
 * chooses to send it — `SCREAM_LEVEL_MS` is a client-side convention, not
 * something this handler enforces.
 *
 * Same window-and-round guard as `onAlive`: a level from a round that already
 * closed would paint a stale bar over the reveal it has no business near, and
 * `levels` is reset to empty every `armRound` so a silent phone reads as
 * silent rather than as whatever it last managed.
 */
export async function onLevel(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  round: number,
  rawLevel: unknown,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.round !== round || s.phase !== 'window') return;
  if (!s.entrants.includes(playerId)) return;
  if (typeof rawLevel !== 'number' || !Number.isFinite(rawLevel)) return;
  s.levels[playerId] = Math.max(0, Math.min(1, rawLevel));
  await ctx.save(s);
  broadcast(ctx, s);
}

/**
 * One phone's result for ONE round (spec §6).
 *
 * Accepted up to `SCREAM_REPORT_GRACE_MS` past the close, and only once per
 * round — a second report for the same round is ignored rather than
 * replacing the first, so a phone cannot send a modest score and then improve
 * on it.
 */
export async function onScore(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  round: number,
  rawScore: unknown,
  rawPeak: unknown,
  rawFloor: unknown,
  rawPartial: unknown,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.round !== round) return;
  if (s.phase === 'countdown' || s.phase === 'reveal' || s.phase === 'done') return;
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

  // Everybody in: close the round now rather than making a room of two wait
  // out the grace.
  const stillOut = s.entrants.filter((id) => !(id in s.reports) && !s.left.includes(id));
  if (stillOut.length === 0) await finishRound(ctx, s);
}

function clampDb(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return SCREAM_DB_FLOOR;
  return Math.max(SCREAM_DB_FLOOR, Math.min(0, raw));
}

/**
 * The clock. Three things can happen on it: the screaming starts, the window
 * closes and gets scored into a reveal, or the reveal ends and either the
 * next round begins or the match is over.
 *
 * Returns true when the whole match is over.
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

  if (s.phase === 'window') {
    await finishRound(ctx, s);
    return false;
  }

  // The reveal is over. Either this was the last round, or the next one is
  // dealt and the whole thing goes round again — no lobby, no tap to continue.
  if (s.round >= SCREAM_ROUNDS) {
    await finishMatch(ctx, s);
    return true;
  }
  armRound(ctx, s, s.round + 1);
  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

/**
 * A player vanished mid-window: no score for this round, listed as left, and
 * the round does not wait for them (spec §7).
 *
 * Everybody gone ends the match outright rather than idling through however
 * many rounds are left with nobody there to play them.
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase === 'done') return;
  if (!s.entrants.includes(playerId) || s.left.includes(playerId)) return;
  s.left.push(playerId);

  if (s.left.length >= s.entrants.length) {
    await finishMatch(ctx, s);
    return;
  }

  const stillOut = s.entrants.filter((id) => !(id in s.reports) && !s.left.includes(id));
  if (stillOut.length === 0 && s.phase === 'window') {
    await finishRound(ctx, s);
    return;
  }
  await ctx.save(s);
  broadcast(ctx, s);
}

/**
 * Close out one round: fold its scores into the running totals and the
 * match's own peak tie-break, then hold the reveal for `SCREAM_REVEAL_MS`.
 *
 * Deliberately never decides the match itself, even on the final round —
 * `tick` does that once the reveal has actually been shown, the same reason
 * Color Match reveals the level that ends a run before declaring it over
 * rather than jumping straight to the results screen.
 */
async function finishRound(ctx: Ctx, s: ScreamMeter): Promise<void> {
  for (const id of s.entrants) {
    const report = s.reports[id];
    if (!report) continue;
    s.totals[id] = (s.totals[id] ?? 0) + report.score;
    s.bestPeak[id] = Math.max(s.bestPeak[id] ?? SCREAM_DB_FLOOR, report.peak);
  }
  s.phase = 'reveal';
  s.revealEndsAt = ctx.now() + SCREAM_REVEAL_MS;
  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
}

/**
 * Rank the match by total across every round played.
 *
 * Highest total wins; a tie is broken by the best peak either of them ever
 * hit, across the whole match — the single-round tie-break, generalised the
 * same way the score itself was. Both tied is a draw that says so.
 * **Everybody at zero is a draw too**, not an error — a legitimate outcome of
 * a game where the room might just be too polite (spec §7).
 */
async function finishMatch(ctx: Ctx, s: ScreamMeter): Promise<void> {
  let winner: PlayerId | null = null;
  let best = { total: -1, peak: -Infinity };
  let tie = false;

  if (!s.solo) {
    for (const id of s.entrants) {
      const total = s.totals[id] ?? 0;
      if (total <= 0) continue;
      const peak = s.bestPeak[id] ?? SCREAM_DB_FLOOR;
      if (total > best.total || (total === best.total && peak > best.peak)) {
        best = { total, peak };
        winner = id;
        tie = false;
      } else if (total === best.total && peak === best.peak) {
        tie = true;
      }
    }
  }

  s.phase = 'done';
  s.winner = tie ? null : winner;
  s.draw = tie || (!s.solo && winner === null);
  await ctx.save(s);
  broadcast(ctx, s);
}

/** The round as every phone needs it. */
export function toState(s: ScreamMeter): ScreamState {
  const open = s.phase === 'countdown' || s.phase === 'window';
  const scores: ScreamState['scores'] = {};
  // Nothing numeric goes out until a round closes: a live score bar would be
  // the whole game handed to a modified client, and the reveal is the payoff
  // (spec §4).
  if (!open) {
    for (const [id, report] of Object.entries(s.reports)) {
      scores[id] = { score: report.score, peak: report.peak, partial: report.partial };
    }
  }
  return {
    roundId: s.roundId,
    round: s.round,
    rounds: SCREAM_ROUNDS,
    prompt: s.prompt,
    phase: s.phase,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    // Presence only, which is what the row of avatars lighting up needs.
    reported: Object.keys(s.reports),
    // Purely visual, and only while it means anything: the side meters exist
    // for the ten seconds a room is actually screaming (spec §4).
    levels: s.phase === 'window' ? { ...s.levels } : {},
    scores,
    totals: { ...s.totals },
    winner: s.winner,
    draw: s.draw,
  };
}

function broadcast(ctx: Ctx, s: ScreamMeter): void {
  ctx.broadcast({ t: 'scream', s: ctx.nextSeq(), d: toState(s) });
}
