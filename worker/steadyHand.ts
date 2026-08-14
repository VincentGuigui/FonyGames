import {
  STEADY_CAP_MS,
  STEADY_GRACE_MS,
  STEADY_LIVES,
  STEADY_MAX_PLAYERS,
  STEADY_MIN_PLAYERS,
  STEADY_PARKED_MS,
  STEADY_SETTLE_MS,
  STEADY_TICK_MS,
  TIGHTEN_EVERY_MS,
  TIGHTEN_FACTOR,
  WOBBLE_FLOOR,
  WOBBLE_START,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart, lastStanding } from '../shared/players';

/**
 * Steady Hand. Spec: docs/specs/games/steady-hand.md
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md. Everything here is driven through `Ctx`, which
 * Room supplies — this module never touches a socket.
 *
 * The referee owns the tolerance, the lives and the eliminations. It cannot see an
 * accelerometer, so it takes the phone's word for the wobble number and is strict
 * about everything it *can* check: the clock, the lives, the grace window and
 * silence.
 */

export type SteadyPlayer = {
  lives: number;
  /** Last reported wobble, for everyone's meters. */
  w: number;
  /** Server time until which wobble is ignored, after spending a life. */
  graceUntil: number;
  /** When this phone last said anything. Silence is elimination. */
  lastSeen: number;
  /** Server time this phone first reported lying flat, or 0 when it is held. */
  flatSince: number;
  /** Sum and count of reported wobble, for the cap-time tie-break. */
  sum: number;
  n: number;
  /** Server time they went out, or 0 while alive. */
  outAt: number;
};

