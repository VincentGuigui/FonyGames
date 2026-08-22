import {
  SQUASH_GRID_CELLS,
  SQUASH_MAX_PLAYERS,
  SQUASH_MIN_PLAYERS,
  SQUASH_ROUND_CAP_MS,
  SQUASH_TOTAL,
  preroundFor,
  type PlayerId,
  type ServerMessage,
  type SquashBoard,
  type SquashState,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';

/**
 * Squash Mosquitoes — the referee. Spec: docs/specs/games/squash-mosquitoes.md
 *
 * Same shape as gridAttack.ts: all state is persisted so the Durable Object can
 * hibernate between taps, and everything reaches the sockets through `Ctx` so this
 * module stays testable and Room.ts stays under the 300-line guidance.
 *
 * **A board only ever changes here** (spec §8). The client renders what it is told
 * and never adds up anything itself.
 */

/** One player's own race against the shared pattern (spec §2, §6). */
export type Board = {
  /** Pattern indices spawned and not yet squashed. */
  active: number[];
  /** Pattern indices squashed. Never removed — the blood stays (spec §2). */
  squashed: number[];
  /** The next pattern index this player has not yet spawned. */
  nextSpawn: number;
};

export type Squash = {
  roundId: number;
  startsAt: number;
  endsAt: number;
  /** The 66 grid positions, in spawn order. Identical for every player. */
  pattern: number[];
  boards: Record<PlayerId, Board>;
  winner: PlayerId | null;
  phase: 'running' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  /** The one thing this referee needs that Grid Attack does not: a fair shuffle. */
  random(): number;
  broadcast(msg: ServerMessage): void;
  /** A board is a private race — only its own player ever sees it (spec §6, §9). */
  sendTo(playerId: PlayerId, msg: ServerMessage): void;
  load(): Promise<Squash | null>;
  save(s: Squash): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

/** Earliest thing the server still owes an answer for: the safety cap. */
export function nextDeadline(s: Squash): number {
  return s.phase === 'running' ? s.endsAt : Infinity;
}

/**
 * A fair shuffle of every grid cell, first `SQUASH_TOTAL` of it kept.
 *
 * Done here, with the referee's own `random()`, rather than trusted from a client —
 * a phone cannot be the fairest source of randomness for a game it is also playing
 * (spec §6, "As built"). Fisher–Yates, in place; `i`/`j` are always valid indices
 * into an array that started full, so the reads below can never actually miss —
 * `noUncheckedIndexedAccess` still requires the check.
 */
function generatePattern(random: () => number): number[] {
  const cells = Array.from({ length: SQUASH_GRID_CELLS }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = cells[i];
    const b = cells[j];
    if (a === undefined || b === undefined) continue;
    cells[i] = b;
    cells[j] = a;
  }
  return cells.slice(0, SQUASH_TOTAL);
}

/** The board everyone starts on: mosquito 0 spawned, nothing squashed yet (spec §2). */
function freshBoard(): Board {
  return { active: [0], squashed: [], nextSpawn: 1 };
}

/** Host pressed start. False when the room cannot seat a game. */
export async function startSquash(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [SQUASH_MIN_PLAYERS, SQUASH_MAX_PLAYERS], solo)) {
    return false;
  }

  const now = ctx.now();
  // Only the first round of a room gets a rules panel (protocol.ts).
  const preround = preroundFor(roundId);

  const boards: Record<PlayerId, Board> = {};
  for (const p of connected) boards[p] = freshBoard();

  const s: Squash = {
    roundId,
    startsAt: now + preround,
    endsAt: now + preround + SQUASH_ROUND_CAP_MS,
    pattern: generatePattern(ctx.random),
    boards,
    winner: null,
    phase: 'running',
  };

  await ctx.save(s);
  broadcastState(ctx, s);
  for (const p of connected) sendBoard(ctx, s, p);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/** The round as every phone needs it: the pattern, and everyone's squashed count. */
export function toState(s: Squash): SquashState {
  const scores: Record<PlayerId, number> = {};
  for (const [id, b] of Object.entries(s.boards)) scores[id] = b.squashed.length;
  return {
    roundId: s.roundId,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    pattern: s.pattern,
    scores,
    winner: s.winner,
    phase: s.phase,
  };
}

function broadcastState(ctx: Ctx, s: Squash): void {
  ctx.broadcast({ t: 'squash', s: ctx.nextSeq(), d: toState(s) });
}

/** A player's own board, to that player alone (spec §6). */
function sendBoard(ctx: Ctx, s: Squash, playerId: PlayerId): void {
  const board = s.boards[playerId];
  if (!board) return;
  const wire: SquashBoard = { active: [...board.active], squashed: [...board.squashed] };
  ctx.sendTo(playerId, {
    t: 'squash-board',
    s: ctx.nextSeq(),
    d: { roundId: s.roundId, board: wire },
  });
}

/**
 * A finger landed on `position`. Spec §2, §6.
 *
 * `position` is a grid cell, never a pattern index — the client reports what
 * happened, and only the referee knows which mosquito, if any, that was for this
 * player (spec §8).
 */
export async function onSquashTap(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  position: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running' || s.roundId !== roundId) return;
  if (!Number.isInteger(position) || position < 0 || position >= SQUASH_GRID_CELLS) return;

  // Nothing squashes while the rules are still on screen, same guard every other
  // game has for its own opening tap.
  if (ctx.now() < s.startsAt) return;

  const board = s.boards[playerId];
  if (!board) return;

  const index = s.pattern.indexOf(position);
  if (index < 0) return; // not a pattern cell at all
  const at = board.active.indexOf(index);
  if (at < 0) return; // nothing alive there for THIS player right now

  board.active.splice(at, 1);
  board.squashed.push(index);

  /*
   * The spawn rule (spec §2.1): every squash pays for the next two, in strict
   * pattern order, for as long as any remain. Which half of the swarm a spawn
   * belongs to (spec §2.2) is decided purely by `nextSpawn`'s position against
   * `SQUASH_STATIC_COUNT` — movement progression is still derived from the pattern;
   * visual size is a client-only random choice and never affects the referee.
   */
  for (let i = 0; i < 2 && board.nextSpawn < SQUASH_TOTAL; i++) {
    board.active.push(board.nextSpawn);
    board.nextSpawn++;
  }

  // First to 66 wins, and the round ends the instant they do (spec §2).
  if (board.squashed.length >= SQUASH_TOTAL && s.winner === null) {
    s.winner = playerId;
    s.phase = 'done';
  }

  await ctx.save(s);
  broadcastState(ctx, s);
  sendBoard(ctx, s, playerId);
  if (s.phase === 'running') await ctx.setAlarm(nextDeadline(s));
}

/**
 * The alarm fired: the cap arrived with nobody at 66. Whoever has squashed the
 * most wins; a tie for the lead is no winner, same as Spill's tied flood.
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

function leader(s: Squash): PlayerId | null {
  let best: PlayerId | null = null;
  let bestCount = -1;
  let tie = false;

  for (const [id, b] of Object.entries(s.boards)) {
    const n = b.squashed.length;
    if (n > bestCount) {
      best = id;
      bestCount = n;
      tie = false;
    } else if (n === bestCount) {
      tie = true;
    }
  }

  return tie ? null : best;
}
