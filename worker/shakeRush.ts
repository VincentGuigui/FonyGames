import {
  RUSH_AWAY_MS,
  RUSH_BROADCAST_MS,
  RUSH_CAP_MS,
  RUSH_DISTANCE,
  RUSH_MAX_PLAYERS,
  RUSH_MIN_PLAYERS,
  SHAKE_RATE_CAP,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';

/**
 * Shake Rush. Spec: docs/specs/games/shake-rush.md
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md. Everything here is driven through `Ctx`, which
 * Room supplies — this module never touches a socket.
 *
 * The referee owns every position. The phone reports **increments**, because only
 * the phone can see an accelerometer, and the server decides what an increment is
 * worth: a batch is clipped to what the elapsed time could physically hold, so
 * reporting five hundred shakes advances you exactly as far as shaking does
 * (spec §8).
 */

export type RushPlayer = {
  /** Shakes travelled. `RUSH_DISTANCE` is the line. */
  at: number;
  /** Server time this phone last reported. Silence freezes the runner. */
  lastSeen: number;
  /** Server time they crossed, or 0 while still running. */
  doneAt: number;
};

export type Rush = {
  roundId: number;
  startsAt: number;
  endsAt: number;
  /** Server time the next broadcast is due — ABSOLUTE, see `nextDeadline`. */
  tickAt: number;
  players: Record<PlayerId, RushPlayer>;
  /** Finish order, first to last. */
  finished: PlayerId[];
  phase: 'running' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<Rush | null>;
  save(s: Rush): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

/**
 * When the room next needs waking: the broadcast tick, or the cap.
 *
 * Takes no clock on purpose. Room asks this both to arm its one alarm and to
 * decide whether the alarm it woke on was ours, and those two answers have to be
 * the same number — a deadline computed from the caller's own clock is never due.
 * Steady Hand shipped that bug; see steady-hand.md §6.
 */
export function nextDeadline(s: Rush): number {
  return Math.min(s.endsAt, s.tickAt);
}

/**
 * The most shakes a frame covering `elapsed` ms could honestly carry.
 *
 * One shake of slack, so a frame that lands a millisecond early does not clip an
 * honest player.
 */
export function allowedIn(elapsed: number): number {
  return Math.floor((Math.max(0, elapsed) / 1000) * SHAKE_RATE_CAP) + 1;
}

/**
 * The furthest anyone could have honestly travelled by `now`.
 *
 * The per-frame cap alone is not enough, and the gap is not small: its slack is
 * **one shake per frame**, so at a 150 ms tick a client that claims 2 every time
 * banks 13/s against a cap of 8 — a third off the race, just by sending more
 * frames. Bounding the position as well makes the slack a constant instead of a
 * rate, and splitting a lie across frames stops paying.
 *
 * It is a ceiling on the trajectory, not a substitute for the per-frame check:
 * on its own it would let a runner sit still for ten seconds and then jump to
 * where a continuous shaker would be.
 */
export function reachableBy(s: Rush, now: number): number {
  return allowedIn(now - s.startsAt);
}

function fresh(now: number): RushPlayer {
  return { at: 0, lastSeen: now, doneAt: 0 };
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startRush(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [RUSH_MIN_PLAYERS, RUSH_MAX_PLAYERS], solo)) return false;

  const now = ctx.now();
  const players: Record<PlayerId, RushPlayer> = {};
  for (const id of connected) players[id] = fresh(now);

  const s: Rush = {
    roundId,
    startsAt: now,
    endsAt: now + RUSH_CAP_MS,
    tickAt: now + RUSH_BROADCAST_MS,
    players,
    finished: [],
    phase: 'running',
  };

  await ctx.save(s);
  broadcast(ctx, s, now);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/**
 * A phone reported the shakes it felt since its last frame.
 *
 * The crossing is resolved here rather than on the tick: at 10 Hz a broadcast is
 * up to 100 ms behind, and "who got there first" is the one thing in this game
 * worth being exact about.
 */
export async function onShake(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  n: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return;
  if (s.roundId !== roundId) return;

  const p = s.players[playerId];
  if (!p) return;
  // Already home. Still refresh `lastSeen` so a finisher is not marked away while
  // they watch the rest come in.
  const now = ctx.now();
  if (p.doneAt !== 0) {
    p.lastSeen = now;
    await ctx.save(s);
    return;
  }

  /*
   * Nonsense is clipped, never believed and never trusted to be a number: `NaN`
   * compared against a cap passes every test one writes by accident, so it is
   * turned into zero first and the cap applied second.
   */
  const claimed = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;

  /*
   * The window a frame may claim for is capped at `RUSH_AWAY_MS` — the same
   * threshold that already marks a runner as away.
   *
   * Without it, credit BANKS: a phone that says nothing for sixteen seconds may
   * then claim sixteen seconds' worth in a single frame and arrive at the finish
   * line from a standing start, both caps satisfied. The spec already says an
   * away runner freezes (§7), so letting silence accumulate progress contradicts
   * the lane the player is being shown. Three ticks of slack means an ordinary
   * hiccup still costs nothing.
   */
  const window = Math.min(now - p.lastSeen, RUSH_AWAY_MS);
  const gained = Math.min(claimed, allowedIn(window));

  p.lastSeen = now;
  // Both ceilings, for the reasons on each: the frame cap stops a burst, the
  // trajectory cap stops the frame cap's slack being farmed.
  p.at = Math.min(p.at + gained, reachableBy(s, now));

  if (p.at >= RUSH_DISTANCE) {
    p.at = RUSH_DISTANCE;
    p.doneAt = now;
    s.finished.push(playerId);

    // First one home ends it. Everyone else's placing is already decided by
    // distance, and a race that continues after the winner is announced is a
    // different game (spec §2).
    await finish(ctx, s);
    return;
  }

  await ctx.save(s);
}

/**
 * The tick. Broadcasts the track and ends the round at the cap.
 *
 * Unlike Steady Hand's tick this one eliminates nobody: going quiet in a race is
 * its own punishment, and freezing a runner is enough.
 *
 * Returns true when the round is over.
 */
export async function onRushTick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return false;

  const now = ctx.now();

  if (now >= s.endsAt) {
    await finish(ctx, s);
    return true;
  }

  s.tickAt = now + RUSH_BROADCAST_MS;
  await ctx.save(s);
  broadcast(ctx, s, now);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

/**
 * A player vanished.
 *
 * Their runner freezes where it is and the round carries on — they rejoin to the
 * same lane at the same distance (spec §7). The round only ends here if the room
 * emptied.
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return;
  const p = s.players[playerId];
  if (!p) return;

  // Backdated so the runner reads as away immediately rather than after a wait.
  p.lastSeen = ctx.now() - RUSH_AWAY_MS - 1;
  await ctx.save(s);
}

/** Who has gone quiet, at `now`. Derived rather than stored — silence is a clock fact. */
export function awayAt(s: Rush, now: number): PlayerId[] {
  const out: PlayerId[] = [];
  for (const [id, p] of Object.entries(s.players)) {
    if (p.doneAt === 0 && now - p.lastSeen > RUSH_AWAY_MS) out.push(id);
  }
  return out;
}

/**
 * End the round.
 *
 * The order is everyone who finished, in the order they finished, then everyone
 * else by distance. Ties on distance are broken by whoever was last seen first —
 * arbitrary, but stable, and a coin flip that changes between two renders of the
 * same result is worse than an arbitrary rule.
 */
async function finish(ctx: Ctx, s: Rush): Promise<void> {
  const rest = Object.keys(s.players)
    .filter((id) => !s.finished.includes(id))
    .sort((a, b) => {
      const pa = s.players[a];
      const pb = s.players[b];
      if (!pa || !pb) return 0;
      return pb.at - pa.at || pa.lastSeen - pb.lastSeen;
    });

  const at: Record<PlayerId, number> = {};
  for (const [id, p] of Object.entries(s.players)) at[id] = p.at;

  s.phase = 'done';
  await ctx.save(s);
  ctx.broadcast({
    t: 'rush-end',
    s: ctx.nextSeq(),
    d: { roundId: s.roundId, order: [...s.finished, ...rest], at },
  });
}

function broadcast(ctx: Ctx, s: Rush, now: number): void {
  const at: Record<PlayerId, number> = {};
  for (const [id, p] of Object.entries(s.players)) at[id] = p.at;

  ctx.broadcast({
    t: 'rush',
    s: ctx.nextSeq(),
    d: {
      roundId: s.roundId,
      endsAt: s.endsAt,
      at,
      finished: [...s.finished],
      away: awayAt(s, now),
    },
  });
}
