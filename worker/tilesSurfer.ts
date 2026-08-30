import {
  TILES_LIVES,
  TILES_MAX_PLAYERS,
  TILES_MIN_PLAYERS,
  TILES_ROUND_CAP_MS,
  type PlayerId,
  type ServerMessage,
  type TilesSurferRun,
  type TilesSurferState,
} from '../shared/protocol';
import { enoughToStart, lastStanding } from '../shared/players';

/**
 * Tiles Surfer. Spec: docs/specs/games/tiles-surfer.md
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md. Everything here is driven through `Ctx`,
 * which Room supplies — this module never touches a socket.
 *
 * Unlike every other referee in this catalogue, **this one does not referee
 * the game itself** (spec §8, by direct instruction): a player's own board —
 * tiles, taps, timing — runs entirely on their own phone, and this file only
 * ever sees the periodic and terminal numbers a `tiles-report` claims. What it
 * DOES own, same as Steady Hand's own lives model: whose report just emptied
 * their own lives, and who is left once that happens.
 */

export type TilesSurferPlayer = TilesSurferRun & {
  /** Server time they went out, or 0 while alive. */
  outAt: number;
};

export type TilesSurfer = {
  roundId: number;
  startsAt: number;
  /** The safety cap — a defensive backstop for a run nobody's own lives end (spec §7). */
  endsAt: number;
  alive: PlayerId[];
  players: Record<PlayerId, TilesSurferPlayer>;
  /**
   * True when the round began with at most one real player (or the debug solo
   * flag), same reasoning as Steady Hand's own `solo` field: alone, there is
   * nobody to outlast, so `lastStanding`'s threshold drops from one to zero
   * rather than ending the run in the same tick it began (spec §7).
   */
  solo: boolean;
  winner: PlayerId | null;
  phase: 'running' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<TilesSurfer | null>;
  save(s: TilesSurfer): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

/** Only ever the safety cap — nothing else here needs polling (spec §8: there
 *  is no per-tick judgment to run, unlike Steady Hand's tightening tolerance). */
export function nextDeadline(s: TilesSurfer): number {
  return s.endsAt;
}

function fresh(): TilesSurferPlayer {
  return { score: 0, lives: TILES_LIVES, perfects: 0, longestStreak: 0, avgReactionMs: 0, outAt: 0 };
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startTilesSurfer(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [TILES_MIN_PLAYERS, TILES_MAX_PLAYERS], solo)) return false;

  const now = ctx.now();
  const players: Record<PlayerId, TilesSurferPlayer> = {};
  for (const id of connected) players[id] = fresh();

  const s: TilesSurfer = {
    roundId,
    startsAt: now,
    endsAt: now + TILES_ROUND_CAP_MS,
    alive: [...connected],
    players,
    // A genuinely-solo room (spec §7, §12): nobody to outlast, so a lone
    // player's own elimination has to be what ends the run, same as the
    // debug flag already does for every other elimination game.
    solo: solo || connected.length <= 1,
    winner: null,
    phase: 'running',
  };

  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/**
 * A phone's own periodic or terminal report (spec §6). Everything here is
 * stored as claimed, past a cheap range clamp — not validated against
 * anything of the referee's own, because there is nothing here for the
 * referee to check it against (spec §8).
 */
export async function onTilesReport(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  score: number,
  lives: number,
  perfects: number,
  longestStreak: number,
  avgReactionMs: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running' || s.roundId !== roundId) return;
  if (!s.alive.includes(playerId)) return;
  const p = s.players[playerId];
  if (!p) return;

  if (Number.isFinite(score) && score >= 0) p.score = score;
  if (Number.isFinite(lives) && lives >= 0) p.lives = Math.min(TILES_LIVES, Math.trunc(lives));
  if (Number.isFinite(perfects) && perfects >= 0) p.perfects = Math.trunc(perfects);
  if (Number.isFinite(longestStreak) && longestStreak >= 0) p.longestStreak = Math.trunc(longestStreak);
  if (Number.isFinite(avgReactionMs) && avgReactionMs >= 0) p.avgReactionMs = avgReactionMs;

  if (p.lives <= 0) {
    await eliminate(ctx, s, playerId, ctx.now());
    return;
  }

  await ctx.save(s);
  broadcast(ctx, s);
}

/** The tick. Only ever the safety cap (spec §7) — returns true when the round is over. */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return false;
  if (ctx.now() < s.endsAt) return false;

  await finish(ctx, s);
  return true;
}

/** A player vanished. Treated exactly like their own lives reaching 0 (spec §7). */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return;
  if (!s.alive.includes(playerId)) return;

  await eliminate(ctx, s, playerId, ctx.now());
}

async function eliminate(ctx: Ctx, s: TilesSurfer, playerId: PlayerId, now: number): Promise<void> {
  s.alive = s.alive.filter((id) => id !== playerId);
  const p = s.players[playerId];
  if (p) {
    p.lives = 0;
    p.outAt = now;
  }

  if (lastStanding(s.alive.length, s.solo)) {
    await finish(ctx, s);
    return;
  }
  await ctx.save(s);
  broadcast(ctx, s);
}

/**
 * End the round. The sole player left in wins outright. At the safety cap
 * with more than one still going, the highest last-reported score wins; a
 * tie at the top is unranked, the same convention every other game's own
 * cap uses (spec §7).
 */
async function finish(ctx: Ctx, s: TilesSurfer): Promise<void> {
  let winner: PlayerId | null = s.alive[0] ?? null;

  if (s.alive.length > 1) {
    winner = null;
    let best = -Infinity;
    let tie = false;
    for (const id of s.alive) {
      const score = s.players[id]?.score ?? 0;
      if (score > best) {
        best = score;
        winner = id;
        tie = false;
      } else if (score === best) {
        tie = true;
      }
    }
    if (tie) winner = null;
  }

  s.phase = 'done';
  s.winner = winner;
  await ctx.save(s);
  broadcast(ctx, s);
}

/** The round as every phone needs it: everyone's last-reported run. */
export function toState(s: TilesSurfer): TilesSurferState {
  const scores: Record<PlayerId, TilesSurferRun> = {};
  for (const [id, p] of Object.entries(s.players)) {
    scores[id] = {
      score: p.score,
      lives: p.lives,
      perfects: p.perfects,
      longestStreak: p.longestStreak,
      avgReactionMs: p.avgReactionMs,
    };
  }
  return { roundId: s.roundId, startsAt: s.startsAt, endsAt: s.endsAt, scores, winner: s.winner, phase: s.phase };
}

function broadcast(ctx: Ctx, s: TilesSurfer): void {
  ctx.broadcast({ t: 'tiles', s: ctx.nextSeq(), d: toState(s) });
}
