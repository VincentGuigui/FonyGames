import {
  downVector,
  reverseSpin, EDGE_INSET, edgeSpot, reverseSpot } from './gravityButton';

/**
 * Where the reverse button sits.
 * Spec: docs/specs/games/tilt-race.md §2, §5 · §11 (the fixed-position option)
 *
 * `downVector`'s own pose-by-pose signs are pinned in
 * `core/sensors/gravity.test.ts` now that it lives there; this file covers
 * what is still specific to the button — the edge-following ray and the
 * held/frozen rule — plus the end-to-end path from a pose to the button's
 * own edge in `freezing()` below.
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

edges();
freezing();


function spinning(): void {
  console.log('\nthe button turns so its arrow points at the real floor (#43)');

  const deg = (r: number): number => (r * 180) / Math.PI;
  // Upright (beta 90) gravity is already screen-down, so nothing to turn.
  check(`upright needs no turn (${deg(reverseSpin(0, 90, false, null)).toFixed(0)}deg)`,
    Math.abs(reverseSpin(0, 90, false, null)) < 1e-9);

  // Tipped onto an edge, the face turns to match.
  const right = reverseSpin(90, 0, false, null);
  const left = reverseSpin(-90, 0, false, null);
  check(`tipped one way turns a quarter (${deg(right).toFixed(0)}deg)`, Math.abs(Math.abs(deg(right)) - 90) < 1);
  check(`and the other way, the other way (${deg(left).toFixed(0)}deg)`, Math.sign(left) === -Math.sign(right));

  // The arrow always points where gravity does: turn the face by the spin and
  // screen-down must land on the real down.
  for (const [g, b] of [[0, 90], [45, 45], [-60, 30], [90, 0]] as const) {
    const spin = reverseSpin(g, b, false, null);
    const d = downVector(g, b);
    const pointed = { x: -Math.sin(spin), y: Math.cos(spin) };
    const len = Math.hypot(d.x, d.y) || 1;
    const dot = (pointed.x * d.x + pointed.y * d.y) / len;
    check(`  the arrow lands on gravity at ${g}/${b} (dot ${dot.toFixed(3)})`, dot > 0.999, dot);
  }

  // Frozen while held, exactly as the position is.
  check('held, it does not turn under the thumb', reverseSpin(90, 0, true, 0.25) === 0.25);
  check('and released it follows gravity again', reverseSpin(0, 90, false, 0.25) === 0);
  check('a flat phone leaves the face alone', reverseSpin(0, 0, false, null) === 0);
}

spinning();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);