export type Steady = {
  roundId: number;
  /** Nothing counts before this: everyone needs a moment to get into position. */
  startsAt: number;
  endsAt: number;
  /**
   * Server time the next tick is due — ABSOLUTE, never "now plus a bit".
   *
   * Room's one alarm handler asks every game "are you due?" by comparing the clock
   * against its deadline, so a deadline computed from the caller's own clock is never
   * due: `now >= now + TICK` is false forever. That is not a hypothetical — it shipped,
   * and it silently cost the round its tightening tolerance AND its silence reaper while
   * leaving the game looking like it worked, because eliminations still broadcast from
   * `onWobble`. Storing the moment is what makes the question answerable.
   */
  tickAt: number;
  alive: PlayerId[];
  players: Record<PlayerId, SteadyPlayer>;
  /**
   * Started in solo test mode, so "last one standing" does not end the round.
   *
   * Alone you ARE the last one standing at kick-off, so the round would finish in the
   * tick it began and there would be nothing to look at — which is the whole point of
   * the mode (`enoughToStart` in shared/players.ts). The time cap still ends it and
   * nothing else changes. Stored on the ROUND rather than read from a flag, so a round
   * that began solo stays solo even if somebody joins halfway through.
   */
  solo: boolean;
  phase: 'running' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<Steady | null>;
  save(s: Steady): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

/**
 * The tolerance at a given moment: `WOBBLE_START`, stepped down by
 * `TIGHTEN_FACTOR` every `TIGHTEN_EVERY_MS`, floored at `WOBBLE_FLOOR`.
 *
 * Computed from the clock rather than stored and decremented, so it cannot drift
 * apart from what the phones are being told, and a late alarm cannot skip a step.
 */
export function toleranceAt(s: Steady, now: number): number {
  const elapsed = Math.max(0, now - s.startsAt);
  const steps = Math.floor(elapsed / TIGHTEN_EVERY_MS);
  return Math.max(WOBBLE_FLOOR, WOBBLE_START * TIGHTEN_FACTOR ** steps);
}

/**
 * When the room next needs waking: the broadcast tick, or the cap.
 *
 * Takes no clock on purpose. Room asks this both to arm the alarm and to decide whether
 * the alarm it just woke on was ours, and those two answers have to be the same number.
 */
export function nextDeadline(s: Steady): number {
  return Math.min(s.endsAt, s.tickAt);
}

function fresh(now: number): SteadyPlayer {
  return {
    lives: STEADY_LIVES,
    w: 0,
    graceUntil: now + STEADY_SETTLE_MS,
    lastSeen: now + STEADY_SETTLE_MS,
    flatSince: 0,
    sum: 0,
    n: 0,
    outAt: 0,
  };
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startSteady(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [STEADY_MIN_PLAYERS, STEADY_MAX_PLAYERS], solo)) return false;

  const now = ctx.now();
  const players: Record<PlayerId, SteadyPlayer> = {};
  for (const id of connected) players[id] = fresh(now);

  const s: Steady = {
    roundId,
    // The settle window is inside the round rather than before it, so every phone
    // agrees on when counting starts without a second round trip.
    startsAt: now + STEADY_SETTLE_MS,
    endsAt: now + STEADY_SETTLE_MS + STEADY_CAP_MS,
    // The settle window still ticks: the countdown on every phone is driven by these
    // frames, and the reaper has to be awake before it is allowed to bite.
    tickAt: now + STEADY_TICK_MS,
    alive: [...connected],
    players,
    phase: 'running',
    solo,
  };

  await ctx.save(s);
  broadcast(ctx, s, now);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/**
 * A phone reported its worst wobble for the last tick.
 *
 * Everything the server can verify, it verifies; the wobble number itself it
 * cannot (spec §8), so the defences are the grace window, the settle window and
 * the fact that going quiet is fatal.
 */
export async function onWobble(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  w: number,
  held: boolean,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return;
  if (s.roundId !== roundId) return;
  if (!s.alive.includes(playerId)) return;

  const p = s.players[playerId];
  if (!p) return;

  const now = ctx.now();
  p.lastSeen = now;

  /*
   * The number that is JUDGED and the number that is DISPLAYED are not the same, and
   * conflating them was a bug worth remembering.
   *
   * Not-a-number or a negative is a broken or hostile client, and it has to be read as
   * the worst case rather than as zero — otherwise sending `NaN` forever is unbeatable.
   * But `Infinity` cannot go on the wire for the meters, so it gets clamped for
   * display. Clamping first and then comparing the clamped value put a hostile client
   * exactly ON the opening tolerance, where `<=` let it through: caught by
   * steadyHand.test.ts §hostile input.
   */
  const judged = Number.isFinite(w) && w >= 0 ? w : Number.POSITIVE_INFINITY;
  p.w = Number.isFinite(judged) ? judged : WOBBLE_START * 2;

  /*
   * Parked beats everything, including grace and the settle window.
   *
   * A phone lying flat is the one cheat the referee can actually detect, and it is
   * worth more than three lives: lives forgive a flinch, and putting the phone down
   * is not a flinch (spec §2.3). Sustained rather than instantaneous, because the
   * moment you *pick it up* it passes through flat.
   */
  if (!held) {
    if (p.flatSince === 0) p.flatSince = now;
    if (now - p.flatSince >= STEADY_PARKED_MS) {
      await eliminate(ctx, s, playerId, 'parked', now);
      return;
    }
  } else {
    p.flatSince = 0;
  }

  // Nothing counts during the settle window or a grace window.
  if (now < s.startsAt || now < p.graceUntil) {
    await ctx.save(s);
    return;
  }

  p.sum += p.w;
  p.n += 1;

  if (judged <= toleranceAt(s, now)) {
    await ctx.save(s);
    return;
  }

  p.lives -= 1;
  if (p.lives <= 0) {
    await eliminate(ctx, s, playerId, 'moved', now);
    return;
  }

  p.graceUntil = now + STEADY_GRACE_MS;
  await ctx.save(s);
  ctx.broadcast({
    t: 'steady-hit',
    s: ctx.nextSeq(),
    d: { roundId: s.roundId, victim: playerId, lives: p.lives, graceUntil: p.graceUntil },
  });
}

/**
 * The tick. Broadcasts the room, reaps phones that have gone quiet, and ends the
 * round when one player is left or the cap arrives.
 *
 * Returns true when the round is over.
 */
export async function onSteadyTick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return false;

  const now = ctx.now();

  /*
   * Silence is elimination.
   *
   * Without this the winning move is to close the tab: no events, no wobble, no way
   * to lose. It also covers a backgrounded tab for free, which is deliberate and
   * stated in the rules — motion events stop when a phone is not looking at you.
   */
  for (const id of [...s.alive]) {
    const p = s.players[id];
    if (!p) continue;
    if (now >= s.startsAt && now - p.lastSeen > 3 * STEADY_TICK_MS) {
      await eliminate(ctx, s, id, 'left', now, true);
    }
  }

  if (lastStanding(s.alive.length, s.solo) || now >= s.endsAt) {
    await finish(ctx, s, now);
    return true;
  }

  // From `now` rather than from the old `tickAt`, so a late alarm resumes the cadence
  // instead of trying to catch up on ticks nobody is waiting for any more.
  s.tickAt = now + STEADY_TICK_MS;
  await ctx.save(s);
  broadcast(ctx, s, now);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

/** A player vanished. Same as silence, but immediate. */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return;
  if (!s.alive.includes(playerId)) return;

  await eliminate(ctx, s, playerId, 'left', ctx.now());
}

