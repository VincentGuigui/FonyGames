import {
  SCREAM_DB_FLOOR,
  SCREAM_DB_SPAN,
  SCREAM_PROMPTS,
  dealPrompt,
  floorOf,
  isScreamPrompt,
  loudestWindow,
  peakOf,
  rmsToDbfs,
  screamScore,
} from './scream';
import { SCREAM_SAMPLE_MS, SCREAM_SUSTAIN_MS, SCREAM_WINDOW_MS } from './protocol';

/**
 * `shared/scream.ts` — what a scream is worth.
 * Spec: docs/specs/games/scream-meter.md §2, §5, §8
 *
 * The scoring choice here IS the game and IS the anti-cheat, so the thing
 * worth proving is that it actually behaves the way §2 claims:
 *
 * - **a bark loses to a held scream.** One very loud frame must not beat three
 *   seconds of a real one, or the whole game is "hit the microphone".
 * - **holding a note for ten seconds is worth no more than holding it for
 *   three**, or it becomes a breath-holding contest.
 * - **the floor is subtracted**, so a phone in a noisy room is not simply
 *   better than one in a quiet room.
 *
 * These are the three failure modes the spec names, and each of them looks
 * perfectly reasonable in the code that produces it.
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

/** How many samples a duration is, at the tracker's own rate. */
const at = (ms: number): number => Math.round(ms / SCREAM_SAMPLE_MS);

/** A run of samples: `quiet` everywhere, with `loud` for `ms` from `fromMs`. */
function run(quiet: number, loud: number, fromMs: number, ms: number, totalMs = SCREAM_WINDOW_MS): number[] {
  const out: number[] = [];
  for (let i = 0; i < at(totalMs); i++) {
    const t = i * SCREAM_SAMPLE_MS;
    out.push(t >= fromMs && t < fromMs + ms ? loud : quiet);
  }
  return out;
}

function decibels(): void {
  console.log('\namplitude to decibels (§5)');

  check('full scale is 0 dBFS', rmsToDbfs(1) === 0);
  check('half amplitude is about -6 dB', Math.abs(rmsToDbfs(0.5) + 6.02) < 0.02);
  check('a tenth is -20', Math.abs(rmsToDbfs(0.1) + 20) < 1e-9);
  check('silence floors rather than going to -Infinity', rmsToDbfs(0) === SCREAM_DB_FLOOR);
  check('and so does a negative', rmsToDbfs(-1) === SCREAM_DB_FLOOR);
  check('nothing exceeds full scale', rmsToDbfs(4) === 0);
  check('NaN is the floor, not NaN', rmsToDbfs(Number.NaN) === SCREAM_DB_FLOOR);
  check('it is monotonic', rmsToDbfs(0.01) < rmsToDbfs(0.1) && rmsToDbfs(0.1) < rmsToDbfs(0.9));
}

function scoring(): void {
  console.log('\nthe score is relative to the room (§5)');

  check('a full span above the floor is 100', screamScore(-10, -10 - SCREAM_DB_SPAN) === 100);
  check('nothing at all above it is 0', screamScore(-55, -55) === 0);
  check('halfway is about 50', Math.abs(screamScore(-55 + SCREAM_DB_SPAN / 2, -55) - 50) <= 1);
  check('quieter than the floor is still 0, never negative', screamScore(-70, -55) === 0);
  check('louder than the span is still 100, never more', screamScore(0, -80) === 100);

  /*
   * The whole point of the floor: the same *scream* in a noisy room and a quiet
   * one has to score about the same, or the game rewards the room rather than
   * the player. A scream sits a fixed number of dB above whatever the room is
   * doing, so this compares equal margins.
   */
  const quietRoom = screamScore(-55 + 30, -55);
  const noisyRoom = screamScore(-40 + 30, -40);
  check(`30 dB over the floor scores the same in a quiet and a noisy room (${quietRoom} vs ${noisyRoom})`, quietRoom === noisyRoom);

  check('a NaN reading scores nothing rather than NaN', screamScore(Number.NaN, -55) === 0);
  check('and a NaN floor too', screamScore(-20, Number.NaN) === 0);
}

