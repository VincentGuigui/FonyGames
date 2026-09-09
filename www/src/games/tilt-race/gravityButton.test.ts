import { EDGE_INSET, downVector, edgeSpot, reverseSpot } from './gravityButton';

/**
 * Where the reverse button sits.
 * Spec: docs/specs/games/tilt-race.md §2, §5 · §11 (the fixed-position option)
 *
 * This is a small piece of trigonometry with an outsized failure mode: get a
 * sign wrong and the button sits on the opposite edge from the player's thumb,
 * which reads as the control being broken rather than misplaced. And it cannot
 * be checked by eye in a browser without a real phone to tilt, so it is
 * checked here instead.
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
  console.log('\nwhich way is down (§5)');

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
  // exactly the coupling whose absence is the point (see the module doc).
  const rolledRight = downVector(45, 45);
  const rolledLeft = downVector(-45, 45);
  check('a roll one way has a rightward pull', rolledRight.x > 0, rolledRight);
  check('and the other a leftward one', rolledLeft.x < 0, rolledLeft);
  check('and they mirror', Math.abs(rolledRight.x + rolledLeft.x) < 1e-9 && Math.abs(rolledRight.y - rolledLeft.y) < 1e-9);

  // A pose where BOTH axes are away from their extremes at once — the case
  // the old formula got wrong (issue report: a phone pitched back or forth
  // read a steady roll as changing direction). `cos(60°)` and `cos(120°)`
  // carry opposite signs, so this also pins that the roll's contribution is
  // meant to invert on the far side of upright — a phone pitched back past
  // vertical presents its rolled edge to gravity from the other side — rather
  // than freezing at whatever sign the roll alone would have given, which is
  // what the old formula did.
  check('a roll reads through a forward pitch', near(downVector(-12, 60), -0.1039558454088797, 0.8660254037844386));
  check('and the opposite sign through a backward one', near(downVector(-12, 120), 0.10395584540887963, 0.8660254037844387));

  check('a missing reading is treated as upright', near(downVector(null, null), 0, 1));
}

function edges(): void {
  console.log('\nfollowing the edges (§2)');

  const bottom = edgeSpot({ x: 0, y: 1 });
  check('down the screen puts it on the bottom edge', bottom.y > 0.8, bottom);
  check('and horizontally centred', Math.abs(bottom.x - 0.5) < 1e-9, bottom);

  const top = edgeSpot({ x: 0, y: -1 });
  check('up the screen puts it on the top edge', top.y < 0.2, top);

  const left = edgeSpot({ x: -1, y: 0 });
  check('a leftward pull puts it on the left edge', left.x < 0.2, left);
  check('and vertically centred', Math.abs(left.y - 0.5) < 1e-9, left);

  const right = edgeSpot({ x: 1, y: 0 });
  check('a rightward one, the right edge', right.x > 0.8, right);

  // A corner-ish angle lands on an edge, not outside the screen.
  for (let deg = 0; deg < 360; deg += 7) {
    const a = (deg * Math.PI) / 180;
    const spot = edgeSpot({ x: Math.sin(a), y: Math.cos(a) });
    if (spot.x < EDGE_INSET - 1e-9 || spot.x > 1 - EDGE_INSET + 1e-9 || spot.y < EDGE_INSET - 1e-9 || spot.y > 1 - EDGE_INSET + 1e-9) {
      check(`at ${deg} degrees it stays inside the inset`, false, spot);
      return;
    }
  }
  check('every angle lands inside the inset, on some edge', true);

  // It really does travel the edge rather than a circle: at 45° one of the two
  // coordinates must be pinned to the edge.
  const diagonal = edgeSpot({ x: Math.SQRT1_2, y: Math.SQRT1_2 });
  const onAnEdge = Math.abs(diagonal.x - EDGE_INSET) < 1e-6
    || Math.abs(diagonal.x - (1 - EDGE_INSET)) < 1e-6
    || Math.abs(diagonal.y - EDGE_INSET) < 1e-6
    || Math.abs(diagonal.y - (1 - EDGE_INSET)) < 1e-6;
  check('a diagonal still sits ON an edge, not on a circle', onAnEdge, diagonal);

  check('the movement is continuous — no jump between neighbouring angles', (() => {
    let worst = 0;
    for (let deg = 0; deg < 360; deg += 1) {
      const r1 = (deg * Math.PI) / 180;
      const r2 = ((deg + 1) * Math.PI) / 180;
      const a = edgeSpot({ x: Math.sin(r1), y: Math.cos(r1) });
      const b = edgeSpot({ x: Math.sin(r2), y: Math.cos(r2) });
      worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
    }
    return worst < 0.03;
  })());
}

function freezing(): void {
  console.log('\nheld means frozen (§2)');

  // The end-to-end path from a pose to the button's own edge, not just
  // `downVector`'s raw direction: this is what would have caught the version
  // that got `downVector`'s own sign right but the button's use of it
  // backwards (module doc, "A later version also carried an extra `-`").
  const rightEdge = reverseSpot(90, 0, false, null);
  check('right edge down puts the button on the right edge', rightEdge.x > 0.8, rightEdge);
  const leftEdge = reverseSpot(-90, 0, false, null);
  check('left edge down puts the button on the left edge', leftEdge.x < 0.2, leftEdge);

  const upright = reverseSpot(0, 90, false, null);
  check('not held, it follows the phone', upright.y > 0.8);

  const rolled = reverseSpot(-80, 20, false, null);
  check('rolling the phone moves it', Math.hypot(rolled.x - upright.x, rolled.y - upright.y) > 0.2, { upright, rolled });

  // Pressed at the bottom, then the phone is rolled hard: it must not move.
  const frozen = reverseSpot(-80, 20, true, upright);
  check('held, it stays exactly where it was pressed', frozen.x === upright.x && frozen.y === upright.y, { frozen, upright });

  const released = reverseSpot(-80, 20, false, upright);
  check('released, it falls into place again', released.x === rolled.x && released.y === rolled.y, { released, rolled });

  check('held with nothing remembered still gives a position', reverseSpot(0, 90, true, null).y > 0.8);
}

directions();
edges();
freezing();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
