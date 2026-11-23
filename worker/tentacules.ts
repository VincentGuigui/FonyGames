import {
  TENT_ARMS,
  TENT_COUNTDOWN_MS,
  TENT_MAX_GRABS_PER_S,
  TENT_MAX_PLAYERS,
  TENT_MIN_PLAYERS,
  TENT_REPORT_GRACE_MS,
  TENT_SQUAT_MS,
  TENT_SUMMIT_CAP_MS,
  TENT_SUMMIT_M,
  TENT_TRIAL_MS,
  type PlayerId,
  type ServerMessage,
  type TentMode,
  type TentPlayer,
  type TentaculesState,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';
import {
  MAX_LEAP,
  REACH,
  REACH_SLACK,
  START_BODY,
  bodyOf,
  canGrab,
  heightOf,
  normaliseTentMode,
  pegById,
  startPegs,
  type Peg,
  type Point,
} from '../shared/tentacules';

/**
 * Tentacules. Spec: docs/specs/games/tentacules.md §6–§8
 *
 * Phones send only what is done: a tentacle grabbing a peg, tentacles letting
 * go, a reset after a fall. This file owns who holds which peg — a peg is
 * exclusive, first to arrive, and can be taken over once held `TENT_SQUAT_MS` —
 * and every height, computed from the holds: a phone never reports a number.
 */

type Climber = TentPlayer & {
  /** Where the body last was while held: the bound on a catch made in the air. */
  lastBody: Point;
  /** Times of recent grabs, for the rate limit. */
  grabs: number[];
};

export type Tentacules = {
  roundId: number;
  startsAt: number;
  endsAt: number;
  seed: number;
  mode: TentMode;
  players: Record<PlayerId, Climber>;
  gone: PlayerId[];
  solo: boolean;
  winner: PlayerId | null;
  phase: 'playing' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<Tentacules | null>;
  save(s: Tentacules): Promise<void>;
  setAlarm(at: number): Promise<void>;
  random(): number;
};

export function roundMsFor(mode: TentMode): number {
  return mode === 'trial' ? TENT_TRIAL_MS : TENT_SUMMIT_CAP_MS;
}

export function nextDeadline(s: Tentacules): number {
  return s.phase === 'playing' ? s.endsAt : Infinity;
}

function onStart(at: number): Pick<Climber, 'holds' | 'since' | 'lastBody'> {
  return { holds: startPegs().map((p) => p.id), since: new Array<number>(TENT_ARMS).fill(at), lastBody: { ...START_BODY } };
}

export async function startTentacules(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  rawOptions: unknown,
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [TENT_MIN_PLAYERS, TENT_MAX_PLAYERS], solo)) return false;
  const mode = normaliseTentMode(rawOptions);
  const startsAt = ctx.now() + TENT_COUNTDOWN_MS;
  const players: Record<PlayerId, Climber> = {};
  for (const id of connected) players[id] = { ...onStart(startsAt), best: 0, bestAt: 0, grabs: [] };
  const s: Tentacules = {
    roundId,
    startsAt,
    endsAt: startsAt + roundMsFor(mode) + TENT_REPORT_GRACE_MS,
    seed: Math.floor(ctx.random() * 0x1_0000_0000) >>> 0,
    mode,
    players,
    gone: [],
    solo: solo || connected.length <= 1,
    winner: null,
    phase: 'playing',
  };
  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/** Still climbing: the round is on, it has started, and its clock has not run out. */
function live(s: Tentacules, now: number): boolean {
  return s.phase === 'playing' && now >= s.startsAt && now <= s.startsAt + roundMsFor(s.mode);
}

function pegsOf(seed: number, holds: readonly (number | null)[]): Peg[] {
  return holds.flatMap((id) => (id === null ? [] : [pegById(seed, id)])).filter((p): p is Peg => p !== null);
}

/** The body moved: remember where, and count a new best — which in Summit may finish the round. */
async function moved(ctx: Ctx, s: Tentacules, id: PlayerId): Promise<boolean> {
  const p = s.players[id] as Climber;
  const body = bodyOf(s.seed, p.holds);
  if (body === null) return false;
  p.lastBody = body;
  const h = heightOf(body.y);
  if (h > p.best) {
    p.best = h;
    p.bestAt = Math.max(0, ctx.now() - s.startsAt);
  }
  if (s.mode === 'summit' && p.best >= TENT_SUMMIT_M) {
    p.finishedMs = p.bestAt;
    await finish(ctx, s, id);
    return true;
  }
  return false;
}

/**
 * A tentacle grabs a peg. Believed only if the peg exists, is within reach of
 * where the player's other holds put the body (or, holding nothing, within a
 * leap of where it last was held), and is free — or held by someone else for
 * `TENT_SQUAT_MS` or more, who then loses it.
 */