async function eliminate(
  ctx: Ctx,
  s: Steady,
  playerId: PlayerId,
  reason: 'moved' | 'parked' | 'left',
  now: number,
  /** Set while iterating in the tick, which finishes the round itself. */
  deferFinish = false,
): Promise<void> {
  s.alive = s.alive.filter((p) => p !== playerId);
  const p = s.players[playerId];
  if (p) {
    p.lives = 0;
    p.outAt = now;
  }

  ctx.broadcast({
    t: 'steady-out',
    s: ctx.nextSeq(),
    d: { roundId: s.roundId, victim: playerId, reason, alive: s.alive },
  });

  if (deferFinish) return;

  if (lastStanding(s.alive.length, s.solo)) {
    await finish(ctx, s, now);
    return;
  }
  await ctx.save(s);
}

/**
 * End the round.
 *
 * A winner is the last player standing. On the cap, nobody was eliminated, so it
 * goes to the **steadiest average** — which is the only fair reading of "you all
 * held still for two minutes".
 */
async function finish(ctx: Ctx, s: Steady, now: number): Promise<void> {
  let winner: PlayerId | null = s.alive[0] ?? null;

  if (s.alive.length > 1) {
    let best = Number.POSITIVE_INFINITY;
    for (const id of s.alive) {
      const p = s.players[id];
      if (!p || p.n === 0) continue;
      const avg = p.sum / p.n;
      if (avg < best) {
        best = avg;
        winner = id;
      }
    }
  }

  const times: Record<PlayerId, number> = {};
  for (const [id, p] of Object.entries(s.players)) {
    times[id] = Math.max(0, (p.outAt === 0 ? now : p.outAt) - s.startsAt);
  }

  s.phase = 'done';
  await ctx.save(s);
  ctx.broadcast({
    t: 'steady-end',
    s: ctx.nextSeq(),
    d: { roundId: s.roundId, winner, times },
  });
}

function broadcast(ctx: Ctx, s: Steady, now: number): void {
  const lives: Record<PlayerId, number> = {};
  const w: Record<PlayerId, number> = {};
  for (const [id, p] of Object.entries(s.players)) {
    lives[id] = p.lives;
    w[id] = p.w;
  }

  ctx.broadcast({
    t: 'steady',
    s: ctx.nextSeq(),
    d: {
      roundId: s.roundId,
      tolerance: toleranceAt(s, now),
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      alive: s.alive,
      lives,
      w,
    },
  });
}
