import { bumpCounter, BUMP_THRESHOLD, type Axes } from './bump';

/**
 * What counts as a knock.
 * Algorithm: docs/device-capabilities.md §3 · implementation: core/sensors/bump.ts
 *
 * This is the rule Pass the Bomb runs on, and it had no test — which is how it shipped
 * refusing the one gesture the game is named after. The old detector required 150 ms of
 * near-stillness before a spike would count; a phone being *swung* to meet another phone
 * is not still, so the run-up disqualified the knock at the end of it. Both phones had to
 * pass that test within a quarter of a second of each other, so the failure compounded.
 *
 * The streams below are written the way a sensor delivers them — three axes every 16 ms,
 * gravity at rest — so each case is a movement you can picture rather than a number.
 *
 * The second thing it exists for is the direction. A knock across a phone held upright barely
 * moves the magnitude at all (gravity is at right angles to it, and Pythagoras eats the rest),
 * so a detector watching the magnitude refused the gesture the game is actually named after.
 * `sideways` below is that knock, and it is the case that fails against the old rule.
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

const G = 9.81;
const STEP = 16;

/**
 * A phone held upright: gravity down the screen, and any movement written along it.
 *
 * Everything below is expressed as "how much, and along which axis", so the streams stay as
 * readable as the list of magnitudes they used to be while carrying the direction that
 * turned out to matter.
 */
const along = (m: number): Axes => ({ x: 0, y: -m, z: 0 });
/** The same size of movement, across the phone instead — a corner-to-corner tap. */
const across = (m: number): Axes => ({ x: m, y: -G, z: 0 });

/** Feed a stream of samples and count the knocks. */
function run(stream: Axes[], from = 1000): number {
  const c = bumpCounter();
  let n = 0;
  stream.forEach((s, i) => {
    if (c.feed(s, from + i * STEP)) n += 1;
  });
  return n;
}

/** `n` samples of a phone doing nothing. */
const still = (n: number): Axes[] => Array.from({ length: n }, () => along(G));

/**
 * An arm swinging a phone: a smooth ramp up and back down, well clear of the knock
 * threshold at its peak but taking a tenth of a second to get there.
 */
const swing = (peak: number, samples = 12): Axes[] =>
  Array.from({ length: samples }, (_, i) => along(G + peak * Math.sin((Math.PI * i) / (samples - 1))));

/** Contact: the whole spike inside one sample, then ringing down. */
const knock = (peak = 30): Axes[] =>
  [peak, peak * 0.5, peak * 0.2, 0, 0].map((p) => along(G + p));

/** The same contact, arriving across the phone rather than through it. */
const sideways = (peak = 12): Axes[] =>
  [peak, peak * 0.5, peak * 0.2, 0, 0].map((p) => across(p));

console.log('\na knock is a knock');

{
  check('a spike out of stillness counts', run([...still(20), ...knock()]) === 1);
  check('and only once', run([...still(20), ...knock(), ...still(30)]) === 1);
  check('nothing at all counts nothing', run(still(60)) === 0);

  // The threshold is a floor, not a target: a gentle corner tap is a smaller spike than a
  // phone slammed on a table, and the game asks for gentle.
  check('a gentle knock still counts', run([...still(20), ...knock(BUMP_THRESHOLD + 6)]) === 1);
  check('but a nudge does not', run([...still(20), ...knock(BUMP_THRESHOLD - 4)]) === 0);
}

console.log('\na knock from the side is a knock — the second bug this file exists for');

{
  /*
   * 12 m/s² across an upright phone. On the magnitude that is √(9.81² + 12²) − 9.81 = 5.7,
   * under any threshold worth having; measured as the vector moving, it is the 12 it always
   * was. This check is the difference between the two.
   */
  check('a knock across the phone counts', run([...still(20), ...sideways(12)]) === 1);
  check('and a gentle one still does', run([...still(20), ...sideways(BUMP_THRESHOLD + 2)]) === 1);
  check('a nudge across it does not', run([...still(20), ...sideways(BUMP_THRESHOLD - 4)]) === 0);

  // The other direction, for completeness: through the back of the phone, which is the axis
  // nothing about the way it is held ever lines up with gravity.
  const back = [18, 9, 3, 0, 0].map((p) => ({ x: 0, y: -G, z: p }));
  check('and one through the back of it', run([...still(20), ...back]) === 1);
}

console.log('\nthe swing before the knock — the bug this file exists for');

{
  // Peak 8 m/s²: an ordinary arm movement, under the 12 threshold, but far over the
  // half-threshold the old detector treated as "not calm".
  check('a swing on its own is not a knock', run([...still(20), ...swing(8)]) === 0);
  check('and a knock at the END of a swing still counts',
    run([...still(20), ...swing(8), ...knock()]) === 1);
  // Straight from the swing into contact, with no calm sample between them at all: this is
  // what two people actually do, and what used to be refused.
  check('even with no pause between the two',
    run([...still(20), ...swing(8).slice(0, 7), ...knock()]) === 1);
  check('a harder swing does not fool it either',
    run([...still(20), ...swing(11, 14)]) === 0);
}

console.log('\nwaving the phone about is still useless');

{
  // Continuous violent shaking: over the line most of the time, which is the anti-cheat
  // rule from docs/device-capabilities.md §3 — a bump must be a contact, not a shake.
  const shaking = Array.from({ length: 60 }, (_, i) => along(G + (i % 2 === 0 ? 26 : -26)));
  const n = run([...still(20), ...shaking]);
  check('shaking scores at most one, not a stream', n <= 1, n);

  // A slow rise to a huge value — a phone in a car, a lift, a long push — has no edge.
  const ramp = Array.from({ length: 40 }, (_, i) => along(G + i));
  check('a slow ramp is not a knock', run([...still(20), ...ramp]) === 0);
}

console.log('\ntwo knocks in a row');

{
  const gap = (ms: number): Axes[] => still(Math.round(ms / STEP));
  // The throttle is 300 ms, and it is also the anti-spam floor.
  check('two knocks 100 ms apart are one', run([...still(20), ...knock(), ...gap(100), ...knock()]) === 1);
  check('two knocks 500 ms apart are two', run([...still(20), ...knock(), ...gap(500), ...knock()]) === 2);
}

console.log('\nthe baseline follows the phone, not the knock');

{
  // A phone in a moving vehicle sits at a different resting value. The baseline has to chase
  // it, or the offset itself reads as a permanent knock.
  const settled = Array.from({ length: 400 }, () => along(G + 3));
  check('a new resting level stops reading as a spike', run(settled) === 0);
  check('and a knock on top of it still counts',
    run([...settled, ...knock().map((s) => ({ ...s, y: s.y - 3 }))]) === 1);

  /*
   * Turned over mid-round. Flat on a table the vector is (0, 0, 9.81) — as far from upright
   * as two readings of the same size can be, and a full 13.9 apart. The baseline follows it,
   * so putting the phone down is not a stream of knocks, and a knock afterwards still is one.
   */
  const flat = Array.from({ length: 400 }, () => ({ x: 0, y: 0, z: G }));
  check('turning the phone over is not a knock at all', run(flat) === 0, run(flat));
  check('and it still feels a knock afterwards',
    run([...flat, ...[18, 9, 3, 0, 0].map((p) => ({ x: p, y: 0, z: G }))]) === 1);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
