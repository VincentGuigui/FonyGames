import { PITCH_SENSITIVITY_DEG, SENSITIVITY_DEG, steer2Filter, steerFilter } from './steer';

/**
 * The tilt-to-steer math.
 * Spec: docs/specs/games/neon-fall.md §5 · algorithm: core/sensors/steer.ts
 *
 * Three things carry the whole rule:
 *
 * 1. **Calibration is explicit and re-centres on whatever gamma was last seen** — not
 *    on zero, and not on the first sample automatically.
 * 2. **The output never leaves −1..1**, however hard the phone is tilted.
 * 3. **A held tilt eventually saturates** — the low-pass filter tracks a sustained
 *    input, it does not just damp a single spike forever.
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

console.log('\ncalibration centres on the last sample, not on zero');
{
  const f = steerFilter();
  f.sample(12);
  f.calibrate();
  check('right after calibrating, dead centre reads as no steer', f.read() === 0);

  const settle = (gamma: number, n: number): void => {
    for (let i = 0; i < n; i++) f.sample(gamma);
  };
  settle(12, 50);
  check('holding the calibrated angle stays centred', Math.abs(f.read()) < 0.01, f.read());
}

console.log('\nthe output never leaves −1..1');
{
  const f = steerFilter();
  f.sample(0);
  f.calibrate();
  for (let i = 0; i < 200; i++) f.sample(500); // an absurd tilt
  check('a huge tilt saturates at 1, not beyond', f.read() <= 1 && f.read() > 0.99, f.read());

  const g = steerFilter();
  g.sample(0);
  g.calibrate();
  for (let i = 0; i < 200; i++) g.sample(-500);
  check('and the other way, at −1', g.read() >= -1 && g.read() < -0.99, g.read());
}

console.log('\na sustained tilt settles toward its target, not just a single kicked step');
{
  const f = steerFilter(SENSITIVITY_DEG);
  f.sample(0);
  f.calibrate();

  const early = (() => {
    f.sample(SENSITIVITY_DEG);
    return f.read();
  })();
  check('the very first sample after a tilt is a partial step', early > 0 && early < 1, early);

  for (let i = 0; i < 100; i++) f.sample(SENSITIVITY_DEG);
  check('held long enough, it settles near the full tilt', Math.abs(f.read() - 1) < 0.01, f.read());
}

console.log('\nrecalibrating clears the filter\'s memory');
{
  const f = steerFilter();
  f.sample(0);
  f.calibrate();
  for (let i = 0; i < 50; i++) f.sample(SENSITIVITY_DEG);
  check('drifted off centre', f.read() > 0.5, f.read());

  f.calibrate();
  check('recalibrating snaps straight back to centre, not a slow decay', f.read() === 0);
}

console.log('\ntwo axes, for a game that flies a tube (asteroid-race.md §5)');
{
  const f = steer2Filter();
  // Calibrated against however the phone is being held, not against zero.
  f.sample(12, 40);
  f.calibrate();
  check('a held pose is the new centre', f.read().x === 0 && f.read().y === 0, f.read());

  for (let i = 0; i < 100; i++) f.sample(12 + SENSITIVITY_DEG, 40);
  check('rolling right steers right', Math.abs(f.read().x - 1) < 0.01, f.read().x);
  check('and does not touch the other axis', Math.abs(f.read().y) < 1e-9, f.read().y);

  const g = steer2Filter();
  g.sample(0, 0);
  g.calibrate();
  for (let i = 0; i < 100; i++) g.sample(0, -PITCH_SENSITIVITY_DEG);
  check('tipping the top edge away climbs', Math.abs(g.read().y - 1) < 0.01, g.read().y);
  check('while roll stays put', Math.abs(g.read().x) < 1e-9, g.read().x);

  for (let i = 0; i < 200; i++) g.sample(0, -PITCH_SENSITIVITY_DEG * 10);
  check('and a wild tip is clamped, not amplified', g.read().y <= 1 + 1e-9, g.read().y);

  g.calibrate();
  check('recalibrating recentres both axes at once', g.read().x === 0 && g.read().y === 0, g.read());
}

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
