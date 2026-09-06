import {
  COLOR_HUNT_ACTION_MS,
  COLOR_HUNT_CAP_MS,
  COLOR_HUNT_MAX_PLAYERS,
  COLOR_HUNT_MIN_PLAYERS,
  type ColorHuntState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { COLOR_BARREN_ROUNDS, COLOR_PICK_GRACE_MS, asRgb, colorScore, huntColor, nextHuntTarget, type Rgb } from '../shared/color';
import { enoughToStart } from '../shared/players';

/**
 * Color Hunt. Spec: docs/specs/games/color-hunt.md
 *
 * Color Match's referee with one phase removed. That is not laziness, it is
 * the design: there is no reveal here, so the next target replaces this one
 * the instant scoring completes (spec §2). The momentum is the thing this game
 * has that its sibling does not, and a two-second results panel between rounds
 * would spend it.
 *
 * **No pixel is ever on this wire.** A phone samples its own camera locally
 * and sends three integers, which is the whole of spec §10 — this file could
 * not reconstruct a frame if it wanted to.
 */

export type HuntFind = { rgb: Rgb; score: number };

export type ColorHunt = {
  roundId: number;
  round: number;
  startsAt: number;
  /** The safety cap, and the reason §9's safety copy can promise a bound. */
  endsAt: number;
  targetKey: string;
  target: Rgb;
  phase: 'hunt' | 'done';
  dueAt: number;
  finds: Record<PlayerId, HuntFind>;
  /** Last scored round, kept separately from the round in flight so the
   *  scoreboard can still show what just happened while the next target is
   *  already up — there is no reveal phase to hold it (spec §2). */
  lastFinds: Record<PlayerId, HuntFind>;
  totals: Record<PlayerId, number>;
  barren: number;
  solo: boolean;
  winner: PlayerId | null;
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<ColorHunt | null>;
  save(s: ColorHunt): Promise<void>;
  setAlarm(at: number): Promise<void>;
  random(): number;
};

/** Picks close, plus the grace a slow phone is allowed (spec §6). */
export function nextDeadline(s: ColorHunt): number {
  return s.phase === 'hunt' ? Math.min(s.dueAt + COLOR_PICK_GRACE_MS, s.endsAt) : Infinity;
}

function armRound(ctx: Ctx, s: ColorHunt, round: number): void {
  const target = nextHuntTarget(s.targetKey, ctx.random);
  s.round = round;
  s.targetKey = target.key;
  s.target = huntColor(target);
  s.phase = 'hunt';
  s.dueAt = ctx.now() + COLOR_HUNT_ACTION_MS;
  s.finds = {};
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startColorHunt(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [COLOR_HUNT_MIN_PLAYERS, COLOR_HUNT_MAX_PLAYERS], solo)) return false;

  const now = ctx.now();
  const totals: Record<PlayerId, number> = {};
  for (const id of connected) totals[id] = 0;

  const s: ColorHunt = {
    roundId,
    round: 1,
    startsAt: now,
    endsAt: now + COLOR_HUNT_CAP_MS,
    // No previous target on the first round, so all six are in the pool.
    targetKey: '',
    target: [0, 0, 0],
    phase: 'hunt',
    dueAt: now,
    finds: {},
    lastFinds: {},
    totals,
    barren: 0,
    solo: solo || connected.length <= 1,
    winner: null,
  };
  armRound(ctx, s, 1);

  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/**
 * What one phone's magnifier last read (spec §6). Three integers, stored and
 * scored later — the same "score once, for everybody, when the window closes"
 * rule Color Match uses, and for the same reason.
 */
export async function onHuntFind(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  round: number,
  rgb: unknown,
  _at: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.phase !== 'hunt' || s.round !== round) return;
  if (!(playerId in s.totals)) return;
  if (ctx.now() > s.dueAt + COLOR_PICK_GRACE_MS) return;

  const found = asRgb(rgb);
  if (!found) return;
  s.finds[playerId] = { rgb: found, score: 0 };
  await ctx.save(s);
}

/** The clock: score what came in, then immediately deal the next target. */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'hunt') return false;
  const now = ctx.now();
  if (now < nextDeadline(s)) return false;

  score(s);

  if (now >= s.endsAt || s.barren >= COLOR_BARREN_ROUNDS) {
    await finish(ctx, s);
    return true;
  }

  armRound(ctx, s, s.round + 1);
  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

function score(s: ColorHunt): void {
  let anybody = false;
  const scored: Record<PlayerId, HuntFind> = {};
  for (const id of Object.keys(s.totals)) {
    const find = s.finds[id];
    if (!find) continue;
    find.score = colorScore(find.rgb, s.target);
    scored[id] = find;
    if (find.score > 0) {
      anybody = true;
      s.totals[id] = (s.totals[id] ?? 0) + find.score;
    }
  }
  s.lastFinds = scored;
  s.barren = anybody ? 0 : s.barren + 1;
}

/** A player vanished. Their total stays; they stop being able to submit. */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'hunt') return;
  if (!(playerId in s.finds)) return;
  delete s.finds[playerId];
  await ctx.save(s);
}

async function finish(ctx: Ctx, s: ColorHunt): Promise<void> {
  let winner: PlayerId | null = null;
  if (!s.solo) {
    let best = -Infinity;
    let tie = false;
    for (const [id, total] of Object.entries(s.totals)) {
      if (total > best) {
        best = total;
        winner = id;
        tie = false;
      } else if (total === best) {
        tie = true;
      }
    }
    if (tie) winner = null;
  }
  s.phase = 'done';
  s.winner = s.solo ? null : winner;
  await ctx.save(s);
  broadcast(ctx, s);
}

export function toState(s: ColorHunt): ColorHuntState {
  const finds: ColorHuntState['finds'] = {};
  // The round in flight is private — a phone that could read the room's finds
  // mid-round could copy the best one — so what goes out is the LAST scored
  // round, which is also the only thing the live ladder has to show.
  for (const [id, f] of Object.entries(s.lastFinds)) {
    finds[id] = { rgb: [f.rgb[0], f.rgb[1], f.rgb[2]], score: f.score };
  }
  return {
    roundId: s.roundId,
    round: s.round,
    target: [s.target[0], s.target[1], s.target[2]],
    name: s.targetKey,
    phase: s.phase,
    dueAt: s.dueAt,
    endsAt: s.endsAt,
    totals: { ...s.totals },
    finds,
    barren: s.barren,
    winner: s.winner,
  };
}

function broadcast(ctx: Ctx, s: ColorHunt): void {
  ctx.broadcast({ t: 'color-hunt', s: ctx.nextSeq(), d: toState(s) });
}
