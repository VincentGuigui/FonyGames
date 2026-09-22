import {
  MAXJUMP_BEST_ANGLE,
  MAXJUMP_DRAG,
  MAXJUMP_EARLY_ANGLE,
  MAXJUMP_FLAP_RATE,
  MAXJUMP_JUMP_STEP,
  MAXJUMP_MAX_SPEED,
  MAXJUMP_PERFECT_BAND,
  MAXJUMP_SPEED_PER_STEP,
  MAXJUMP_STEP_FAST_MS,
  MAXJUMP_STEP_SLOW_MS,
  MAXJUMP_STRIDE,
  MAXJUMP_TAKEOFF_BONUS,
  MAXJUMP_TAP_WINDOW_MS,
  MAXJUMP_TIMING_WINDOW_MS,
} from '../../../../shared/protocol';
import {
  bestPossible,
  isPerfect,
  pressJump,
  pressLeg,
  runFor,
  startAttempt,
  stepFlight,
  stepMs,
  takeoffAngle,
  tapRate,
  timingGain,
  type Attempt,
} from './jump';

/**
 * Maximum Jump's whole attempt: the run-up rhythm, the take-off band and the
 * ballistic arc. Spec: docs/specs/games/maximum-jump.md §2
 *
 * The referee sees two numbers and can check neither (spec §6), so everything
 * that makes this a game rather than a button is asserted here.
 */

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

/** Run the attempt with perfectly timed alternating legs until `until` says stop. */
function runUp(until: (a: Attempt) => boolean, offsetMs = 0): Attempt {
  let a = pressLeg(startAttempt(), 'left');
  let leg: 'left' | 'right' = 'right';
  // A fine frame, pressing when the beat (plus whatever lateness the caller
  // asked for) comes round. Fine because the take-off band is milliseconds
  // wide at speed, and a coarse step would overshoot the line and foul.
  for (let i = 0; i < 80_000 && !until(a); i++) {
    a = runFor(a, 4);
    if (a.t >= a.beatAt + offsetMs) {
      a = pressLeg(a, leg);
      leg = leg === 'left' ? 'right' : 'left';
    }
  }
  return a;
}

function rhythm(): void {
  console.log('\nthe run-up: one step is worth up to one increment (§2.1)');

  check('a fresh attempt is standing still', startAttempt().speed === 0 && startAttempt().atStep === 0);

  check('a press dead on the beat is worth the lot', near(timingGain(0), 1));
  check('half a window out is worth half', near(timingGain(MAXJUMP_TIMING_WINDOW_MS / 2), 0.5));
  check('a window out is worth nothing', timingGain(MAXJUMP_TIMING_WINDOW_MS) === 0);
  check('and early is scored the same as late', near(timingGain(-80), timingGain(80)));
  check('nothing ever scores more than one', timingGain(-1) <= 1 && timingGain(0) <= 1);

  check('the rhythm tightens with the speed', stepMs(MAXJUMP_MAX_SPEED) < stepMs(0));
  check('standing still is the slow end', near(stepMs(0), MAXJUMP_STEP_SLOW_MS));
  check('flat out is the fast end', near(stepMs(MAXJUMP_MAX_SPEED), MAXJUMP_STEP_FAST_MS));
  check('and past flat out does not go faster still', near(stepMs(MAXJUMP_MAX_SPEED * 3), MAXJUMP_STEP_FAST_MS));

  // The same leg twice is not a step.
  const one = pressLeg(startAttempt(), 'left');
  const again = pressLeg(one, 'left');
  check('pressing the same leg twice is not a step', again.speed === one.speed && again.beatAt === one.beatAt);
  const onTheBeat = pressLeg(runFor(one, one.beatAt), 'right');
  check('the other leg, on the beat, is', near(onTheBeat.speed, one.speed + MAXJUMP_SPEED_PER_STEP), onTheBeat.speed);
  check('the other leg a whole window early is worth nothing',
    pressLeg(runFor(one, one.beatAt - MAXJUMP_TIMING_WINDOW_MS), 'right').speed === one.speed);

  // A well-timed run-up outruns a sloppy one over the same ground.
  const sharp = runUp((a) => a.atStep >= 40);
  const sloppy = runUp((a) => a.atStep >= 40, MAXJUMP_TIMING_WINDOW_MS * 0.7);
  check(
    `rhythm beats mashing (${sharp.speed.toFixed(1)} vs ${sloppy.speed.toFixed(1)} m/s)`,
    sharp.speed > sloppy.speed * 1.3,
    { sharp: sharp.speed, sloppy: sloppy.speed },
  );
  check('and gets there sooner', sharp.t < sloppy.t, { sharp: sharp.t, sloppy: sloppy.t });
  check('no run-up ever exceeds the sprinter cap', sharp.speed <= MAXJUMP_MAX_SPEED);
  check('the top speed is remembered, not just the current one', sharp.topSpeed >= sharp.speed);

  // Position is distance, not presses.
  const still = runFor({ ...startAttempt(), speed: MAXJUMP_STRIDE }, 1000);
  check('a metre-per-stride second advances exactly one step', near(still.atStep, 1, 1e-9), still.atStep);
  check('standing still advances nothing', runFor(startAttempt(), 5000).atStep === 0);
}

