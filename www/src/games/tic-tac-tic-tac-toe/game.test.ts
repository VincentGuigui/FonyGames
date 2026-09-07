import type { TttState } from '../../../../shared/protocol';
import { tttWinner, tttWinningLine } from '../../../../shared/ticTacTicTacToe';
import { TTT_PULSE_COUNT, TTT_PULSE_MS, TTT_STAMP_MS, finaleLine, finaleStage } from './game';

/**
 * Tic-Tac-Tic-Tac-Toe's winning finale.
 * Spec: docs/specs/games/tic-tac-tic-tac-toe.md §4
 *
 * The referee decides `phase: 'over'` on the tap that wins the meta grid, and
 * everything here is about what the phone does with the five seconds after
 * that: which three cells to pulse, and which matches get a celebration at all.
 * A draw and a timed-out match must not — holding a winner's send-off over
 * either would be the game lying about what happened.
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

function state(over: Partial<TttState>): TttState {
  return {
    roundId: 1,
    phase: 'over',
    symbols: { a: 'x', b: 'o' },
    meta: Array(9).fill(null),
    small: Array(9).fill(null),
    selectedMeta: 0,
    chooser: null,
    turn: null,
    miniWinner: 'x',
    winner: 'a',
    draw: false,
    startsAt: 0,
    zoomAt: 0,
    reopened: [],
    reopenedAt: 0,
    endsAt: 0,
    ...over,
  };
}

function theLine(): void {
  console.log('\nwhich three cells actually won it');

  check('a top row is found', JSON.stringify(tttWinningLine(['x', 'x', 'x', null, null, null, null, null, null])) === '[0,1,2]');
  check('a column too', JSON.stringify(tttWinningLine(['o', null, null, 'o', null, null, 'o', null, null])) === '[0,3,6]');
  check('and a diagonal', JSON.stringify(tttWinningLine(['x', null, null, null, 'x', null, null, null, 'x'])) === '[0,4,8]');
  check('an unfinished grid has none', tttWinningLine(['x', 'o', 'x', null, null, null, null, null, null]) === null);

  // Three draws in a row are three closed boards, not a win — the one case a
  // naive equality check gets wrong, and the reason `tttWinner` excludes it.
  check('three drawn boards in a row are not a line',
    tttWinningLine(['draw', 'draw', 'draw', null, null, null, null, null, null]) === null);

  // The two must always describe the same win, or the finale would pulse a
  // line the result panel disagrees with.
  const meta = ['o', 'x', 'x', 'x', 'o', null, 'x', null, 'o'] as const;
  const line = tttWinningLine(meta);
  check('the line and the winner agree on who won',
    !!line && line.every((cell) => meta[cell] === tttWinner(meta)), { line, winner: tttWinner(meta) });
}

function whoGetsAFinale(): void {
  console.log('\nwhich endings earn a celebration');

  const won = state({ meta: ['x', 'x', 'x', 'o', 'o', null, null, null, null] });
  check('a real meta win does', JSON.stringify(finaleLine(won)) === '[0,1,2]');

  check('a draw does not',
    finaleLine(state({ draw: true, winner: null, meta: ['draw', 'draw', 'draw', 'x', 'o', 'x', 'o', 'x', 'o'] })) === null);
  check('nor does the five-minute cap, which ends with no winner',
    finaleLine(state({ winner: null, draw: true, meta: ['x', 'o', null, null, null, null, null, null, null] })) === null);
  check('nor does a match still being played',
    finaleLine(state({ phase: 'playing', winner: null, meta: ['x', 'x', 'x', null, null, null, null, null, null] })) === null);

  // Solo puts one player in both seats, and a solo win is still a win worth
  // showing — the line is what is celebrated, not the name.
  check('a solo win still gets one',
    JSON.stringify(finaleLine(state({ meta: [null, null, 'o', null, 'o', null, 'o', null, null] }))) === '[2,4,6]');
}

function theBeats(): void {
  console.log('\ntwo beats, then the results');

  check('the winning child grid holds the screen first', finaleStage(0) === 'stamp');
  check('and keeps it for the whole two seconds', finaleStage(TTT_STAMP_MS - 1) === 'stamp');
  check('then the line takes over', finaleStage(TTT_STAMP_MS) === 'line');
  check('for three seconds of pulsing', finaleStage(TTT_STAMP_MS + TTT_PULSE_MS - 1) === 'line');
  check('and only then the results panel', finaleStage(TTT_STAMP_MS + TTT_PULSE_MS) === 'done');
  check('which is where it stays', finaleStage(60_000) === 'done');

  check('the whole thing is five seconds', TTT_STAMP_MS + TTT_PULSE_MS === 5_000);
  check('and the pulse count follows from its own length rather than being a third number',
    TTT_PULSE_COUNT === 3, TTT_PULSE_COUNT);
}

for (const t of [theLine, whoGetsAFinale, theBeats]) t();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
