import { bumpCounter, BUMP_THRESHOLD } from './bump';

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
 * The streams below are written the way a sensor delivers them — a magnitude every 16 ms,
 * gravity at rest — so each case is a movement you can picture rather than a number.
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

/** Feed a list of magnitudes, one per sample, and count the knocks. */
function run(magnitudes: number[], from = 1000): number {
  const c = bumpCounter();
  let n = 0;
  magnitudes.forEach((m, i) => {
    if (c.feed(m, from + i * STEP)) n += 1;
  });
  return n;
}

/** `n` samples of a phone doing nothing. */
const still = (n: number): number[] => Array.from({ length: n }, () => G);

/**
 * An arm swinging a phone: a smooth ramp up and back down, well clear of the knock
 * threshold at its peak but taking a tenth of a second to get there.
 */
const swing = (peak: number, samples = 12): number[] =>
  Array.from({ length: samples }, (_, i) => G + peak * Math.sin((Math.PI * i) / (samples - 1)));

/** Contact: the whole spike inside one sample, then ringing down. */
const knock = (peak = 30): number[] => [G + peak, G + peak * 0.5, G + peak * 0.2, G, G];

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
  const shaking = Array.from({ length: 60 }, (_, i) => G + (i % 2 === 0 ? 26 : -26));
  const n = run([...still(20), ...shaking]);
  check('shaking scores at most one, not a stream', n <= 1, n);

  // A slow rise to a huge value — a phone in a car, a lift, a long push — has no edge.
  const ramp = Array.from({ length: 40 }, (_, i) => G + i);
  check('a slow ramp is not a knock', run([...still(20), ...ramp]) === 0);
}

console.log('\ntwo knocks in a row');

{
  const gap = (ms: number): number[] => still(Math.round(ms / STEP));
  // The throttle is 300 ms, and it is also the anti-spam floor.
  check('two knocks 100 ms apart are one', run([...still(20), ...knock(), ...gap(100), ...knock()]) === 1);
  check('two knocks 500 ms apart are two', run([...still(20), ...knock(), ...gap(500), ...knock()]) === 2);
}

console.log('\nthe baseline follows the phone, not the knock');

{
  // Held flat, then upright: gravity reads the same magnitude either way, but a phone in a
  // moving vehicle sits at a different resting value. The baseline has to chase it, or the
  // offset itself reads as a permanent knock.
  const settled = Array.from({ length: 400 }, () => G + 3);
  check('a new resting level stops reading as a spike', run(settled) === 0);
  check('and a knock on top of it still counts',
    run([...settled, ...knock().map((m) => m + 3)]) === 1);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
