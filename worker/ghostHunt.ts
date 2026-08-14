import {
  ELEVATION_MAX_DEG,
  ELEVATION_MIN_DEG,
  HUNT_MAX_PLAYERS,
  HUNT_MIN_PLAYERS,
  HUNT_ROUND_MS,
  HUNT_TICK_MS,
  MIN_FIND_MS,
  TARGET_MIN_SEPARATION_DEG,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';

/**
 * Ghost Hunt. Spec: docs/specs/games/ghost-hunt.md
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md. Everything here is driven through `Ctx`, which
 * Room supplies — this module never touches a socket.
 *
 * The referee owns the target sequence, the clock and the score. It **cannot see
 * an aim** — no orientation crosses the wire at all (spec §6) — so the only thing
 * it can verify is time, and that is exactly what it checks (spec §8).
 *
 * The targets are the same pair of angles for everyone, but each player reads
 * them against their own calibrated forward, so the puzzle is shared while the
 * frame is personal (spec §3).
 */

export type Target = { azimuth: number; elevation: number };

export type HuntPlayer = {
  /** How many they have found. Equal to `index`, but stored for clarity. */
  score: number;
  /** How far down the shared sequence they are. Their own pace. */
  index: number;
  /** Server time THEIR current target appeared. A find is measured from here. */
  shownAt: number;
  /** Fastest single find, or 0 if none. */
  best: number;
};

export type Hunt = {
  roundId: number;
  startsAt: number;
  endsAt: number;
  /** Server time the next broadcast is due — ABSOLUTE, see `nextDeadline`. */
  tickAt: number;
  /**
   * The ghosts, in order. Shared by everyone, walked at each player's own pace.
   *
   * A single live target advanced by whoever finds it first was the first design
   * and it is wrong twice over: it makes the ghost vanish mid-sweep for everyone
   * slower, and it means the second finder of a ghost scores nothing — which the
   * spec explicitly says should score (§7). Extended lazily as anyone needs one.
   */
  targets: Target[];
  players: Record<PlayerId, HuntPlayer>;
  phase: 'running' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  /** 0…1. Injected so the sequence can be driven by a test rather than by luck. */
  random(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<Hunt | null>;
  save(s: Hunt): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

/**
 * When the room next needs waking: the broadcast tick, or the end.
 *
 * Takes no clock on purpose — Room asks this both to arm its one alarm and to
 * decide whether the alarm it woke on was ours, and a deadline computed from the
 * caller's own clock is never due. See steady-hand.md §6 for the version of this
 * that shipped broken.
 */
export function nextDeadline(s: Hunt): number {
  return Math.min(s.endsAt, s.tickAt);
}

const DEG = Math.PI / 180;

/**
 * The angle between two directions on the sphere, in degrees.
 *
 * Duplicated from `www/src/core/sensors/orientation.ts` rather than shared: the
 * Worker may not import from `www/`, and `shared/` is documented as protocol-only.
 * Six lines of trigonometry is the cheaper duplication.
 */
export function separation(a: Target, b: Target): number {
  const e1 = a.elevation * DEG;
  const e2 = b.elevation * DEG;
  const dAz = (((a.azimuth - b.azimuth + 180) % 360 + 360) % 360 - 180) * DEG;
  const cos = Math.sin(e1) * Math.sin(e2) + Math.cos(e1) * Math.cos(e2) * Math.cos(dAz);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / DEG;
}

/**
 * Pick somewhere on the sphere that is not near where we just were.
 *
 * `TARGET_MIN_SEPARATION_DEG` is what makes every find cost a movement; without
 * it the sequence can put two ghosts a few degrees apart and the second is free.
 * The attempt count is bounded because a cone can in principle be unsatisfiable
 * against a narrow elevation band, and a referee that loops forever is worse than
 * one that occasionally repeats itself.
 */
export function pickTarget(random: () => number, previous: Target | null): Target {
  let best: Target = { azimuth: 0, elevation: 0 };
  let bestGap = -1;

  for (let i = 0; i < 24; i++) {
    const candidate: Target = {
      azimuth: Math.round(random() * 360) - 180,
      elevation: Math.round(
        ELEVATION_MIN_DEG + random() * (ELEVATION_MAX_DEG - ELEVATION_MIN_DEG),
      ),
    };
    if (!previous) return candidate;

    const gap = separation(candidate, previous);
    if (gap >= TARGET_MIN_SEPARATION_DEG) return candidate;
    // Keep the best near-miss, so a run of bad draws still moves the ghost as far
    // away as it managed rather than falling back to something adjacent.
    if (gap > bestGap) {
      bestGap = gap;
      best = candidate;
    }
  }

  return best;
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startHunt(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [HUNT_MIN_PLAYERS, HUNT_MAX_PLAYERS], solo)) return false;

  const now = ctx.now();
  const players: Record<PlayerId, HuntPlayer> = {};
  for (const id of connected) players[id] = { score: 0, index: 0, shownAt: now, best: 0 };

  const s: Hunt = {
    roundId,
    startsAt: now,
    endsAt: now + HUNT_ROUND_MS,
    tickAt: now + HUNT_TICK_MS,
    targets: [pickTarget(ctx.random, null)],
    players,
    phase: 'running',
  };

  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/**
 * Ensure the sequence reaches `index`, extending it if it has to.
 *
 * The leader drives the length and everyone else walks the same list behind them,
 * which is what makes "the same ghosts in the same order" true while progress
 * stays personal.
 */
function targetAt(ctx: Ctx, s: Hunt, index: number): Target {
  while (s.targets.length <= index) {
    s.targets.push(pickTarget(ctx.random, s.targets[s.targets.length - 1] ?? null));
  }
  return s.targets[index] as Target;
}

/**
 * A phone claims it locked its current target.
 *
 * Everything here is a timing check, because timing is all the server has. A
 * client that lies about its aim wins, and the spec says so plainly (§8) rather
 * than pretending otherwise.
 *
 * Only the finder advances. Two players who find the same ghost both score — this
 * is a race for a count, not a claim on a ghost (spec §7).
 */
export async function onFound(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  index: number,
  ms: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return;
  if (s.roundId !== roundId) return;

  const p = s.players[playerId];
  if (!p) return;

  /*
   * The index IS the claim check: a player is on exactly one target at a time, so
   * a repeat, a late lock on the one they have already left, and a guess at one
   * they have not reached are all the same rejection.
   */
  if (index !== p.index) return;

  /*
   * Two clocks, and the stricter of them wins.
   *
   * `ms` is the client's own measurement and cannot be trusted; the server's
   * `now - shownAt` cannot be beaten but is inflated by the trip. Rejecting on
   * EITHER being too fast means a client that simply lies low about `ms` still
   * has to have waited in real time. `NaN` is turned into a rejection rather than
   * compared, since every comparison against it is false.
   */
  const now = ctx.now();
  const claimed = Number.isFinite(ms) ? ms : -1;
  const elapsed = now - p.shownAt;
  if (claimed < MIN_FIND_MS || elapsed < MIN_FIND_MS) return;

  p.score += 1;
  // The server's own elapsed, not the client's: a fastest-find board built from
  // numbers the client chose is a board of whoever lies best.
  if (p.best === 0 || elapsed < p.best) p.best = elapsed;

  p.index += 1;
  p.shownAt = now;
  targetAt(ctx, s, p.index);

  await ctx.save(s);
  broadcast(ctx, s);
}

/**
 * The tick. Broadcasts the room, and ends the round at the cap.
 *
 * Nothing is eliminated and nothing expires — a target stays until somebody finds
 * it, so a room that cannot find one simply scores nothing, which is the honest
 * outcome for a hunt.
 *
 * Returns true when the round is over.
 */
export async function onHuntTick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return false;

  const now = ctx.now();
  if (now >= s.endsAt) {
    await finish(ctx, s);
    return true;
  }

  s.tickAt = now + HUNT_TICK_MS;
  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

/*
 * There is deliberately no `onPlayerGone`.
 *
 * Every other game has one, so its absence is the thing worth explaining: a
 * player who drops keeps their score, their place in the sequence and their seat,
 * and rejoins to all three. There is nothing to eliminate them from — a hunt with
 * one fewer phone is still a hunt — and freezing or zeroing them would only
 * punish a network blip. Room tears the round down when the room empties.
 */

async function finish(ctx: Ctx, s: Hunt): Promise<void> {
  const scores: Record<PlayerId, number> = {};
  let best: { player: PlayerId; ms: number } | null = null;

  for (const [id, p] of Object.entries(s.players)) {
    scores[id] = p.score;
    if (p.best > 0 && (!best || p.best < best.ms)) best = { player: id, ms: p.best };
  }

  s.phase = 'done';
  await ctx.save(s);
  ctx.broadcast({
    t: 'hunt-end',
    s: ctx.nextSeq(),
    d: { roundId: s.roundId, scores, best },
  });
}

function broadcast(ctx: Ctx, s: Hunt): void {
  const scores: Record<PlayerId, number> = {};
  const index: Record<PlayerId, number> = {};
  for (const [id, p] of Object.entries(s.players)) {
    scores[id] = p.score;
    index[id] = p.index;
  }

  ctx.broadcast({
    t: 'hunt',
    s: ctx.nextSeq(),
    d: {
      roundId: s.roundId,
      // The whole sequence: it is ~15 pairs of small numbers at the end of a
      // 90 second round, and sending it means a phone that missed a frame, or
      // joined late, needs no resync path at all.
      targets: s.targets.map((t) => ({ azimuth: t.azimuth, elevation: t.elevation })),
      index,
      endsAt: s.endsAt,
      scores,
    },
  });
}
