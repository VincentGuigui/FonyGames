import {
  TAPS100_CHECKPOINT,
  TAPS100_MAX_PLAYERS,
  TAPS100_MIN_PLAYERS,
  TAPS100_ROUND_CAP_MS,
  TAPS100_TOTAL,
  preroundFor,
  type PlayerId,
  type ServerMessage,
  type Taps100State,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';

/**
 * 100 Taps — the referee. Spec: docs/specs/games/100-taps.md
 *
 * Tap Tap Music's own referee (`tapTapMusic.ts`) with the window mechanic removed
 * (spec §2.1): that game lights five cells at once because its board hides the
 * order from the player. This board hides nothing — every number is printed and
 * visible — so there is exactly one correct cell at any moment: `order[cleared.length]`,
 * the grid position holding the next number due. No `taptapWindow`-equivalent
 * function is needed here at all.
 *
 * The checkpoint rewind (spec §2.2) is reused unchanged from Tap Tap Music, same
 * constant value, same `checkpointOf` shape.
 */

export type Taps100 = {
  roundId: number;
  startsAt: number;
  endsAt: number;
  /** Cell `order[k]` shows the printed number `k + 1`. Identical for every player. */
  order: number[];
  /** Cells each player has correctly tapped, in the order they tapped them. */
  cleared: Record<PlayerId, number[]>;
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
  /** A player's own cleared history is private — only they ever see it (spec §6). */
  sendTo(playerId: PlayerId, msg: ServerMessage): void;
  load(): Promise<Taps100 | null>;
  save(s: Taps100): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

/** Earliest thing the server still owes an answer for: the safety cap. */
export function nextDeadline(s: Taps100): number {
  return s.phase === 'running' ? s.endsAt : Infinity;
}

/** A fair shuffle of all 100 grid cells — Fisher–Yates, in place. Every cell is used once. */
function generateOrder(random: () => number): number[] {
  const cells = Array.from({ length: TAPS100_TOTAL }, (_, i) => i);
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

/** The last checkpoint a given cleared-count has actually reached. */
function checkpointOf(count: number): number {
  return Math.floor(count / TAPS100_CHECKPOINT) * TAPS100_CHECKPOINT;
}

export async function startTaps100(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [TAPS100_MIN_PLAYERS, TAPS100_MAX_PLAYERS], solo)) {
    return false;
  }

  const now = ctx.now();
  const preround = preroundFor(roundId);

  const cleared: Record<PlayerId, number[]> = {};
  const finishedAt: Record<PlayerId, number | null> = {};
  for (const p of connected) {
    cleared[p] = [];
    finishedAt[p] = null;
  }

  const s: Taps100 = {
    roundId,
    startsAt: now + preround,
    endsAt: now + preround + TAPS100_ROUND_CAP_MS,
    order: generateOrder(ctx.random),
    cleared,
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

/** The round as every phone needs it: the layout, everyone's remaining count. */
export function toState(s: Taps100): Taps100State {
  const remaining: Record<PlayerId, number> = {};
  for (const [id, c] of Object.entries(s.cleared)) remaining[id] = TAPS100_TOTAL - c.length;
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

function broadcastState(ctx: Ctx, s: Taps100): void {
  ctx.broadcast({ t: 'taps100', s: ctx.nextSeq(), d: toState(s) });
}

/** A player's own cleared history, to that player alone (spec §6). */
function sendProgress(ctx: Ctx, s: Taps100, playerId: PlayerId): void {
  const cleared = s.cleared[playerId];
  if (cleared === undefined) return;
  ctx.sendTo(playerId, {
    t: 'taps100-progress',
    s: ctx.nextSeq(),
    d: { roundId: s.roundId, cleared: [...cleared] },
  });
}

/**
 * A finger landed on `cell`. Spec §2, §6, §8.
 *
 * Correct iff `cell` is the exact next number due — `order[cleared.length]` — never
 * a window of candidates: the board shows every number, so there is nothing here
 * for the referee to be lenient about the way Tap Tap Music's five-live-at-once
 * rule is.
 */
export async function onTaps100(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  cell: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running' || s.roundId !== roundId) return;
  if (!Number.isInteger(cell) || cell < 0 || cell >= TAPS100_TOTAL) return;

  // Nothing counts while the rules are still on screen, same gate every other game's
  // own opening tap already has.
  if (ctx.now() < s.startsAt) return;

  const cleared = s.cleared[playerId];
  if (cleared === undefined) return;
  if (cleared.length >= TAPS100_TOTAL) return; // already finished; further taps are no-ops

  if (cell === s.order[cleared.length]) {
    cleared.push(cell);
    if (cleared.length >= TAPS100_TOTAL) {
      const now = ctx.now();
      s.finishedAt[playerId] = now;
      // First to clear all 100 wins, and the round ends the instant they do.
      if (s.winner === null) {
        s.winner = playerId;
        s.phase = 'done';
      }
    }
  } else {
    // Any number other than the one exact next one — a miss rewinds to the last
    // checkpoint, not to zero (spec §2.2).
    s.cleared[playerId] = cleared.slice(0, checkpointOf(cleared.length));
  }

  await ctx.save(s);
  broadcastState(ctx, s);
  sendProgress(ctx, s, playerId);
  if (s.phase === 'running') await ctx.setAlarm(nextDeadline(s));
}

/**
 * The alarm fired: the cap arrived with nobody finished. Whoever has cleared the most
 * wins; a tie for the lead is no winner.
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

function leader(s: Taps100): PlayerId | null {
  let best: PlayerId | null = null;
  let bestCount = -1;
  let tie = false;

  for (const [id, c] of Object.entries(s.cleared)) {
    if (c.length > bestCount) {
      best = id;
      bestCount = c.length;
      tie = false;
    } else if (c.length === bestCount) {
      tie = true;
    }
  }

  return tie ? null : best;
}
