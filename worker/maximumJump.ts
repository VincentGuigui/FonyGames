import {
  MAXJUMP_ATTEMPTS,
  MAXJUMP_MAX_PLAYERS,
  MAXJUMP_MIN_PLAYERS,
  MAXJUMP_ROUND_CAP_MS,
  type MaximumJumpAttempt,
  type MaximumJumpState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';
import { bestPossible } from '../www/src/games/maximum-jump/jump';

/**
 * Maximum Jump. Spec: docs/specs/games/maximum-jump.md
 *
 * **The whole attempt happens on the phone** (spec §6) — the run-up, the
 * take-off and the flight are one player's own physics, and a leg press that
 * waited on a referee would not be this game. So this file owns three things:
 * how many attempts each player has left, the cap, and the winner.
 *
 * The one judgement it makes about a result is whether the distance is
 * physically possible, which it gets from the game's own `bestPossible()`
 * rather than a number copied here — a retuned gravity or top speed must move
 * the bound with it (spec §8).
 */

export type MaximumJump = {
  roundId: number;
  startsAt: number;
  /** The safety cap (spec §7). */
  endsAt: number;
  jumpers: Record<PlayerId, MaximumJumpAttempt>;
  solo: boolean;
  winner: PlayerId | null;
  phase: 'jumping' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<MaximumJump | null>;
  save(s: MaximumJump): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

/** Nothing to tick between attempts — only the cap ever fires. */
export function nextDeadline(s: MaximumJump): number {
  return s.phase === 'jumping' ? s.endsAt : Infinity;
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startMaximumJump(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [MAXJUMP_MIN_PLAYERS, MAXJUMP_MAX_PLAYERS], solo)) return false;

  const now = ctx.now();
  const jumpers: Record<PlayerId, MaximumJumpAttempt> = {};
  for (const id of connected) jumpers[id] = { best: 0, speed: 0, used: 0 };

  const s: MaximumJump = {
    roundId,
    startsAt: now,
    endsAt: now + MAXJUMP_ROUND_CAP_MS,
    jumpers,
    solo: solo || connected.length <= 1,
    winner: null,
    phase: 'jumping',
  };

  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/**
 * One finished attempt (spec §6). A faceplant arrives as zero and still spends
 * one — that is the whole cost of fouling.
 *
 * `attempt` is the phone's own count, used only to make the message idempotent:
 * a resent result for an attempt already banked changes nothing, so a flaky
 * connection cannot spend somebody's three jumps on one.
 */
export async function onJumpResult(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  attempt: number,
  speed: number,
  distance: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.phase !== 'jumping') return;
  const j = s.jumpers[playerId];
  if (!j) return;
  if (j.used >= MAXJUMP_ATTEMPTS) return;
  // Only the attempt that is actually next: an out-of-order or repeated result
  // is dropped rather than banked twice.
  if (!Number.isInteger(attempt) || attempt !== j.used + 1) return;

  const far = Number.isFinite(distance) ? Math.min(Math.max(0, distance), bestPossible()) : 0;
  const fast = Number.isFinite(speed) ? Math.max(0, speed) : 0;

  j.used += 1;
  if (far > j.best) {
    j.best = far;
    j.speed = fast;
  }

  if (everyoneDone(s)) {
    await finish(ctx, s);
    return;
  }
  await ctx.save(s);
  broadcast(ctx, s);
}

function everyoneDone(s: MaximumJump): boolean {
  const all = Object.values(s.jumpers);
  return all.length > 0 && all.every((j) => j.used >= MAXJUMP_ATTEMPTS);
}

/** The cap. There is nothing else on this clock — the round ends when everyone
 *  has jumped three times, or when the cap says so (spec §7). */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'jumping') return false;
  if (ctx.now() < s.endsAt) return false;
  await finish(ctx, s);
  return true;
}

/**
 * A player vanished. Their best stays and can still win it — nobody was
 * jumping against them directly — but their unused attempts stop holding the
 * room open.
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'jumping') return;
  const j = s.jumpers[playerId];
  if (!j || j.used >= MAXJUMP_ATTEMPTS) return;

  j.used = MAXJUMP_ATTEMPTS;
  if (everyoneDone(s)) {
    await finish(ctx, s);
    return;
  }
  await ctx.save(s);
  broadcast(ctx, s);
}

/** The longest jump wins; a tie at the top is unranked, and a room where
 *  nobody landed one has no winner rather than an arbitrary one. */
async function finish(ctx: Ctx, s: MaximumJump): Promise<void> {
  let winner: PlayerId | null = null;
  if (!s.solo) {
    let best = -Infinity;
    let tie = false;
    for (const [id, j] of Object.entries(s.jumpers)) {
      if (j.best > best) {
        best = j.best;
        winner = id;
        tie = false;
      } else if (j.best === best) {
        tie = true;
      }
    }
    if (tie || best <= 0) winner = null;
  }
  s.phase = 'done';
  s.winner = winner;
  await ctx.save(s);
  broadcast(ctx, s);
}

export function toState(s: MaximumJump): MaximumJumpState {
  const jumpers: Record<PlayerId, MaximumJumpAttempt> = {};
  for (const [id, j] of Object.entries(s.jumpers)) jumpers[id] = { ...j };
  return {
    roundId: s.roundId,
    phase: s.phase,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    jumpers,
    solo: s.solo,
    winner: s.winner,
  };
}

function broadcast(ctx: Ctx, s: MaximumJump): void {
  ctx.broadcast({ t: 'maximum-jump', s: ctx.nextSeq(), d: toState(s) });
}
