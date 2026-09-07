/**
 * The ship's pose banding. Spec: docs/specs/games/asteroid-race.md §13
 *
 * The rest of `render.ts` is a canvas and is covered by looking at a real
 * round (docs/testing.md §1.2). This is here for the same reason as
 * `sprites.test.ts`'s `bucket()`: how the 25 poses divide the hull's range is
 * a *stated requirement* — 40% neutral, 40% small bank, 20% hard bank — and a
 * distribution is exactly the kind of thing that looks fine in the source and
 * is wrong on a phone. The first version quantised linearly and gave the
 * neutral pose 25%, which is why this file exists.
 */
import { ASTEROID_REACH } from './game';
import { POSE_BANDS, SHIP_SHEET_COLS, SHIP_SHEET_ROWS, shipFrame } from './pose';

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

/** A fraction of the hull's own range, in the world units `shipFrame` takes. */
const at = (n: number): number => n * ASTEROID_REACH;
const frame = (x: number, y: number): { col: number; row: number } => shipFrame(x, y, false);

function theMiddle(): void {
  console.log('\nthe neutral pose owns the middle 40% of the range');

  check('dead centre is the sheet\'s own middle frame', frame(0, 0).col === 2 && frame(0, 0).row === 2, frame(0, 0));
  check('and that is row 3, column 3 counting from 1', SHIP_SHEET_COLS === 5 && SHIP_SHEET_ROWS === 5);

  // 40% of a range that runs -1..1 is |n| <= 0.4 — a fifth of the reach either
  // side of the axis is NOT the band; two fifths is.
  // Either side of the nominal edge rather than exactly on it: `ASTEROID_REACH`
  // is 6.2, so the offset -> fraction round trip lands 0.4 at 0.4000000000000001
  // and a check sitting on the boundary would be asserting float noise, not a
  // rule. Which side a hair's breadth falls on does not matter; that the band
  // is 40% wide does, and the sweep below is what says so.
  check('a fifth of the way out still reads as straight', frame(at(0.2), 0).col === 2, frame(at(0.2), 0));
  check('and so does a hair inside two fifths', frame(at(0.399), 0).col === 2, frame(at(0.399), 0));
  check('a hair outside it is not', frame(at(0.401), 0).col !== 2, frame(at(0.401), 0));

  // The whole complaint this fixes: sweep the range and count.
  let neutral = 0;
  const steps = 2001;
  for (let i = 0; i < steps; i++) {
    const n = -1 + (2 * i) / (steps - 1);
    if (frame(at(n), 0).col === 2) neutral += 1;
  }
  const share = neutral / steps;
  check('a sweep of the whole range sits neutral ~40% of it', share > 0.39 && share < 0.41, share);
}

function theBanks(): void {
  console.log('\nthe banks take 40% and the outer 20%');

  check('past two fifths is a small bank', frame(at(0.5), 0).col === 3, frame(at(0.5), 0));
  check('and a hair inside four fifths still is', frame(at(0.799), 0).col === 3, frame(at(0.799), 0));
  check('a hair outside it is the hard bank', frame(at(0.801), 0).col === 4, frame(at(0.801), 0));

  let small = 0;
  let hard = 0;
  const steps = 2001;
  for (let i = 0; i < steps; i++) {
    const n = -1 + (2 * i) / (steps - 1);
    const col = frame(at(n), 0).col;
    if (col === 1 || col === 3) small += 1;
    if (col === 0 || col === 4) hard += 1;
  }
  check('the two small banks share ~40% of the range', small / steps > 0.39 && small / steps < 0.41, small / steps);
  check('and the two hard banks the outer ~20%', hard / steps > 0.19 && hard / steps < 0.21, hard / steps);
}

function theEdges(): void {
  console.log('\nthe wall, and past it');

  check('at the right-hand wall, the sheet\'s last column', frame(at(1), 0).col === 4, frame(at(1), 0));
  check('at the left-hand wall, its first', frame(at(-1), 0).col === 0, frame(at(-1), 0));
  check('at the top of the tube, its last row', frame(0, at(1)).row === 4, frame(0, at(1)));
  check('at the bottom, its first', frame(0, at(-1)).row === 0, frame(0, at(-1)));

  // The flight clamps the hull inside the tube, but the pose must not depend
  // on that: an offset past the wall clamps rather than indexing off the sheet.
  check('an offset past the wall clamps rather than overflowing', frame(at(9), at(-9)).col === 4 && frame(at(9), at(-9)).row === 0, frame(at(9), at(-9)));
}

function theAxes(): void {
  console.log('\ntwo axes, independently');

  check('steering right alone leaves the row alone', frame(at(1), 0).row === 2, frame(at(1), 0));
  check('climbing alone leaves the column alone', frame(0, at(1)).col === 2, frame(0, at(1)));
  const corner = frame(at(-0.9), at(0.5));
  check('and a hard left in a shallow climb reads as both', corner.col === 0 && corner.row === 3, corner);
}

function reducedMotion(): void {
  console.log('\nprefers-reduced-motion freezes the pose (§11)');

  check('hard against the wall, still the middle frame', shipFrame(at(1), at(-1), true).col === 2 && shipFrame(at(1), at(-1), true).row === 2, shipFrame(at(1), at(-1), true));
}

function theBandsMatchTheSheet(): void {
  console.log('\nthe bands and the sheet stay in step');

  // Two thresholds is exactly the two steps a five-frame axis has either side
  // of its middle. Widening the sheet without adding a band would silently
  // strand its outer frames; adding one without widening it would index off
  // the end.
  check('one threshold per step out from the middle', POSE_BANDS.length === (SHIP_SHEET_COLS - 1) / 2, POSE_BANDS.length);
  check('and the rows agree with the columns', SHIP_SHEET_ROWS === SHIP_SHEET_COLS);
  check('the thresholds climb toward the wall', POSE_BANDS.every((b, i) => b > 0 && b <= 1 && (i === 0 || b > (POSE_BANDS[i - 1] ?? 0))), POSE_BANDS);
}

theMiddle();
theBanks();
theEdges();
theAxes();
reducedMotion();
theBandsMatchTheSheet();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
