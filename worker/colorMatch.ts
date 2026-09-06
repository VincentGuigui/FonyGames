import {
  COLOR_MATCH_MAX_PLAYERS,
  COLOR_MATCH_MIN_PLAYERS,
  COLOR_REVEAL_HOLD_MS,
  COLOR_RUN_CAP_MS,
  COLOR_SCORE_HOLD_MS,
  COLOR_SOLVE_MS,
  colorActionMs,
  type ColorMatchState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { COLOR_BARREN_ROUNDS, COLOR_PICK_GRACE_MS, asRgb, colorKey, colorScore, dealTarget, rungAt, withLuminance, type Rgb } from '../shared/color';
import { enoughToStart } from '../shared/players';

/**
 * Color Match. Spec: docs/specs/games/color-match.md
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md. Everything here is driven through `Ctx`,
 * which Room supplies — this module never touches a socket.
 *
 * **The referee owns the level, the target and the scores; the phone owns one
 * colour.** That is the whole division, and it is what makes this the cheapest
 * profile in docs/multiplayer.md: one message down per level, one up per
 * player, and nothing at frame rate.
 *
 * The ladder itself lives in `shared/color.ts`, not here, because the phone
 * draws the wheel from the same rung this file deals from — a second copy
 * would let the two disagree about what colours are even on offer (spec §2.3).
 */

export type ColorPick = {
  rgb: Rgb;
  /** Filled in when the level is scored, not when the pick arrives. */
  score: number;
};

export type ColorMatch = {
  roundId: number;
  level: number;
  startsAt: number;
  /** The safety cap — a room that will not stop scoring (spec §2.1). */
  endsAt: number;
  target: Rgb;
  luminance: boolean;
  phase: 'pick' | 'reveal' | 'done';
  picksDueAt: number;
  revealAt: number;
  levelEndsAt: number;
  /** This level's picks, replaced wholesale each level. */
  picks: Record<PlayerId, ColorPick>;
  totals: Record<PlayerId, number>;
  /** Every colour this session has asked for. A session never asks twice
   *  (spec §2.3) — except where a rung has nothing left, which the first rung
   *  reaches at level 4 by having only three colours in it. */
  used: string[];
  /** Consecutive levels nobody scored a point on (spec §2.1). */
  barren: number;
  solo: boolean;
  winner: PlayerId | null;
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<ColorMatch | null>;
  save(s: ColorMatch): Promise<void>;
  setAlarm(at: number): Promise<void>;
  /** 0..1. Injected rather than read here so a test can pin a level to an
   *  exact colour — `shared/color.ts` takes the same argument for the same
   *  reason. */
  random(): number;
};

/**
 * The next thing this game needs waking for. During `pick` that is the
 * deadline plus the grace: the referee deliberately waits `COLOR_PICK_GRACE_MS`
 * past the moment picks close before scoring, so a phone 300 ms away loses
 * points to its own lag only when it is genuinely slow (spec §6).
 */
export function nextDeadline(s: ColorMatch): number {
  if (s.phase === 'done') return Infinity;
  const own = s.phase === 'pick' ? s.picksDueAt + COLOR_PICK_GRACE_MS : s.levelEndsAt;
  return Math.min(own, s.endsAt);
}

/** Everything after picking closes: score hold, cursors sliding, one more beat.
 *  The action window itself is tiered by level (`colorActionMs`), so a whole
 *  level is that plus this. */
export const LEVEL_TAIL_MS = COLOR_SCORE_HOLD_MS + COLOR_SOLVE_MS + COLOR_REVEAL_HOLD_MS;

/** How long a whole level takes, end to end (spec §2.2). */
export function levelMs(level: number): number {
  return colorActionMs(level) + LEVEL_TAIL_MS;
}

function armLevel(ctx: Ctx, s: ColorMatch, level: number): void {
  const now = ctx.now();
  const dealt = dealTarget(level, ctx.random, new Set(s.used));
  s.level = level;
  s.target = dealt.rgb;
  s.used.push(colorKey(dealt.rgb));
  s.luminance = rungAt(level).luminance;
  s.phase = 'pick';
  s.picksDueAt = now + colorActionMs(level);
  s.revealAt = s.picksDueAt + COLOR_SCORE_HOLD_MS;
  s.levelEndsAt = now + levelMs(level);
  s.picks = {};
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startColorMatch(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [COLOR_MATCH_MIN_PLAYERS, COLOR_MATCH_MAX_PLAYERS], solo)) return false;

  const now = ctx.now();
  const totals: Record<PlayerId, number> = {};
  // Everyone is on the ladder from the first level at zero rather than
  // appearing on their own first pick — an empty scoreboard reads as broken.
  for (const id of connected) totals[id] = 0;

  const s: ColorMatch = {
    roundId,
    level: 1,
    startsAt: now,
    endsAt: now + COLOR_RUN_CAP_MS,
    target: [0, 0, 0],
    luminance: false,
    phase: 'pick',
    picksDueAt: now,
    revealAt: now,
    levelEndsAt: now,
    picks: {},
    totals,
    used: [],
    barren: 0,
    solo: solo || connected.length <= 1,
    winner: null,
  };
  armLevel(ctx, s, 1);

  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/**
 * One phone's pick for the level in flight (spec §6).
 *
 * Stored, never scored here — scoring happens once, for everybody, when the
 * window closes, so a pick that arrives early cannot be worth more than one
 * that arrives late. A later pick simply replaces an earlier one, which is
 * what makes "whatever the cursor reads when the pie empties" true.
 */
export async function onColorPick(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  level: number,
  rgb: unknown,
  lum: unknown,
  _at: number,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.phase !== 'pick' || s.level !== level) return;
  if (!(playerId in s.totals)) return;
  // Past the deadline plus its grace, nothing counts. The referee has not
  // scored yet at that point, so this is the only thing keeping the window shut.
  if (ctx.now() > s.picksDueAt + COLOR_PICK_GRACE_MS) return;

  const base = asRgb(rgb);
  if (!base) return;
  const k = typeof lum === 'number' && Number.isFinite(lum) ? Math.min(1, Math.max(0, lum)) : 1;
  // A pick's score is never taken from the payload — it cannot even carry one
  // (spec §8). It arrives as a colour and leaves as a colour.
  s.picks[playerId] = { rgb: s.luminance ? withLuminance(base, k) : base, score: 0 };
  await ctx.save(s);
}

