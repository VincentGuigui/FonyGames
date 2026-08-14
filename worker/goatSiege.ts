import {
  SIEGE_ADULT_FLIGHT_MS,
  SIEGE_CABBAGES,
  SIEGE_KID_FLIGHT_MS,
  SIEGE_KIDS_PER_SPLIT,
  SIEGE_LOB_COOLDOWN_MS,
  SIEGE_MAX_PLAYERS,
  SIEGE_MIN_PLAYERS,
  SIEGE_ROUND_CAP_MS,
  preroundFor,
  type Goat,
  type GoatState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart, lastStanding } from '../shared/players';
import { splitLanes } from '../shared/goatSplit';

/**
 * Goat Siege — the referee. Spec: docs/specs/games/goat-siege.md
 *
 * Same shape as spill.ts: persisted state, everything through `Ctx`, and the
 * cabbage counts change **only here**.
 *
 * The one idea worth remembering: a goat is a deterministic arc, so it goes on
 * the wire once and every phone animates the whole flight locally (spec §5).
 * Streaming positions would put this game in Profile B of the cost model and
 * cost roughly thirty times as much for no visible gain.
 */

export type Siege = {
  roundId: number;
  /** Server time play begins. The rules panel owns the window before it. */
  startsAt: number;
  players: PlayerId[];
  cabbages: Record<PlayerId, number>;
  out: PlayerId[];
  air: Record<string, Goat>;
  /** Server time each player may lob again. */
  cooldown: Record<PlayerId, number>;
  nextGoat: number;
  /** Bumped per goat so the split lanes differ without Math.random on clients. */
  nextSeed: number;
  endsAt: number;
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
  load(): Promise<Siege | null>;
  save(siege: Siege): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

function standing(s: Siege): PlayerId[] {
  return s.players.filter((p) => !s.out.includes(p));
}

export function toState(s: Siege): GoatState {
  return {
    roundId: s.roundId,
    startsAt: s.startsAt,
    players: s.players,
    cabbages: s.cabbages,
    out: s.out,
    air: Object.values(s.air),
    phase: s.phase,
  };
}

function broadcastState(ctx: Ctx, s: Siege): void {
  ctx.broadcast({ t: 'siege', s: ctx.nextSeq(), d: toState(s) });
}

export async function startSiege(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [SIEGE_MIN_PLAYERS, SIEGE_MAX_PLAYERS], solo)) {
    return false;
  }

  const now = ctx.now();
  // Only the first round of a room gets a rules panel (protocol.ts).
  const preround = preroundFor(roundId);
  const cabbages: Record<PlayerId, number> = {};
  for (const p of connected) cabbages[p] = SIEGE_CABBAGES;

  const siege: Siege = {
    roundId,
    startsAt: now + preround,
    players: [...connected],
    cabbages,
    out: [],
    air: {},
    cooldown: {},
    nextGoat: 0,
    nextSeed: 1,
    // The cap runs from the start of play, not from the panel.
    endsAt: now + preround + SIEGE_ROUND_CAP_MS,
    phase: 'running',
    solo,
  };

  await ctx.save(siege);
  broadcastState(ctx, siege);
  await ctx.setAlarm(siege.endsAt);
  return true;
}

/** Lob a goat at a chosen neighbour. */
export async function onLob(
  ctx: Ctx,
  from: PlayerId,
  roundId: number,
  to: PlayerId,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running' || s.roundId !== roundId) return;
  if (!s.players.includes(from) || s.out.includes(from)) return;
  if (from === to || !s.players.includes(to) || s.out.includes(to)) return;

  const now = ctx.now();
  // No goats in the air while the rules are still on screen (see spill.ts).
  if (now < s.startsAt) return;
  if ((s.cooldown[from] ?? 0) > now) return;

  const seed = s.nextSeed++;
  const goat: Goat = {
    goatId: `${s.roundId}-${s.nextGoat++}`,
    victim: to,
    from,
    kind: 'adult',
    // Where it crosses the fence. Derived from the seed rather than random, so
    // a replayed state puts every goat back exactly where it was.
    lane: laneFrom(seed),
    launchedAt: now,
    arrivesAt: now + SIEGE_ADULT_FLIGHT_MS,
    seed,
  };

  s.air[goat.goatId] = goat;
  s.cooldown[from] = now + SIEGE_LOB_COOLDOWN_MS;

  ctx.broadcast({ t: 'goat', s: ctx.nextSeq(), d: goat });
  await ctx.save(s);
  await ctx.setAlarm(nextDeadline(s));
}

