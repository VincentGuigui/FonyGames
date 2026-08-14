import { RUSH_DISTANCE } from '../../../../shared/protocol';

/**
 * The tune, one note per shake.
 * Spec: docs/specs/games/shake-rush.md §5b · played by `tune.ts`
 *
 * Exactly `RUSH_DISTANCE` notes, so an honest runner hears the whole thing once and it
 * lands on the last note as they cross the line. That is the only rule this file has, and
 * `game.test.ts` enforces it — a list of the wrong length would either repeat or cut off,
 * and neither reads as a finish.
 *
 * ## Replacing it
 *
 * This is the one file to touch. Swap the array for any melody you have the right to use,
 * keep it `RUSH_DISTANCE` long, and nothing else changes: `tune.ts` only ever asks for
 * `MELODY[i]` and does not care what is in it.
 *
 * Note names are scientific pitch — `D4` is middle D, `C#5` a semitone above the C above
 * it. Tone.js parses them directly.
 *
 * **The melody below is original, written for this game.** A recognisable film theme was
 * asked for and is not here: those are copyrighted compositions, and transcribing one into
 * a repository is copying it. A tune out of copyright, or one you wrote, drops straight in.
 *
 * ## What it is
 *
 * D harmonic minor, five sections of twenty-four, each starting higher than the last —
 * so the pitch climbs as the runner does and the last stretch is the shrillest. It is
 * arpeggios rather than steps because at up to eight notes a second (`SHAKE_RATE_CAP`) a
 * stepwise line turns to mush, while a leaping one stays legible.
 */
export const MELODY: readonly string[] = [
  // 1 — down low, the first quarter of the track.
  'D3', 'F3', 'A3', 'D4', 'C4', 'A3', 'F3', 'A3',
  'G3', 'Bb3', 'D4', 'G4', 'F4', 'D4', 'Bb3', 'D4',
  'A3', 'C#4', 'E4', 'A4', 'G4', 'E4', 'C#4', 'E4',

  // 2 — the same shape an octave up.
  'D4', 'F4', 'A4', 'D5', 'C5', 'A4', 'F4', 'A4',
  'G4', 'Bb4', 'D5', 'G5', 'F5', 'D5', 'Bb4', 'D5',
  'A4', 'C#5', 'E5', 'A5', 'G5', 'E5', 'C#5', 'E5',

  // 3 — stepwise for contrast, a breath before the last third.
  'D4', 'E4', 'F4', 'G4', 'A4', 'Bb4', 'C#5', 'D5',
  'C#5', 'Bb4', 'A4', 'G4', 'F4', 'E4', 'D4', 'E4',
  'F4', 'G4', 'A4', 'Bb4', 'C#5', 'D5', 'E5', 'F5',

  // 4 — climbing.
  'A4', 'D5', 'F5', 'A5', 'G5', 'F5', 'D5', 'F5',
  'Bb4', 'D5', 'G5', 'Bb5', 'A5', 'G5', 'D5', 'G5',
  'C#5', 'E5', 'A5', 'C#6', 'Bb5', 'A5', 'E5', 'A5',

  // 5 — the run in. Drops back once so the final rise has somewhere to come from.
  'D5', 'F5', 'A5', 'D6', 'C#6', 'A5', 'F5', 'A5',
  'G4', 'Bb4', 'D5', 'G5', 'F5', 'D5', 'Bb4', 'D5',
  'A4', 'C#5', 'E5', 'A5', 'G5', 'E5', 'C#5', 'D6',
];

/**
 * The note for a runner `shakes` into the race, wrapping if they overshoot.
 *
 * Wrapping rather than falling silent: the count can run past the line — the server clips
 * progress, not shaking — and a tune that stops while a player is still shaking reads as
 * the sound breaking.
 */
export function noteFor(shakes: number): string {
  const i = Number.isFinite(shakes) && shakes > 0 ? Math.floor(shakes) : 0;
  return MELODY[i % MELODY.length] as string;
}

/** The one invariant, exported so the test does not restate the number. */
export const MELODY_FITS_THE_TRACK = MELODY.length === RUSH_DISTANCE;
