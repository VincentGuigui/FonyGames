import {
  NEON_BOLT_MS,
  NEON_BOUNCE_MS,
  NEON_LANE_COOLDOWN_MS,
  NEON_LANES,
  NEON_LIVES,
  NEON_MAX_BOLTS,
  NEON_ROUND_CAP_MS,
  NEON_STEER_DEADZONE,
  NEON_TICK_MS,
  PREROUND_MS,
  type ServerMessage,
} from '../shared/protocol';
import { nextDeadline, onPlayerGone, onShoot, onSteer, startNeon, tick, type Ctx, type NeonFall } from './neonFall';

/**
 * Neon Fall's referee.
 * Spec: docs/specs/games/neon-fall.md
 *
 * Three rules carry the whole game, and each fails silently if it is wrong:
 *
 * 1. **The glider's phone never dictates a position.** It reports a steer intent;
 *    the referee is the only thing that ever moves `lane`.
 * 2. **A hit is decided against the referee's own lane**, at the moment a bolt's
 *    flight time elapses — not against whatever either client claims.
 * 3. **A hit during the bounce's invulnerability window is impossible**, and a
 *    round ends the instant lives or the floor say it should, not on the next tick.
 */

let failures = 0;
let checks = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  checks++;
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

const A = 'p-a';
const B = 'p-b';
const C = 'p-c';

/** A fixed sequence rather than true randomness, so a bounce's landing lane is reproducible. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 4_294_967_296;
  };
}

function harness() {
  let clock = 5_000_000;
  let seq = 0;
  let stored: NeonFall | null = null;
  const sent: ServerMessage[] = [];
  const rand = seeded(7);

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    random: rand,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as NeonFall) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as NeonFall;
    },
    setAlarm: async () => {},
  };

  return {
    ctx,
    sent,
    at: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
    state: () => stored,
    last: () =>
      [...sent].reverse().find((m) => m.t === 'neon') as Extract<ServerMessage, { t: 'neon' }> | undefined,
    clear: () => void (sent.length = 0),
  };
}

/** Start a round, clear the pre-round, and advance past `startsAt` so ticks act. */
async function running(roles?: { glider: string; protector: string }) {
  const h = harness();
  await startNeon(h.ctx, 1, [A, B], roles);
  h.advance(PREROUND_MS + 1);
  h.clear();
  return h;
}

/** Run `tick` exactly `n` times, advancing the clock by one tick each time. */
async function ticks(h: ReturnType<typeof harness>, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    h.advance(NEON_TICK_MS);
    await tick(h.ctx);
  }
}

/* ---------------------------------------------------------------- */

async function seating(): Promise<void> {
  console.log('\nseating and roles');
  const h = harness();

  check('2 is allowed', await startNeon(h.ctx, 1, [A, B]));
  check('1 player is refused', !(await startNeon(harness().ctx, 1, [A])));
  check('3 players is refused — this game is exactly 2', !(await startNeon(harness().ctx, 1, [A, B, C])));

  const solo = harness();
  check('solo test mode allows one', await startNeon(solo.ctx, 1, [A], undefined, true));

  const s = h.state()!;
  check('roles were filled: a glider', s.gliderId === A);
  check('and a protector', s.protectorId === B);
  check('lives start at the pitch\'s three', s.lives === NEON_LIVES);
  check('every lane starts ready', s.laneReadyAt.every((t) => t === 0), s.laneReadyAt);
  check('nothing has fallen yet', s.y === 0);
  check('starts centred', s.lane === (NEON_LANES - 1) / 2);
}

async function roleChoice(): Promise<void> {
  console.log('\nthe host\'s seat picks');
  const chosen = harness();
  await startNeon(chosen.ctx, 1, [A, B], { glider: B, protector: A });
  const s = chosen.state()!;
  check('an explicit, valid choice is honoured', s.gliderId === B && s.protectorId === A);

  const invalid = harness();
  await startNeon(invalid.ctx, 1, [A, B], { glider: A, protector: A });
  check(
    'the same player twice falls back to array order',
    invalid.state()!.gliderId === A && invalid.state()!.protectorId === B,
  );

  const missing = harness();
  await startNeon(missing.ctx, 1, [A, B]);
  check('no choice at all falls back the same way', missing.state()!.gliderId === A && missing.state()!.protectorId === B);
}

