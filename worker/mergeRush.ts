import {
  MERGE_COUNTDOWN_MS,
  MERGE_MAX_PLAYERS,
  MERGE_MIN_PLAYERS,
  MERGE_REPORT_GRACE_MS,
  MERGE_ROUND_MS,
  type MergeEntry,
  type MergeRushState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';
import { isBoard, mass, maxMass, maxMoves, maxScore, startBoard } from '../shared/merge';

/**
 * Merge Rush. Spec: docs/specs/games/merge-rush.md
 *
 * The moves happen on the phones. This file owns the seed, the clock and the
 * winner, and the bound on what a phone claims about its own board (spec §8).
 */

export type MergeRush = {
  roundId: number;
  startsAt: number;
  /** The last moment a report is waited for. */
  endsAt: number;
  seed: number;
  boards: Record<PlayerId, MergeEntry>;
  /** Players who left: no longer waited for, but their last board stands. */
  gone: PlayerId[];
  solo: boolean;
  winner: PlayerId | null;
  phase: 'playing' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<MergeRush | null>;
  save(s: MergeRush): Promise<void>;
  setAlarm(at: number): Promise<void>;
  random(): number;
};

export function nextDeadline(s: MergeRush): number {
  return s.phase === 'playing' ? s.endsAt : Infinity;
}

export async function startMergeRush(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [MERGE_MIN_PLAYERS, MERGE_MAX_PLAYERS], solo)) return false;

  const seed = Math.floor(ctx.random() * 0x1_0000_0000) >>> 0;
  const startsAt = ctx.now() + MERGE_COUNTDOWN_MS;
  const begin = startBoard(seed);
  const boards: Record<PlayerId, MergeEntry> = {};
  // Seeded with the starting board, so a thumbnail exists before its owner moves.
  for (const id of connected) boards[id] = { board: [...begin], score: 0, moves: 0, over: false };

  const s: MergeRush = {
    roundId,
    startsAt,
    endsAt: startsAt + MERGE_ROUND_MS + MERGE_REPORT_GRACE_MS,
    seed,
    boards,
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

function whole(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * One phone's board. Score and moves are **clipped** to what the rules allow and
 * never go down; a board that cannot exist is ignored and the last one kept.
 * Once a phone says it is over, it stays over.
 */
export async function onMergeBoard(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  board: unknown,
  score: unknown,
  moves: unknown,
  over: unknown,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.phase !== 'playing') return;
  const e = s.boards[playerId];
  if (!e || e.over) return;

  const elapsed = Math.min(Math.max(0, ctx.now() - s.startsAt), MERGE_ROUND_MS);
  const startMass = mass(startBoard(s.seed));
  const m = Math.max(e.moves, Math.min(whole(moves), maxMoves(elapsed)));

  if (isBoard(board) && mass(board) <= maxMass(startMass, m)) e.board = board;
  e.moves = m;
  e.score = Math.max(e.score, Math.min(whole(score), maxScore(startMass, m)));
  e.over = over === true;

  if (everyoneDone(s)) {
    await finish(ctx, s);
    return;
  }
  await ctx.save(s);
  broadcast(ctx, s);
}

function everyoneDone(s: MergeRush): boolean {
  return Object.entries(s.boards).every(([id, e]) => e.over || s.gone.includes(id));
}

export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'playing') return false;
  if (ctx.now() < s.endsAt) return false;
  await finish(ctx, s);
  return true;
}

/** Their board and score stay and can still win; they stop holding the round open. */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'playing') return;
  if (!(playerId in s.boards) || s.gone.includes(playerId)) return;
  s.gone.push(playerId);
  if (everyoneDone(s)) {
    await finish(ctx, s);
    return;
  }
  await ctx.save(s);
  broadcast(ctx, s);
}

/**
 * Highest score wins, always — a round with a score has a winner, and so does a
 * solo one. A tie goes to whoever got there in fewer moves, then to whoever
 * joined first.
 */
async function finish(ctx: Ctx, s: MergeRush): Promise<void> {
  let winner: PlayerId | null = null;
  let best: MergeEntry | null = null;
  for (const [id, e] of Object.entries(s.boards)) {
    if (best === null || e.score > best.score || (e.score === best.score && e.moves < best.moves)) {
      winner = id;
      best = e;
    }
  }
  s.phase = 'done';
  s.winner = winner;
  await ctx.save(s);
  broadcast(ctx, s);
}

export function toState(s: MergeRush): MergeRushState {
  const boards: Record<PlayerId, MergeEntry> = {};
  for (const [id, e] of Object.entries(s.boards)) boards[id] = { ...e, board: [...e.board] };
  return {
    roundId: s.roundId,
    phase: s.phase,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    seed: s.seed,
    boards,
    solo: s.solo,
    winner: s.winner,
  };
}

function broadcast(ctx: Ctx, s: MergeRush): void {
  ctx.broadcast({ t: 'merge-rush', s: ctx.nextSeq(), d: toState(s) });
}
