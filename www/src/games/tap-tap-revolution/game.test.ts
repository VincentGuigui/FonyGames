import { TAPTAP_TOTAL, type ServerMessage, type TapTapState } from '../../../../shared/protocol';
import { TapTapGame, elapsedMs, formatClock } from './game';
import { MELODY, NOTES_AFTER_THE_LAST_CELL, noteFor } from './melody';

/**
 * Tap Tap Revolution, client side. Spec: docs/specs/games/tap-tap-revolution.md
 *
 * `TapTapGame` has no referee to catch a mistake either — it only projects the
 * public state and this phone's own private progress into what the board and the
 * timeline draw. `formatClock` and `noteFor` are the other two pure things worth
 * a direct check.
 */

let failures = 0;
let checks = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  checks++;
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

const ME = 'p-me';
const OTHER = 'p-other';

/** An order where index i lights cell i — makes the arithmetic easy to check. */
const IDENTITY_ORDER = Array.from({ length: TAPTAP_TOTAL }, (_, i) => i);

function state(over: Partial<TapTapState> = {}): TapTapState {
  return {
    roundId: 1,
    startsAt: 0,
    endsAt: 100_000,
    order: IDENTITY_ORDER,
    remaining: { [ME]: TAPTAP_TOTAL, [OTHER]: TAPTAP_TOTAL },
    finishedAt: { [ME]: null, [OTHER]: null },
    winner: null,
    phase: 'running',
    ...over,
  };
}

function taptapMsg(d: TapTapState): ServerMessage {
  return { t: 'taptap', s: 1, d };
}

function progressMsg(roundId: number, index: number): ServerMessage {
  return { t: 'taptap-progress', s: 1, d: { roundId, index } };
}

function progressing(): void {
  console.log('\nmy own progress lights a cell and hollows the rest');
  const g = new TapTapGame();
  g.apply(taptapMsg(state()));

  check('nothing cleared yet', g.progress === 0);
  check('cell 0 is lit', g.litCell() === 0);
  check('nothing is gone yet', g.goneCells().size === 0);
  check('remaining is the full board', g.remaining === TAPTAP_TOTAL);

  g.apply(progressMsg(1, 3));
  check('progress advances to what the server said', g.progress === 3);
  check('cell 3 is lit', g.litCell() === 3);
  check('cells 0, 1, 2 are gone', [...g.goneCells()].sort().join(',') === '0,1,2');
  check('remaining shrinks with it', g.remaining === TAPTAP_TOTAL - 3);
}

function rewinding(): void {
  console.log('\na checkpoint rewind is carried in the same message, going down instead of up');
  const g = new TapTapGame();
  g.apply(taptapMsg(state()));
  g.apply(progressMsg(1, 13));
  check('13 in', g.progress === 13);

  g.apply(progressMsg(1, 10));
  check('rewound to the checkpoint', g.progress === 10);
  check('cell 10 relit', g.litCell() === 10);
  check('only cells 0..9 are gone now', [...g.goneCells()].sort((a, b) => a - b).join(',') === Array.from({ length: 10 }, (_, i) => i).join(','));
}

function freshRound(): void {
  console.log('\na new roundId resets my own progress, even before the first progress message');
  const g = new TapTapGame();
  g.apply(taptapMsg(state()));
  g.apply(progressMsg(1, 47));
  check('47 in', g.progress === 47);

  g.apply(taptapMsg(state({ roundId: 2 })));
  check('a new round starts my progress back at zero', g.progress === 0);
  check('lit cell is the new order\'s first', g.litCell() === 0);
}

function stalenessAndPrivacy(): void {
  console.log('\na progress message for a stale round is ignored; other players stay in `remaining` only');
  const g = new TapTapGame();
  g.apply(taptapMsg(state()));
  g.apply(progressMsg(1, 5));
  g.apply(progressMsg(99, 80)); // some other, already-over round
  check('the stale message changed nothing', g.progress === 5);

  const remaining = g.remainingByPlayer();
  check('the shared panel sees counts for everyone', remaining[ME] === TAPTAP_TOTAL && remaining[OTHER] === TAPTAP_TOTAL);
}

function clock(): void {
  console.log('\nformatClock: SS.CC');
  check('zero', formatClock(0) === '00.00');
  check('under a second', formatClock(340) === '00.34');
  check('exactly one second', formatClock(1_000) === '01.00');
  check('twelve point three four', formatClock(12_340) === '12.34');
  check('past a minute wraps the seconds place, no minutes digit', formatClock(61_000) === '61.00');
  check('negative clamps to zero', formatClock(-50) === '00.00');
  check('NaN clamps to zero', formatClock(NaN) === '00.00');

  check('elapsed is now minus startsAt', elapsedMs(state({ startsAt: 1_000 }), 1_340) === 340);
  check('elapsed never goes negative, before the round has actually started', elapsedMs(state({ startsAt: 5_000 }), 1_000) === 0);
}

function melody(): void {
  console.log('\nthe melody: a hundred taps in, with a tail left for the finish');
  check('the phrase plays twice', MELODY.length === 108);
  check('some notes are left over for the finish', NOTES_AFTER_THE_LAST_CELL === MELODY.length - TAPTAP_TOTAL);
  check('a little left over, not none and not a lot', NOTES_AFTER_THE_LAST_CELL > 0 && NOTES_AFTER_THE_LAST_CELL < 20);
  check('note 0 is the phrase\'s first note', noteFor(0) === MELODY[0]);
  check('a rewind to 0 sings the same note it did the first time', noteFor(0) === noteFor(0));
  check('overshooting wraps rather than falling silent', noteFor(MELODY.length) === MELODY[0]);
}

for (const t of [progressing, rewinding, freshRound, stalenessAndPrivacy, clock, melody]) t();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log(`\nall ${checks} passed`);
