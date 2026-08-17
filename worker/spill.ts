import {
  CLOCK_SKEW_TOLERANCE_MS,
  SPILL_APPROACH_MS,
  SPILL_GAP_MS,
  SPILL_HOLD_MS,
  SPILL_LOCK_MAX_MS,
  SPILL_LOCK_MIN_MS,
  SPILL_LOSE_LEVEL,
  SPILL_MAX_PLAYERS,
  SPILL_MIN_PLAYERS,
  SPILL_ROUND_CAP_MS,
  preroundFor,
  SPILL_SPEED_MAX,
  SPILL_SPEED_MIN,
  SPILL_START_LEVEL,
  type PlayerId,
  type ServerMessage,
  type SpillDrop,
  type SpillState,
} from '../shared/protocol';
import { enoughToStart, lastStanding } from '../shared/players';
import { aimSeat, clampFlick } from '../shared/spillGeometry';

/**
 * Spill — the referee. Spec: docs/specs/games/spill.md
 *
 * Same shape as passTheBomb.ts: all state is persisted (the object hibernates
 * between flicks), and everything reaches the sockets through `Ctx` so this
 * module stays testable and Room.ts stays under the 300-line guidance.
 *
 * **Levels only ever change here** (spec §9). The client renders what it is
 * told and never adds up anything itself.
 */

export type Spill = {
  roundId: number;
  /** Server time play begins. The rules panel owns the window before it. */
  startsAt: number;
  /** Player at each seat. The index *is* the physical position on the table. */
  seats: PlayerId[];
  levels: Record<PlayerId, number>;
  /** Flooded out, or walked off. Their seat stays as a hole drops fall through. */
  out: PlayerId[];
  /** Server time each player may next fling — the launch lock (spec §4). */
  lockedUntil: Record<PlayerId, number>;
  air: Record<string, SpillDrop>;
  /** Caught and not yet re-flung. */
  held: Record<string, { by: PlayerId; size: number; soaksAt: number }>;
  nextDrop: number;
  endsAt: number;
  /**
   * Started in solo test mode, so "last one standing" does not end the round.
   *
   * Alone you ARE the last one standing at kick-off, so the round would finish in the
   * tick it began and there would be nothing to look at — which is the whole point of
   * the mode (`enoughToStart` in shared/players.ts). The time cap still ends it and
   * nothing else changes. Stored on the ROUND rather than read from a flag, so a round
   * that began solo stays solo even if somebody joins halfway through.
   */
  solo: boolean;
  phase: 'running' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<Spill | null>;
  save(spill: Spill): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

function alive(s: Spill): PlayerId[] {
  return s.seats.filter((p) => p !== '' && !s.out.includes(p));
}

/** Host pressed start. False when the room cannot seat a game. */
export async function startSpill(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [SPILL_MIN_PLAYERS, SPILL_MAX_PLAYERS], solo)) {
    return false;
  }

  const now = ctx.now();
  // Only the first round of a room gets a rules panel (protocol.ts).
  const preround = preroundFor(roundId);
  const levels: Record<PlayerId, number> = {};
  for (const p of connected) levels[p] = SPILL_START_LEVEL;

  // Seats follow join order rather than being shuffled: everyone has to walk to
  // a physical spot anyway, and a stable order makes the lobby diagram match
  // the player list they were just looking at.
  const spill: Spill = {
    roundId,
    startsAt: now + preround,
    seats: [...connected],
    levels,
    out: [],
    lockedUntil: {},
    air: {},
    held: {},
    nextDrop: 0,
    // The cap runs from the start of play, not from the panel.
    endsAt: now + preround + SPILL_ROUND_CAP_MS,
    phase: 'running',
    solo,
  };

  await ctx.save(spill);
  broadcastState(ctx, spill);
  await ctx.setAlarm(spill.endsAt);
  return true;
}

/** The round as a client needs it — after a start, a change, or a refresh. */
export function toState(s: Spill): SpillState {
  return {
    roundId: s.roundId,
    startsAt: s.startsAt,
    seats: s.seats,
    levels: s.levels,
    out: s.out,
    air: Object.values(s.air),
    phase: s.phase,
  };
}

function broadcastState(ctx: Ctx, s: Spill): void {
  ctx.broadcast({ t: 'spill', s: ctx.nextSeq(), d: toState(s) });
}

/**
 * A flick. `angle` is screen-space; the seating convention in
 * shared/spillGeometry.ts turns it into a table bearing and therefore a target.
 */
