import { ART_REFERENCE_HUE, hexHue, rotatedPixel } from './tint';

/**
 * Logic harness for tint.ts's pure maths — `tinted()` itself needs a
 * `<canvas>` and is covered by looking at a real round instead (docs/testing.md
 * §1.2), but `rotatedPixel` and `hexHue` are DOM-free and the whole point of
 * this file: a flat `source-in` recolour could not be tested any way but by
 * eye, and the reason to hue-rotate instead was exactly so this could exist.
 */

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

function near(a: number, b: number, tol = 1): boolean {
  return Math.abs(a - b) <= tol;
}

function grey(): void {
  console.log('\nblack, white and every true grey pass through untouched');

  for (const [r, g, b] of [[0, 0, 0], [255, 255, 255], [128, 128, 128], [17, 17, 17]] as const) {
    for (const delta of [0, 37, 180, -90]) {
      const out = rotatedPixel(r, g, b, delta);
      check(`(${r},${g},${b}) at delta ${delta} is bit-exact`, out[0] === r && out[1] === g && out[2] === b, out);
    }
  }
}

function rotation(): void {
  console.log('\na coloured pixel actually rotates');

  // Pure magenta (300deg) is the art's own reference hue — a delta of +60
  // should land on pure red (0/360deg): magenta -> red -> ... round the wheel.
  const magenta: [number, number, number] = [255, 0, 255];
  const toRed = rotatedPixel(...magenta, 60);
  check('magenta + 60deg is red', near(toRed[0], 255) && near(toRed[1], 0) && near(toRed[2], 0), toRed);

  // A full 360 is a no-op (mod wrap).
  const fullTurn = rotatedPixel(...magenta, 360);
  check('a full turn is a no-op', near(fullTurn[0], magenta[0]) && near(fullTurn[1], magenta[1]) && near(fullTurn[2], magenta[2]), fullTurn);

  // Saturation and lightness survive the trip: a DARK magenta shifts hue but
  // stays dark, never brightening toward the target's own lightness.
  const darkMagenta: [number, number, number] = [80, 0, 80];
  const darkShifted = rotatedPixel(...darkMagenta, 60);
  const maxChannel = Math.max(...darkShifted);
  check('a dark input stays dark after rotating', maxChannel < 120, darkShifted);
}

function relativeOffsetsSurvive(): void {
  console.log('\ntwo differently-hued details stay differently hued after the same shift');

  // The ship's own body (magenta, the reference) and an accent painted at a
  // different hue in the source (green, ~130deg) — both rotated by the same
  // delta must keep the SAME angular gap between them.
  const body: [number, number, number] = [255, 0, 255]; // 300deg
  const accent: [number, number, number] = [30, 220, 90]; // ~140deg-ish
  for (const delta of [45, -90, 200]) {
    const bodyOut = rotatedPixel(...body, delta);
    const accentOut = rotatedPixel(...accent, delta);
    // They must not have collapsed onto the same colour.
    const collided = Math.abs(bodyOut[0] - accentOut[0]) < 5 && Math.abs(bodyOut[1] - accentOut[1]) < 5 && Math.abs(bodyOut[2] - accentOut[2]) < 5;
    check(`at delta ${delta}, body and accent are still distinguishable`, !collided, { bodyOut, accentOut });
  }
}

function hexParsing(): void {
  console.log('\nhexHue reads a hex colour, and fails open on anything else');

  check('pure magenta is the reference hue itself', near(hexHue('#FF00FF'), ART_REFERENCE_HUE, 0.5), hexHue('#FF00FF'));
  check('pure red is 0deg', near(hexHue('#FF0000'), 0, 0.5) || near(hexHue('#FF0000'), 360, 0.5), hexHue('#FF0000'));
  check('a 3-digit hex expands', near(hexHue('#f0f'), ART_REFERENCE_HUE, 0.5), hexHue('#f0f'));
  check('case does not matter', near(hexHue('#FF00FF'), hexHue('#ff00ff'), 0.01));
  check('no leading # still parses', near(hexHue('ff00ff'), ART_REFERENCE_HUE, 0.5));

  check('black has no hue of its own, falls back to the reference', hexHue('#000000') === ART_REFERENCE_HUE);
  check('white has no hue of its own, falls back to the reference', hexHue('#ffffff') === ART_REFERENCE_HUE);
  check('grey has no hue of its own, falls back to the reference', hexHue('#888888') === ART_REFERENCE_HUE);

  check('garbage input fails open to the reference hue, not a throw', hexHue('not a colour') === ART_REFERENCE_HUE);
  check('an empty string fails open too', hexHue('') === ART_REFERENCE_HUE);
}

grey();
rotation();
relativeOffsetsSurvive();
hexParsing();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
