import { RHINO_SETTLE_RATE } from '../../../../shared/protocol';
import { feed, gravityAngle, newEyes, newSpinner, spinEyes, spins, type Spinner } from './spin';

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, detail === undefined ? '' : detail);
  }
}

/** Turn the phone through `turns` full rotations, through the real sensor path. */
function rotate(s: Spinner, turns: number, steps = 72): Spinner {
  let out = s;
  // From i = 0: the first reading only sets the baseline, so starting at 1
  // would silently throw away one step's worth of sweep.
  for (let i = 0; i <= steps; i++) out = feedAngle(out, (turns * 2 * Math.PI * i) / steps);
  return out;
}

/** `feed` takes sensor angles; this drives it from a known screen angle. */
function feedAngle(s: Spinner, angle: number): Spinner {
  // beta/gamma that produce this exact screen-down angle: x = cos b sin g,
  // y = sin b. Choosing b so that sin b = sin(angle) and cos b sin g = cos(angle).
  const y = Math.sin(angle);
  const x = Math.cos(angle);
  const beta = (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI;
  const cosB = Math.cos((beta * Math.PI) / 180);
  const sinG = Math.max(-1, Math.min(1, cosB === 0 ? 0 : x / cosB));
  const gamma = (Math.asin(sinG) * 180) / Math.PI;
  return feed(s, gamma, beta);
}

function counting(): void {
  console.log('\na spin is a full turn of gravity, either way (§2.1)');

  check('a fresh spinner has spun nothing', spins(newSpinner()) === 0);

  // Direct sweep accumulation, independent of the sensor mapping.
  let s = newSpinner();
  s = { last: 0, swept: 0 };
  for (let i = 1; i <= 36; i++) s = feedSwept(s, (i * 2 * Math.PI) / 36);
  check(`one turn is one spin (${spins(s)})`, spins(s) === 1, s.swept);

  let two = { last: 0, swept: 0 } as Spinner;
  for (let i = 1; i <= 72; i++) two = feedSwept(two, (i * 4 * Math.PI) / 72);
  check(`two turns are two spins (${spins(two)})`, spins(two) === 2, two.swept);

  // The other way round counts the same.
  let back = { last: 0, swept: 0 } as Spinner;
  for (let i = 1; i <= 36; i++) back = feedSwept(back, (-i * 2 * Math.PI) / 36);
  check(`a turn the other way also counts (${spins(back)})`, spins(back) === 1, back.swept);

  // Half a turn is not a spin.
  let half = { last: 0, swept: 0 } as Spinner;
  for (let i = 1; i <= 18; i++) half = feedSwept(half, (i * Math.PI) / 18);
  check(`half a turn is nothing (${spins(half)})`, spins(half) === 0, half.swept);

  // Wobbling back and forth cancels rather than accumulating.
  let wobble = { last: 0, swept: 0 } as Spinner;
  for (let i = 0; i < 40; i++) {
    wobble = feedSwept(wobble, 0.8);
    wobble = feedSwept(wobble, 0);
  }
  check(`shaking on the spot is not spinning (${spins(wobble)})`, spins(wobble) === 0, wobble.swept);

  // And the same, driven all the way through `feed` from synthesised sensor
  // readings, since that is the path a phone actually takes.
  check(`three turns of real readings are three spins (${spins(rotate(newSpinner(), 3))})`, spins(rotate(newSpinner(), 3)) === 3);
  check('two and a bit turns are still two', spins(rotate(newSpinner(), 2.4)) === 2);
}

/** Feed a known screen angle straight into the unwrapper. */
function feedSwept(s: Spinner, angle: number): Spinner {
  const d = ((angle - (s.last ?? angle) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return { last: angle, swept: s.swept + d };
}

function glitches(): void {
  console.log('\nthe sensor is not trusted blindly (§2.1)');

  // A flat phone has no screen-plane gravity at all.
  check('a flat phone has no gravity angle', gravityAngle(0, 0) === null);
  check('an upright one does', gravityAngle(0, 90) !== null);

  let flat = newSpinner();
  for (let i = 0; i < 100; i++) flat = feed(flat, 0, 0);
  check('so resting on a table scores nothing', spins(flat) === 0, flat);

  // A jump most of the way round is a glitch, not most of a spin.
  let jumpy: Spinner = { last: 0, swept: 0 };
  const before = jumpy.swept;
  jumpy = feedAngle(jumpy, Math.PI * 0.95);
  check('a near-half-turn jump between samples is dropped', jumpy.swept === before, jumpy);
}

function dizzy(): void {
  console.log('\nthe pupils keep rolling after the phone stops (§4)');

  let e = newEyes();
  // A real throw: gravity's angle sweeping at about four radians a second.
  let target = 0;
  for (let i = 0; i < 60; i++) {
    target += 4 * 0.016;
    e = spinEyes(e, target, 16);
  }
  check(`the eyes are moving at the end of a spin (${e.rate.toFixed(1)} rad/s)`, Math.abs(e.rate) > RHINO_SETTLE_RATE, e.rate);

  // Now the phone stops: nothing to chase, and they must wind down on their own.
  const spinning = Math.abs(e.rate);
  let coasted = e;
  for (let i = 0; i < 30; i++) coasted = spinEyes(coasted, null, 16);
  check(`they keep going for a moment (${Math.abs(coasted.rate).toFixed(2)} rad/s)`, Math.abs(coasted.rate) > 0, coasted.rate);
  check('but slower than while spinning', Math.abs(coasted.rate) < spinning, { was: spinning, now: coasted.rate });

  let settled = coasted;
  for (let i = 0; i < 600; i++) settled = spinEyes(settled, null, 16);
  check(`and they settle (${Math.abs(settled.rate).toFixed(3)} rad/s)`, Math.abs(settled.rate) < RHINO_SETTLE_RATE, settled.rate);

  check('a still phone leaves still eyes', Math.abs(spinEyes(newEyes(), Math.PI / 2, 16).rate) < 1e-9);
}

counting();
glitches();
dizzy();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