function takeoff(): void {
  console.log('\nthe take-off: the line is at step 50 (§2.2)');

  const line = MAXJUMP_JUMP_STEP;
  const at = (step: number): Attempt => ({ ...startAttempt(), atStep: step, speed: 9, topSpeed: 9 });

  check('past the line is a faceplant', pressJump(at(line)).phase === 'foul');
  check('and a faceplant scores nothing', pressJump(at(line + 3)).distance === 0);
  check('a hair before it is not', pressJump(at(line - 0.01)).phase === 'flight');

  check('the perfect band is the end of the last step', isPerfect(line - MAXJUMP_PERFECT_BAND / 2));
  check('but not the line itself', !isPerfect(line));
  check('nor two steps out', !isPerfect(line - 2));

  const perfect = pressJump(at(line - MAXJUMP_PERFECT_BAND / 2));
  check('hitting it exactly takes the best angle', near(perfect.angle, MAXJUMP_BEST_ANGLE));
  check(
    `and the bonus (${perfect.speed.toFixed(2)} from 9 m/s)`,
    near(perfect.speed, 9 + MAXJUMP_TAKEOFF_BONUS * MAXJUMP_SPEED_PER_STEP),
    perfect.speed,
  );

  const early = pressJump(at(line - 4));
  check('going early takes the steep angle', near(early.angle, MAXJUMP_EARLY_ANGLE));
  check('and no bonus at all', near(early.speed, 9));

  // The ramp across the last step.
  check('the angle only improves as the line nears',
    takeoffAngle(line - 1) > takeoffAngle(line - 0.5) && takeoffAngle(line - 0.5) > takeoffAngle(line - 0.2));
  check('a step out is the steep angle exactly', near(takeoffAngle(line - 1), MAXJUMP_EARLY_ANGLE));
  check('and the band is the best one', near(takeoffAngle(line - MAXJUMP_PERFECT_BAND / 2), MAXJUMP_BEST_ANGLE));
  check('nothing further out is steeper than the steep one', takeoffAngle(line - 20) === MAXJUMP_EARLY_ANGLE);

  check('the take-off leaves the ground moving up and forward', perfect.vx > 0 && perfect.vy > 0);
}

/** Fly an attempt to the ground at a fixed tap rate. */
function fly(a: Attempt, tapsPerSecond: number): Attempt {
  let out = a;
  for (let i = 0; i < 4000 && out.phase === 'flight'; i++) out = stepFlight(out, 16, tapsPerSecond);
  return out;
}

