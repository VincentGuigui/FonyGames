import { RUSH_DISTANCE } from '../../../../shared/protocol';

/**
 * The tune, one note per shake.
 * Spec: docs/specs/games/shake-rush.md §5b · played by `tune.ts`
 *
 * ## The shape: a phrase, twice, and eight notes over
 *
 * `PHRASE` is the song — fifty-four notes, six lines of it. `MELODY` is that phrase
 * **twice**, so a hundred and eight notes for a hundred shakes. The eight left over are
 * not a mistake and not padding: they are the end of the song, and `tune.ts` plays them
 * by itself the moment a runner crosses the line (`finish()`). Reaching the finish and
 * hearing the tune land is one event rather than two, and nobody has to keep shaking an
 * already-won race to hear how it ends.
 *
 * That is why the old invariant — "exactly `RUSH_DISTANCE` notes" — is gone. The song
 * decides its own length; the track is a hundred shakes because that is the race
 * (`shared/protocol.ts`). The only thing that must hold is that there is a **little** left
 * over at the line rather than a lot, which `game.test.ts` checks: a phrase that came up
 * short would loop back to the start mid-run, and one that ran way over would leave a
 * finisher listening to a minute of automatic playback.
 *
 * ## Replacing it
 *
 * This is the one file to touch. Swap `PHRASE` for any melody you have the right to use;
 * `tune.ts` only ever asks for `MELODY[i]` and does not care what is in it. Keep it a bit
 * under half the track so the doubling still lands near the line.
 *
 * Note names are scientific pitch — `A4` is the A above middle C, `C#5` the C sharp above
 * that. Tone.js parses them directly.
 *
 * ## Reading the notation it came from
 *
 * Written down as `A-B  ^D-B  ^F# ^F# ^E`, where `^` is the octave above the base. The
 * base is **A4** rather than A3: a phone speaker has almost nothing below ~300 Hz, and the
 * lower octave was audible in a room and gone in a pocket. So the whole song sits in
 * A4–A5, which is where a small speaker is loudest.
 *
 * Hyphens in the source grouped notes into beats. They are dropped here, because a shake
 * IS the beat — the runner's arm is the rhythm section.
 */

/** The song. Six lines: 7, 9, 11, 7, 9, 11. */
export const PHRASE: readonly string[] = [
  // A-B  ^D-B  ^F# ^F# ^E
  'A4', 'B4', 'D5', 'B4', 'F#5', 'F#5', 'E5',

  // A-B  ^D-B  ^E ^E  ^D-^C#-B
  'A4', 'B4', 'D5', 'B4', 'E5', 'E5', 'D5', 'C#5', 'B4',

  // A-B  ^D-B  ^D  ^E-^C#  A  A-^E  ^D
  'A4', 'B4', 'D5', 'B4', 'D5', 'E5', 'C#5', 'A4', 'A4', 'E5', 'D5',

  // A-B  ^D-B  ^F#  ^F# ^E
  'A4', 'B4', 'D5', 'B4', 'F#5', 'F#5', 'E5',

  // A-B  ^D-B  ^A  ^C#-^D-^C#-B
  'A4', 'B4', 'D5', 'B4', 'A5', 'C#5', 'D5', 'C#5', 'B4',

  // A-B  ^D-B  ^D ^E ^C#-A  A  ^E  ^D
  'A4', 'B4', 'D5', 'B4', 'D5', 'E5', 'C#5', 'A4', 'A4', 'E5', 'D5',
];

/** The phrase, twice through. One note per shake, from the off. */
export const MELODY: readonly string[] = [...PHRASE, ...PHRASE];

/**
 * How many notes are still unplayed when a runner reaches the line.
 *
 * `tune.ts` plays exactly these, on its own, at the finish. Negative would mean the song
 * runs out before the race does — see the test.
 */
export const NOTES_AFTER_THE_LINE = MELODY.length - RUSH_DISTANCE;

/**
 * The note for a runner `shakes` into the race, wrapping if they overshoot.
 *
 * Wrapping rather than falling silent: the count can run past the end of the song — the
 * server clips progress, not shaking — and a tune that stops while a player is still
 * shaking reads as the sound breaking. In practice the wrap is rarely heard, because the
 * eight notes past the line are the ending and a finisher gets them either way.
 */
export function noteFor(shakes: number): string {
  const i = Number.isFinite(shakes) && shakes > 0 ? Math.floor(shakes) : 0;
  return MELODY[i % MELODY.length] as string;
}
