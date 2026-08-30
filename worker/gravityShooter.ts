import {
  GRAVITY_LIVES,
  GRAVITY_MAX_PLAYERS,
  GRAVITY_MAX_STRENGTH,
  GRAVITY_MIN_PLAYERS,
  GRAVITY_PLANET_ART_COUNT,
  GRAVITY_PLANET_R_MAX,
  GRAVITY_PLANET_R_MIN,
  GRAVITY_PLANET_X_MARGIN,
  GRAVITY_PLANET_Y_MAX,
  GRAVITY_PLANET_Y_MIN,
  GRAVITY_SHOT_TIMEOUT_MS,
  type GravityPlanet,
  type GravityShooterState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';

/**
 * Gravity Shooter. Spec: docs/specs/games/gravity-shooter.md
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md. Everything here is driven through `Ctx`,
 * which Room supplies — this module never touches a socket.
 *
 * **The hit decision is trusted, not refereed** (spec §8, by direct
 * instruction): a shot's own physics runs entirely on the shooter's phone,
 * and this file stores whatever `hit` a `gravity-shot` claims. What it DOES
 * own, same shape as Grid Attack's own two-fixed-seats rule: whose turn it
 * is, lives, the planets (rolled once, here, with the referee's own fair
 * `random()` — a phone cannot be the fairest source of a shared board it is
 * also playing, the same reasoning Squash Mosquitoes' own shuffle uses), and
 * forcing a silent shooter's turn forward rather than ever stalling the match.
 */

export type Gravity = GravityShooterState;

export type Ctx = {
  now(): number;
  nextSeq(): number;
  /** The one thing this referee needs that Grid Attack does not: a fair roll
   *  for the planets. */
  random(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<Gravity | null>;
  save(g: Gravity): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

/** Earliest thing the server still owes an answer for: the current shot's
 *  own timeout (spec §2.4) — there is no separate safety cap, since a shot
 *  that never arrives already forces the turn forward. */
export function nextDeadline(g: Gravity): number {
  return g.phase === 'running' ? g.resolvesAt : Infinity;
}

/** One planet, rolled with the referee's own fair `random()` (spec §2.1). */
function rollPlanet(random: () => number): GravityPlanet {
  return {
    x: GRAVITY_PLANET_X_MARGIN + random() * (1 - 2 * GRAVITY_PLANET_X_MARGIN),
    y: GRAVITY_PLANET_Y_MIN + random() * (GRAVITY_PLANET_Y_MAX - GRAVITY_PLANET_Y_MIN),
    r: GRAVITY_PLANET_R_MIN + random() * (GRAVITY_PLANET_R_MAX - GRAVITY_PLANET_R_MIN),
    art: Math.floor(random() * GRAVITY_PLANET_ART_COUNT),
  };
}

/** Host pressed start. Returns false when the room is not eligible.
 *
 * **No solo mode.** Two ships facing each other is the whole game — alone
 * there is nobody to shoot at, the same reason Grid Attack opts out. */
export async function startGravityShooter(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
): Promise<boolean> {
  if (!enoughToStart(connected.length, [GRAVITY_MIN_PLAYERS, GRAVITY_MAX_PLAYERS], false)) return false;
  const host = connected[0];
  const other = connected[1];
  if (!host || !other) return false;

  const now = ctx.now();
  const g: Gravity = {
    roundId,
    startsAt: now,
    seats: [host, other],
    planets: [rollPlanet(ctx.random), rollPlanet(ctx.random)],
    lives: { [host]: GRAVITY_LIVES, [other]: GRAVITY_LIVES },
    turn: host,
    resolvesAt: now + GRAVITY_SHOT_TIMEOUT_MS,
    lastShot: null,
    winner: null,
    phase: 'running',
  };

  await ctx.save(g);
  broadcast(ctx, g);
  await ctx.setAlarm(g.resolvesAt);
  return true;
}

function otherPlayer(g: Gravity, playerId: PlayerId): PlayerId | null {
  return Object.keys(g.lives).find((id) => id !== playerId) ?? null;
}

/**
 * The shooter's own turn, resolved. `hit` is trusted as reported — the
 * referee already holds everything a verification would need (the planets
 * it rolled itself, plus `angle`/`strength`) but deliberately does not
 * re-derive it, by direct instruction (spec §8). `angle`/`strength` are
 * still clamped to finite, sane ranges: a cheap defence against a malformed
 * payload producing `NaN`/`Infinity` in the other phone's own replay, not
 * a check on the claimed outcome.
 */
export async function onGravityShot(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  angle: number,
  strength: number,
  hit: boolean,
): Promise<void> {
  const g = await ctx.load();
  if (!g || g.phase !== 'running' || g.roundId !== roundId) return;
  if (g.turn !== playerId) return;
  if (ctx.now() >= g.resolvesAt) return; // the tick has already timed this turn out

  const opponent = otherPlayer(g, playerId);
  if (!opponent) return;

  const safeAngle = Number.isFinite(angle) ? angle : 0;
  const safeStrength = Number.isFinite(strength) ? Math.max(0, Math.min(GRAVITY_MAX_STRENGTH, strength)) : 0;
  const landed = hit === true;

  g.lastShot = { shooter: playerId, angle: safeAngle, strength: safeStrength, hit: landed };
  if (landed) g.lives[opponent] = Math.max(0, (g.lives[opponent] ?? 0) - 1);

  if ((g.lives[opponent] ?? 0) <= 0) {
    await finish(ctx, g, playerId);
    return;
  }

  g.turn = opponent;
  g.resolvesAt = ctx.now() + GRAVITY_SHOT_TIMEOUT_MS;
  await ctx.save(g);
  broadcast(ctx, g);
  await ctx.setAlarm(g.resolvesAt);
}

/**
 * The alarm. A shooter who never sent `gravity-shot` costs them the turn,
 * not the match (spec §2.4) — resolved as a miss, same as Tap Fighter's own
 * no-lock-in default for a silent planning phase.
 */
export async function tick(ctx: Ctx): Promise<boolean> {
  const g = await ctx.load();
  if (!g || g.phase !== 'running') return false;
  if (ctx.now() < g.resolvesAt) return false;

  const shooter = g.turn;
  const opponent = otherPlayer(g, shooter);
  if (!opponent) return false;

  g.lastShot = { shooter, angle: 0, strength: 0, hit: false };
  g.turn = opponent;
  g.resolvesAt = ctx.now() + GRAVITY_SHOT_TIMEOUT_MS;
  await ctx.save(g);
  broadcast(ctx, g);
  await ctx.setAlarm(g.resolvesAt);
  return false;
}

/**
 * A player vanished. The other one wins outright — two fixed seats, the
 * same rule Grid Attack/Neon Fall use, not Steady Hand's "continue without
 * them" (which only applies at 3+ players).
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const g = await ctx.load();
  if (!g || g.phase !== 'running') return;
  if (!(playerId in g.lives)) return;

  await finish(ctx, g, otherPlayer(g, playerId));
}

async function finish(ctx: Ctx, g: Gravity, winner: PlayerId | null): Promise<void> {
  g.phase = 'done';
  g.winner = winner;
  await ctx.save(g);
  broadcast(ctx, g);
}

export function toState(g: Gravity): GravityShooterState {
  return g;
}

function broadcast(ctx: Ctx, g: Gravity): void {
  ctx.broadcast({ t: 'gravity', s: ctx.nextSeq(), d: toState(g) });
}
