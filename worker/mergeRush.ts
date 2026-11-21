import {
  MERGE_COUNTDOWN_MS,
  MERGE_MAX_PLAYERS,
  MERGE_MIN_PLAYERS,
  MERGE_RACE_CAP_MS,
  MERGE_REPORT_GRACE_MS,
  type MergeEntry,
  type MergeMode,
  type MergeRushState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';
import {
  compareEntries,
  hasWon,
  isBoard,
  mass,
  maxMass,
  maxMoves,
  maxScore,
  normaliseMergeOptions,
  puzzle,
  roundMsFor,
  startBoard,
} from '../shared/merge';

/**
 * Double Fusion. Spec: docs/specs/games/merge-rush.md
 *
 * The moves happen on the phones. This file owns the seed, the starting board,
 * the clock and the winner, and the bound on what a phone claims about its own
 * board (spec §8). A race and Highlander are won outright by the first phone
 * whose accepted board meets the goal; Time Attack only ever ends on the clock.
 */

export type MergeRush = {
  roundId: number;
  startsAt: number;
  /** The last moment a report is waited for. */
  endsAt: number;
  seed: number;
  mode: MergeMode;
  target: number;
  roundMs: number;
  start: number[];
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

/** How long a round can honestly run, ms after its start. */
function playable(s: Pick<MergeRush, 'roundMs'>): number {
  return s.roundMs > 0 ? s.roundMs : MERGE_RACE_CAP_MS;
}

export async function startMergeRush(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  rawOptions: unknown,
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [MERGE_MIN_PLAYERS, MERGE_MAX_PLAYERS], solo)) return false;

  const { mode, target } = normaliseMergeOptions(rawOptions);
  const seed = Math.floor(ctx.random() * 0x1_0000_0000) >>> 0;
  const startsAt = ctx.now() + MERGE_COUNTDOWN_MS;
  const roundMs = roundMsFor(mode);
  const begin = mode === 'highlander' ? puzzle(seed) : startBoard(seed);
  const boards: Record<PlayerId, MergeEntry> = {};
  // Seeded with the starting board, so a thumbnail exists before its owner moves.
  for (const id of connected) boards[id] = { board: [...begin], score: 0, moves: 0, over: false };

  const s: MergeRush = {
    roundId,
    startsAt,
    endsAt: startsAt + playable({ roundMs }) + MERGE_REPORT_GRACE_MS,
    seed,
    mode,
    target,
    roundMs,
    start: [...begin],
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
 * Once a phone says it is over, it stays over. In Highlander nothing ever
 * spawns, so a board is only believed if it holds exactly the mass it started with.
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

  const elapsed = Math.min(Math.max(0, ctx.now() - s.startsAt), playable(s));
  const startMass = mass(s.start);
  const m = Math.max(e.moves, Math.min(whole(moves), maxMoves(elapsed)));
  const fixed = s.mode === 'highlander';

  if (isBoard(board) && (fixed ? mass(board) === startMass : mass(board) <= maxMass(startMass, m))) e.board = board;
  e.moves = m;
  e.score = Math.max(e.score, Math.min(whole(score), maxScore(startMass, fixed ? 0 : m)));
  e.over = over === true;

  if (hasWon(s.mode, s.target, e.board)) {
    if (s.mode === 'highlander') e.solvedMs = Math.max(0, ctx.now() - s.startsAt);
    await finish(ctx, s, playerId);
    return;
  }
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
 * There is always a winner, solo included: the phone that met the goal first,
 * or else whoever is ahead by the mode's own measure (`compareEntries`), with a
 * dead heat going to whoever joined first.
 */
async function finish(ctx: Ctx, s: MergeRush, outright: PlayerId | null = null): Promise<void> {
  let winner: PlayerId | null = outright;
  if (winner === null) {
    const ahead = compareEntries(s.mode);
    let best: MergeEntry | null = null;
    for (const [id, e] of Object.entries(s.boards)) {
      if (best === null || ahead(e, best) < 0) {
        winner = id;
        best = e;
      }
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
    mode: s.mode,
    target: s.target,
    roundMs: s.roundMs,
    start: [...s.start],
    boards,
    solo: s.solo,
    winner: s.winner,
  };
}

function broadcast(ctx: Ctx, s: MergeRush): void {
  ctx.broadcast({ t: 'merge-rush', s: ctx.nextSeq(), d: toState(s) });
}
