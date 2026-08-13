import { applySteady, isAlive, meterFill, type SteadyState } from './game';
import { detectSteady, isHeld } from '../../core/sensors/steady';
import { STEADY_HOLD_CONE_DEG, type PlayerId, type ServerMessage } from '../../../../shared/protocol';

/**
 * The phone's half of Steady Hand.
 * Spec: docs/specs/games/steady-hand.md
 *
 * Two things are worth asserting rather than eyeballing: the frame ordering, for the
 * same reason as every other game (a late frame must not give back a spent life), and
 * `isHeld`, because that boundary is what eliminates people and "is the phone flat"
 * is not obvious from three axes.
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

const steady = (s: number, over: Partial<{ tolerance: number; alive: PlayerId[] }> = {}): ServerMessage => ({
  t: 'steady',
  s,
  d: {
    roundId: 1,
    tolerance: over.tolerance ?? 1.2,
    startsAt: 1000,
    endsAt: 121000,
    alive: over.alive ?? [A, B],
    lives: { a: 3, b: 3 },
    w: { a: 0.1, b: 0.2 },
  },
});

console.log('\nthe first frame opens the round');

let st: SteadyState = applySteady(null, steady(1), 0);
check('tolerance arrives', st?.tolerance === 1.2);
check('everyone is alive', st?.alive.length === 2);
check('with all their lives', st?.lives['a'] === 3);
check('running', st?.phase === 'running');
check('nothing has happened yet', st?.lastHit === null && st?.lastOut === null);

console.log('\nthe tolerance closes in as frames arrive');

st = applySteady(st, steady(2, { tolerance: 0.96 }), 100);
check('and the view follows it', st?.tolerance === 0.96);

console.log('\na late frame must not undo anything');

{
  const before = st;
  st = applySteady(st, steady(1, { tolerance: 1.2 }), 200);
  check('lower seq is ignored', st?.tolerance === 0.96);
  check('and the object is untouched, so no re-render', st === before);
}

console.log('\nlosing a life');

st = applySteady(st, { t: 'steady-hit', s: 3, d: { roundId: 1, victim: A, lives: 2, graceUntil: 900 } }, 300);
check('the life is gone', st?.lives['a'] === 2);
check('and the moment is stamped for the flash', st?.lastHit?.at === 300);
check('naming who', st?.lastHit?.victim === A);

{
  // A late hit frame would give back a life that has already been spent.
  const before = st;
  st = applySteady(st, { t: 'steady-hit', s: 2, d: { roundId: 1, victim: A, lives: 9, graceUntil: 0 } }, 400);
  check('a stale hit cannot restore a life', st?.lives['a'] === 2, st?.lives);
  check('nor cause a render', st === before);
}

console.log('\ngoing out, and why');

st = applySteady(st, { t: 'steady-out', s: 4, d: { roundId: 1, victim: A, reason: 'parked', alive: [B] } }, 500);
check('dropped from alive', st?.alive.join() === 'b', st?.alive);
check('lives zeroed', st?.lives['a'] === 0);
check('the reason is carried, not guessed', st?.lastOut?.reason === 'parked');
check('and A knows they are out', !isAlive(st, A));
check('while B is still in', isAlive(st, B));

console.log('\nthe round ends when the server says so');

st = applySteady(st, { t: 'steady-end', s: 5, d: { roundId: 1, winner: B, times: { a: 4000, b: 9000 } } }, 600);
check('over', st?.phase === 'over');
check('with a winner', st?.winner === B);
check('and survival times', st?.times['b'] === 9000);

console.log('\na new round wipes the last one');

{
  const next = applySteady(st, { ...steady(1), d: { ...steady(1).d, roundId: 2 } } as ServerMessage, 700);
  check('accepted even though its seq restarts low', next?.roundId === 2);
  check('running again', next?.phase === 'running');
  check('no stale explosion', next?.lastOut === null && next?.lastHit === null);
  check('no stale winner', next?.winner === null);

  const before = next;
  const straggler = applySteady(next, steady(9), 800);
  check('and a frame from the finished round is dropped', straggler === before);
}

console.log('\nthe meter');

check('empty at rest', meterFill(0, 1.2) === 0);
check('half way', Math.abs(meterFill(0.6, 1.2) - 0.5) < 1e-9);
check('full at the limit', meterFill(1.2, 1.2) === 1);
// Past the limit the number stops meaning anything, and a bar overflowing its track
// reads as a rendering bug at the worst possible moment.
check('clamped past the limit', meterFill(99, 1.2) === 1);
check('a nonsense reading pins it rather than emptying it', meterFill(Number.NaN, 1.2) === 1);
check('and a zero tolerance cannot divide by zero', meterFill(1, 0) === 0);

/*
 * The held check. This is the rule that eliminates people for "phone put down", so the
 * boundary matters more than the happy path. With the screen facing the player, gravity
 * runs down the device Y axis; flat on a table it is almost all on Z.
 */