async function steering(): Promise<void> {
  console.log('\nsteering never moves the lane by itself');
  const h = await running();

  await onSteer(h.ctx, A, 1, 1);
  check('the intent is stored', h.state()!.steer === 1);
  check('but the lane has not moved yet', h.state()!.lane === (NEON_LANES - 1) / 2);
  check('nothing was broadcast for a steer alone', h.sent.length === 0);

  await ticks(h, 1);
  check('one tick later the lane has drifted', h.state()!.lane > (NEON_LANES - 1) / 2);

  await onSteer(h.ctx, B, 1, 1);
  check('the protector cannot steer', h.state()!.steer === 1); // unchanged from A's own value

  await onSteer(h.ctx, A, 1, 2);
  check('an out-of-range steer is clamped', h.state()!.steer === 1);
}

async function falling(): Promise<void> {
  console.log('\nthe fall itself');
  const h = await running();

  await ticks(h, 20);
  const s = h.state()!;
  check('y has advanced', s.y > 0, s.y);
  check('and never exceeds the floor', s.y <= 1);

  const frame = h.last()!;
  check('the broadcast carries both roles', frame.d.gliderId === A && frame.d.protectorId === B);
  check('and the fall progress', typeof frame.d.y === 'number');
}

async function shooting(): Promise<void> {
  console.log('\nevery lane cools down on its own, no shared ammo');
  const h = await running();

  await onShoot(h.ctx, B, 1, 2);
  check('lane 2 is now cooling down', h.state()!.laneReadyAt[2]! > h.at());
  check('the other lanes are untouched', h.state()!.laneReadyAt[0] === 0 && h.state()!.laneReadyAt[1] === 0);

  const beforeSameLane = h.state()!.bolts.length;
  await onShoot(h.ctx, B, 1, 2);
  check('the same lane is refused while it is still cooling down', h.state()!.bolts.length === beforeSameLane);

  await onShoot(h.ctx, B, 1, 0);
  check('a different lane fires immediately — no shared pool to deplete', h.state()!.bolts.length === beforeSameLane + 1);

  const spent = h.state()!.laneReadyAt[2];
  await onShoot(h.ctx, A, 1, 1);
  check('the glider cannot fire the protector\'s trigger', h.state()!.laneReadyAt[2] === spent && h.state()!.bolts.length === beforeSameLane + 1);

  h.advance(NEON_LANE_COOLDOWN_MS + 1);
  await onShoot(h.ctx, B, 1, 2);
  check('lane 2 fires again once its own cooldown elapses', h.state()!.bolts.length === beforeSameLane + 2);

  const shot = h.last();
  check('a shot is telegraphed the instant it fires, not on the next tick', shot?.t === 'neon');
}

async function bringingItAllInFlight(): Promise<void> {
  console.log('\nthe real limiter now: how many bolts may share the sky');
  const h = await running();

  // Every lane has its own cooldown, so NEON_MAX_BOLTS lanes can all fire back
  // to back with nothing standing in the way but the shared cap.
  for (let lane = 0; lane < NEON_MAX_BOLTS; lane++) await onShoot(h.ctx, B, 1, lane);
  check(`${NEON_MAX_BOLTS} lanes filled the sky`, h.state()!.bolts.length === NEON_MAX_BOLTS);

  const before = h.state()!.bolts.length;
  await onShoot(h.ctx, B, 1, NEON_MAX_BOLTS); // a lane that has never fired, still ready
  check('a fresh, ready lane is refused once the cap is reached', h.state()!.bolts.length === before);

  h.advance(NEON_BOLT_MS + 10);
  await tick(h.ctx); // the in-flight bolts resolve and clear
  check('the sky is clear again', h.state()!.bolts.length === 0);

  await onShoot(h.ctx, B, 1, NEON_MAX_BOLTS);
  check('and a shot is accepted again', h.state()!.bolts.length === 1);
}

