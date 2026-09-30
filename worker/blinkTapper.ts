import {
  BLINK_COUNTDOWN_MS,
  BLINK_MAX_PLAYERS,
  BLINK_MIN_PLAYERS,
  BLINK_MISS_LIMIT,
  BLINK_REPORT_GRACE_MS,
  BLINK_UNLIMITED_CAP_MS,
  type BlinkFinal,
  type BlinkOptions,
  type BlinkTapperState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';
import { maxHits, normaliseBlinkOptions } from '../shared/blink';

/**
 * Blink Tapper. Spec: docs/specs/games/blink-tapper.md
 *
 * **The referee is used only at the end** (spec §6). It fixes the first blink's
 * time and the options, and after that hears one report per phone. What it owns
 * is the cap, the bound on each report, and the winner.
 */

export type BlinkTapper = {
  roundId: number;
  startsAt: number;
  /** The last moment a report is waited for (spec §7). */
  endsAt: number;
  options: BlinkOptions;
  finals: Record<PlayerId, BlinkFinal | null>;
  /** Players who left before reporting: no longer waited for, never ranked. */
  gone: PlayerId[];
  solo: boolean;
  winner: PlayerId | null;
  phase: 'playing' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<BlinkTapper | null>;
  save(s: BlinkTapper): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

export function nextDeadline(s: BlinkTapper): number {
  return s.phase === 'playing' ? s.endsAt : Infinity;
}

/** How long a round can honestly run, ms after the first blink. */
function playable(s: Pick<BlinkTapper, 'options'>): number {
  return s.options.duration > 0 ? s.options.duration : BLINK_UNLIMITED_CAP_MS;
}

export async function startBlinkTapper(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  rawOptions: unknown,
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [BLINK_MIN_PLAYERS, BLINK_MAX_PLAYERS], solo)) return false;

  const options = normaliseBlinkOptions(rawOptions);
  const startsAt = ctx.now() + BLINK_COUNTDOWN_MS;
  const finals: Record<PlayerId, BlinkFinal | null> = {};
  for (const id of connected) finals[id] = null;

  const s: BlinkTapper = {
    roundId,
    startsAt,
    endsAt: startsAt + playable({ options }) + BLINK_REPORT_GRACE_MS,
    options,
    finals,
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

/**
 * One phone's whole round (spec §6, §8). Clamped, never rejected: hits cannot
 * outnumber the blinks that had started by the time it arrived, and misses in
 * `unlimited` stop at the limit that ended it. The first report is the one
 * that counts — a resend changes nothing.
 */
export async function onBlinkFinal(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  hits: number,
  misses: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.phase !== 'playing') return;
  if (!(playerId in s.finals) || s.finals[playerId] !== null) return;

  const elapsed = Math.min(Math.max(0, ctx.now() - s.startsAt), playable(s));
  const h = Math.min(whole(hits), maxHits(elapsed));
  let m = whole(misses);
  if (s.options.duration === 0) m = Math.min(m, BLINK_MISS_LIMIT);
  s.finals[playerId] = { hits: h, misses: m, score: h - m };

  if (everyoneIn(s)) {
    await finish(ctx, s);
    return;
  }
  await ctx.save(s);
  broadcast(ctx, s);
}

function whole(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function everyoneIn(s: BlinkTapper): boolean {
  return Object.entries(s.finals).every(([id, f]) => f !== null || s.gone.includes(id));
}

export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'playing') return false;
  if (ctx.now() < s.endsAt) return false;
  await finish(ctx, s);
  return true;
}

/** A reported score stays and can still win; a player who never reported
 *  stops holding the room open (spec §7). */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'playing') return;
  if (!(playerId in s.finals) || s.finals[playerId] !== null || s.gone.includes(playerId)) return;
  s.gone.push(playerId);
  if (everyoneIn(s)) {
    await finish(ctx, s);
    return;
  }
  await ctx.save(s);
  broadcast(ctx, s);
}

/** Highest net score among those who reported. A tie at the top is unranked,
 *  and a room where nobody reported has no winner. */
async function finish(ctx: Ctx, s: BlinkTapper): Promise<void> {
  let winner: PlayerId | null = null;
  if (!s.solo) {
    let best = -Infinity;
    let tie = false;
    for (const [id, f] of Object.entries(s.finals)) {
      if (!f) continue;
      if (f.score > best) {
        best = f.score;
        winner = id;
        tie = false;
      } else if (f.score === best) {
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

export function toState(s: BlinkTapper): BlinkTapperState {
  const finals: Record<PlayerId, BlinkFinal | null> = {};
  for (const [id, f] of Object.entries(s.finals)) finals[id] = f ? { ...f } : null;
  return {
    roundId: s.roundId,
    phase: s.phase,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    options: { ...s.options },
    finals,
    solo: s.solo,
    winner: s.winner,
  };
}

function broadcast(ctx: Ctx, s: BlinkTapper): void {
  ctx.broadcast({ t: 'blink-tapper', s: ctx.nextSeq(), d: toState(s) });
}