export async function onFling(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  angle: number,
  speed: number,
  heldId?: string,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running' || s.roundId !== roundId) return;
  if (!Number.isFinite(angle) || !Number.isFinite(speed)) return;

  const seat = s.seats.indexOf(playerId);
  if (seat < 0 || s.out.includes(playerId)) return;

  const now = ctx.now();
  // Nothing leaves a phone while the rules are still on screen. Enforced here
  // as well as in the UI, so skipping the panel is not a head start.
  if (now < s.startsAt) return;
  if ((s.lockedUntil[playerId] ?? 0) > now) return;

  // Clamped, never rejected — an honest player with a fast screen must not be
  // punished for a cheat's signature (spec §9).
  const v = clamp(speed, SPILL_SPEED_MIN, SPILL_SPEED_MAX);
  /*
   * And the same for the direction: water goes up the table, never backwards or along the
   * side (`SPILL_FLICK_CONE`). The phone refuses that gesture outright and never sends it,
   * so anything out of the cone arriving here came from a client of somebody's own making —
   * folded back to the nearest legal heading rather than dropped, for the same reason the
   * speed is.
   */
  const heading = clampFlick(angle);
  // Half a screen height to the edge, at v heights per second.
  const exitMs = clamp((0.5 / v) * 1000, SPILL_LOCK_MIN_MS, SPILL_LOCK_MAX_MS);

  /*
   * The aim is resolved BEFORE anything is spent, because a miss now costs nothing but
   * the throw. `v` narrows the window, so the harder this was thrown the likelier it is
   * to be a miss (spec §2).
   */
  let to = aimSeat(seat, heading, s.seats.length, v);
  // A seat whose player is out — or who walked off — is a hole in the ring.
  if (to !== null) {
    const target = s.seats[to];
    if (target === undefined || s.out.includes(target)) to = null;
  }
  const lands = to !== null;

  /*
   * Where the payload comes from: a drop you caught, or your own pool. **Nothing is
   * spent unless the throw is going to land somewhere** (spec §4c) — water leaves your
   * phone by arriving on somebody else's, and a flick that sails off the table simply
   * comes back.
   *
   * Doing it this way round, rather than deducting and crediting it back on return,
   * buys three things:
   *
   * - No winning on a miss. `settle()` runs a few lines below, so a player on their
   *   last drop would otherwise take the round by flinging it at the floor.
   * - A fumbled re-throw stays fumbled: the hold survives with its `soaksAt` still
   *   running, so keep missing with a caught payload and you eat it. That is the
   *   existing soak rule doing the work rather than a new one to explain.
   * - Your counter never lies. It moves when the water is actually gone.
   */
  let size: number;
  if (heldId !== undefined) {
    const held = s.held[heldId];
    if (!held || held.by !== playerId) return;
    size = held.size;
    if (lands) delete s.held[heldId];
  } else {
    if ((s.levels[playerId] ?? 0) <= 0) return;
    if (lands) s.levels[playerId] = (s.levels[playerId] ?? 0) - 1;
    size = 1;
  }

  const dropId = `${s.roundId}-${s.nextDrop++}`;
  const drop: SpillDrop = {
    dropId,
    from: seat,
    to,
    angle: heading,
    size,
    launchedAt: now,
    leavesAt: now + exitMs,
    arrivesAt: now + exitMs + SPILL_GAP_MS + SPILL_APPROACH_MS,
  };

  s.air[dropId] = drop;
  s.lockedUntil[playerId] = drop.leavesAt;

  ctx.broadcast({
    t: 'drop',
    s: ctx.nextSeq(),
    // `replaces` tells the thrower their held payload is gone. Omitted (rather
    // than null) for an ordinary fling, per exactOptionalPropertyTypes — and for
    // a re-throw that missed, where the payload is still in their hands and still
    // soaking, so claiming it had gone would strand the client's copy.
    d: heldId === undefined || !lands
      ? { ...drop, levels: s.levels }
      : { ...drop, levels: s.levels, replaces: heldId },
  });

  // Flinging is the only thing that empties a phone, so the win can land here.
  if (await settle(ctx, s)) return;
  await ctx.save(s);
  await ctx.setAlarm(nextDeadline(s));
}

