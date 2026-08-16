import {
  GRID_CELLS,
  GRID_FUSE_MS,
  GRID_TAP_WINDOW_MS,
  GRID_TAPS,
  type GridCell,
  type GridState,
  type ServerMessage,
} from '../../../../shared/protocol';
import { applyGrid, cellsOf, fuseProgress, livesOf, pulseMs, sides, tapCounter, type GridBoard } from './game';

/**
 * The phone's half of Grid Attack.
 * Spec: docs/specs/games/grid-attack.md
 *
 * The referee has its own suite. This covers the two things the phone decides for itself —
 * how far through a fuse a cell is, and how many taps to show — plus the ordering rule that
 * stops a late frame putting a cell back the way it was.
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

const A = 'p-a';
const B = 'p-b';
const T0 = 1_000_000;

const empty = (): GridCell[] => Array.from({ length: GRID_CELLS }, () => ({ gone: false, burstAt: 0 }));

function frame(s: number, over: Partial<GridState> = {}): ServerMessage {
  return {
    t: 'grid',
    s,
    d: {
      roundId: 1,
      grids: { [A]: empty(), [B]: empty() },
      lives: { [A]: 5, [B]: 5 },
      ready: { [A]: true, [B]: true },
      startsAt: T0,
      endsAt: T0 + 300_000,
      winner: null,
      phase: 'running',
      ...over,
    },
  };
}

console.log('\nthe board arrives whole');

let st: GridBoard = applyGrid(null, frame(1));
check('two grids', Object.keys(st?.grids ?? {}).length === 2);
check('sixteen cells each', cellsOf(st!, A).length === GRID_CELLS);
check('five lives each', livesOf(st!, A) === 5);
check('and it is running', st?.phase === 'running');

console.log('\nwhich half is which');

{
  const seats = sides(st!, A);
  check('mine is mine', seats?.mine === A);
  check('and theirs is the other one', seats?.theirs === B);
  // Before a seat is known there are no halves to draw, which is not an error.
  check('a player with no seat has no sides', sides(st!, undefined) === null);
  check('nor does a stranger', sides(st!, 'p-z') === null);
}

console.log('\na late frame cannot put a cell back');

{
  const lit = empty();
  lit[3] = { gone: false, burstAt: T0 + GRID_FUSE_MS };
  st = applyGrid(st, frame(2, { grids: { [A]: empty(), [B]: lit } }));
  check('a cell is lit', cellsOf(st!, B)[3]?.burstAt === T0 + GRID_FUSE_MS);

  const before = st;
  st = applyGrid(st, frame(1));
  check('an older frame is dropped', st === before);
  st = applyGrid(st, frame(2));
  check('and so is one with the same seq', st === before);

  // A new round restarts the numbering, so it is accepted however low its seq.
  const next = applyGrid(st, frame(1, { roundId: 2 }));
  check('a new round is accepted anyway', next?.roundId === 2);
  const stale = applyGrid(next, frame(9, { roundId: 1 }));
  check('while a frame from the finished round is not', stale === next);
}

console.log('\nhow far through a fuse a cell is');

{
  const idle: GridCell = { gone: false, burstAt: 0 };
  const gone: GridCell = { gone: true, burstAt: 0 };
  const lit: GridCell = { gone: false, burstAt: T0 + GRID_FUSE_MS };

  check('an idle cell has no fuse', fuseProgress(idle, T0) === null);
  check('nor does a hole', fuseProgress(gone, T0) === null);
  check('a fresh fuse is at nil', fuseProgress(lit, T0) === 0);
  check('halfway is a half', Math.abs((fuseProgress(lit, T0 + GRID_FUSE_MS / 2) ?? 0) - 0.5) < 1e-9);
  check('and at the end it is full', fuseProgress(lit, T0 + GRID_FUSE_MS) === 1);
  /*
   * Past the end matters: the burst is the SERVER's to declare, and its alarm can be a
   * moment late. A phone that carried on past 1 would draw a cell more finished than
   * finished, which at these speeds is a flicker of nonsense.
   */
  check('and never past it', fuseProgress(lit, T0 + GRID_FUSE_MS + 5_000) === 1);
}

console.log('\nthe pulse accelerates');

{
  check('a fresh cell flashes about once a second', pulseMs(0) === 1000);
  check('and a doomed one about ten times', pulseMs(1) === 100);
  // Monotonic, and faster at the end than the start — the whole point is that it reads as
  // running out of time rather than as a steady blink.
  let ok = true;
  for (let p = 0; p < 1; p += 0.05) ok &&= pulseMs(p) > pulseMs(p + 0.05);
  check('always speeding up, never slowing', ok);
  check('and the second half is where most of it happens',
    pulseMs(0) - pulseMs(0.5) < pulseMs(0.5) - pulseMs(1),
    { first: pulseMs(0) - pulseMs(0.5), second: pulseMs(0.5) - pulseMs(1) });
}

console.log('\ncounting your own taps, locally');

{
  const c = tapCounter();
  check('one tap shows one', c.tap(4, T0) === 1);
  check('two shows two', c.tap(4, T0 + 100) === 2);
  check('and the third completes the run', c.tap(4, T0 + 200) === GRID_TAPS);
  // The run is spent, so the next tap starts a new one rather than showing four.
  check('after which it starts again', c.tap(4, T0 + 300) === 1);

  // Cells count separately: you are usually part-way into several at once.
  const d = tapCounter();
  d.tap(1, T0);
  d.tap(2, T0);
  check('one cell does not count for another', d.showing(1, T0) === 1 && d.showing(2, T0) === 1);
  check('and a cell nobody touched shows nothing', d.showing(3, T0) === 0);

  /*
   * The same decay the referee applies, for the same reason — but here it is only so the
   * pips match what the server is doing. Pips that stayed lit after the server had given
   * up on the run would promise a tap that is not going to land.
   */
  const e = tapCounter();
  e.tap(0, T0);
  e.tap(0, T0 + 50);
  check('two showing', e.showing(0, T0 + 50) === 2);
  check('and gone once the window has passed', e.showing(0, T0 + 50 + GRID_TAP_WINDOW_MS + 1) === 0);
  check('so the next tap is a first one', e.tap(0, T0 + 50 + GRID_TAP_WINDOW_MS + 2) === 1);
}

console.log('\nthe end of it');

{
  const over = applyGrid(null, frame(1, { phase: 'done', winner: A, lives: { [A]: 3, [B]: 0 } }));
  check('done is done', over?.phase === 'done');
  check('with a winner', over?.winner === A);
  check('and the lives that decided it', livesOf(over!, B) === 0);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