function theWindow(): void {
  console.log('\nthe loudest sustained window (§2, §8)');

  const quiet = -55;
  const loud = -12;

  // A bark: one frame, very loud. This is the exploit, and it must not win.
  const bark = run(quiet, 0, 4_000, SCREAM_SAMPLE_MS);
  // A real scream: three seconds of loud, and not as loud as a knuckle.
  const scream = run(quiet, loud, 3_000, SCREAM_SUSTAIN_MS);

  const barkScore = loudestWindow(bark, SCREAM_SUSTAIN_MS, SCREAM_SAMPLE_MS);
  const screamScoreDb = loudestWindow(scream, SCREAM_SUSTAIN_MS, SCREAM_SAMPLE_MS);
  check(
    `a full-scale bark (${barkScore.toFixed(1)} dB) loses to three seconds of a real scream (${screamScoreDb.toFixed(1)} dB)`,
    barkScore < screamScoreDb,
    { barkScore, screamScoreDb },
  );
  check('even though the bark has the higher peak', peakOf(bark) > peakOf(scream));

  // A whole-window hold is worth no more than a three-second one: otherwise
  // the game becomes a breath-holding contest.
  const held = run(quiet, loud, 0, SCREAM_WINDOW_MS);
  check(
    'holding it for the whole ten seconds is worth no more than three',
    Math.abs(loudestWindow(held, SCREAM_SUSTAIN_MS, SCREAM_SAMPLE_MS) - screamScoreDb) < 0.01,
  );

  // Two seconds is worth less than three: it is a *sustain* window.
  const brief = run(quiet, loud, 3_000, 2_000);
  check('two seconds is worth less than three', loudestWindow(brief, SCREAM_SUSTAIN_MS, SCREAM_SAMPLE_MS) < screamScoreDb);
  check('but more than nothing', loudestWindow(brief, SCREAM_SUSTAIN_MS, SCREAM_SAMPLE_MS) > quiet);

  // It really finds the loudest stretch, wherever it is.
  for (const from of [0, 1_500, 4_000, SCREAM_WINDOW_MS - SCREAM_SUSTAIN_MS]) {
    const shifted = run(quiet, loud, from, SCREAM_SUSTAIN_MS);
    const found = loudestWindow(shifted, SCREAM_SUSTAIN_MS, SCREAM_SAMPLE_MS);
    if (Math.abs(found - screamScoreDb) > 0.5) {
      check(`the loudest stretch is found at ${from} ms`, false, { from, found, screamScoreDb });
      return;
    }
  }
  check('the loudest stretch is found wherever it sits in the window', true);

  check('an empty run is the floor', loudestWindow([], SCREAM_SUSTAIN_MS, SCREAM_SAMPLE_MS) === SCREAM_DB_FLOOR);
  check('a single sample is itself', loudestWindow([-30], SCREAM_SUSTAIN_MS, SCREAM_SAMPLE_MS) === -30);

  /*
   * A run shorter than the window averages what there is (spec §7): a phone
   * backgrounded halfway through reports what it managed, and the referee
   * flags it rather than scoring it as a full ten seconds.
   */
  const partial = run(quiet, loud, 0, 1_000, 1_000);
  check('a partial run averages what it got', Math.abs(loudestWindow(partial, SCREAM_SUSTAIN_MS, SCREAM_SAMPLE_MS) - loud) < 0.01);
}

function floorAndPeak(): void {
  console.log('\nthe floor and the peak (§5, §8)');

  check('the floor is the mean of the calibration', Math.abs(floorOf([-50, -60]) + 55) < 1e-9);
  check('an empty calibration is the floor constant', floorOf([]) === SCREAM_DB_FLOOR);
  /*
   * The mean, not the minimum: a minimum over a second of samples is whatever
   * the quietest single frame happened to be, which measures the gaps between
   * the room's noise rather than the noise.
   */
  const spiky = [-60, -60, -60, -20];
  check('one loud frame during calibration raises the floor rather than being ignored', floorOf(spiky) > -60);

  check('the peak is the loudest sample', peakOf([-50, -12, -30]) === -12);
  check('an empty run has no peak', peakOf([]) === SCREAM_DB_FLOOR);
}

function prompts(): void {
  console.log('\nthe prompt is a costume (§3)');

  check('there are six of them', SCREAM_PROMPTS.length === 6);
  check('four vowels and two pitches', SCREAM_PROMPTS.filter((p) => p === 'high' || p === 'low').length === 2);

  // Dealt from the referee's own randomness, and every one is reachable.
  const seen = new Set<string>();
  let h = 7;
  const random = (): number => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 4294967296;
  };
  for (let i = 0; i < 400; i++) seen.add(dealPrompt(random));
  check(`every prompt comes up (${seen.size}/${SCREAM_PROMPTS.length})`, seen.size === SCREAM_PROMPTS.length, [...seen]);
  check('a 0 deals the first', dealPrompt(() => 0) === SCREAM_PROMPTS[0]);
  check('a 1 deals the last, not past the end', dealPrompt(() => 1) === SCREAM_PROMPTS[SCREAM_PROMPTS.length - 1]);

  check('a known prompt is recognised', isScreamPrompt('ooo'));
  check('an unknown one is not', !isScreamPrompt('screech'));
  check('and neither is a number', !isScreamPrompt(3));

  /*
   * Nothing here scores a prompt, and there is deliberately no function that
   * could: verifying a vowel would make the game unfair in exactly the way a
   * party game must not be (spec §3). Asserted as an absence so a future
   * "improvement" has to delete this line to add one.
   */
  check('nothing in this module can score a prompt', !Object.keys({ dealPrompt, isScreamPrompt }).some((k) => /match|verify|score.*prompt/i.test(k)));
}

decibels();
scoring();
theWindow();
floorAndPeak();
prompts();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