console.log('\nheld up, or put down');

check('upright, screen facing you', isHeld(0, -9.81, 0) === true);
check('tilted back a little, still held', isHeld(0, -9.2, -3.4) === true);
check('flat on its back on a table', isHeld(0, 0, 9.81) === false);
check('flat on its face', isHeld(0, 0, -9.81) === false);
check('leaning past the cone counts as down', isHeld(0, -3.4, 9.2) === false);
check('on its side but upright is still held', isHeld(-9.81, 0, 0) === true);
// A warming-up sensor reports zeros, and nobody should be eliminated for that.
check('a zero vector is not an accusation', isHeld(0, 0, 0) === true);
check('the cone is configurable for a future wide mode', isHeld(0, -5, 8, 60) === false);
check('and the default matches the protocol', STEADY_HOLD_CONE_DEG === 35);

/*
 * The detector's windowing, and the loophole inside it.
 *
 * A window with no samples has a wobble of zero, which is indistinguishable from a
 * flawless hold — and reporting it refreshes the referee's `lastSeen`, so the silence
 * rule can never fire and turning the sensor off becomes a winning move. That is why
 * `samples` exists: the caller has to be able to tell "still" from "nothing to say".
 *
 * There is no DOM here, so `window` is stubbed. `steady.ts` touches it only inside
 * `detectSteady`, never at import time, so setting it up now is enough.
 */
console.log('\nthe detector reports what it measured, and only that');

{
  type Listener = (e: { accelerationIncludingGravity: { x: number; y: number; z: number } }) => void;
  let listener: Listener | null = null;
  const stub = {
    addEventListener: (t: string, fn: Listener) => {
      if (t === 'devicemotion') listener = fn;
    },
    removeEventListener: () => {
      listener = null;
    },
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g['window'] = stub;
  g['document'] = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
  g['performance'] = g['performance'] ?? { now: () => 0 };

  const feed = (x: number, y: number, z: number): void =>
    listener?.({ accelerationIncludingGravity: { x, y, z } });

  const det = detectSteady();

  const empty = det.read();
  check('an untouched window reports no samples', empty.samples === 0);
  // The trap: this zero is what a dead sensor looks like, and it must not be sendable.
  check('and its wobble is zero, which is exactly the problem', empty.w === 0);

  feed(0, -9.81, 0);
  const first = det.read();
  check('one sample counts as a reading', first.samples === 1);
  check('with nothing to compare against yet', first.w === 0);

  feed(0, -9.81, 0);
  feed(0, -9.81, 0);
  const held = det.read();
  check('a still hand reads near zero', held.w < 1e-9, held.w);
  check('but it is a reading, not a silence', held.samples === 2);

  feed(0, -9.81, 0);
  feed(3, -9.81, 0);
  feed(0, -9.81, 0);
  const moved = det.read();
  check('the worst jolt in the window is what survives', Math.abs(moved.w - 3) < 1e-9, moved.w);
  check('a mean would have buried it', moved.w > 1);
  check('and every sample was counted', moved.samples === 3);

  const after = det.read();
  check('reading empties the window', after.w === 0 && after.samples === 0);

  feed(0, 0, 9.81);
  check('a phone laid flat is reported as such', det.read().held === false);

  det.stop();
  feed(9, 9, 9);
  check('and nothing arrives once stopped', det.read().samples === 0);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
