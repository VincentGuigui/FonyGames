import { TAPTAP_TOTAL } from '../../../../shared/protocol';

/**
 * The tune, one note per correct tap.
 * Spec: docs/specs/games/tap-tap-revolution.md §5b · played by `tune.ts`
 *
 * The exact song Shake Rush plays (`shake-rush/melody.ts`), copied rather than
 * imported — every game's sound is its own leaf file, the same reasoning
 * `docs/design/illustrations.md` §3 gives for art. `RUSH_DISTANCE` and
 * `TAPTAP_TOTAL` are both 100, so the doubled phrase lands on this board exactly
 * as it does on that track: fifty-four notes, twice, with eight left over that
 * `tune.ts` plays as the finishing cadence the moment the 100th cell clears.
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

/** The phrase, twice through. One note per tap, from the off. */
export const MELODY: readonly string[] = [...PHRASE, ...PHRASE];

/**
 * How many notes are still unplayed when a player clears the 100th cell.
 *
 * `tune.ts` plays exactly these, on its own, at the finish. Negative would mean
 * the song runs out before the board does — see the test.
 */
export const NOTES_AFTER_THE_LAST_CELL = MELODY.length - TAPTAP_TOTAL;

/**
 * The note for progress index `i` into the board, wrapping if it ever overshoots.
 *
 * Indexed by **progress**, not by a running tap count: a checkpoint rewind moves
 * progress backwards, and the next correct tap has to sing the same note it would
 * have if the miss had never happened — otherwise the tune would audibly skip
 * ahead of a board that just gave ground back.
 */
export function noteFor(index: number): string {
  const i = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  return MELODY[i % MELODY.length] as string;
}