/** Grab an incoming drop during its approach window (spec §5). */
export async function onCatch(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  dropId: string,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running' || s.roundId !== roundId) return;

  const drop = s.air[dropId];
  if (!drop || drop.to === null) return;
  if (s.seats[drop.to] !== playerId || s.out.includes(playerId)) return;

  const now = ctx.now();
  // Only inside the window it is actually on screen, with the usual allowance
  // for a client clock that runs a little fast.
  if (now < drop.arrivesAt - SPILL_APPROACH_MS - CLOCK_SKEW_TOLERANCE_MS) return;
  if (now >= drop.arrivesAt) return;

  delete s.air[dropId];
  const size = drop.size * 2;
  const soaksAt = now + SPILL_HOLD_MS;
  s.held[dropId] = { by: playerId, size, soaksAt };

  ctx.broadcast({ t: 'caught', s: ctx.nextSeq(), d: { dropId, by: playerId, size, soaksAt } });
  await ctx.save(s);
  await ctx.setAlarm(nextDeadline(s));
}

/**
 * The alarm fired: land everything that has arrived and soak in everything held
 * too long. Returns true when the round is over.
 */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return false;

  const now = ctx.now();

  for (const drop of Object.values(s.air)) {
    if (drop.arrivesAt > now) continue;
    delete s.air[drop.dropId];
    const target = drop.to === null ? undefined : s.seats[drop.to];
    // A drop aimed at a hole in the ring is simply gone — that water is out of
    // the game, which is why a wild flick is a legitimate tactic.
    const on = target !== undefined && !s.out.includes(target) ? target : null;
    if (on) s.levels[on] = (s.levels[on] ?? 0) + drop.size;
    announceLanding(ctx, s, drop.dropId, on, drop.size);
  }

  for (const [dropId, held] of Object.entries(s.held)) {
    if (held.soaksAt > now) continue;
    delete s.held[dropId];
    // You held it too long. You take the doubled amount — that is the deal.
    s.levels[held.by] = (s.levels[held.by] ?? 0) + held.size;
    announceLanding(ctx, s, dropId, held.by, held.size);
  }

  if (await settle(ctx, s)) return true;

  if (now >= s.endsAt) {
    await finish(ctx, s, leader(s));
    return true;
  }

  await ctx.save(s);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

function announceLanding(
  ctx: Ctx,
  s: Spill,
  dropId: string,
  on: PlayerId | null,
  size: number,
): void {
  ctx.broadcast({
    t: 'land',
    s: ctx.nextSeq(),
    d: { dropId, on, size, levels: s.levels, out: s.out },
  });
}

/** A player vanished. Their seat becomes a hole rather than shifting the ring. */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return;
  if (!s.seats.includes(playerId) || s.out.includes(playerId)) return;

  // Renumbering seats would silently rotate everyone else's aim mid-round, so
  // the slot stays and simply stops catching anything (spec §8).
  s.out.push(playerId);
  for (const [dropId, held] of Object.entries(s.held)) {
    if (held.by === playerId) delete s.held[dropId];
  }

  if (await settle(ctx, s)) return;
  broadcastState(ctx, s);
  await ctx.save(s);
  await ctx.setAlarm(nextDeadline(s));
}

/**
 * Apply the win and elimination conditions. Reaching zero resolves before
 * reaching the ceiling, so a tick that does both is a win (spec §8).
 */
async function settle(ctx: Ctx, s: Spill): Promise<boolean> {
  const emptied = alive(s).find((p) => (s.levels[p] ?? 0) <= 0);
  if (emptied) {
    await finish(ctx, s, emptied);
    return true;
  }

  let flooded = false;
  for (const p of alive(s)) {
    if ((s.levels[p] ?? 0) >= SPILL_LOSE_LEVEL) {
      s.out.push(p);
      flooded = true;
    }
  }

  const left = alive(s);
  if (lastStanding(left.length, s.solo)) {
    await finish(ctx, s, left[0] ?? null);
    return true;
  }
  if (flooded) broadcastState(ctx, s);
  return false;
}

/** Whoever has the least water when the round runs out of time. */
function leader(s: Spill): PlayerId | null {
  const left = alive(s);
  if (left.length === 0) return null;
  return left.reduce((a, b) => ((s.levels[a] ?? 0) <= (s.levels[b] ?? 0) ? a : b));
}

async function finish(ctx: Ctx, s: Spill, winnerId: PlayerId | null): Promise<void> {
  s.phase = 'done';
  s.air = {};
  s.held = {};
  await ctx.save(s);
  ctx.broadcast({
    t: 'spill-over',
    s: ctx.nextSeq(),
    d: { roundId: s.roundId, winnerId, levels: s.levels },
  });
}

/** Earliest thing the server still owes an answer for. */
export function nextDeadline(s: Spill): number {
  let at = s.endsAt;
  for (const d of Object.values(s.air)) at = Math.min(at, d.arrivesAt);
  for (const h of Object.values(s.held)) at = Math.min(at, h.soaksAt);
  return at;
}
