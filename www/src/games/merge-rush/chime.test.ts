import { CHIME_RESET_AFTER, CHIME_STEPS, CLIMB_START, climb, partials } from './chime';

/** The merge note's climb and its spectrum. Module: merge-rush/chime.ts */

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

console.log('\nthe climb (spec §4)');
let c = CLIMB_START;
const steps: number[] = [];
for (let i = 0; i < 30; i++) {
  c = climb(c, true);
  steps.push(c.step);
}
check('merge after merge, each note a step higher, with no ceiling', steps.every((s, i) => s === i + 1));
c = climb(climb(climb(c, false), false), false);
check(`${CHIME_RESET_AFTER} moves without a merge keep the step`, c.step === 30 && c.idle === CHIME_RESET_AFTER);
check('and the next merge starts again from the low note', climb(c, true).step === 0);
const two = climb(climb(climb(climb(CLIMB_START, true), true), false), false);
check('two quiet moves are not enough to start over', climb(two, true).step === 3);

console.log('\nan endless rise: a Shepard tone');
const lowest = (step: number): number => Math.min(...partials(step).map((p) => p.hz));
const loudest = (step: number): number => partials(step).reduce((a, b) => (b.gain > a.gain ? b : a)).hz;
check('every step within the scale is higher than the one before', Array.from({ length: CHIME_STEPS - 1 }, (_, i) => lowest(i + 1) > lowest(i)).every(Boolean));
check('a full turn up is the very same sound', JSON.stringify(partials(CHIME_STEPS)) === JSON.stringify(partials(0)) && JSON.stringify(partials(25)) === JSON.stringify(partials(1)));
check('each note is its pitch class in octaves', partials(5).every((p, i, all) => i === 0 || Math.abs(p.hz / (all[i - 1]?.hz ?? 1) - 2) < 1e-9));
check('loudness sums to one, so every step is as loud as the next', [0, 3, 7, 11].every((s) => Math.abs(partials(s).reduce((t, p) => t + p.gain, 0) - 1) < 1e-9));
// Step 0 is where an octave leaves at the top and a new one enters at the bottom.
const ends = partials(0);
check('where the scale wraps, the octaves coming and going are near silent', (ends[0]?.gain ?? 1) < 0.01 && (ends[ends.length - 1]?.gain ?? 1) < 0.01, ends);
check('it sings in the middle of the range', [0, 6, 11].every((s) => loudest(s) > 200 && loudest(s) < 800));

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
