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
 *
 * **Every per-side field is keyed by seat (0 or 1), never by player id.**
 * Solo mode (Tap Fighter's own idiom) puts the same connected player in both
 * `seats` — a player id cannot tell the two ships apart when there is only
 * one of it, so `lives`, `turn`, a shot's own `shooter`, and `winner` all
 * index by seat instead. A `gravity-shot` is still only ever accepted from
 * whoever `seats[turn]` actually is — which in solo is trivially the one
 * connected player, whichever seat is on turn.
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

/** One planet, rolled with the referee's own fair `random()` (spec §2.1), at
 *  a given `x` — the caller decides which half of the board that is. */
function rollPlanet(random: () => number, x: number): GravityPlanet {
  return {
    x,
    y: GRAVITY_PLANET_Y_MIN + random() * (GRAVITY_PLANET_Y_MAX - GRAVITY_PLANET_Y_MIN),
    r: GRAVITY_PLANET_R_MIN + random() * (GRAVITY_PLANET_R_MAX - GRAVITY_PLANET_R_MIN),
    art: Math.floor(random() * GRAVITY_PLANET_ART_COUNT),
  };
}

/**
 * Both planets' own `x`, one per half of the board — never on the same side
 * (a genuine complaint: two planets both left, or both right, leaves the
 * other side of the board with nothing to curve a shot at all). Which
 * planet gets which half is still a fair coin flip; nothing about a
 * planet's own identity should read as "the left one" or "the right one".
 */
function rollPlanetXs(random: () => number): [number, number] {
  const left = GRAVITY_PLANET_X_MARGIN + random() * (0.5 - GRAVITY_PLANET_X_MARGIN);
  const right = 0.5 + random() * (0.5 - GRAVITY_PLANET_X_MARGIN);
  return random() < 0.5 ? [left, right] : [right, left];
}

/** Host pressed start. Returns false when the room is not eligible.
 *
 * **Solo mode is a hotseat, not a second player.** The one connected phone
 * takes both seats, alternating which ship it aims each turn — the same
 * idiom Tap Fighter's own solo already uses (`worker/tapFighter.ts`). */
export async function startGravityShooter(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [GRAVITY_MIN_PLAYERS, GRAVITY_MAX_PLAYERS], solo)) return false;
  const host = connected[0];
  const other = solo ? host : connected[1];
  if (!host || !other) return false;

  const now = ctx.now();
  const [xa, xb] = rollPlanetXs(ctx.random);
  const g: Gravity = {
    roundId,
    startsAt: now,
    seats: [host, other],
    planets: [rollPlanet(ctx.random, xa), rollPlanet(ctx.random, xb)],
    lives: [GRAVITY_LIVES, GRAVITY_LIVES],
    turn: 0,
    resolvesAt: now + GRAVITY_SHOT_TIMEOUT_MS,
    lastShot: null,
    winner: null,
    phase: 'running',
    solo,
  };

  await ctx.save(g);
  broadcast(ctx, g);
  await ctx.setAlarm(g.resolvesAt);
  return true;
}

function otherSeat(seat: 0 | 1): 0 | 1 {
  return seat === 0 ? 1 : 0;
}

/**
 * The shooter's own turn, resolved. `hit` is trusted as reported — the
 * referee already holds everything a verification would need (the planets
 * it rolled itself, plus `angle`/`strength`) but deliberately does not
 * re-derive it, by direct instruction (spec §8). `angle`/`strength` are
 * still clamped to finite, sane ranges: a cheap defence against a malformed
 * payload producing `NaN`/`Infinity` in the other phone's own replay, not
 * a check on the claimed outcome.
 *
 * The sender must be whoever `seats[turn]` actually is — in solo that is
 * always the one connected player, on either seat, so nothing extra is
 * needed to let a hotseat player fire for both ships in their own turn.
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
  if (g.seats[g.turn] !== playerId) return;
  if (ctx.now() >= g.resolvesAt) return; // the tick has already timed this turn out

  const shooter = g.turn;
  const opponent = otherSeat(shooter);

  const safeAngle = Number.isFinite(angle) ? angle : 0;
  const safeStrength = Number.isFinite(strength) ? Math.max(0, Math.min(GRAVITY_MAX_STRENGTH, strength)) : 0;
  const landed = hit === true;

  g.lastShot = { shooter, angle: safeAngle, strength: safeStrength, hit: landed };
  if (landed) g.lives[opponent] = Math.max(0, g.lives[opponent] - 1);

  if (g.lives[opponent] <= 0) {
    await finish(ctx, g, shooter);
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
  const opponent = otherSeat(shooter);

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
  const seat = g.seats[0] === playerId ? 0 : g.seats[1] === playerId ? 1 : null;
  if (seat === null) return;

  await finish(ctx, g, otherSeat(seat));
}

async function finish(ctx: Ctx, g: Gravity, winner: 0 | 1 | null): Promise<void> {
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
