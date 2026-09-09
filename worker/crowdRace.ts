import {
  CROWD_AWAY_MS,
  CROWD_CLAIM_SLACK,
  CROWD_FINISH_Y,
  CROWD_MAX_PLAYERS,
  CROWD_MIN_PLAYERS,
  CROWD_REPORT_MS,
  CROWD_RUN_CAP_MS,
  CROWD_START_Y,
  CROWD_STREET_WIDTH,
  CROWD_WALK_SPEED,
  type CrowdRaceState,
  type CrowdWalker,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';

/**
 * Crowd Race. Spec: docs/specs/games/crowd-race.md
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md. Everything here is driven through `Ctx`,
 * which Room supplies — this module never touches a socket.
 *
 * **This referee never walks anybody, and never sees the crowd.** Every
 * player's own street is a pure function of `roundId`, simulated privately
 * on their own phone — bounces, cascades, the lot (spec §2.2) — so there is
 * no second copy of any of that for this file to keep. What it owns is the
 * clock, the finish line and the winner, and what it does with a report is
 * clamp it to what an honest walk could have covered — the same
 * `reachableBy`-shaped bound Asteroid Race's own referee uses, simpler here
 * because there is no boost to account for: distance is a function of time
 * alone.
 */

export type CrowdWalkerRecord = CrowdWalker & {
  /** Server time of their last accepted report — the claim window measures
   *  from here, and going quiet past `CROWD_AWAY_MS` freezes them in place. */
  lastReportAt: number;
};

export type CrowdRace = {
  roundId: number;
  startsAt: number;
  /** The safety cap (spec §7). */
  endsAt: number;
  /** When the ladder next goes out — the referee's own tick, independent of
   *  how often any one phone reports. */
  nextTickAt: number;
  players: Record<PlayerId, CrowdWalkerRecord>;
  /** Alone there is nobody to beat, so the race is a time trial and ends with
   *  `winner: null` (spec §7) — Asteroid Race's own solo answer. */
  solo: boolean;
  winner: PlayerId | null;
  phase: 'running' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<CrowdRace | null>;
  save(s: CrowdRace): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

/** The ladder's own tick, or the cap — whichever is sooner. */
export function nextDeadline(s: CrowdRace): number {
  return s.phase === 'running' ? Math.min(s.nextTickAt, s.endsAt) : Infinity;
}

function fresh(): CrowdWalkerRecord {
  return { x: CROWD_STREET_WIDTH / 2, y: CROWD_START_Y, finishedAt: null, away: false, lastReportAt: 0 };
}

/**
 * The furthest up the street any honest walk could have got in `elapsedMs`.
 *
 * One term, because walking here has no throttle to bound separately: the
 * player's own speed is always `CROWD_WALK_SPEED` (spec §2's own reading —
 * tilt steers the direction, never how fast). `CROWD_CLAIM_SLACK` covers
 * ordinary clock jitter and the small, bounded extra ground a forward-leaning
 * bounce can buy — the same honest gap Asteroid Race's own §8 names: a client
 * that never reports a collision, or one that happened to be bounced forward,
 * walks a slightly better race than it should have, bounded by what
 * `CROWD_BOUNCE_MS` at `CROWD_BOUNCE_IMPULSE` could possibly add.
 */
export function reachableBy(elapsedMs: number): number {
  if (!(elapsedMs > 0)) return CROWD_CLAIM_SLACK;
  return (CROWD_WALK_SPEED * elapsedMs) / 1000 + CROWD_CLAIM_SLACK;
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startCrowdRace(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [CROWD_MIN_PLAYERS, CROWD_MAX_PLAYERS], solo)) return false;

  const now = ctx.now();
  const players: Record<PlayerId, CrowdWalkerRecord> = {};
  // Everyone is on the ladder from the first frame, at the start line, rather
  // than appearing on their own first report.
  for (const id of connected) players[id] = { ...fresh(), lastReportAt: now };

  const s: CrowdRace = {
    roundId,
    startsAt: now,
    endsAt: now + CROWD_RUN_CAP_MS,
    nextTickAt: now + CROWD_REPORT_MS,
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

/** A phone's own position, ~4×/s (spec §6). */
export async function onCrowdMove(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  x: number,
  y: number,
  at: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.phase !== 'running') return;
  const p = s.players[playerId];
  if (!p || p.finishedAt !== null) return;

  const now = ctx.now();

  if (Number.isFinite(x)) p.x = Math.min(CROWD_STREET_WIDTH, Math.max(0, x));

  if (Number.isFinite(y)) {
    const sinceStart = now - s.startsAt;
    const sinceLast = Math.min(now - p.lastReportAt, CROWD_AWAY_MS);
    // `reachableBy` is a pure distance; a walker starts the race already at
    // `CROWD_START_Y`, not world `y = 0`, so the since-start ceiling needs
    // that baseline added back in — the since-last term does not, since it
    // is added to `p.y`, which already carries it.
    const ceiling = Math.min(CROWD_START_Y + reachableBy(sinceStart), p.y + reachableBy(sinceLast));
    // Never backwards: a phone that reconnects resumes from the referee's own
    // number (spec §7), so a stale frame cannot undo real progress — even
    // though a bounce can genuinely push a player's own `y` down on their
    // phone, the ladder only ever shows their best.
    p.y = Math.max(p.y, Math.min(y, ceiling));
  }

  p.lastReportAt = now;
  p.away = false;

  if (p.y >= CROWD_FINISH_Y) {
    // The finish TIME is the phone's own stamp, clamped into the window it
    // could honestly have happened in — it is what the results screen shows.
    // The finish itself is decided by this report arriving, not by that stamp.
    p.finishedAt = clampStamp(at, s.startsAt, now);
    await finish(ctx, s, playerId);
    return;
  }

  await ctx.save(s);
}

/** A phone's own clock estimate, held to a window it could honestly name. */
function clampStamp(at: number, min: number, max: number): number {
  if (!Number.isFinite(at)) return max;
  return Math.min(max, Math.max(min, at));
}

/** Every walker either over the line or gone quiet forever is not this
 *  referee's problem to detect early — the cap always ends a running race,
 *  the same posture Together in the Dark's own co-op cap takes. */
function allDone(s: CrowdRace): boolean {
  const walkers = Object.values(s.players);
  return walkers.length > 0 && walkers.every((p) => p.finishedAt !== null);
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
    p.away = p.finishedAt === null && now - p.lastReportAt > CROWD_AWAY_MS;
  }

  if (now >= s.endsAt || allDone(s)) {
    await finish(ctx, s, null);
    return true;
  }

  // Anchored to the moment rather than accumulated, so a late alarm does not
  // leave the tick permanently behind the clock it is meant to follow.
  s.nextTickAt = now + CROWD_REPORT_MS;
  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

/**
 * A player vanished. Their walker **freezes where it is** and the race
 * carries on (spec §7) — the same call Asteroid Race's own §7 makes: nobody
 * was racing them directly, so a rejoin resumes at the same position.
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return;
  const p = s.players[playerId];
  if (!p || p.finishedAt !== null || p.away) return;

  p.away = true;
  await ctx.save(s);
  broadcast(ctx, s);
}

/**
 * End the race. A named `crosser` won it outright by getting there first;
 * otherwise — the cap — the furthest wins, and a tie at the top is unranked
 * (spec §7). A solo room has nobody to beat, so it records no winner at all.
 */
async function finish(ctx: Ctx, s: CrowdRace, crosser: PlayerId | null): Promise<void> {
  let winner: PlayerId | null = crosser;

  if (winner === null && !s.solo) {
    let best = -Infinity;
    let tie = false;
    for (const [id, p] of Object.entries(s.players)) {
      if (p.y > best) {
        best = p.y;
        winner = id;
        tie = false;
      } else if (p.y === best) {
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

/** The race as every phone needs it: everyone's last-accepted position. */
export function toState(s: CrowdRace): CrowdRaceState {
  const walkers: Record<PlayerId, CrowdWalker> = {};
  for (const [id, p] of Object.entries(s.players)) {
    walkers[id] = { x: p.x, y: p.y, finishedAt: p.finishedAt, away: p.away };
  }
  return { roundId: s.roundId, startsAt: s.startsAt, endsAt: s.endsAt, walkers, winner: s.winner, phase: s.phase };
}

function broadcast(ctx: Ctx, s: CrowdRace): void {
  ctx.broadcast({ t: 'crowd', s: ctx.nextSeq(), d: toState(s) });
}