/**
 * Tap an incoming goat. Shooing an adult is not a clean save: it becomes two
 * kids scattering, each needing its own tap (spec §3). Kids do not split again.
 */
export async function onShoo(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  goatId: string,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running' || s.roundId !== roundId) return;

  const goat = s.air[goatId];
  if (!goat || goat.victim !== playerId) return;

  const now = ctx.now();
  // Only inside its flight window: a shoo that lands after the chomp is too
  // late, and the first tap by corrected time is the one that counts.
  if (now >= goat.arrivesAt) return;

  delete s.air[goatId];

  if (goat.kind === 'kid') {
    // A shooed kid is simply gone — the one unambiguously good outcome.
    ctx.broadcast({ t: 'split', s: ctx.nextSeq(), d: { goatId, by: playerId, kids: [] } });
    await ctx.save(s);
    await ctx.setAlarm(nextDeadline(s));
    return;
  }

  const lanes = splitLanes(goat.seed, goat.lane, SIEGE_KIDS_PER_SPLIT);
  const kids: Goat[] = lanes.map((lane, i) => ({
    goatId: `${goat.goatId}k${i}`,
    victim: goat.victim,
    from: null,
    kind: 'kid',
    lane,
    launchedAt: now,
    arrivesAt: now + SIEGE_KID_FLIGHT_MS,
    seed: goat.seed * 31 + i,
  }));
  for (const kid of kids) s.air[kid.goatId] = kid;

  ctx.broadcast({ t: 'split', s: ctx.nextSeq(), d: { goatId, by: playerId, kids } });
  await ctx.save(s);
  await ctx.setAlarm(nextDeadline(s));
}

/** Land everything that has arrived. Returns true when the round is over. */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return false;

  const now = ctx.now();

  for (const goat of Object.values(s.air)) {
    if (goat.arrivesAt > now) continue;
    delete s.air[goat.goatId];
    // A patch with nobody left to defend it stops being a target.
    if (s.out.includes(goat.victim)) continue;

    s.cabbages[goat.victim] = Math.max(0, (s.cabbages[goat.victim] ?? 0) - 1);
    if (s.cabbages[goat.victim] === 0 && !s.out.includes(goat.victim)) {
      s.out.push(goat.victim);
    }
    ctx.broadcast({
      t: 'chomp',
      s: ctx.nextSeq(),
      d: { goatId: goat.goatId, victim: goat.victim, cabbages: s.cabbages, out: s.out },
    });
  }

  const left = standing(s);
  if (lastStanding(left.length, s.solo)) {
    await finish(ctx, s, left[0] ?? null);
    return true;
  }
  if (now >= s.endsAt) {
    await finish(ctx, s, leader(s));
    return true;
  }

  await ctx.save(s);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

/** A player vanished: their patch stops receiving, and in-flight goats die. */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return;
  if (!s.players.includes(playerId) || s.out.includes(playerId)) return;

  s.out.push(playerId);
  for (const [id, goat] of Object.entries(s.air)) {
    if (goat.victim === playerId) delete s.air[id];
  }

  const left = standing(s);
  if (lastStanding(left.length, s.solo)) {
    await finish(ctx, s, left[0] ?? null);
    return;
  }

  broadcastState(ctx, s);
  await ctx.save(s);
  await ctx.setAlarm(nextDeadline(s));
}

/** Most cabbages left when the clock runs out. */
function leader(s: Siege): PlayerId | null {
  const left = standing(s);
  if (left.length === 0) return null;
  return left.reduce((a, b) => ((s.cabbages[a] ?? 0) >= (s.cabbages[b] ?? 0) ? a : b));
}

async function finish(ctx: Ctx, s: Siege, winnerId: PlayerId | null): Promise<void> {
  s.phase = 'done';
  s.air = {};
  await ctx.save(s);
  ctx.broadcast({
    t: 'siege-over',
    s: ctx.nextSeq(),
    d: { roundId: s.roundId, winnerId, cabbages: s.cabbages },
  });
}

export function nextDeadline(s: Siege): number {
  let at = s.endsAt;
  for (const g of Object.values(s.air)) at = Math.min(at, g.arrivesAt);
  return at;
}

/** Spread lobs across the patch without a random source. */
function laneFrom(seed: number): number {
  // Golden-ratio stepping: successive seeds land far apart rather than walking
  // predictably left to right.
  return (seed * 0.6180339887) % 1;
}
