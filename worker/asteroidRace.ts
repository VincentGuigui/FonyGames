import {
  ASTEROID_AWAY_MS,
  ASTEROID_BOOST_COOLDOWN_MS,
  ASTEROID_BOOST_MS,
  ASTEROID_BOOST_MULTIPLIER,
  ASTEROID_CLAIM_SLACK,
  ASTEROID_CRUISE_SPEED,
  ASTEROID_LIVES,
  ASTEROID_MAX_PLAYERS,
  ASTEROID_MIN_PLAYERS,
  ASTEROID_REPORT_MS,
  ASTEROID_ROUND_CAP_MS,
  ASTEROID_STUN_MS,
  ASTEROID_TRACK_LENGTH,
  type AsteroidRaceState,
  type AsteroidRun,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';

/**
 * Asteroid Race. Spec: docs/specs/games/asteroid-race.md
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md. Everything here is driven through `Ctx`,
 * which Room supplies — this module never touches a socket.
 *
 * **This referee never flies anything** (spec §2.2). Every ship is alone in
 * its own copy of a field that is a pure function of `roundId`, so there is no
 * second copy of anybody's run for this file to keep — what it owns is the
 * clock, the finish line, the ladder and the winner, and what it does with a
 * report is clamp it to what the clock actually allowed (`reachableBy`).
 *
 * That clamp is the whole anti-cheat (spec §8), and it works because distance
 * here is a function of TIME rather than of effort: a ship cruises on its own,
 * so the fastest run physically available in a given elapsed time is a number
 * this file can compute without knowing anything about the flight.
 */

export type AsteroidRacer = AsteroidRun & {
  /** Server time of their last accepted report — the claim window measures
   *  from here, and going quiet past `ASTEROID_AWAY_MS` freezes the run. */
  lastReportAt: number;
};

export type AsteroidRace = {
  roundId: number;
  startsAt: number;
  /** The 120 s cap (spec §7). */
  endsAt: number;
  /** When the ladder next goes out. The referee's own 1 Hz tick — the one
   *  thing here that is not driven by a report arriving. */
  nextTickAt: number;
  players: Record<PlayerId, AsteroidRacer>;
  /** Alone there is nobody to beat, so the race is a time trial and ends with
   *  `winner: null` (spec §7) — Tiles Surfer's own answer for a solo room. */
  solo: boolean;
  winner: PlayerId | null;
  phase: 'running' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<AsteroidRace | null>;
  save(s: AsteroidRace): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

/** The ladder's own tick, or the cap — whichever is sooner. */
export function nextDeadline(s: AsteroidRace): number {
  return s.phase === 'running' ? Math.min(s.nextTickAt, s.endsAt) : Infinity;
}

function fresh(): AsteroidRacer {
  return { distance: 0, lives: ASTEROID_LIVES, hits: 0, finishedAt: null, away: false, lastReportAt: 0 };
}

/**
 * The furthest any honest ship could have got in `elapsedMs`, having taken
 * `hits` collisions on the way (spec §8).
 *
 * Three terms, and each is a thing the phone cannot argue with:
 *
 * - **Cruise.** The ship flies itself, so time alone buys distance.
 * - **Boost.** Bounded by the cooldown rather than by what was claimed — the
 *   referee never sees a boost (spec §6), so it assumes the best possible use
 *   of them. One is available at the start, hence the `+ 1`.
 * - **Stun.** Every reported hit is a second standing still, so a player who
 *   admits to hits gets a *lower* bound. Which is also the shape of the hole
 *   this cannot close, stated plainly in the spec: hiding a hit is the one lie
 *   that pays, and its payoff is capped at the difference between a real run
 *   and a perfect one.
 */
export function reachableBy(elapsedMs: number, hits: number): number {
  if (!(elapsedMs > 0)) return ASTEROID_CLAIM_SLACK;
  const boosts = Math.floor(elapsedMs / ASTEROID_BOOST_COOLDOWN_MS) + 1;
  const boostMs = Math.min(boosts * ASTEROID_BOOST_MS, elapsedMs);
  const cruise = (ASTEROID_CRUISE_SPEED * elapsedMs) / 1000;
  const bonus = (ASTEROID_CRUISE_SPEED * (ASTEROID_BOOST_MULTIPLIER - 1) * boostMs) / 1000;
  const stunned = (ASTEROID_CRUISE_SPEED * Math.max(0, hits) * ASTEROID_STUN_MS) / 1000;
  return Math.max(0, cruise + bonus - stunned) + ASTEROID_CLAIM_SLACK;
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startAsteroidRace(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [ASTEROID_MIN_PLAYERS, ASTEROID_MAX_PLAYERS], solo)) return false;

  const now = ctx.now();
  const players: Record<PlayerId, AsteroidRacer> = {};
  // Everyone is on the ladder from the first frame, at zero, rather than
  // appearing on their own first report — a race with an empty grid reads as
  // broken for the second it takes the first tick to arrive.
  for (const id of connected) players[id] = { ...fresh(), lastReportAt: now };

  const s: AsteroidRace = {
    roundId,
    startsAt: now,
    endsAt: now + ASTEROID_ROUND_CAP_MS,
    nextTickAt: now + ASTEROID_REPORT_MS,
    players,
    solo: solo || connected.length <= 1,
    winner: null,
    phase: 'running',
  };

  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/**
 * A phone's own periodic or terminal report (spec §6).
 *
 * Everything claimed is clamped before it is stored, and the two clamps do
 * different jobs: `reachableBy(sinceStart)` bounds where a ship can BE, and
 * `reachableBy(min(sinceLastReport, ASTEROID_AWAY_MS))` bounds how far it can
 * have moved since it last said anything. The second is what stops a silent
 * phone banking time and spending it in one frame.
 */
export async function onAsteroidReport(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  distance: number,
  lives: number,
  hits: number,
  at: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.phase !== 'running') return;
  const p = s.players[playerId];
  if (!p || p.finishedAt !== null || p.lives <= 0) return;

  const now = ctx.now();

  // Hits only ever climb, and only by something finite.
  if (Number.isFinite(hits)) p.hits = Math.max(p.hits, Math.trunc(Math.max(0, hits)));
  // Lives only ever fall. A report claiming more than it had is not an error
  // worth rejecting the whole frame over — the number simply does not move.
  if (Number.isFinite(lives)) p.lives = Math.min(p.lives, Math.max(0, Math.trunc(lives)));

  if (Number.isFinite(distance)) {
    const sinceStart = now - s.startsAt;
    const sinceLast = Math.min(now - p.lastReportAt, ASTEROID_AWAY_MS);
    const ceiling = Math.min(reachableBy(sinceStart, p.hits), p.distance + reachableBy(sinceLast, 0));
    // Never backwards: a phone that reconnects resumes from the referee's own
    // number (spec §7), so a stale frame cannot undo real progress.
    p.distance = Math.max(p.distance, Math.min(Math.max(0, distance), ceiling));
  }

  p.lastReportAt = now;
  p.away = false;

  if (p.distance >= ASTEROID_TRACK_LENGTH) {
    // The finish TIME is the phone's own stamp, clamped into the window it
    // could honestly have happened in — it is what the results screen shows.
    // The finish itself is decided by this report arriving, not by that stamp.
    p.finishedAt = clampStamp(at, s.startsAt, now);
    await finish(ctx, s, playerId);
    return;
  }

  if (p.lives <= 0) {
    // Their run is over where it stopped; everyone else keeps flying.
    await ctx.save(s);
    if (allDone(s)) {
      await finish(ctx, s, null);
      return;
    }
    broadcast(ctx, s);
    return;
  }

  await ctx.save(s);
}

/** A phone's own clock estimate, held to a window it could honestly name. */
function clampStamp(at: number, min: number, max: number): number {
  if (!Number.isFinite(at)) return max;
  return Math.min(max, Math.max(min, at));
}

/** Every run either over the line or out of lives — nothing left to wait for. */
function allDone(s: AsteroidRace): boolean {
  const runs = Object.values(s.players);
  return runs.length > 0 && runs.every((p) => p.finishedAt !== null || p.lives <= 0);
}

/**
 * The tick: the ladder goes out, quiet phones freeze, and the cap ends it.
 * Returns true when the round is over.
 */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return false;
  const now = ctx.now();
  if (now < Math.min(s.nextTickAt, s.endsAt)) return false;

  for (const p of Object.values(s.players)) {
    p.away = p.finishedAt === null && p.lives > 0 && now - p.lastReportAt > ASTEROID_AWAY_MS;
  }

  if (now >= s.endsAt || allDone(s)) {
    await finish(ctx, s, null);
    return true;
  }

  // Anchored to the moment rather than accumulated, so a late alarm does not
  // leave the tick permanently behind the clock it is meant to follow.
  s.nextTickAt = now + ASTEROID_REPORT_MS;
  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

/**
 * A player vanished. Their run **freezes where it is** and the race carries on
 * (spec §7) — deliberately not Tiles Surfer's "a phone gone is a phone out",
 * because nobody was racing them directly and their lives are still theirs to
 * come back to: a rejoin resumes at the same distance with the same lives.
 *
 * The cost is that a room everyone walks out of runs to its own cap rather
 * than ending early, which is what the cap is for.
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return;
  const p = s.players[playerId];
  if (!p || p.finishedAt !== null || p.lives <= 0 || p.away) return;

  p.away = true;
  await ctx.save(s);
  broadcast(ctx, s);
}

/**
 * End the race. A named `crosser` won it outright by getting there first;
 * otherwise — everyone out of lives, or the cap — the furthest wins, and a tie
 * at the top is unranked, the convention every other game's own cap uses
 * (spec §7). A solo room has nobody to beat, so it records no winner at all.
 */
async function finish(ctx: Ctx, s: AsteroidRace, crosser: PlayerId | null): Promise<void> {
  let winner: PlayerId | null = crosser;

  if (winner === null && !s.solo) {
    let best = -Infinity;
    let tie = false;
    for (const [id, p] of Object.entries(s.players)) {
      if (p.distance > best) {
        best = p.distance;
        winner = id;
        tie = false;
      } else if (p.distance === best) {
        tie = true;
      }
    }
    if (tie) winner = null;
  }

  s.phase = 'done';
  s.winner = s.solo ? null : winner;
  await ctx.save(s);
  broadcast(ctx, s);
}

/** The race as every phone needs it: everyone's last-accepted run. */
export function toState(s: AsteroidRace): AsteroidRaceState {
  const runs: Record<PlayerId, AsteroidRun> = {};
  for (const [id, p] of Object.entries(s.players)) {
    runs[id] = { distance: p.distance, lives: p.lives, hits: p.hits, finishedAt: p.finishedAt, away: p.away };
  }
  return { roundId: s.roundId, startsAt: s.startsAt, endsAt: s.endsAt, runs, winner: s.winner, phase: s.phase };
}

function broadcast(ctx: Ctx, s: AsteroidRace): void {
  ctx.broadcast({ t: 'asteroid', s: ctx.nextSeq(), d: toState(s) });
}
