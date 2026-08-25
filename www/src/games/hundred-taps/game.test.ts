import { TAPS100_TOTAL, type ServerMessage, type Taps100State } from '../../../../shared/protocol';
import {
  Taps100Game,
  TAPS100_ROW_COUNTS,
  TAPS100_ROW_STARTS,
  TAPS100_WINDOW_SIZE,
  cellColor,
  elapsedMs,
  formatClock,
} from './game';

/**
 * 100 Taps, client side. Spec: docs/specs/games/hundred-taps.md
 *
 * `Taps100Game` has no referee to catch a mistake either — it only projects the
 * public state and this phone's own private cleared history into what the board
 * and the timeline draw. `formatClock` and `cellColor` are the other two pure
 * things worth a direct check.
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

/** An order where index i labels cell i with number i+1 — makes the arithmetic easy to check. */
const IDENTITY_ORDER = Array.from({ length: TAPS100_TOTAL }, (_, i) => i);

function state(over: Partial<Taps100State> = {}): Taps100State {
  return {
    roundId: 1,
    startsAt: 0,
    endsAt: 100_000,
    order: IDENTITY_ORDER,
    remaining: { [ME]: TAPS100_TOTAL, [OTHER]: TAPS100_TOTAL },
    finishedAt: { [ME]: null, [OTHER]: null },
    winner: null,
    phase: 'running',
    ...over,
  };
}

function taps100Msg(d: Taps100State): ServerMessage {
  return { t: 'taps100', s: 1, d };
}

function progressMsg(roundId: number, cleared: number[]): ServerMessage {
  return { t: 'taps100-progress', s: 1, d: { roundId, cleared } };
}

function numbering(): void {
  console.log('\nnumbers() is order inverted: cell order[k] shows k+1');
  const g = new Taps100Game();
  g.apply(taps100Msg(state({ order: [5, 0, 3, ...Array.from({ length: 97 }, (_, i) => i + 6).filter((c) => ![5, 0, 3].includes(c))] })));
  const numbers = g.numbers();
  check('cell 5 shows 1 (it is order[0])', numbers[5] === 1);
  check('cell 0 shows 2 (it is order[1])', numbers[0] === 2);
  check('cell 3 shows 3 (it is order[2])', numbers[3] === 3);
}

function progressing(): void {
  console.log('\nclearing advances progress and marks cells gone');
  const g = new Taps100Game();
  g.apply(taps100Msg(state()));

  check('nothing cleared yet', g.progress === 0);
  check('nothing is gone yet', g.goneCells().size === 0);
  check('remaining is the full board', g.remaining === TAPS100_TOTAL);

  g.apply(progressMsg(1, [0]));
  check('progress advances to what the server said', g.progress === 1);
  check('cell 0 is gone', g.goneCells().has(0));
  check('cell 1 is still live', !g.goneCells().has(1));
}

