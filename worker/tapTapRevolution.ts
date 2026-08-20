import {
  TAPTAP_CHECKPOINT,
  TAPTAP_MAX_PLAYERS,
  TAPTAP_MIN_PLAYERS,
  TAPTAP_ROUND_CAP_MS,
  TAPTAP_TOTAL,
  preroundFor,
  type PlayerId,
  type ServerMessage,
  type TapTapState,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';

/**
 * Tap Tap Revolution — the referee. Spec: docs/specs/games/tap-tap-revolution.md
 *
 * Same shape as squashMosquitoes.ts, and for the same reason: state persisted so the
 * Durable Object can hibernate between taps, and a board only ever changes here.
 *
 * The board-dealing half is identical to Squash Mosquitoes on purpose (spec §2.1) — one
 * shuffle, dealt once by the referee's own random source, shared by every player. Where
 * this game diverges is the shape of a miss: Squash Mosquitoes forgives one outright,
 * this game rewinds to the last checkpoint (spec §2.2) — the built, "forgiving" answer
 * to the harsher "reset to zero" idea the spec's own §12 flagged as the real open
 * question.
 */

export type TapTap = {
  roundId: number;
  startsAt: number;
  endsAt: number;
  /** The 100 grid cells, in lit-up order. Identical for every player. */
  order: number[];
  /** How far into `order` each player has correctly tapped, 0..100. */
  progress: Record<PlayerId, number>;
  finishedAt: Record<PlayerId, number | null>;
  winner: PlayerId | null;
  phase: 'running' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  /** The one thing this referee needs that Grid Attack does not: a fair shuffle. */
  random(): number;
  broadcast(msg: ServerMessage): void;
  /** A player's own progress is private — only they ever see their own index (spec §6). */
  sendTo(playerId: PlayerId, msg: ServerMessage): void;
  load(): Promise<TapTap | null>;
  save(s: TapTap): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

/** Earliest thing the server still owes an answer for: the safety cap. */
export function nextDeadline(s: TapTap): number {
  return s.phase === 'running' ? s.endsAt : Infinity;
}

/**
 * A fair shuffle of all 100 grid cells — Fisher–Yates, in place. Every cell is used
 * exactly once, unlike Squash Mosquitoes' pattern, which deals only 66 of 117 (spec
 * §2.1): this board has no cells held in reserve.
 */
function generateOrder(random: () => number): number[] {
  const cells = Array.from({ length: TAPTAP_TOTAL }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = cells[i];
    const b = cells[j];
    if (a === undefined || b === undefined) continue;
    cells[i] = b;
    cells[j] = a;
  }
  return cells;
}

/** The last checkpoint a given progress index has actually cleared. */
function checkpointOf(index: number): number {
  return Math.floor(index / TAPTAP_CHECKPOINT) * TAPTAP_CHECKPOINT;
}

export async function startTapTap(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [TAPTAP_MIN_PLAYERS, TAPTAP_MAX_PLAYERS], solo)) {
    return false;
  }

  const now = ctx.now();
  const preround = preroundFor(roundId);

  const progress: Record<PlayerId, number> = {};
  const finishedAt: Record<PlayerId, number | null> = {};
  for (const p of connected) {
    progress[p] = 0;
    finishedAt[p] = null;
  }

  const s: TapTap = {
    roundId,
    startsAt: now + preround,
    endsAt: now + preround + TAPTAP_ROUND_CAP_MS,
    order: generateOrder(ctx.random),
    progress,
    finishedAt,
    winner: null,
    phase: 'running',
  };

  await ctx.save(s);
  broadcastState(ctx, s);
  for (const p of connected) sendProgress(ctx, s, p);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/** The round as every phone needs it: the order, everyone's remaining count. */
export function toState(s: TapTap): TapTapState {
  const remaining: Record<PlayerId, number> = {};
  for (const [id, p] of Object.entries(s.progress)) remaining[id] = TAPTAP_TOTAL - p;
  return {
    roundId: s.roundId,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    order: s.order,
    remaining,
    finishedAt: s.finishedAt,
    winner: s.winner,
    phase: s.phase,
  };
}

function broadcastState(ctx: Ctx, s: TapTap): void {
  ctx.broadcast({ t: 'taptap', s: ctx.nextSeq(), d: toState(s) });
}

/** A player's own progress, to that player alone (spec §6). */
function sendProgress(ctx: Ctx, s: TapTap, playerId: PlayerId): void {
  const index = s.progress[playerId];
  if (index === undefined) return;
  ctx.sendTo(playerId, {
    t: 'taptap-progress',
    s: ctx.nextSeq(),
    d: { roundId: s.roundId, index },
  });
}

/**
 * A finger landed on `cell`. Spec §2, §6, §8.
 *
 * `cell` is a grid position, never "the lit one" — the referee is the only thing that
 * knows what `order[progress[playerId]]` actually is for this player right now.
 */
export async function onTapTap(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  cell: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running' || s.roundId !== roundId) return;
  if (!Number.isInteger(cell) || cell < 0 || cell >= TAPTAP_TOTAL) return;

  // Nothing counts while the rules are still on screen, same gate every other game's
  // own opening tap already has.
  if (ctx.now() < s.startsAt) return;

  const progress = s.progress[playerId];
  if (progress === undefined) return;
  if (progress >= TAPTAP_TOTAL) return; // already finished; further taps are no-ops

  const target = s.order[progress];
  if (target === undefined) return;

  if (cell === target) {
    const next = progress + 1;
    s.progress[playerId] = next;
    if (next >= TAPTAP_TOTAL) {
      const now = ctx.now();
      s.finishedAt[playerId] = now;
      // First to clear all 100 wins, and the round ends the instant they do — same
      // rule Squash Mosquitoes runs for its own 66 (spec §2).
      if (s.winner === null) {
        s.winner = playerId;
        s.phase = 'done';
      }
    }
  } else {
    // Wrong cell, gone cell, doesn't matter which — a miss rewinds to the last
    // checkpoint, not to zero (spec §2.2).
    s.progress[playerId] = checkpointOf(progress);
  }

  await ctx.save(s);
  broadcastState(ctx, s);
  sendProgress(ctx, s, playerId);
  if (s.phase === 'running') await ctx.setAlarm(nextDeadline(s));
}

/**
 * The alarm fired: the cap arrived with nobody finished. Whoever has cleared the most
 * wins; a tie for the lead is no winner, same as Squash Mosquitoes' tied swarm.
 */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return false;
  if (ctx.now() < s.endsAt) return false;

  s.winner = leader(s);
  s.phase = 'done';
  await ctx.save(s);
  broadcastState(ctx, s);
  return true;
}

function leader(s: TapTap): PlayerId | null {
  let best: PlayerId | null = null;
  let bestProgress = -1;
  let tie = false;

  for (const [id, p] of Object.entries(s.progress)) {
    if (p > bestProgress) {
      best = id;
      bestProgress = p;
      tie = false;
    } else if (p === bestProgress) {
      tie = true;
    }
  }

  return tie ? null : best;
}
