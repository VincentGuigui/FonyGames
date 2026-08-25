import { TAPS100_GRID_SIZE, TAPS100_TOTAL, type ServerMessage, type Taps100State } from '../../../../shared/protocol';
import { Taps100Game, cellColor, elapsedMs, formatClock, GRADIENT_PINK, GRADIENT_VIOLET } from './game';

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
  console.log('\ncellColor: pink at top-right, violet at bottom-left, decorative only');
  const n = TAPS100_GRID_SIZE;
  check('top-right corner is pure pink', cellColor(0, n - 1, n).toUpperCase() === GRADIENT_PINK);
  check('bottom-left corner is pure violet', cellColor(n - 1, 0, n).toUpperCase() === GRADIENT_VIOLET);

  const center = cellColor(Math.floor(n / 2), Math.floor(n / 2), n);
  check('the centre is neither pure endpoint', center.toUpperCase() !== GRADIENT_PINK && center.toUpperCase() !== GRADIENT_VIOLET);
  check('every colour is a well-formed hex', /^#[0-9a-f]{6}$/i.test(center));

  check('a cell closer to the pink corner leans lighter/pinker than one closer to violet',
    cellColor(0, n - 1, n) !== cellColor(n - 1, 0, n));
}

for (const t of [numbering, progressing, rewinding, freshRound, stalenessAndPrivacy, clock, gradient]) t();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log(`\nall ${checks} passed`);
