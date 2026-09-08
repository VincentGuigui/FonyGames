import { ROLL_MIN_GRAVITY, rollAngle, rollTracker } from './roll';

/**
 * The steering wheel. Spec: docs/specs/games/tilt-race.md §2.1, §5
 *
 * Three things are worth pinning here, because each one is a way the control
 * could be silently backwards or silently bounded:
 *
 * - **the sign** — clockwise on the wrist has to be clockwise on the road, and
 *   this is the file where that is decided;
 * - **the full circle** — the reason `gamma` was abandoned is that it folds at
 *   vertical, so "a phone turned right round reads a whole turn" is the
 *   property the whole rewrite exists for;
 * - **a flat phone** — face up on a table there is no in-plane gravity at all,
 *   and following its direction would spin the car with nobody touching it.
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

const DEG = 180 / Math.PI;

/**
 * The `deviceorientation` reading for a phone held upright and then rotated
 * `turn` degrees clockwise in its own plane.
 *
 * Derived rather than tabulated: rotating an upright phone about the axis out
 * of its screen leaves `beta` and `gamma` on the circle
 * `beta = 90 - turn` while `gamma` sweeps — which is awkward to write directly,
 * so this goes the other way and states the pose by where gravity ends up.
 * Screen-space gravity for a clockwise turn of `t` is `(sin t, cos t)`, and
 * `downVector` says that is `(-sin gamma, sin beta cos gamma)`.
 */
function upright(turnDeg: number): { gamma: number; beta: number } {
  const t = turnDeg / DEG;
  // -sin(gamma) = sin(t)  ->  gamma = -t, within ±90.
  const gamma = -Math.asin(Math.max(-1, Math.min(1, Math.sin(t)))) * DEG;
  // sin(beta) cos(gamma) = cos(t), and cos(gamma) = |cos t|.
  const cg = Math.cos(gamma / DEG);
  const beta = Math.asin(Math.max(-1, Math.min(1, Math.cos(t) / (cg === 0 ? 1 : cg)))) * DEG;
  return { gamma, beta };
}

function theAngle(): void {
  console.log('\nwhich way the phone is turned');

  check('upright is zero', Math.abs(rollAngle(0, 90) ?? 99) < 1e-9, rollAngle(0, 90));
  // The four quarter poses, straight off `downVector`'s own table.
  check('right edge down is a quarter clockwise', Math.abs((rollAngle(-90, 0) ?? 0) * DEG - 90) < 1e-6, (rollAngle(-90, 0) ?? 0) * DEG);
  check('left edge down is a quarter the other way', Math.abs((rollAngle(90, 0) ?? 0) * DEG + 90) < 1e-6, (rollAngle(90, 0) ?? 0) * DEG);
  check('upside down is half a turn', Math.abs(Math.abs((rollAngle(0, -90) ?? 0) * DEG) - 180) < 1e-6, (rollAngle(0, -90) ?? 0) * DEG);

  // The sign is the whole of the first bullet of the report: the old control
  // turned the car the other way from the wrist.
  check('a small clockwise turn reads positive', (rollAngle(upright(20).gamma, upright(20).beta) ?? 0) > 0);
  check('and a small counter-clockwise turn negative', (rollAngle(upright(-20).gamma, upright(-20).beta) ?? 0) < 0);

  check('a phone flat on its back has no angle to give', rollAngle(0, 0) === null, rollAngle(0, 0));
  check('and neither has one nearly flat', rollAngle(5, 5) === null);
  check('the threshold is where the reading stops being noise', ROLL_MIN_GRAVITY > 0 && ROLL_MIN_GRAVITY < 0.5);
}

function turningRightRound(): void {
  console.log('\nthe wrist can go all the way round, and the car goes with it');

  // One degree at a time, right round, twice. This is the property `gamma`
  // could not have: it folds back on itself past vertical, so a tracker built
  // on it would have unwound here rather than accumulating.
  for (const turns of [1, 2, -1, -2]) {
    const t = rollTracker();
    t.calibrate();
    const stepDeg = turns > 0 ? 1 : -1;
    const total = Math.abs(turns) * 360;
    for (let d = 0; Math.abs(d) <= total; d += stepDeg) {
      const pose = upright(d);
      t.sample(pose.gamma, pose.beta);
    }
    const want = turns * Math.PI * 2;
    check(`  ${turns} whole turns reads ${turns} whole turns (${(t.read() / Math.PI / 2).toFixed(2)})`, Math.abs(t.read() - want) < 0.05, t.read());
  }
}

function calibration(): void {
  console.log('\nzero is upright, not wherever the round happened to start');

  const t = rollTracker();
  t.calibrate();
  // Started with the phone already tipped: the total reflects that tilt from
  // upright, not a fresh zero — there is no "wherever you're holding it" any
  // more (roll.ts's own top comment; the report this replaced).
  const held = upright(35);
  t.sample(held.gamma, held.beta);
  check('the first reading after calibrating is the angle from upright', Math.abs(t.read() * DEG - 35) < 0.5, t.read() * DEG);

  const moved = upright(65);
  t.sample(moved.gamma, moved.beta);
  check('and thirty degrees further reads sixty-five from upright', Math.abs(t.read() * DEG - 65) < 0.5, t.read() * DEG);

  // Recalibrating mid-run re-syncs to whatever the next reading says, rather
  // than trusting a `delta` against a `last` that might be stale.
  t.calibrate();
  t.sample(moved.gamma, moved.beta);
  check('recalibrating re-syncs to the next reading', Math.abs(t.read() * DEG - 65) < 0.5, t.read() * DEG);

  const flat = rollTracker();
  flat.calibrate();
  flat.sample(0, 0);
  check('a flat phone leaves the tracker at zero rather than at noise', flat.read() === 0);
  const after = upright(40);
  flat.sample(after.gamma, after.beta);
  check('and the first usable reading is what it seeds on', Math.abs(flat.read() * DEG - 40) < 0.5, flat.read() * DEG);
}

function steadiness(): void {
  console.log('\na phone held still does not drift');

  const t = rollTracker();
  t.calibrate();
  const pose = upright(25);
  const start = rollAngle(pose.gamma, pose.beta) ?? 0;
  for (let i = 0; i < 600; i++) t.sample(pose.gamma, pose.beta);
  check('six hundred identical readings move it not at all from where it seeded', Math.abs(t.read() - start) < 1e-9, t.read());

  // A hand tremor is a wobble about a pose, not a walk away from it: the
  // tracker is an accumulator, so what matters is that it comes back to
  // wherever it seeded, not to zero.
  const wobble = rollTracker();
  wobble.calibrate();
  const seeded = upright(25 + Math.sin(0 / 3) * 1.5);
  const wobbleStart = rollAngle(seeded.gamma, seeded.beta) ?? 0;
  for (let i = 0; i < 400; i++) {
    const p = upright(25 + Math.sin(i / 3) * 1.5);
    wobble.sample(p.gamma, p.beta);
  }
  const end = upright(25 + Math.sin(399 / 3) * 1.5);
  wobble.sample(end.gamma, end.beta);
  check('and a tremor comes back to where it started', Math.abs((wobble.read() - wobbleStart) * DEG) < 2, (wobble.read() - wobbleStart) * DEG);
}

theAngle();
turningRightRound();
calibration();
steadiness();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
