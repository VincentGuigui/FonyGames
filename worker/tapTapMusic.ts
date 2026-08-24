import {
  TAPTAP_CHECKPOINT,
  TAPTAP_MAX_PLAYERS,
  TAPTAP_MIN_PLAYERS,
  TAPTAP_ROUND_CAP_MS,
  TAPTAP_TOTAL,
  preroundFor,
  taptapWindow,
  type PlayerId,
  type ServerMessage,
  type TapTapState,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';

/**
 * Tap Tap Music — the referee. Spec: docs/specs/games/tap-tap-music.md
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
 *
 * **Five cells are live at once, tappable in any order** (spec §2). A player's own
 * `cleared` array is not a progress index any more — it is the exact cells they have
 * correctly tapped, in the order they tapped them. `taptapWindow` (shared/protocol.ts)
 * is the one function that turns `order` and that history into "which cells are lit
 * right now," and it is shared with the client for exactly one reason: both have to
 * agree on the window from the same two facts, or a tap that looks correct on screen
 * could be refused here.
 */

export type TapTap = {
  roundId: number;
  startsAt: number;
  endsAt: number;
  /** The 100 grid cells, in lit-up order. Identical for every player. */
  order: number[];
  /** Cells each player has correctly tapped, in the order they tapped them — never
   *  reordered to match `order`, so an out-of-order clear stays exactly that. */
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

/** The last checkpoint a given cleared-count has actually reached. */
function checkpointOf(count: number): number {
  return Math.floor(count / TAPTAP_CHECKPOINT) * TAPTAP_CHECKPOINT;
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

  const cleared: Record<PlayerId, number[]> = {};
  const finishedAt: Record<PlayerId, number | null> = {};
  for (const p of connected) {
    cleared[p] = [];
    finishedAt[p] = null;
  }

  const s: TapTap = {
    roundId,
    startsAt: now + preround,
    endsAt: now + preround + TAPTAP_ROUND_CAP_MS,
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

/** The round as every phone needs it: the order, everyone's remaining count. */
export function toState(s: TapTap): TapTapState {
  const remaining: Record<PlayerId, number> = {};
  for (const [id, c] of Object.entries(s.cleared)) remaining[id] = TAPTAP_TOTAL - c.length;
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

/** A player's own cleared history, to that player alone (spec §6). */
function sendProgress(ctx: Ctx, s: TapTap, playerId: PlayerId): void {
  const cleared = s.cleared[playerId];
  if (cleared === undefined) return;
  ctx.sendTo(playerId, {
    t: 'taptap-progress',
    s: ctx.nextSeq(),
    d: { roundId: s.roundId, cleared: [...cleared] },
  });
}

/**
 * A finger landed on `cell`. Spec §2, §6, §8.
 *
 * `cell` is a grid position, never "a lit one" — the referee is the only thing that
 * knows this player's own `taptapWindow(order, cleared)` right now, the up to five
 * cells a correct tap could be.
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

  const cleared = s.cleared[playerId];
  if (cleared === undefined) return;
  if (cleared.length >= TAPTAP_TOTAL) return; // already finished; further taps are no-ops

  const window = taptapWindow(s.order, cleared);

  if (window.includes(cell)) {
    cleared.push(cell);
    if (cleared.length >= TAPTAP_TOTAL) {
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
    // Not one of the up-to-five live cells — wrong, gone, or simply not reached yet,
    // doesn't matter which — a miss rewinds to the last checkpoint, not to zero (spec
    // §2.2). The rewind undoes the most RECENTLY tapped cells, in tap order, whichever
    // physical cells those happened to be — not the highest `order` positions.
    s.cleared[playerId] = cleared.slice(0, checkpointOf(cleared.length));
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
