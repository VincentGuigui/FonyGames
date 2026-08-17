import {
  SQUASH_GRID_COLS,
  SQUASH_STATIC_COUNT,
  squashFlies,
  type ServerMessage,
  type SquashState,
} from '../../../../shared/protocol';
import { SquashGame, wander } from './game';

/**
 * Squash Mosquitoes, client side. Spec: docs/specs/games/squash-mosquitoes.md
 *
 * This is the half of the game that has no referee to catch a mistake: which cell
 * a pattern index actually lives at, whether a mosquito flies, and where a flying
 * one currently is. All three are pure functions, so they get pure checks.
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

/** A pattern where index i lives at cell i — makes row/col arithmetic easy to check. */
const IDENTITY_PATTERN = Array.from({ length: 66 }, (_, i) => i);

function state(over: Partial<SquashState> = {}): SquashState {
  return {
    roundId: 1,
    startsAt: 0,
    endsAt: 100_000,
    pattern: IDENTITY_PATTERN,
    scores: { [ME]: 0, [OTHER]: 0 },
    winner: null,
    phase: 'running',
    ...over,
  };
}

function squashMsg(d: SquashState): ServerMessage {
  return { t: 'squash', s: 1, d };
}

function boardMsg(active: number[], squashed: number[]): ServerMessage {
  return { t: 'squash-board', s: 1, d: { roundId: 1, board: { active, squashed } } };
}

function seeing(): void {
  console.log('\nan index resolves to a cell, a row and a column');
  const g = new SquashGame();
  g.identify(ME, () => 0);
  g.apply(squashMsg(state()));
  g.apply(boardMsg([0, 1, SQUASH_GRID_COLS, SQUASH_STATIC_COUNT], []));

  const byIndex = new Map(g.active().map((v) => [v.index, v]));
  check('index 0 sits at row 0, col 0', byIndex.get(0)?.row === 0 && byIndex.get(0)?.col === 0);
  check(
    'index equal to the row width wraps to the next row',
    byIndex.get(SQUASH_GRID_COLS)?.row === 1 && byIndex.get(SQUASH_GRID_COLS)?.col === 0,
  );
  check('static, one below the boundary', byIndex.get(SQUASH_STATIC_COUNT - 1) === undefined);
  check('flying, exactly at the boundary', byIndex.get(SQUASH_STATIC_COUNT)?.flying === true);
  check('and index 1 is still static', byIndex.get(1)?.flying === false);

  // squashFlies is the pure boundary both the client and the spec's prose lean on.
  check('one below the boundary does not fly', !squashFlies(SQUASH_STATIC_COUNT - 1));
  check('the boundary itself flies', squashFlies(SQUASH_STATIC_COUNT));
}

function boardsAndScores(): void {
  console.log('\nmy board, and everyone\'s count');
  const g = new SquashGame();
  g.identify(ME, () => 0);
  g.apply(squashMsg(state({ scores: { [ME]: 3, [OTHER]: 5 } })));
  g.apply(boardMsg([4, 5], [0, 1, 2]));

  check('my squashed count comes from the shared scores', g.mySquashed === 3);
  check('the shared scoreboard has everyone', g.scores()[OTHER] === 5);

  check('three squashed marks', g.squashed().length === 3);
  check('two active', g.active().length === 2);
  check('a squashed mark carries its own index', g.squashed().map((v) => v.index).sort().join() === '0,1,2');

  check('a spawned, unsquashed cell is tappable', g.indexAt(4) === 4);
  check('an already-squashed cell is not', g.indexAt(0) === null);
  check('a cell nothing has spawned on is not', g.indexAt(9) === null);
  check('a cell outside the pattern entirely is not', g.indexAt(9999) === null);

  check('before any frame arrives, nothing is active', new SquashGame().active().length === 0);
}

function ending(): void {
  console.log('\nphase and winner ride the shared frame');
  const g = new SquashGame();
  g.identify(ME, () => 0);
  g.apply(squashMsg(state()));
  check('running, no winner', g.phase === 'running' && g.winner === null);

  g.apply(squashMsg(state({ phase: 'done', winner: OTHER })));
  check('done, with a winner', g.phase === 'done' && g.winner === OTHER);
}

function wandering(): void {
  console.log('\nthe flying wander');

  let inBounds = true;
  for (let index = 0; index < 66; index++) {
    for (let ms = 0; ms < 20_000; ms += 137) {
      const { dx, dy } = wander(index, ms);
      if (dx < -0.5 || dx > 0.5 || dy < -0.5 || dy > 0.5) inBounds = false;
    }
  }
  check('never strays outside its own half of the cell', inBounds);

  const a = wander(40, 12_345);
  const b = wander(40, 12_345);
  check('the same index at the same instant is the same spot', a.dx === b.dx && a.dy === b.dy);

  const x = wander(1, 5_000);
  const y = wander(2, 5_000);
  check('two different mosquitoes do not move in lockstep', x.dx !== y.dx || x.dy !== y.dy);

  const early = wander(7, 1_000);
  const later = wander(7, 1_500);
  check('and the same one actually moves as time passes', early.dx !== later.dx || early.dy !== later.dy);
}

for (const t of [seeing, boardsAndScores, ending, wandering]) t();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
