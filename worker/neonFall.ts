import {
  NEON_BOLT_MS,
  NEON_BOUNCE_MS,
  NEON_BOUNCE_RISE,
  NEON_FALL_SPEED,
  NEON_LANES,
  NEON_LANE_COOLDOWN_MS,
  NEON_LANE_MAGNET_GAIN,
  NEON_LANE_SPEED,
  NEON_LIVES,
  NEON_MAX_BOLTS,
  NEON_MAX_PLAYERS,
  NEON_MIN_PLAYERS,
  NEON_ROUND_CAP_MS,
  NEON_STEER_DEADZONE,
  NEON_TICK_MS,
  preroundFor,
  type NeonBolt,
  type NeonFallState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';

/**
 * Neon Fall — the referee. Spec: docs/specs/games/neon-fall.md
 *
 * Same shape as the other referees: state is persisted so the Durable Object can
 * hibernate between ticks, and everything reaches the sockets through `Ctx`.
 *
 * What is different, and the reason it needed its own measured design (spec §8):
 * the glider's phone never reports a position, only a **steer intent**, and the
 * referee integrates that into an actual lane every tick — the same trust
 * boundary Steady Hand draws around wobble and Cat and Mouse draws around
 * `capped` speed, but this is the first game where the server itself owns a
 * continuous physical simulation (a falling position, not just a broadcast rate)
 * rather than relaying or clamping something a client computed.
 */

export type NeonFall = {
  roundId: number;
  startsAt: number;
  gliderId: PlayerId;
  protectorId: PlayerId;
  /** 0..4, continuous. */
  lane: number;
  /** −1..1, the glider's last reported intent. Read every tick, never broadcast. */
  steer: number;
  /** 0 (top) .. 1 (floor). */
  y: number;
  lives: number;
  /** Set together, only while bouncing; both null the rest of the time. */
  bounceFrom: { lane: number; y: number } | null;
  bounceTo: { lane: number; y: number } | null;
  /** Server time the bounce ends. 0 when not bouncing. */
  bounceUntil: number;
  /** One entry per lane: the server time it next becomes available to fire —
   *  no shared ammo pool, each trigger cools down on its own (spec §2.2). */
  laneReadyAt: number[];
  bolts: NeonBolt[];
  /** Server time of the last tick actually simulated, for `dt` (spec §6). */
  lastTickAt: number;
  /** Server time of the next scheduled broadcast tick. */
  nextFrameAt: number;
  /** Defensive safety cap (spec §7) — the fall is bounded by construction. */
  endsAt: number;
  winner: PlayerId | null;
  phase: 'running' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  /** The bounce's landing lane (spec §2.3) needs a fair, unpredictable pick. */
  random(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<NeonFall | null>;
  save(s: NeonFall): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Earliest thing the server still owes an answer for. */
export function nextDeadline(s: NeonFall): number {
  return Math.min(s.endsAt, Math.max(s.startsAt, s.nextFrameAt));
}

export function toState(s: NeonFall): NeonFallState {
  return {
    roundId: s.roundId,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    gliderId: s.gliderId,
    protectorId: s.protectorId,
    lane: Math.round(s.lane * 1000) / 1000,
    y: Math.round(s.y * 1000) / 1000,
    lives: s.lives,
    bounceUntil: s.bounceUntil,
    laneReadyAt: [...s.laneReadyAt],
    bolts: s.bolts.map((b) => ({ lane: b.lane, resolvesAt: b.resolvesAt })),
    winner: s.winner,
    phase: s.phase,
  };
}

function broadcastState(ctx: Ctx, s: NeonFall): void {
  ctx.broadcast({ t: 'neon', s: ctx.nextSeq(), d: toState(s) });
}

/**
 * Host chose the seats. Falls back to array order when the choice is missing or
 * malformed — the same forgiving default Cat and Mouse's `drag` uses — rather
 * than refusing to start over a stale or dropped client.
 */
function assignRoles(
  connected: PlayerId[],
  roles?: { glider: PlayerId; protector: PlayerId },
): { gliderId: PlayerId; protectorId: PlayerId } {
  const [a, b] = connected;
  const first = a as PlayerId;
  const second = (b ?? a) as PlayerId;
  if (
    roles &&
    roles.glider !== roles.protector &&
    connected.includes(roles.glider) &&
    connected.includes(roles.protector)
  ) {
    return { gliderId: roles.glider, protectorId: roles.protector };
  }
  return { gliderId: first, protectorId: second };
}

export async function startNeon(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** The host's seat picks (spec §4) — orthogonal to `mode`, like Cat and Mouse's `drag`. */
  roles?: { glider: PlayerId; protector: PlayerId },
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [NEON_MIN_PLAYERS, NEON_MAX_PLAYERS], solo)) {
    return false;
  }

  const now = ctx.now();
  const preround = preroundFor(roundId);
  const startsAt = now + preround;
  const { gliderId, protectorId } = assignRoles(connected, roles);

  const s: NeonFall = {
    roundId,
    startsAt,
    gliderId,
    protectorId,
    lane: (NEON_LANES - 1) / 2,
    steer: 0,
    y: 0,
    lives: NEON_LIVES,
    bounceFrom: null,
    bounceTo: null,
    bounceUntil: 0,
    laneReadyAt: Array<number>(NEON_LANES).fill(0),
    bolts: [],
    lastTickAt: startsAt,
    nextFrameAt: startsAt,
    endsAt: startsAt + NEON_ROUND_CAP_MS,
    winner: null,
    phase: 'running',
  };

  await ctx.save(s);
  broadcastState(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/**
 * The glider's tilt (or tap-zone) intent. Stored, never simulated here — the
 * tick is the only place the lane actually moves, same reasoning as Cat and
 * Mouse's `onMove` deferring to its own tick (spec §6).
 */
export async function onSteer(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  steer: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running' || s.roundId !== roundId) return;
  if (playerId !== s.gliderId) return;
  if (!Number.isFinite(steer)) return;

  s.steer = clamp(steer, -1, 1);
  await ctx.save(s);
}

/**
 * A trigger tap. Each lane's own cooldown is tracked here, server-side, so a
 * modified protector client claiming a shot before its lane's own cooldown
 * elapses simply is not given one (spec §8) — likewise a shot once
 * `NEON_MAX_BOLTS` are already in flight, the real limiter now that no
 * shared ammo pool caps how many lanes can fire close together.
 *
 * Broadcasts immediately, unlike `onSteer` — the bolt has to be telegraphed from
 * the instant it fires, or the glider's whole `NEON_BOLT_MS` reaction window is
 * shorter than advertised (spec §4).
 */
export async function onShoot(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  lane: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running' || s.roundId !== roundId) return;
  if (playerId !== s.protectorId) return;
  if (!Number.isInteger(lane) || lane < 0 || lane >= NEON_LANES) return;

  const now = ctx.now();
  if (now < s.startsAt) return;
  if (now < (s.laneReadyAt[lane] ?? 0)) return;
  if (s.bolts.length >= NEON_MAX_BOLTS) return;

  s.laneReadyAt[lane] = now + NEON_LANE_COOLDOWN_MS;
  s.bolts.push({ lane, resolvesAt: now + NEON_BOLT_MS });

  await ctx.save(s);
  broadcastState(ctx, s);
}

/**
 * Advance the fall by `dt` — the glider's own lane drift, and the
 * ever-advancing fall progress. Not run while bouncing; the arc owns
 * position for that window instead (`stepBounce`).
 *
 * Lane drift is two forces summed (spec §2.4): `steer` at `NEON_LANE_SPEED`,
 * same as ever, plus a spring pulling toward the centre of whichever lane is
 * currently closest — so an idle glider settles into a lane instead of
 * drifting wherever the last tilt left it. The pull is dropped outright
 * whenever `steer` points toward a *different* lane past
 * `NEON_STEER_DEADZONE`: a deliberate tilt away from the current lane must
 * actually cross it, not be held back by that lane's own magnetism.
 */
function stepFalling(s: NeonFall, dt: number): void {
  const seconds = dt / 1000;
  const nearestLane = Math.round(s.lane);
  const pull = nearestLane - s.lane;
  const pullSign = Math.sign(pull);
  const opposing = pullSign !== 0 && Math.sign(s.steer) === -pullSign && Math.abs(s.steer) > NEON_STEER_DEADZONE;
  const magnet = opposing ? 0 : pull * NEON_LANE_MAGNET_GAIN;
  s.lane = clamp(s.lane + (s.steer * NEON_LANE_SPEED + magnet) * seconds, 0, NEON_LANES - 1);
  s.y = clamp(s.y + NEON_FALL_SPEED * seconds, 0, 1);
}

/**
 * Where the bounce arc puts the glider right now — linear across lanes, and a
 * parabola in `y` so the hop actually rises above the straight line between
 * where it was hit and where it lands, rather than just sliding downhill less.
 */
function stepBounce(s: NeonFall, now: number): void {
  const from = s.bounceFrom;
  const to = s.bounceTo;
  if (!from || !to) return;

  const t = clamp(1 - (s.bounceUntil - now) / NEON_BOUNCE_MS, 0, 1);
  const ARC_HEIGHT = 0.08;
  s.lane = lerp(from.lane, to.lane, t);
  s.y = lerp(from.y, to.y, t) - ARC_HEIGHT * 4 * t * (1 - t);
}

/** A bolt connected. A life is spent, and — unless that was the last one — the
 *  glider bounces to a random lane, blinking and unhittable for the duration. */
function registerHit(ctx: Ctx, s: NeonFall, now: number): void {
  s.lives = Math.max(0, s.lives - 1);
  if (s.lives <= 0) {
    s.winner = s.protectorId;
    s.phase = 'done';
    return;
  }

  const landingLane = Math.floor(ctx.random() * NEON_LANES);
  s.bounceFrom = { lane: s.lane, y: s.y };
  s.bounceTo = { lane: landingLane, y: Math.max(0, s.y - NEON_BOUNCE_RISE) };
  s.bounceUntil = now + NEON_BOUNCE_MS;
}

/**
 * Every bolt due this tick, checked against the lane the referee itself holds —
 * never a client's claim, on either end (spec §8). A bolt due during the
 * bounce's own invulnerability window is a miss, impossible to score, by
 * construction (spec §7).
 */
function resolveBolts(ctx: Ctx, s: NeonFall, now: number): void {
  const invulnerable = now < s.bounceUntil;
  const remaining: NeonBolt[] = [];
  for (const bolt of s.bolts) {
    if (now < bolt.resolvesAt) {
      remaining.push(bolt);
      continue;
    }
    if (!invulnerable && Math.round(s.lane) === bolt.lane) {
      registerHit(ctx, s, now);
    }
  }
  s.bolts = remaining;
}

/**
 * One simulation tick. Reschedules itself for as long as the round runs — the
 * fall never stops on its own, unlike the event-driven referees (spec §6).
 */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return false;

  const now = ctx.now();
  if (now < s.startsAt) {
    await ctx.setAlarm(nextDeadline(s));
    return false;
  }

  if (now < s.bounceUntil) {
    stepBounce(s, now);
  } else {
    if (s.bounceTo) {
      // The bounce just ended: land exactly on the arc's target once, rather
      // than falling one more `dt` from wherever the arc's last frame put it.
      s.lane = s.bounceTo.lane;
      s.y = s.bounceTo.y;
      s.bounceFrom = null;
      s.bounceTo = null;
    }
    stepFalling(s, now - s.lastTickAt);
  }
  s.lastTickAt = now;

  // Bolts resolve before the floor check, on purpose: a bolt fired in time to
  // still be in flight when the glider crosses the line arrives in time to
  // have stopped it (spec §7's tie-break).
  resolveBolts(ctx, s, now);

  if (s.phase === 'running' && s.y >= 1) {
    s.winner = s.gliderId;
    s.phase = 'done';
  }

  if (s.phase === 'running' && now >= s.endsAt) {
    // The fall is bounded by construction (NEON_ROUND_CAP_MS's own comment) —
    // reaching the cap means the glider survived every hit it could take.
    s.winner = s.gliderId;
    s.phase = 'done';
  }

  if (s.phase === 'running') {
    // Absolute schedule, not `now + NEON_TICK_MS` — a late alarm must not push
    // every later tick late as well (same reasoning as Cat and Mouse's own tick).
    s.nextFrameAt = Math.max(now + 1, s.nextFrameAt + NEON_TICK_MS);
  }

  await ctx.save(s);
  broadcastState(ctx, s);
  if (s.phase === 'running') await ctx.setAlarm(nextDeadline(s));
  return s.phase === 'done';
}

/**
 * Either seat vanishing ends the round for the other — there is no game with
 * only one role filled (spec §7).
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return;
  if (playerId !== s.gliderId && playerId !== s.protectorId) return;

  s.winner = playerId === s.gliderId ? s.protectorId : s.gliderId;
  s.phase = 'done';
  await ctx.save(s);
  broadcastState(ctx, s);
}