function flight(): void {
  console.log('\nthe flight: drag is the part still being played (§2.3)');

  const takeOff = pressJump({ ...startAttempt(), atStep: MAXJUMP_JUMP_STEP - MAXJUMP_PERFECT_BAND / 2, speed: 9, topSpeed: 9 });

  const idle = fly(takeOff, 0);
  const half = fly(takeOff, MAXJUMP_FLAP_RATE / 2);
  const flat = fly(takeOff, MAXJUMP_FLAP_RATE);

  check('every jump lands', idle.phase === 'landed' && half.phase === 'landed' && flat.phase === 'landed');
  check('on the ground, not through it', idle.y === 0 && flat.y === 0);
  check(
    `tapping goes further (${idle.distance.toFixed(2)} / ${half.distance.toFixed(2)} / ${flat.distance.toFixed(2)} m)`,
    flat.distance > half.distance && half.distance > idle.distance,
    { idle: idle.distance, half: half.distance, flat: flat.distance },
  );
  check('and past the ceiling rate buys nothing more', near(fly(takeOff, MAXJUMP_FLAP_RATE * 4).distance, flat.distance, 1e-9));

  // At the flap ceiling there is no drag left, so the arc should be the
  // textbook one: v^2 sin(2 theta) / g.
  const v = takeOff.speed;
  const ideal = (v * v * Math.sin(2 * takeOff.angle)) / 9.81;
  check(`a drag-free jump is the textbook range (${flat.distance.toFixed(2)} vs ${ideal.toFixed(2)} m)`,
    Math.abs(flat.distance - ideal) < 0.1, { flown: flat.distance, ideal });
  check('and the drag-free one is the longer of the two', flat.distance > idle.distance);
  check('drag only ever slows the jumper down', MAXJUMP_DRAG > 0 && idle.distance < ideal);

  // Frame rate must not change the answer.
  let coarse = takeOff;
  for (let i = 0; i < 2000 && coarse.phase === 'flight'; i++) coarse = stepFlight(coarse, 33, MAXJUMP_FLAP_RATE);
  check(`the distance does not depend on the frame rate (${coarse.distance.toFixed(3)} vs ${flat.distance.toFixed(3)})`,
    Math.abs(coarse.distance - flat.distance) < 0.05, { coarse: coarse.distance, fine: flat.distance });

  // A faster or better-angled take-off goes further.
  const slow = fly(pressJump({ ...startAttempt(), atStep: MAXJUMP_JUMP_STEP - MAXJUMP_PERFECT_BAND / 2, speed: 6, topSpeed: 6 }), MAXJUMP_FLAP_RATE);
  check(`speed is what the run-up is for (${slow.distance.toFixed(2)} at 6 m/s)`, slow.distance < flat.distance);
  const steep = fly(pressJump({ ...startAttempt(), atStep: MAXJUMP_JUMP_STEP - 5, speed: 9, topSpeed: 9 }), MAXJUMP_FLAP_RATE);
  check(`and the line is what the angle is for (${steep.distance.toFixed(2)} m going early)`, steep.distance < flat.distance);

  check('nothing this game can produce beats its own ceiling', flat.distance < bestPossible());
}

function tapping(): void {
  console.log('\nreading the tap rate (§2.3)');

  check('no taps is no rate', tapRate([], 10_000) === 0);
  const now = 10_000;
  const five = [now - 100, now - 200, now - 300, now - 400, now - 500];
  check(`five in the window reads as ${tapRate(five, now)} a second`, tapRate(five, now) === (5 * 1000) / MAXJUMP_TAP_WINDOW_MS);
  check('taps older than the window are forgotten', tapRate([now - MAXJUMP_TAP_WINDOW_MS - 1, ...five], now) === tapRate(five, now));
  check('and the rate falls as the window slides past them', tapRate(five, now + MAXJUMP_TAP_WINDOW_MS) === 0);
}

function ceiling(): void {
  console.log('\nthe referee\'s bound (§8)');

  const best = bestPossible();
  check(`the ceiling is generous but finite (${best.toFixed(2)} m)`, best > 10 && best < 20, best);

  // The best an actual attempt can do: a flawless run-up, the perfect band, and
  // the flap rate held the whole way.
  const flawless = runUp((a) => a.atStep >= MAXJUMP_JUMP_STEP - MAXJUMP_PERFECT_BAND / 2);
  const jumped = fly(pressJump(flawless), MAXJUMP_FLAP_RATE);
  check(
    `a flawless attempt lands inside it (${jumped.distance.toFixed(2)} of ${best.toFixed(2)} m)`,
    jumped.phase === 'landed' && jumped.distance < best,
    { distance: jumped.distance, best },
  );
  check(`and is a real jump, not a hop (${jumped.distance.toFixed(2)} m at ${jumped.topSpeed.toFixed(1)} m/s)`,
    jumped.distance > 6, { distance: jumped.distance, speed: jumped.topSpeed });
}

rhythm();
takeoff();
flight();
tapping();
ceiling();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
