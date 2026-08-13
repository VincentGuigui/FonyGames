import {
  nextDeadline,
  onPlayerGone,
  onSteadyTick,
  onWobble,
  startSteady,
  toleranceAt,
  type Ctx,
  type Steady,
} from './steadyHand';
import {
  STEADY_GRACE_MS,
  STEADY_LIVES,
  STEADY_PARKED_MS,
  STEADY_SETTLE_MS,
  STEADY_TICK_MS,
  TIGHTEN_EVERY_MS,
  WOBBLE_FLOOR,
  WOBBLE_START,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';

/**
 * Steady Hand's referee.
 * Spec: docs/specs/games/steady-hand.md
 *
 * Three rules here are invisible until they break in a room full of people, and each
 * has a section of its own below: the tolerance has to close in or the round never
 * ends, a flinch must cost exactly one life rather than all three, and going quiet
 * has to be fatal or the winning move is closing the tab.
 */

let failures = 0;
let checks = 0;

function check(what: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${what}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${what}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

const A = 'a' as PlayerId;
const B = 'b' as PlayerId;
const C = 'c' as PlayerId;

/** A referee harness with a clock we drive by hand. */
function harness(at = 1_000_000) {
  let now = at;
  let seq = 0;
  let stored: Steady | null = null;
  const sent: ServerMessage[] = [];
  let alarm = 0;

  const ctx: Ctx = {
    now: () => now,
    nextSeq: () => ++seq,
    broadcast: (m) => sent.push(m),
    load: async () => stored,
    save: async (s) => {
      stored = s;
    },
    setAlarm: async (a) => {
      alarm = a;
    },
  };

  return {
    ctx,
    sent,
    get state() {
      return stored;
    },
    get alarm() {
      return alarm;
    },
    advance: (ms: number) => {
      now += ms;
    },
    get now() {
      return now;
    },
    last: (t: string) => [...sent].reverse().find((m) => m.t === t),
    count: (t: string) => sent.filter((m) => m.t === t).length,
  };
}

console.log('\nstarting a round');

{
  const h = harness();
  const ok = await startSteady(h.ctx, 1, [A, B, C]);
  check('three players is a game', ok === true);
  check('everyone starts with all their lives', h.state?.players[A]?.lives === STEADY_LIVES);
  check('counting starts after the settle window', h.state?.startsAt === h.now + STEADY_SETTLE_MS);
  check('a state frame went out', h.count('steady') === 1);
  check('the alarm is the tick, not the cap', h.alarm === h.now + STEADY_TICK_MS);

  const solo = harness();
  check('one player is not a game', (await startSteady(solo.ctx, 1, [A])) === false);
}

/*
 * THE termination rule (spec §2.2). A phone that is not moving never wobbles, so
 * without a closing tolerance two careful players stand there until the cap.
 */
console.log('\nthe tolerance closes in');

{
  const h = harness();
  await startSteady(h.ctx, 1, [A, B, C]);
  const s = h.state as Steady;

  check('it starts forgiving', toleranceAt(s, s.startsAt) === WOBBLE_START);
  const afterOne = toleranceAt(s, s.startsAt + TIGHTEN_EVERY_MS);
  check('one step in, it is tighter', afterOne < WOBBLE_START, afterOne);
  const afterTen = toleranceAt(s, s.startsAt + 10 * TIGHTEN_EVERY_MS);
  check('ten steps in, it is at the floor', Math.abs(afterTen - WOBBLE_FLOOR) < 1e-9, afterTen);
  const afterHundred = toleranceAt(s, s.startsAt + 100 * TIGHTEN_EVERY_MS);
  check('and it never goes below the floor', afterHundred === WOBBLE_FLOOR, afterHundred);
  // Computed from the clock, so a late alarm cannot skip a step or double-apply one.
  check(
    'it is a function of time, not of how often it was asked',
    toleranceAt(s, s.startsAt + 3 * TIGHTEN_EVERY_MS) ===
      toleranceAt(s, s.startsAt + 3 * TIGHTEN_EVERY_MS),
  );
}

console.log('\nholding still costs nothing');

{
  const h = harness();
  await startSteady(h.ctx, 1, [A, B, C]);
  h.advance(STEADY_SETTLE_MS + 10);
  await onWobble(h.ctx, A, 1, 0.1, true);
  check('a steady hand keeps its lives', h.state?.players[A]?.lives === STEADY_LIVES);
  check('and nothing was announced', h.count('steady-hit') === 0);
}

console.log('\nnothing counts during the settle window');

{
  const h = harness();
  await startSteady(h.ctx, 1, [A, B, C]);
  h.advance(100);
  await onWobble(h.ctx, A, 1, 99, true);
  check('a wild wobble before the start is free', h.state?.players[A]?.lives === STEADY_LIVES);
}

/*
 * THE grace rule (spec §2.4). Wobble arrives every 200 ms and the flinch is still in
 * progress on the next tick, so without grace one twitch spends all three lives in
 * 600 ms and the whole three-lives mode does nothing.
 */
console.log('\na flinch costs exactly one life');

{
  const h = harness();
  await startSteady(h.ctx, 1, [A, B, C]);
  h.advance(STEADY_SETTLE_MS + 10);

  await onWobble(h.ctx, A, 1, 99, true);
  check('the first over-tolerance tick takes a life', h.state?.players[A]?.lives === STEADY_LIVES - 1);
  check('and says so', h.count('steady-hit') === 1);

  // The same flinch, still in progress, three ticks running.
  h.advance(STEADY_TICK_MS);
  await onWobble(h.ctx, A, 1, 99, true);
  h.advance(STEADY_TICK_MS);
  await onWobble(h.ctx, A, 1, 99, true);
  check(
    'the rest of the same flinch is free',
    h.state?.players[A]?.lives === STEADY_LIVES - 1,
    h.state?.players[A]?.lives,
  );

  // Past the grace window, a fresh flinch costs again.
  h.advance(STEADY_GRACE_MS + 10);
  await onWobble(h.ctx, A, 1, 99, true);
  check('a new flinch costs the next life', h.state?.players[A]?.lives === STEADY_LIVES - 2);
}

console.log('\nthe third life ends your round');

{
  const h = harness();
  await startSteady(h.ctx, 1, [A, B, C]);
  h.advance(STEADY_SETTLE_MS + 10);
  for (let i = 0; i < STEADY_LIVES; i++) {
    await onWobble(h.ctx, A, 1, 99, true);
    h.advance(STEADY_GRACE_MS + 10);
  }
  const out = h.last('steady-out');
  check('eliminated', out !== undefined);
  check('for moving', out?.t === 'steady-out' && out.d.reason === 'moved', out);
  check('and dropped from alive', h.state?.alive.join() === 'b,c', h.state?.alive);
  check('the round is not over — two are left', h.state?.phase === 'running');
}

/*
 * Parked bypasses lives entirely (spec §2.3): it is the one cheat the referee can
 * actually detect, and three free goes at it would make detecting it pointless.
 */
console.log('\nputting the phone down is not a flinch');

{
  const h = harness();
  await startSteady(h.ctx, 1, [A, B, C]);
  h.advance(STEADY_SETTLE_MS + 10);

  await onWobble(h.ctx, A, 1, 0, false);
  check('going flat does not eliminate instantly', h.state?.alive.includes(A) === true);
  check('with all lives intact', h.state?.players[A]?.lives === STEADY_LIVES);

  h.advance(STEADY_PARKED_MS + 10);
  await onWobble(h.ctx, A, 1, 0, false);
  const out = h.last('steady-out');
  check('staying flat eliminates', h.state?.alive.includes(A) === false);
  check('named as parked, not moved', out?.t === 'steady-out' && out.d.reason === 'parked', out);
  check('and it took no lives on the way — it just ended', h.count('steady-hit') === 0);
}

{
  const h = harness();
  await startSteady(h.ctx, 1, [A, B, C]);
  h.advance(STEADY_SETTLE_MS + 10);
  // Passing through flat while picking the phone up must not count.
  await onWobble(h.ctx, A, 1, 0, false);
  h.advance(STEADY_TICK_MS);
  await onWobble(h.ctx, A, 1, 0.2, true);
  h.advance(STEADY_PARKED_MS + 10);
  await onWobble(h.ctx, A, 1, 0.2, true);
  check('picking it back up clears the flat timer', h.state?.alive.includes(A) === true);
}

/*
 * THE tab rule (spec §6). Without it, closing the tab is unbeatable: no events, no
 * wobble, no way to lose.
 */
console.log('\ngoing quiet is fatal');

{
  const h = harness();
  await startSteady(h.ctx, 1, [A, B, C]);
  h.advance(STEADY_SETTLE_MS + 10);
  await onWobble(h.ctx, A, 1, 0.1, true);
  await onWobble(h.ctx, B, 1, 0.1, true);
  await onWobble(h.ctx, C, 1, 0.1, true);

  // A and B keep talking; C's phone goes silent.
  for (let i = 0; i < 4; i++) {
    h.advance(STEADY_TICK_MS);
    await onWobble(h.ctx, A, 1, 0.1, true);
    await onWobble(h.ctx, B, 1, 0.1, true);
  }
  await onSteadyTick(h.ctx);
  check('the silent phone is out', h.state?.alive.includes(C) === false, h.state?.alive);
  const out = h.last('steady-out');
  check('recorded as having left', out?.t === 'steady-out' && out.d.reason === 'left', out);
}

console.log('\nlast one standing wins');

{
  const h = harness();
  await startSteady(h.ctx, 1, [A, B]);
  h.advance(STEADY_SETTLE_MS + 10);
  for (let i = 0; i < STEADY_LIVES; i++) {
    await onWobble(h.ctx, B, 1, 99, true);
    h.advance(STEADY_GRACE_MS + 10);
  }
  const end = h.last('steady-end');
  check('the round ended', end !== undefined);
  check('and A won', end?.t === 'steady-end' && end.d.winner === A, end);
  check('phase is done', h.state?.phase === 'done');
  check('survival times are reported', end?.t === 'steady-end' && Object.keys(end.d.times).length === 2);
}

console.log('\nthe cap goes to the steadiest average');

{
  const h = harness();
  await startSteady(h.ctx, 1, [A, B]);
  h.advance(STEADY_SETTLE_MS + 10);
  // Both survive; B is consistently shakier but never over the tolerance.
  for (let i = 0; i < 5; i++) {
    await onWobble(h.ctx, A, 1, 0.05, true);
    await onWobble(h.ctx, B, 1, 0.9, true);
    h.advance(STEADY_TICK_MS);
  }
  // Jump past the cap and tick.
  h.advance(3 * 60_000);
  await onWobble(h.ctx, A, 1, 0.05, true);
  await onWobble(h.ctx, B, 1, 0.9, true);
  await onSteadyTick(h.ctx);
  const end = h.last('steady-end');
  check('the round ended at the cap', end !== undefined);
  check('the steadier player won', end?.t === 'steady-end' && end.d.winner === A, end);
}

console.log('\nframes from another round are ignored');

{
  const h = harness();
  await startSteady(h.ctx, 1, [A, B, C]);
  h.advance(STEADY_SETTLE_MS + 10);
  await onWobble(h.ctx, A, 7, 99, true);
  check('a wobble for round 7 does nothing to round 1', h.state?.players[A]?.lives === STEADY_LIVES);
}

console.log('\nhostile input');

{
  const h = harness();
  await startSteady(h.ctx, 1, [A, B, C]);
  h.advance(STEADY_SETTLE_MS + 10);
  // NaN would sail under every comparison and make a client unbeatable.
  await onWobble(h.ctx, A, 1, Number.NaN, true);
  check('NaN is treated as the worst case, not as zero', h.state?.players[A]?.lives === STEADY_LIVES - 1);

  h.advance(STEADY_GRACE_MS + 10);
  await onWobble(h.ctx, B, 1, -5, true);
  check('a negative wobble is too', h.state?.players[B]?.lives === STEADY_LIVES - 1);

  // A player who is not in the round cannot affect it.
  const before = JSON.stringify(h.state);
  await onWobble(h.ctx, 'nobody' as PlayerId, 1, 99, true);
  check('an unknown player changes nothing', JSON.stringify(h.state) === before);
}

console.log('\nleaving');

{
  const h = harness();
  await startSteady(h.ctx, 1, [A, B, C]);
  h.advance(STEADY_SETTLE_MS + 10);
  await onPlayerGone(h.ctx, A);
  check('a departure eliminates', h.state?.alive.includes(A) === false);
  await onPlayerGone(h.ctx, B);
  check('and the last departure ends the round', h.state?.phase === 'done');
  const end = h.last('steady-end');
  check('with the survivor as winner', end?.t === 'steady-end' && end.d.winner === C, end);
}

/*
 * The deadline, asked the way Room asks it.
 *
 * Room owns one alarm slot for every game, so its handler compares `Date.now()` against
 * each game's deadline to find out which of them it was woken for. That makes the
 * deadline an ABSOLUTE moment, and a deadline derived from the caller's own clock is
 * never due — `now >= now + TICK` is false forever.
 *
 * The first version of this took a `now` and returned `now + STEADY_TICK_MS`, and the
 * test asserted exactly that, so the suite was green while no tick ever fired in a real
 * room: the tolerance never closed in and nobody was ever reaped for going quiet. It
 * still LOOKED like it worked, because eliminations broadcast from `onWobble`. So these
 * checks are written as Room's own expression rather than as the function's shape.
 */
console.log('\nthe deadline is a moment, and it comes round');

{
  const h = harness();
  await startSteady(h.ctx, 1, [A, B, C]);
  const s = h.state as Steady;

  check('it is a tick away, not a tick long', nextDeadline(s) === h.now + STEADY_TICK_MS);
  check('so it is not due yet', !(h.now >= nextDeadline(s)));
  check('and it is what the alarm was set to', h.alarm === nextDeadline(s));

  h.advance(STEADY_TICK_MS);
  check('once the clock reaches it, it IS due', h.now >= nextDeadline(s));
}

{
  // And the cadence continues: each tick has to re-arm, or the round stops after one.
  const h = harness();
  await startSteady(h.ctx, 1, [A, B, C]);

  for (let i = 0; i < 3; i++) {
    h.advance(STEADY_TICK_MS);
    check(`tick ${i + 1} is due`, h.now >= nextDeadline(h.state as Steady));
    await onSteadyTick(h.ctx);
    check(`tick ${i + 1} armed the next one`, h.alarm === h.now + STEADY_TICK_MS);
  }
  check('and every one of them broadcast the room', h.count('steady') === 4);

  const s = h.state as Steady;
  check('the deadline is clamped to the cap', nextDeadline({ ...s, tickAt: s.endsAt + 10 }) === s.endsAt);
}

/*
 * The payoff, driven the way Room drives it rather than by calling the tick by hand:
 * a phone that stops reporting is reaped. This is the check the deadline bug defeated.
 */
console.log('\nsilence, with the alarm driven as Room drives it');

{
  const h = harness();
  await startSteady(h.ctx, 1, [A, B, C]);

  // Past the settle window, with A and B still reporting and C gone quiet.
  for (let t = 0; t < STEADY_SETTLE_MS + 10 * STEADY_TICK_MS; t += STEADY_TICK_MS) {
    h.advance(STEADY_TICK_MS);
    await onWobble(h.ctx, A, 1, 0.01, true);
    await onWobble(h.ctx, B, 1, 0.01, true);
    if (h.now >= nextDeadline(h.state as Steady)) await onSteadyTick(h.ctx);
  }

  check('the quiet phone is out', h.state?.alive.includes(C) === false, h.state?.alive);
  const out = h.last('steady-out');
  check('and the room was told why', out?.t === 'steady-out' && out.d.reason === 'left', out);
  check('the two who kept reporting are still in', h.state?.alive.length === 2);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