function rewinding(): void {
  console.log('\na checkpoint rewind is carried in the same message, going down instead of up');
  const g = new Taps100Game();
  g.apply(taps100Msg(state()));
  g.apply(progressMsg(1, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
  check('13 in', g.progress === 13);

  g.apply(progressMsg(1, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  check('rewound to the checkpoint', g.progress === 10);
  check('cells 10-12 are un-gone again', !g.goneCells().has(10) && !g.goneCells().has(12));
  check('cells 0-9 stay gone', [...Array(10).keys()].every((c) => g.goneCells().has(c)));
}

function freshRound(): void {
  console.log('\na new roundId resets my own cleared history, even before the first progress message');
  const g = new Taps100Game();
  g.apply(taps100Msg(state()));
  g.apply(progressMsg(1, [0, 1, 2, 3, 4, 5, 6]));
  check('7 in', g.progress === 7);

  g.apply(taps100Msg(state({ roundId: 2 })));
  check('a new round starts my progress back at zero', g.progress === 0);
}

function stalenessAndPrivacy(): void {
  console.log('\na progress message for a stale round is ignored; other players stay in `remaining` only');
  const g = new Taps100Game();
  g.apply(taps100Msg(state()));
  g.apply(progressMsg(1, [0, 1, 2, 3, 4]));
  g.apply(progressMsg(99, Array.from({ length: 80 }, (_, i) => i))); // some other, already-over round
  check('the stale message changed nothing', g.progress === 5);

  const remaining = g.remainingByPlayer();
  check('the shared panel sees counts for everyone', remaining[ME] === TAPS100_TOTAL && remaining[OTHER] === TAPS100_TOTAL);
}

function windowing(): void {
  console.log('\nenabledCells() is the next TAPS100_WINDOW_SIZE due, in board position');
  const g = new Taps100Game();
  g.apply(taps100Msg(state()));

  // IDENTITY_ORDER: order[k] === k, so cell k shows number k+1 and the window
  // at zero progress is simply cells 0..WINDOW_SIZE-1.
  const atStart = g.enabledCells();
  check('the window has exactly WINDOW_SIZE cells', atStart.size === TAPS100_WINDOW_SIZE, atStart.size);
  check('it starts at cell 0', atStart.has(0) && !atStart.has(TAPS100_WINDOW_SIZE));
  check('cell WINDOW_SIZE - 1 is the last one in it', atStart.has(TAPS100_WINDOW_SIZE - 1));

  g.apply(progressMsg(1, [0, 1, 2]));
  const afterThree = g.enabledCells();
  check('the window slides with progress', !afterThree.has(0) && !afterThree.has(1) && !afterThree.has(2));
  check('and still holds WINDOW_SIZE cells', afterThree.size === TAPS100_WINDOW_SIZE, afterThree.size);
  check('cell 3 (the next due) is in it', afterThree.has(3));
  check('cell 2 (just cleared) is not', !afterThree.has(2));

  console.log('\nnear the end, the window is whatever is left, never past the board');
  g.apply(progressMsg(1, Array.from({ length: TAPS100_TOTAL - 3 }, (_, i) => i)));
  const nearEnd = g.enabledCells();
  check('only the last three cells remain enabled', nearEnd.size === 3, nearEnd.size);
  check('they are the last three in order', [97, 98, 99].every((c) => nearEnd.has(c)));

  console.log('\na checkpoint rewind carries the window back with it');
  g.apply(taps100Msg(state()));
  g.apply(progressMsg(1, Array.from({ length: 13 }, (_, i) => i)));
  g.apply(progressMsg(1, Array.from({ length: 10 }, (_, i) => i)));
  const afterRewind = g.enabledCells();
  check('the window is back to starting at cell 10', afterRewind.has(10) && !afterRewind.has(9));
  check('cells the rewind un-cleared are enabled again', afterRewind.has(10) && afterRewind.has(11) && afterRewind.has(12));

  console.log('\nno state at all means no window, not a crash');
  const fresh = new Taps100Game();
  check('an empty game has no enabled cells', fresh.enabledCells().size === 0);
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

function gradient(): void {
  console.log('\ncellColor: a hue wheel keyed by a cell\'s own printed number, decorative only');
  const n = TAPS100_TOTAL;
  check('every colour is a well-formed hsl() string', /^hsl\(-?\d+(\.\d+)?deg 75% 55%\)$/.test(cellColor(1, n)));

  check('number 1 sits at the red end of the wheel (hue 0)', cellColor(1, n) === 'hsl(0.0deg 75% 55%)');
  const last = cellColor(n, n);
  check('the last number is short of a full turn back to red', last !== cellColor(1, n) && last === 'hsl(300.0deg 75% 55%)');

  const mid = cellColor(Math.floor(n / 2), n);
  check('the middle number is a distinct hue from either end', mid !== cellColor(1, n) && mid !== last);

  check('hue climbs with the number, not with board position',
    cellColor(10, n) !== cellColor(90, n) && cellColor(1, n) !== cellColor(2, n));

  check('a single-cell board does not divide by zero', cellColor(1, 1) === 'hsl(0.0deg 75% 55%)');
}

function rowShape(): void {
  console.log('\nTAPS100_ROW_COUNTS / TAPS100_ROW_STARTS: six, centred, top and bottom; eight across between');
  check('thirteen rows', TAPS100_ROW_COUNTS.length === 13);
  check('first row has six cells', TAPS100_ROW_COUNTS[0] === 6);
  check('last row has six cells', TAPS100_ROW_COUNTS[TAPS100_ROW_COUNTS.length - 1] === 6);
  check('the eleven rows between have eight cells each', TAPS100_ROW_COUNTS.slice(1, -1).every((c) => c === 8));
  check('the rows sum to the whole board', TAPS100_ROW_COUNTS.reduce((a, b) => a + b, 0) === TAPS100_TOTAL);

  check('one start per row', TAPS100_ROW_STARTS.length === TAPS100_ROW_COUNTS.length);
  check('the first row starts at cell 0', TAPS100_ROW_STARTS[0] === 0);
  check('the second row starts right after the first', TAPS100_ROW_STARTS[1] === 6);
  check('the last row starts at 94 (6 + 11*8)', TAPS100_ROW_STARTS[TAPS100_ROW_STARTS.length - 1] === 94);
}

for (const t of [numbering, progressing, rewinding, freshRound, stalenessAndPrivacy, windowing, clock, gradient, rowShape]) t();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log(`\nall ${checks} passed`);