async function hitting(): Promise<void> {
  console.log('\na hit: server-decided, against the server\'s own lane');
  const h = await running();

  // Park the glider dead centre — lane 2 of 0..4 — and shoot lane 2.
  await onShoot(h.ctx, B, 1, 2);
  h.advance(NEON_BOLT_MS - 10);
  await tick(h.ctx);
  check('not resolved yet: still in flight', h.state()!.lives === NEON_LIVES && h.state()!.bolts.length === 1);

  h.advance(20);
  await tick(h.ctx);
  check('the bolt resolves and costs a life', h.state()!.lives === NEON_LIVES - 1);
  check('the bolt is gone either way', h.state()!.bolts.length === 0);
  check('a bounce began', h.state()!.bounceUntil > h.at());

  h.advance(NEON_BOUNCE_MS + NEON_TICK_MS);
  await tick(h.ctx);
  check('the bounce ends on schedule', h.state()!.bounceUntil <= h.at());
}

async function juking(): Promise<void> {
  console.log('\na lane changed in time is a miss');
  const h = await running();

  await onShoot(h.ctx, B, 1, 2); // fired at the centre lane the glider starts on
  await onSteer(h.ctx, A, 1, -1); // and immediately steers hard away
  await ticks(h, Math.ceil(NEON_BOLT_MS / NEON_TICK_MS) + 1);

  check('the glider actually moved off the shot lane', Math.round(h.state()!.lane) !== 2);
  check('and the bolt missed', h.state()!.lives === NEON_LIVES);
}

async function invulnerability(): Promise<void> {
  console.log('\nno second hit during the bounce');
  const h = await running();

  await onShoot(h.ctx, B, 1, 2);
  h.advance(NEON_BOLT_MS + 10);
  await tick(h.ctx);
  const afterFirst = h.state()!.lives;
  check('the first hit landed', afterFirst === NEON_LIVES - 1);

  // Fire at whatever lane the bounce landed the glider on — it should still be
  // untouchable for the rest of the bounce window. Only enough of a wait to
  // clear lane 2's own cooldown from the first shot, not so much that this
  // second bolt would resolve after the bounce itself has already ended.
  h.advance(NEON_LANE_COOLDOWN_MS - (NEON_BOLT_MS + 10) + 1);
  const landedLane = Math.round(h.state()!.lane);
  await onShoot(h.ctx, B, 1, landedLane);
  h.advance(NEON_BOLT_MS + 10);
  await tick(h.ctx);
  check(
    'a bolt resolving during the bounce cannot land',
    h.state()!.lives === afterFirst,
    { lives: h.state()!.lives, bounceUntil: h.state()!.bounceUntil, now: h.at() },
  );
}

async function winningByFloor(): Promise<void> {
  console.log('\nreaching the floor wins it for the glider');
  const h = await running();

  // Advance well past a hitless fall's whole duration.
  await ticks(h, Math.ceil(1_100_000 / NEON_TICK_MS));

  check('the glider reached the floor', h.state()!.y >= 1);
  check('and won', h.state()!.winner === A);
  check('the round reports done', h.state()!.phase === 'done');

  const sentBefore = h.sent.length;
  await onSteer(h.ctx, A, 1, 1);
  await tick(h.ctx);
  check('nothing moves once the round is done', h.sent.length === sentBefore);
}

async function winningByLives(): Promise<void> {
  console.log('\nthree hits, no bounce left, the protector wins');
  const h = await running();

  for (let i = 0; i < NEON_LIVES; i++) {
    const lane = Math.round(h.state()!.lane);
    await onShoot(h.ctx, B, 1, lane);
    h.advance(NEON_BOLT_MS + 10);
    await tick(h.ctx);
    if (h.state()!.phase === 'done') break;
    // Clear the bounce before the next shot, so each of the three lands cleanly.
    h.advance(NEON_BOUNCE_MS + NEON_TICK_MS);
    await tick(h.ctx);
  }

  check('three hits ends it', h.state()!.lives === 0);
  check('the protector wins', h.state()!.winner === B);
  check('the round reports done', h.state()!.phase === 'done');
}

