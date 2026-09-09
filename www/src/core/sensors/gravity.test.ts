import { downVector } from './gravity';

/**
 * Which way gravity pulls, in screen coordinates.
 *
 * This is a small piece of trigonometry with an outsized failure mode: get a
 * sign wrong and whatever reads it points the opposite way, which reads as
 * broken rather than misplaced (`games/tilt-race/gravityButton.ts` has the
 * two times that already happened). And it cannot be checked by eye in a
 * browser without a real phone to tilt, so it is checked here instead.
 *
 * The pose that pins every sign is a phone held upright: `beta ≈ 90`,
 * `gamma ≈ 0`, and gravity pointing down the screen.
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

function directions(): void {
  console.log('\nwhich way is down');

  /*
   * Each of these is a pose you can hold a phone in, and its answer is forced
   * by physics rather than chosen — which is the point of deriving the vector
   * instead of guessing an angle. The first version of this module was written
   * as an angle with guessed signs and had two of the four quadrants
   * backwards.
   */
  const near = (v: { x: number; y: number }, x: number, y: number): boolean =>
    Math.abs(v.x - x) < 1e-9 && Math.abs(v.y - y) < 1e-9;

  check('held upright, down is down the screen', near(downVector(0, 90), 0, 1), downVector(0, 90));
  check('upside down, down is up the screen', near(downVector(0, -90), 0, -1), downVector(0, -90));
  check('right edge down, down is screen right', near(downVector(90, 0), 1, 0), downVector(90, 0));
  check('left edge down, down is screen left', near(downVector(-90, 0), -1, 0), downVector(-90, 0));
  check('flat on a table, there is no in-plane direction', Math.hypot(downVector(0, 0).x, downVector(0, 0).y) < 1e-9);

  // Halfway poses land between, and the two rolls are mirror images. The pull
  // is `cos(beta)`-attenuated here rather than the full `sin(45°)` a roll
  // alone would give, because this pose is *also* pitched 45° from upright —
  // exactly the coupling whose absence is the point (module doc).
  const rolledRight = downVector(45, 45);
  const rolledLeft = downVector(-45, 45);
  check('a roll one way has a rightward pull', rolledRight.x > 0, rolledRight);
  check('and the other a leftward one', rolledLeft.x < 0, rolledLeft);
  check('and they mirror', Math.abs(rolledRight.x + rolledLeft.x) < 1e-9 && Math.abs(rolledRight.y - rolledLeft.y) < 1e-9);

  // A pose where BOTH axes are away from their extremes at once — the case
  // an early formula got wrong (a phone pitched back or forth read a steady
  // roll as changing direction). `cos(60°)` and `cos(120°)` carry opposite
  // signs, so this also pins that the roll's contribution is meant to invert
  // on the far side of upright — a phone pitched back past vertical presents
  // its rolled edge to gravity from the other side — rather than freezing at
  // whatever sign the roll alone would have given.
  check('a roll reads through a forward pitch', near(downVector(-12, 60), -0.1039558454088797, 0.8660254037844386));
  check('and the opposite sign through a backward one', near(downVector(-12, 120), 0.10395584540887963, 0.8660254037844387));

  check('a missing reading is treated as upright', near(downVector(null, null), 0, 1));
}

directions();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