/**
 * The clock. Two things happen on it: the picks close and get scored, and the
 * reveal finishes and the next level is dealt.
 *
 * Returns true when the run is over.
 */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase === 'done') return false;
  const now = ctx.now();
  if (now < nextDeadline(s)) return false;

  if (now >= s.endsAt) {
    await finish(ctx, s);
    return true;
  }

  if (s.phase === 'pick') {
    score(s);
    s.phase = 'reveal';
    if (s.barren >= COLOR_BARREN_ROUNDS) {
      // Scored, shown, and then over: the level that ended the run is still
      // revealed, because ending on a blank screen reads as a crash.
      await ctx.save(s);
      broadcast(ctx, s);
      await ctx.setAlarm(s.levelEndsAt);
      return false;
    }
    await ctx.save(s);
    broadcast(ctx, s);
    await ctx.setAlarm(nextDeadline(s));
    return false;
  }

  // The reveal is over. Either the run ended on this level, or the next one is
  // dealt and the whole thing goes round again — no lobby, no tap to continue.
  if (s.barren >= COLOR_BARREN_ROUNDS) {
    await finish(ctx, s);
    return true;
  }
  armLevel(ctx, s, s.level + 1);
  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

/**
 * Score every pick against the target and move the totals. A player who sent
 * nothing scores nothing and counts toward the barren streak like any other
 * zero — not tapping is a pick (spec §7).
 */
function score(s: ColorMatch): void {
  let anybody = false;
  for (const id of Object.keys(s.totals)) {
    const pick = s.picks[id];
    const points = pick ? colorScore(pick.rgb, s.target) : 0;
    if (pick) pick.score = points;
    if (points > 0) {
      anybody = true;
      s.totals[id] = (s.totals[id] ?? 0) + points;
    }
  }
  s.barren = anybody ? 0 : s.barren + 1;
}

/**
 * A player vanished. Their total stays on the board — the run is against the
 * ladder rather than against each other, so removing them would rewrite a
 * scoreboard other people are still comparing themselves to. They simply stop
 * being able to pick.
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase === 'done') return;
  if (!(playerId in s.picks)) return;
  delete s.picks[playerId];
  await ctx.save(s);
}

/** End the run: highest total takes it, a tie at the top is unranked, and a
 *  solo room has nobody to beat so it records no winner (spec §7). */
async function finish(ctx: Ctx, s: ColorMatch): Promise<void> {
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

/** The level as every phone needs it. */
export function toState(s: ColorMatch): ColorMatchState {
  const picks: ColorMatchState['picks'] = {};
  // Nothing about anyone else's pick goes out while the window is still open —
  // a phone that could read the room's picks mid-level would be a phone that
  // could copy the best one.
  if (s.phase !== 'pick') {
    for (const [id, p] of Object.entries(s.picks)) {
      picks[id] = { rgb: [p.rgb[0], p.rgb[1], p.rgb[2]], score: p.score };
    }
  }
  return {
    roundId: s.roundId,
    level: s.level,
    target: [s.target[0], s.target[1], s.target[2]],
    luminance: s.luminance,
    phase: s.phase,
    picksDueAt: s.picksDueAt,
    revealAt: s.revealAt,
    endsAt: s.levelEndsAt,
    totals: { ...s.totals },
    picks,
    barren: s.barren,
    winner: s.winner,
  };
}

function broadcast(ctx: Ctx, s: ColorMatch): void {
  ctx.broadcast({ t: 'color-match', s: ctx.nextSeq(), d: toState(s) });
}
