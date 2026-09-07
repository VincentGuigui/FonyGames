import {
  TILT_CLAIM_SLACK,
  TILT_COUNTDOWN_MS,
  TILT_LAPS,
  TILT_MAX_PLAYERS,
  TILT_MIN_PLAYERS,
  TILT_RUN_CAP_MS,
  tiltSpeedAt,
  type PlayerId,
  type ServerMessage,
  type TiltState,
} from '../shared/protocol';
import { rollTrack, type Track } from '../shared/tiltTrack';
import { enoughToStart } from '../shared/players';

/**
 * Tilt Race. Spec: docs/specs/games/tilt-race.md
 *
 * **The referee owns the circuit, the clock and the finishing order. Each phone
 * owns its own position** — it has to, because the driving simulation runs
 * there at 60 fps and streaming it would be a different cost profile entirely
 * (spec §6). What travels up is one arc length, four times a second.
 *
 * That trade is paid for in `onMove`, which clamps a claimed arc length to what
 * the speed curve could actually have covered since the last report. A modified
 * client can still creep, but it cannot teleport, and it cannot cross the line
 * before the curve allows (spec §8).
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md, and driven entirely through `Ctx`.
 */

export type TiltCar = {
  /** Arc length round the current lap, world units. */
  s: number;
  lap: number;
  /** When this phone last reported, on the referee's clock — the clamp is
   *  measured from here, never from the payload's own `at` (spec §8). */
  reportedAt: number;
  finished: boolean;
  /** Left the room. Their progress stays on the board (spec §7). */
  left: boolean;
};

export type TiltRace = {
  roundId: number;
  seed: number;
  track: Track;
  phase: 'countdown' | 'running' | 'done';
  startsAt: number;
  endsAt: number;
  laps: number;
  cars: Record<PlayerId, TiltCar>;
  order: PlayerId[];
  solo: boolean;
  winner: PlayerId | null;
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<TiltRace | null>;
  save(s: TiltRace): Promise<void>;
  setAlarm(at: number): Promise<void>;
  random(): number;
};

/**
 * The next thing this game needs waking for: the green light, then the run cap.
 *
 * Nothing else is on the alarm — the field is broadcast when a report arrives
 * rather than on a timer, because a report is already four times a second and a
 * second clock would just be a second thing to keep in step.
 */
export function nextDeadline(s: TiltRace): number {
  if (s.phase === 'done') return Infinity;
  return s.phase === 'countdown' ? s.startsAt : s.endsAt;
}

/**
 * A circuit that is known to roll cleanly, for the case where the roller
 * cannot produce one — the same shape as Gravity Shooter's committed fallback
 * board. Rolled from a fixed seed rather than written out by hand, so it is
 * always a circuit this exact code produces.
 */
function fallbackTrack(): Track {
  let h = 20260907;
  const random = (): number => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 4294967296;
  };
  // Retried rather than trusted: this is the path taken when rolling has
  // already failed, so it must not be able to fail the same way.
  for (let i = 0; i < 40; i++) {
    const t = rollTrack(random);
    if (t) return t;
  }
  // Unreachable in practice; a square is still a circuit.
  const points = [
    { x: 200, y: 200 }, { x: 800, y: 200 }, { x: 800, y: 1200 }, { x: 200, y: 1200 },
  ];
  const cum = [0, 600, 1600, 2200];
  return { points, cum, length: 2800, cells: [] };
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startTiltRace(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [TILT_MIN_PLAYERS, TILT_MAX_PLAYERS], solo)) return false;

  const now = ctx.now();
  const seed = Math.floor(ctx.random() * 0xffffffff);
  let track = rollTrack(ctx.random);
  if (!track) track = fallbackTrack();

  const cars: Record<PlayerId, TiltCar> = {};
  // Everyone starts on the line at zero rather than appearing on their first
  // report — a progress rail with nobody on it reads as broken.
  for (const id of connected) {
    cars[id] = { s: 0, lap: 0, reportedAt: now, finished: false, left: false };
  }

  const s: TiltRace = {
    roundId,
    seed,
    track,
    phase: 'countdown',
    // The countdown is what gets eight phones away together rather than
    // trickling in as each one taps.
    startsAt: now + TILT_COUNTDOWN_MS,
    endsAt: now + TILT_COUNTDOWN_MS + TILT_RUN_CAP_MS,
    laps: TILT_LAPS,
    cars,
    order: [],
    solo: solo || connected.length <= 1,
    winner: null,
  };

  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/**
 * How much total progress the speed curve could have covered between two
 * moments of a run, plus slack.
 *
 * Integrated rather than approximated with "top speed × elapsed", because the
 * first six seconds of a race are the spool and a bound that ignored it would
 * let a phone claim a flying start (spec §2).
 */
export function reachable(fromMs: number, toMs: number): number {
  if (toMs <= fromMs) return 0;
  // 20 ms steps: the spool is 6 s, so this is ~300 steps at worst and exact
  // enough that the slack dwarfs the error.
  const step = 20;
  let covered = 0;
  for (let t = fromMs; t < toMs; t += step) {
    covered += tiltSpeedAt(t + step / 2) * (Math.min(step, toMs - t) / 1000);
  }
  return covered * TILT_CLAIM_SLACK;
}

/** Total progress in world units, for comparing two cars. */
function total(s: TiltRace, car: TiltCar): number {
  return car.lap * s.track.length + car.s;
}

/**
 * One phone's own progress (spec §6).
 *
 * Clamped, not trusted: whatever it claims, it cannot have moved further than
 * the speed curve allows since its last report. A claim past that is pulled
 * back to the bound rather than rejected outright — rejecting it would leave a
 * stuttering phone frozen on the rail, and the bound is already generous.
 */
