import {
  RHINO_COUNTDOWN_MS,
  RHINO_MAX_PLAYERS,
  RHINO_MAX_RATE,
  RHINO_MIN_PLAYERS,
  RHINO_REPORT_MS,
  RHINO_ROUND_MS,
  type PlayerId,
  type RhinoSpinState,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';

/**
 * Rhino Spin. Spec: docs/specs/games/rhino-spin.md
 *
 * **Nothing about a throw reaches this file.** Each phone reads its own
 * gravity angle and counts its own rotations (www/src/games/rhino-spin/spin.ts);
 * what crosses the wire is one integer. So the referee owns the clock, the
 * ladder and the winner, and the only judgement it makes about a report is
 * whether the number could honestly have been spun in the time elapsed.
 */

export type RhinoSpin = {
  roundId: number;
  /** When the throwing window opens — there is a countdown before it. */
  startsAt: number;
  endsAt: number;
  /** When the ladder next goes out, independent of any one phone's reports. */
  nextTickAt: number;
  /** Best count seen per player. Never lowered (spec §6). */
  spins: Record<PlayerId, number>;
  solo: boolean;
  winner: PlayerId | null;
  phase: 'spin' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<RhinoSpin | null>;
  save(s: RhinoSpin): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

export function nextDeadline(s: RhinoSpin): number {
  return s.phase === 'spin' ? Math.min(s.nextTickAt, s.endsAt) : Infinity;
}

/**
 * The most spins anyone could have banked by `now`.
 *
 * Measured from the moment the window opened, not from the last report: a
 * count is a running total, so bounding the total against total elapsed time
 * is both simpler and tighter than bounding each increment. One spin of slack
 * covers the phone that completed a turn as the clock ticked over.
 */
export function reachableBy(s: RhinoSpin, now: number): number {
  const elapsed = Math.max(0, Math.min(now, s.endsAt) - s.startsAt);
  return Math.floor((RHINO_MAX_RATE * elapsed) / 1000) + 1;
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startRhinoSpin(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [RHINO_MIN_PLAYERS, RHINO_MAX_PLAYERS], solo)) return false;

  const now = ctx.now();
  const startsAt = now + RHINO_COUNTDOWN_MS;
  const spins: Record<PlayerId, number> = {};
  for (const id of connected) spins[id] = 0;

  const s: RhinoSpin = {
    roundId,
    startsAt,
    endsAt: startsAt + RHINO_ROUND_MS,
    nextTickAt: startsAt,
    spins,
    solo: solo || connected.length <= 1,
    winner: null,
    phase: 'spin',
  };

  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/**
 * One phone's running total (spec §6). Kept if it is both an improvement and
 * within reach; a phone that reports less than the referee already has is not
 * cheating, it reconnected, so its best stands.
 */
export async function onRhinoSpins(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  claimed: number,
  _at: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.phase !== 'spin') return;
  if (!(playerId in s.spins)) return;
  if (!Number.isFinite(claimed)) return;

  const capped = Math.min(Math.floor(Math.max(0, claimed)), reachableBy(s, ctx.now()));
  if (capped <= (s.spins[playerId] ?? 0)) return;
  s.spins[playerId] = capped;
  await ctx.save(s);
}

/** The tick: the ladder goes out, and the window's own clock ends the round. */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'spin') return false;
  const now = ctx.now();
  if (now < nextDeadline(s)) return false;

  if (now >= s.endsAt) {
    await finish(ctx, s);
    return true;
  }

  // Anchored to the moment rather than accumulated, so a late alarm does not
  // leave the tick permanently behind the clock it follows.
  s.nextTickAt = now + RHINO_REPORT_MS;
  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

/**
 * A player vanished. Their count stays on the ladder: it is what they spun,
 * and a rejoin resumes from the referee's own best (spec §7's backgrounded
 * tab, which is the same thing from the room's side).
 */
export async function onPlayerGone(_ctx: Ctx, _playerId: PlayerId): Promise<void> {
  // Nothing to do — kept so Room.ts can wire every game the same way.
}

/** Most spins wins; a tie at the top is unranked, and solo has nobody to beat. */
async function finish(ctx: Ctx, s: RhinoSpin): Promise<void> {
  let winner: PlayerId | null = null;
  if (!s.solo) {
    let best = -Infinity;
    let tie = false;
    for (const [id, n] of Object.entries(s.spins)) {
      if (n > best) {
        best = n;
        winner = id;
        tie = false;
      } else if (n === best) {
        tie = true;
      }
    }
    // Nobody spun at all: no winner rather than an arbitrary one (spec §7).
    if (tie || best <= 0) winner = null;
  }
  s.phase = 'done';
  s.winner = winner;
  await ctx.save(s);
  broadcast(ctx, s);
}

export function toState(s: RhinoSpin): RhinoSpinState {
  return {
    roundId: s.roundId,
    phase: s.phase,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    spins: { ...s.spins },
    solo: s.solo,
    winner: s.winner,
  };
}

function broadcast(ctx: Ctx, s: RhinoSpin): void {
  ctx.broadcast({ t: 'rhino-spin', s: ctx.nextSeq(), d: toState(s) });
}