export async function onGrab(ctx: Ctx, id: PlayerId, roundId: number, arm: unknown, peg: unknown): Promise<void> {
  const s = await ctx.load();
  const now = ctx.now();
  if (!s || s.roundId !== roundId || !live(s, now)) return;
  const p = s.players[id];
  if (!p || s.gone.includes(id)) return;
  if (typeof arm !== 'number' || !Number.isInteger(arm) || arm < 0 || arm >= TENT_ARMS) return;
  if (typeof peg !== 'number') return;
  const target = pegById(s.seed, peg);
  if (!target || p.holds[arm] === peg || p.holds.includes(peg)) return;

  p.grabs = p.grabs.filter((t) => now - t < 1000);
  if (p.grabs.length >= TENT_MAX_GRABS_PER_S) return;

  const others = pegsOf(s.seed, p.holds.filter((_, i) => i !== arm));
  const reachable =
    others.length > 0
      ? canGrab(others, target, null, REACH_SLACK)
      : target.y <= p.lastBody.y + MAX_LEAP + REACH + REACH_SLACK;
  if (!reachable) return;

  // Starting pegs are each player's own; a shared peg is exclusive.
  if (peg > 0) {
    for (const [otherId, other] of Object.entries(s.players)) {
      if (otherId === id) continue;
      const at = other.holds.indexOf(peg);
      if (at < 0) continue;
      if (now - (other.since[at] ?? now) < TENT_SQUAT_MS) return;
      other.holds[at] = null;
      const body = bodyOf(s.seed, other.holds);
      if (body) other.lastBody = body;
    }
  }

  p.grabs.push(now);
  p.holds[arm] = peg;
  p.since[arm] = now;
  if (await moved(ctx, s, id)) return;
  await ctx.save(s);
  broadcast(ctx, s);
}

/** Tentacles let go: to move one, to launch, or because the octopus fell. */
export async function onLetGo(ctx: Ctx, id: PlayerId, roundId: number, arms: unknown): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.phase !== 'playing') return;
  const p = s.players[id];
  if (!p || !Array.isArray(arms)) return;
  let changed = false;
  for (const arm of arms) {
    if (typeof arm === 'number' && Number.isInteger(arm) && arm >= 0 && arm < TENT_ARMS && p.holds[arm] !== null) {
      p.holds[arm] = null;
      changed = true;
    }
  }
  if (!changed) return;
  const body = bodyOf(s.seed, p.holds);
  if (body) p.lastBody = body;
  await ctx.save(s);
  broadcast(ctx, s);
}

/** Fell past the bottom: back on its own starting pegs. Its best stands. */
export async function onReset(ctx: Ctx, id: PlayerId, roundId: number): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.phase !== 'playing') return;
  const p = s.players[id];
  if (!p) return;
  Object.assign(p, onStart(ctx.now()));
  await ctx.save(s);
  broadcast(ctx, s);
}

export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'playing' || ctx.now() < s.endsAt) return false;
  await finish(ctx, s);
  return true;
}

/** Their best stands and can still win; their pegs are freed at once. */
export async function onPlayerGone(ctx: Ctx, id: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'playing' || !(id in s.players) || s.gone.includes(id)) return;
  s.gone.push(id);
  const p = s.players[id] as Climber;
  p.holds = p.holds.map(() => null);
  if (Object.keys(s.players).every((other) => s.gone.includes(other))) {
    await finish(ctx, s);
    return;
  }
  await ctx.save(s);
  broadcast(ctx, s);
}

/** Highest point reached wins; on a tie, whoever got there first, then whoever joined first. */
async function finish(ctx: Ctx, s: Tentacules, outright: PlayerId | null = null): Promise<void> {
  let winner = outright;
  if (winner === null) {
    let best: Climber | null = null;
    for (const [id, p] of Object.entries(s.players)) {
      if (best === null || p.best > best.best || (p.best === best.best && p.bestAt < best.bestAt)) {
        winner = id;
        best = p;
      }
    }
  }
  s.phase = 'done';
  s.winner = winner;
  await ctx.save(s);
  broadcast(ctx, s);
}

export function toState(s: Tentacules): TentaculesState {
  const players: Record<PlayerId, TentPlayer> = {};
  for (const [id, p] of Object.entries(s.players)) {
    players[id] = {
      holds: [...p.holds],
      since: [...p.since],
      best: p.best,
      bestAt: p.bestAt,
      ...(p.finishedMs !== undefined ? { finishedMs: p.finishedMs } : {}),
    };
  }
  return {
    roundId: s.roundId,
    phase: s.phase,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    seed: s.seed,
    mode: s.mode,
    players,
    solo: s.solo,
    winner: s.winner,
  };
}

function broadcast(ctx: Ctx, s: Tentacules): void {
  ctx.broadcast({ t: 'tentacules', s: ctx.nextSeq(), d: toState(s) });
}