export async function onMove(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  rawS: unknown,
  rawLap: unknown,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.phase !== 'running') return;
  const car = s.cars[playerId];
  if (!car || car.finished || car.left) return;

  if (typeof rawS !== 'number' || !Number.isFinite(rawS)) return;
  if (typeof rawLap !== 'number' || !Number.isFinite(rawLap)) return;

  const now = ctx.now();
  // Lateral position is the phone's business; the lap counter is not. It may
  // only ever go up, and only by one at a time (spec §8).
  const lap = Math.min(car.lap + 1, Math.max(car.lap, Math.floor(rawLap)));
  const claimed = Math.min(s.track.length, Math.max(0, rawS)) + lap * s.track.length;

  const cap = total(s, car) + reachable(car.reportedAt - s.startsAt, now - s.startsAt);
  const allowed = Math.min(claimed, cap);
  // Never backwards: a car pushed back down the track by a rail still keeps its
  // best progress for the placings, which is what the rail is scored on.
  if (allowed > total(s, car)) {
    car.lap = Math.floor(allowed / s.track.length);
    car.s = allowed - car.lap * s.track.length;
  }
  car.reportedAt = now;
  await ctx.save(s);
  broadcast(ctx, s);
}

/**
 * A phone says it crossed the line.
 *
 * Checked against the same bound as a move: a client cannot report the finish
 * earlier than the speed curve allows. The referee's arrival order is what
 * decides the placings, so a genuinely faster phone with 300 ms of lag still
 * beats a slower one — the lag costs it 300 ms of its own race and nothing else.
 */
export async function onFinish(ctx: Ctx, playerId: PlayerId, roundId: number): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.phase !== 'running') return false;
  const car = s.cars[playerId];
  if (!car || car.finished || car.left) return false;

  const now = ctx.now();
  const needed = s.laps * s.track.length;
  const cap = total(s, car) + reachable(car.reportedAt - s.startsAt, now - s.startsAt);
  if (cap < needed) return false;

  car.finished = true;
  car.lap = s.laps;
  car.s = 0;
  car.reportedAt = now;
  s.order.push(playerId);
  if (s.winner === null) s.winner = playerId;

  // Everybody home, or everybody who still could be: the race is over rather
  // than running to its cap with nobody on the track.
  const racing = Object.values(s.cars).filter((c) => !c.finished && !c.left);
  if (racing.length === 0) {
    await finish(ctx, s);
    return true;
  }
  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

/**
 * The clock. Two things happen on it: the lights go green, and the run cap
 * ends a race nobody finished.
 *
 * Returns true when the race is over.
 */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase === 'done') return false;
  const now = ctx.now();
  if (now < nextDeadline(s)) return false;

  if (s.phase === 'countdown') {
    s.phase = 'running';
    // Every car's clamp starts counting from the green light, not from the tap
    // that opened the countdown.
    for (const car of Object.values(s.cars)) car.reportedAt = s.startsAt;
    await ctx.save(s);
    broadcast(ctx, s);
    await ctx.setAlarm(nextDeadline(s));
    return false;
  }

  await finish(ctx, s);
  return true;
}

/**
 * A player vanished mid-race.
 *
 * Their progress stays on the board and in the placings, marked as left
 * (spec §7) — a race is against the clock as much as against each other, and
 * deleting a rival would rewrite a rail everyone else is reading. If they were
 * the last car still driving, the race ends rather than running to its cap.
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase === 'done') return;
  const car = s.cars[playerId];
  if (!car || car.left) return;
  car.left = true;

  const racing = Object.values(s.cars).filter((c) => !c.finished && !c.left);
  if (racing.length === 0 && s.phase === 'running') {
    await finish(ctx, s);
    return;
  }
  await ctx.save(s);
  broadcast(ctx, s);
}

/**
 * End the race.
 *
 * Anybody who finished is placed by arrival; everybody else is placed by how
 * far they got, so a whole room gets a placing rather than only the winner
 * (spec §2). A solo run has nobody to beat and records no winner.
 */
async function finish(ctx: Ctx, s: TiltRace): Promise<void> {
  const unfinished = Object.entries(s.cars)
    .filter(([id]) => !s.order.includes(id))
    .sort(([, a], [, b]) => total(s, b) - total(s, a))
    .map(([id]) => id);
  s.order = [...s.order, ...unfinished];
  s.phase = 'done';
  if (s.solo) s.winner = null;
  else if (s.winner === null) s.winner = s.order[0] ?? null;
  await ctx.save(s);
  broadcast(ctx, s);
}

/** The race as every phone needs it. */
export function toState(s: TiltRace): TiltState {
  const field: TiltState['field'] = {};
  for (const [id, car] of Object.entries(s.cars)) {
    field[id] = { s: car.s, lap: car.lap, finished: car.finished, left: car.left };
  }
  return {
    roundId: s.roundId,
    seed: s.seed,
    // The whole circuit, every frame. It is ~500 numbers and it never changes
    // during a race, so a phone that joins late or reconnects gets it without
    // a second message type — the same call Gravity Shooter makes about its
    // board, and for the same reason: the track was never secret.
    track: s.track.points.map((p) => ({ x: p.x, y: p.y })),
    lapLength: s.track.length,
    cells: s.track.cells,
    phase: s.phase,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    laps: s.laps,
    field,
    order: [...s.order],
    winner: s.winner,
  };
}

function broadcast(ctx: Ctx, s: TiltRace): void {
  ctx.broadcast({ t: 'tilt', s: ctx.nextSeq(), d: toState(s) });
}
