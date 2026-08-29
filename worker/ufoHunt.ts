import {
  UFOHUNT_BASE_HEALTH,
  UFOHUNT_ELEVATION_MAX_DEG,
  UFOHUNT_ELEVATION_MIN_DEG,
  UFOHUNT_HEALTH_STEP,
  UFOHUNT_KIND_COUNT,
  UFOHUNT_MAX_PLAYERS,
  UFOHUNT_MIN_PLAYERS,
  UFOHUNT_MISSILE_CHARGE_GOAL,
  UFOHUNT_ROUND_CAP_MS,
  UFOHUNT_SHOT_COOLDOWN_MS,
  UFOHUNT_TICK_MS,
  ufoAngleBetween,
  ufoImpact,
  ufoMissileImpact,
  ufoPositionAt,
  type PlayerId,
  type ServerMessage,
  type UfoHuntState,
  type UfoWave,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';

/**
 * UFO Hunt. Spec: docs/specs/games/ufo-hunt.md
 *
 * Ghost Hunt's own referee shape (`Ctx`, `nextDeadline`, the tick/alarm pattern) with
 * a wholly new core loop: instead of a sequence walked at each player's own pace, a
 * SINGLE saucer's health bar is shared by the whole room, and every shot — from
 * anyone — chips the same number (spec §2). Score stays personal: the running sum of
 * a player's own shot damage.
 *
 * Unlike Ghost Hunt, which never scores on aim and only ever checks a clock (spec §8
 * there), this game's whole premise is a continuous accuracy value, so the aim itself
 * has to cross the wire. What keeps the referee in charge of the result anyway: the
 * saucer's position is never trusted from the client, only recomputed here from
 * `ufoPositionAt` — the same pure function the client renders with — so a modified
 * client can misreport its OWN aim but not where the saucer actually was (spec §8).
 */

export type UfoHunt = {
  roundId: number;
  startsAt: number;
  endsAt: number;
  /** Server time the next broadcast is due — ABSOLUTE, see `nextDeadline`. */
  tickAt: number;
  wave: UfoWave;
  /** Running sum of each player's own shot damage. The score. */
  scores: Record<PlayerId, number>;
  /** Server time each player's last accepted shot landed — the cooldown clock (spec §2, §8). */
  lastShotAt: Record<PlayerId, number>;
  /** Each player's own missile charge, 0…`UFOHUNT_MISSILE_CHARGE_GOAL` (spec §2.6). */
  missileCharge: Record<PlayerId, number>;
  winner: PlayerId | null;
  phase: 'running' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  /** 0…1. Injected so a wave's home direction and kind are driven by a test rather than by luck. */
  random(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<UfoHunt | null>;
  save(s: UfoHunt): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

/** Earliest thing the server still owes an answer for: the tick, or the safety cap. */
export function nextDeadline(s: UfoHunt): number {
  return Math.min(s.endsAt, s.tickAt);
}

/**
 * A fresh saucer: a random home direction, a random visual kind, `UFOHUNT_HEALTH_STEP`
 * tougher than the one before (spec §2, §12 — `index` is what carries the escalation).
 */
function spawnWave(random: () => number, index: number, now: number): UfoWave {
  const maxHealth = UFOHUNT_BASE_HEALTH + UFOHUNT_HEALTH_STEP * index;
  return {
    index,
    kind: Math.floor(random() * UFOHUNT_KIND_COUNT),
    maxHealth,
    health: maxHealth,
    homeAz: Math.round(random() * 360) - 180,
    homeEl: Math.round(
      UFOHUNT_ELEVATION_MIN_DEG + random() * (UFOHUNT_ELEVATION_MAX_DEG - UFOHUNT_ELEVATION_MIN_DEG),
    ),
    spawnedAt: now,
  };
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startUfoHunt(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [UFOHUNT_MIN_PLAYERS, UFOHUNT_MAX_PLAYERS], solo)) return false;

  const now = ctx.now();
  const scores: Record<PlayerId, number> = {};
  const lastShotAt: Record<PlayerId, number> = {};
  const missileCharge: Record<PlayerId, number> = {};
  for (const id of connected) {
    scores[id] = 0;
    lastShotAt[id] = 0;
    missileCharge[id] = 0;
  }

  const s: UfoHunt = {
    roundId,
    startsAt: now,
    endsAt: now + UFOHUNT_ROUND_CAP_MS,
    tickAt: now + UFOHUNT_TICK_MS,
    wave: spawnWave(ctx.random, 0, now),
    scores,
    lastShotAt,
    missileCharge,
    winner: null,
    phase: 'running',
  };

  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/** The round as every phone needs it: the shared saucer, everyone's score. */
export function toState(s: UfoHunt): UfoHuntState {
  return {
    roundId: s.roundId,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    wave: { ...s.wave },
    scores: { ...s.scores },
    missileCharge: { ...s.missileCharge },
    winner: s.winner,
    phase: s.phase,
  };
}

function broadcast(ctx: Ctx, s: UfoHunt): void {
  ctx.broadcast({ t: 'ufo-hunt', s: ctx.nextSeq(), d: toState(s) });
}

/**
 * A phone fired at its own current aim. Spec §2.3, §8.
 *
 * Everything that decides the shot happens here, not on the phone: the saucer's true
 * position at THIS instant is recomputed from `ufoPositionAt` — the same deterministic
 * roam the client used to render it — and the angle from that to the reported aim is
 * what `ufoImpact` turns into damage. The client's aim itself still cannot be verified
 * as the phone's real sensor reading; `UFOHUNT_SHOT_COOLDOWN_MS` bounds how often that
 * unverifiable claim can be cashed in, which is the honest limit spec §8 states plainly.
 */
export async function onUfoShoot(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  aimAz: number,
  aimEl: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running' || s.roundId !== roundId) return;
  if (!Number.isFinite(aimAz) || !Number.isFinite(aimEl)) return;
  if (s.scores[playerId] === undefined) return;

  const now = ctx.now();
  const last = s.lastShotAt[playerId] ?? 0;
  if (now - last < UFOHUNT_SHOT_COOLDOWN_MS) return; // the blaster is recharging

  s.lastShotAt[playerId] = now;

  const pos = ufoPositionAt(s.wave.homeAz, s.wave.homeEl, s.wave.index, now - s.wave.spawnedAt);
  const offset = ufoAngleBetween({ azimuth: aimAz, elevation: aimEl }, pos);
  const impact = ufoImpact(offset);

  s.scores[playerId] = (s.scores[playerId] ?? 0) + impact;
  s.wave.health = Math.max(0, s.wave.health - impact);

  // A landed ordinary shot is what fills the missile — not the missile itself
  // (spec §2.6), so this cannot chain into an unbounded charge.
  if (impact > 0) {
    s.missileCharge[playerId] = Math.min(UFOHUNT_MISSILE_CHARGE_GOAL, (s.missileCharge[playerId] ?? 0) + 1);
  }

  // The saucer explodes at 0 health; the next one spawns immediately, tougher (spec §2.5).
  if (s.wave.health <= 0) s.wave = spawnWave(ctx.random, s.wave.index + 1, now);

  await ctx.save(s);
  broadcast(ctx, s);
}

/**
 * A phone fired its missile. Spec §2.6, §8.
 *
 * Same referee-decides shape as `onUfoShoot`: the saucer's true position is
 * recomputed here, never trusted from the client. Two things set it apart —
 * the charge gate (this is refused outright below `UFOHUNT_MISSILE_CHARGE_GOAL`,
 * not merely throttled) and `ufoMissileImpact`'s own flat-fraction damage in
 * place of `ufoImpact`'s precision curve. The charge is consumed the instant
 * this is accepted, whether or not the shot itself lands — firing is what
 * empties the button, same as the brief states it.
 */
export async function onUfoMissile(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  aimAz: number,
  aimEl: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running' || s.roundId !== roundId) return;
  if (!Number.isFinite(aimAz) || !Number.isFinite(aimEl)) return;
  if (s.scores[playerId] === undefined) return;
  if ((s.missileCharge[playerId] ?? 0) < UFOHUNT_MISSILE_CHARGE_GOAL) return; // not charged yet

  const now = ctx.now();
  s.missileCharge[playerId] = 0;

  const pos = ufoPositionAt(s.wave.homeAz, s.wave.homeEl, s.wave.index, now - s.wave.spawnedAt);
  const offset = ufoAngleBetween({ azimuth: aimAz, elevation: aimEl }, pos);
  const impact = ufoMissileImpact(offset, s.wave.maxHealth);

  s.scores[playerId] = (s.scores[playerId] ?? 0) + impact;
  s.wave.health = Math.max(0, s.wave.health - impact);

  if (s.wave.health <= 0) s.wave = spawnWave(ctx.random, s.wave.index + 1, now);

  await ctx.save(s);
  broadcast(ctx, s);
}

/**
 * The tick. Broadcasts the room, and ends the round at the safety cap.
 *
 * Nothing about the wave expires on its own — a saucer stays at whatever health it has
 * until enough shots land, so a quiet room simply scores nothing, the same honest
 * outcome Ghost Hunt's own tick already accepts for a target nobody finds.
 *
 * Returns true when the round is over.
 */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return false;

  const now = ctx.now();
  if (now >= s.endsAt) {
    await finish(ctx, s);
    return true;
  }

  s.tickAt = now + UFOHUNT_TICK_MS;
  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

/*
 * There is deliberately no `onPlayerGone`, the same absence Ghost Hunt's own referee
 * documents and for the same reason: a player who drops keeps their score and their
 * seat, and rejoins to both. The saucer belongs to the room, not to any one shooter, so
 * there is nothing here to eliminate anyone from (spec §7). Room tears the round down
 * when the room empties, same as every other score-keeping game in this catalogue.
 */

async function finish(ctx: Ctx, s: UfoHunt): Promise<void> {
  s.winner = leader(s);
  s.phase = 'done';
  await ctx.save(s);
  broadcast(ctx, s);
}

/** Highest score wins; a tie for the lead is no winner (spec §2, the house convention every timed game's own cap uses). */
function leader(s: UfoHunt): PlayerId | null {
  let best: PlayerId | null = null;
  let bestScore = -Infinity;
  let tie = false;

  for (const [id, score] of Object.entries(s.scores)) {
    if (score > bestScore) {
      best = id;
      bestScore = score;
      tie = false;
    } else if (score === bestScore) {
      tie = true;
    }
  }

  return tie ? null : best;
}