async function safetyCap(): Promise<void> {
  console.log('\nthe defensive cap: the glider survived, the glider wins');
  const h = await running();

  h.advance(NEON_ROUND_CAP_MS + NEON_TICK_MS);
  const ended = await tick(h.ctx);

  check('the cap ends the round', ended);
  check('the glider wins for having survived it', h.state()!.winner === A);

  const fresh = await running();
  check('nextDeadline never exceeds the cap', nextDeadline(fresh.state()!) <= fresh.state()!.endsAt);
}

async function playerGone(): Promise<void> {
  console.log('\neither seat leaving ends it for the other');
  const gliderLeft = await running();
  await onPlayerGone(gliderLeft.ctx, A);
  check('the glider leaving hands it to the protector', gliderLeft.state()!.winner === B);
  check('and the round is done', gliderLeft.state()!.phase === 'done');

  const protectorLeft = await running();
  await onPlayerGone(protectorLeft.ctx, B);
  check('the protector leaving hands it to the glider', protectorLeft.state()!.winner === A);

  const bystander = await running();
  await onPlayerGone(bystander.ctx, C);
  check('a stranger leaving does nothing — there is no third seat', bystander.state()!.phase === 'running');
}

async function magnetism(): Promise<void> {
  console.log('\nan idle glider settles into the closest lane');
  const h = await running();

  // A single tick's nudge, short of the next lane's own halfway point.
  await onSteer(h.ctx, A, 1, 1);
  await ticks(h, 1);
  const nudged = h.state()!.lane;
  check('a brief tilt moved it off centre, short of the next lane', nudged > 2 && nudged < 2.5, nudged);

  await onSteer(h.ctx, A, 1, 0);
  await ticks(h, 40); // plenty of time for the spring to settle
  check('with no more tilt, it drifted back to the lane it started in', Math.abs(h.state()!.lane - 2) < 0.01, h.state()!.lane);

  // A deliberate, sustained tilt must still be able to cross into the next
  // lane — the magnet pulling it back toward lane 2 must not be able to trap
  // it there once the tilt actively opposes that pull.
  await onSteer(h.ctx, A, 1, 1);
  await ticks(h, 5);
  check('a held tilt still crosses past the halfway point', h.state()!.lane > 2.5, h.state()!.lane);

  // A steer too small to count as "pulling the other way" must not cancel the
  // magnet outright — it still nudges the lane a little on its own (that part
  // of steer is unconditional), but the magnet keeps fighting it the whole
  // time rather than switching off, so it settles near its lane rather than
  // drifting all the way to the next one.
  const settled = await running();
  await onSteer(settled.ctx, A, 1, 0.05);
  check('a steer inside the deadzone is not enough to fight the magnet', 0.05 < NEON_STEER_DEADZONE);
  await ticks(settled, 40);
  check('the glider settles near its own lane, not the next one', Math.abs(settled.state()!.lane - 2) < 0.2, settled.state()!.lane);
}

async function cheating(): Promise<void> {
  console.log('\nstale rounds and out-of-range input');
  const h = await running();

  await onSteer(h.ctx, A, 99, 1);
  check('a stale roundId is ignored for steering', h.state()!.steer === 0);

  await onShoot(h.ctx, B, 99, 0);
  check('and for shooting', h.state()!.bolts.length === 0);

  await onShoot(h.ctx, B, 1, -1);
  await onShoot(h.ctx, B, 1, NEON_LANES);
  await onShoot(h.ctx, B, 1, 1.5);
  check('out-of-range and non-integer lanes are ignored', h.state()!.bolts.length === 0);
}

for (const t of [
  seating,
  roleChoice,
  steering,
  falling,
  shooting,
  bringingItAllInFlight,
  hitting,
  juking,
  invulnerability,
  magnetism,
  winningByFloor,
  winningByLives,
  safetyCap,
  playerGone,
  cheating,
]) {
  await t();
}

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
