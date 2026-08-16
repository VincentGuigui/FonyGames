import {
  GRID_CELLS,
  GRID_FUSE_MS,
  GRID_LIVES,
  GRID_READY_WAIT_MS,
  GRID_TAP_WINDOW_MS,
  GRID_TAPS,
  type ServerMessage,
} from '../shared/protocol';
import {
  nextDeadline,
  onGridPlayerGone,
  onGridReady,
  onGridTap,
  onGridTick,
  startGrid,
  type Ctx,
  type Grid,
} from './gridAttack';

/**
 * Grid Attack's referee.
 * Spec: docs/specs/games/grid-attack.md
 *
 * Everything worth asserting here is a race, and every race is decided by one clock — so
 * the harness owns the clock and the tests read as "these things happened in this order",
 * which is exactly what the game is.
 *
 * Three rules carry the whole game and each of them fails silently if it is wrong:
 *
 * 1. **Three taps means three taps QUICKLY.** Progress that never decays lets an attacker
 *    leave two taps on all sixteen cells and finish them in one sweep, against a defender
 *    who cannot save sixteen in two seconds. The game would still run.
 * 2. **Tap progress never goes on the wire.** A cell says nothing to its owner until it is
 *    armed; a frame that leaked "somebody is two taps in" would hand over the game and
 *    look like a helpful feature.
 * 3. **The round waits for both phones.** Two seconds of being attacked while reading a
 *    fullscreen prompt is two seconds nobody played.
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

const A = 'p-a';
const B = 'p-b';

function harness() {
  let clock = 7_000_000;
  let seq = 0;
  let stored: Grid | null = null;
  const sent: ServerMessage[] = [];

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as Grid) : null),
    save: async (g) => {
      stored = JSON.parse(JSON.stringify(g)) as Grid;
    },
    setAlarm: async () => {},
  };

  return {
    ctx,
    sent,
    get now() {
      return clock;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    state: () => stored,
    last: () => [...sent].reverse().find((m) => m.t === 'grid') as
      | Extract<ServerMessage, { t: 'grid' }>
      | undefined,
    clear: () => void (sent.length = 0),
  };
}

/** Both phones ready, so the board is live. */
async function running() {
  const h = harness();
  await startGrid(h.ctx, 1, [A, B]);
  await onGridReady(h.ctx, A, 1);
  await onGridReady(h.ctx, B, 1);
  h.clear();
  return h;
}

/** `n` taps on one cell, each a beat apart but inside the window. */
async function tap(
  h: ReturnType<typeof harness>,
  who: string,
  cell: number,
  side: 'mine' | 'theirs',
  n = GRID_TAPS,
  gap = 100,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    await onGridTap(h.ctx, who, 1, cell, side);
    if (i < n - 1) h.advance(gap);
  }
}

async function startAndWait(): Promise<void> {
  console.log('\nthe round waits for both phones');

  const h = harness();
  check('two players can start', (await startGrid(h.ctx, 1, [A, B])) === true);
  check('one cannot', (await startGrid(harness().ctx, 1, [A])) === false);
  check('nor can three', (await startGrid(harness().ctx, 1, [A, B, 'p-c'])) === false);

  const opened = h.state();
  check('both grids are whole', opened?.grids[A]?.length === GRID_CELLS, opened?.grids[A]?.length);
  check(`with ${GRID_LIVES} lives each`, opened?.lives[A] === GRID_LIVES && opened?.lives[B] === GRID_LIVES);
  check('and nobody is playing yet', opened?.phase === 'waiting', opened?.phase);

  // THE rule: a tap before the board is live does nothing at all.
  await tap(h, A, 0, 'theirs');
  check('taps before the whistle count for nothing', h.state()?.grids[B]?.[0]?.burstAt === 0);

  await onGridReady(h.ctx, A, 1);
  check('one phone ready is not enough', h.state()?.phase === 'waiting', h.state()?.phase);
  check('but the room is told who is', h.last()?.d.ready[A] === true);

  await onGridReady(h.ctx, B, 1);
  check('both, and it begins', h.state()?.phase === 'running');
  check('with the clock starting now', h.state()?.startsAt === h.now, h.state()?.startsAt);

  // And nothing banked during the wait survives it.
  await tap(h, A, 0, 'theirs', GRID_TAPS - 1);
  check('a run started before the whistle is not continued', h.state()?.grids[B]?.[0]?.burstAt === 0);
}

async function readyTimeout(): Promise<void> {
  console.log('\nand gives up waiting eventually');

  const h = harness();
  await startGrid(h.ctx, 1, [A, B]);
  await onGridReady(h.ctx, A, 1);

  h.advance(GRID_READY_WAIT_MS - 1);
  await onGridTick(h.ctx);
  check('still waiting a moment before the deadline', h.state()?.phase === 'waiting');

  h.advance(2);
  await onGridTick(h.ctx);
  // A phone face down on a table must not strand the other player on a screen with no
  // way forward. The game starts; they are simply behind.
  check('and starts anyway when it runs out', h.state()?.phase === 'running', h.state()?.phase);
}

async function arming(): Promise<void> {
  console.log('\nthree quick taps light a cell');

  const h = await running();
  await tap(h, A, 5, 'theirs', GRID_TAPS - 1);
  check('two taps do nothing', h.state()?.grids[B]?.[5]?.burstAt === 0);
  check('and say nothing', h.last() === undefined, h.sent.length);

  await onGridTap(h.ctx, A, 1, 5, 'theirs');
  const lit = h.state()?.grids[B]?.[5];
  check('the third lights it', (lit?.burstAt ?? 0) > 0, lit);
  check('with a two-second fuse', lit?.burstAt === h.now + GRID_FUSE_MS, { at: lit?.burstAt, now: h.now });
  check('and NOW the room is told', h.last()?.d.grids[B]?.[5]?.burstAt === lit?.burstAt);

  // The one thing that must never travel: how far anybody is through a run.
  const frame = JSON.stringify(h.last());
  check('but never how many taps anyone has made', !/runs|taps/.test(frame), frame.slice(0, 120));
}

async function slowTaps(): Promise<void> {
  console.log('\nthree SLOW taps do not');

  const h = await running();
  /*
   * THE rule this game would break without. Progress that never decays lets an attacker
   * leave two taps on every cell at leisure and finish them all in one sweep — sixteen
   * cells armed at once against a defender who can save perhaps three.
   */
  await tap(h, A, 2, 'theirs', GRID_TAPS - 1);
  h.advance(GRID_TAP_WINDOW_MS + 1);
  await onGridTap(h.ctx, A, 1, 2, 'theirs');
  check('a tap after the window starts a new run', h.state()?.grids[B]?.[2]?.burstAt === 0);

  // Two more, quickly, and it lights: the run restarted rather than being lost.
  h.advance(50);
  await onGridTap(h.ctx, A, 1, 2, 'theirs');
  h.advance(50);
  await onGridTap(h.ctx, A, 1, 2, 'theirs');
  check('and finishing THAT run lights it', (h.state()?.grids[B]?.[2]?.burstAt ?? 0) > 0);
}

async function saving(): Promise<void> {
  console.log('\nthree taps save a cell of your own');

  const h = await running();
  await tap(h, A, 7, 'theirs');
  check('B has a lit cell', (h.state()?.grids[B]?.[7]?.burstAt ?? 0) > 0);

  h.advance(400);
  await tap(h, B, 7, 'mine', GRID_TAPS - 1);
  check('two taps do not put it out', (h.state()?.grids[B]?.[7]?.burstAt ?? 0) > 0);

  await onGridTap(h.ctx, B, 1, 7, 'mine');
  check('the third does', h.state()?.grids[B]?.[7]?.burstAt === 0);

  // And it stays out. Without clearing the attacker's spent run, one more tap from them
  // re-arms a cell that was just saved — which from the defender's side is the save
  // silently not working.
  h.advance(50);
  await onGridTap(h.ctx, A, 1, 7, 'theirs');
  check('and one more attacking tap does not re-light it', h.state()?.grids[B]?.[7]?.burstAt === 0);

  // The fuse really is gone, not merely hidden.
  h.advance(GRID_FUSE_MS + 100);
  await onGridTick(h.ctx);
  check('so it never bursts', h.state()?.grids[B]?.[7]?.gone === false);
  check('and B still has every life', h.state()?.lives[B] === GRID_LIVES);
}

async function bursting(): Promise<void> {
  console.log('\nan unsaved cell bursts, and costs a life');

  const h = await running();
  await tap(h, A, 3, 'theirs');

  h.advance(GRID_FUSE_MS - 10);
  await onGridTick(h.ctx);
  check('not a moment early', h.state()?.grids[B]?.[3]?.gone === false);

  h.advance(20);
  const over = await onGridTick(h.ctx);
  check('and then it goes', h.state()?.grids[B]?.[3]?.gone === true);
  check('taking a life with it', h.state()?.lives[B] === GRID_LIVES - 1, h.state()?.lives);
  check('the attacker loses nothing', h.state()?.lives[A] === GRID_LIVES);
  check('and the round carries on', over === false && h.state()?.phase === 'running');

  // A hole takes no more taps, from either side — there is nothing there.
  await tap(h, A, 3, 'theirs');
  check('a hole cannot be attacked again', h.state()?.grids[B]?.[3]?.burstAt === 0);
  check('and nobody loses a second life for it', h.state()?.lives[B] === GRID_LIVES - 1);
}

async function nonsense(): Promise<void> {
  console.log('\nwhat a crafted client cannot do');

  const h = await running();
  const before = JSON.stringify(h.state());

  await onGridTap(h.ctx, A, 1, -1, 'theirs');
  await onGridTap(h.ctx, A, 1, GRID_CELLS, 'theirs');
  await onGridTap(h.ctx, A, 1, 1.5, 'theirs');
  await onGridTap(h.ctx, A, 99, 0, 'theirs');
  await onGridTap(h.ctx, 'nobody', 1, 0, 'theirs');
  check('a cell off the board, a stale round, a stranger: all ignored',
    JSON.stringify(h.state()) === before);

  // Attacking your own grid, or defending one that is not lit, are both nothing —
  // there is only ever one thing a cell is waiting for.
  await tap(h, A, 4, 'mine');
  check('you cannot light your own cell', h.state()?.grids[A]?.[4]?.burstAt === 0);
  await tap(h, A, 4, 'theirs');
  await tap(h, A, 4, 'theirs');
  check('nor put out one of theirs by attacking it twice',
    (h.state()?.grids[B]?.[4]?.burstAt ?? 0) > 0);
}

async function ending(): Promise<void> {
  console.log('\nout of lives');

  const h = await running();
  let over = false;
  for (let i = 0; i < GRID_LIVES; i++) {
    await tap(h, A, i, 'theirs');
    h.advance(GRID_FUSE_MS + 10);
    over = await onGridTick(h.ctx);
  }

  check(`${GRID_LIVES} bursts ends it`, over === true, over);
  check('the board is done', h.state()?.phase === 'done');
  check('and the other player took it', h.state()?.winner === A, h.state()?.winner);
  check('with their lives intact', h.state()?.lives[A] === GRID_LIVES);

  // Nothing moves after the end.
  await tap(h, B, 9, 'theirs');
  check('a tap after the end does nothing', h.state()?.grids[A]?.[9]?.burstAt === 0);
}

async function walkout(): Promise<void> {
  console.log('\nsomebody walks off');

  const h = await running();
  await onGridPlayerGone(h.ctx, B);
  check('the round ends rather than carrying on alone', h.state()?.phase === 'done');
  check('and the one still there wins', h.state()?.winner === A, h.state()?.winner);
}

async function deadlines(): Promise<void> {
  console.log('\nwhen the room needs waking');

  const h = harness();
  await startGrid(h.ctx, 1, [A, B]);
  check('while waiting, at the end of the wait',
    nextDeadline(h.state() as Grid) === h.now + GRID_READY_WAIT_MS,
    nextDeadline(h.state() as Grid) - h.now);

  await onGridReady(h.ctx, A, 1);
  await onGridReady(h.ctx, B, 1);
  const capped = nextDeadline(h.state() as Grid);
  check('running with nothing lit, at the safety cap', capped === h.state()?.endsAt, capped);

  await tap(h, A, 11, 'theirs');
  check('and with a cell lit, at the soonest fuse',
    nextDeadline(h.state() as Grid) === h.state()?.grids[B]?.[11]?.burstAt);

  // Two cells: the sooner one wins, or the later one blows late.
  h.advance(300);
  await tap(h, A, 12, 'theirs');
  check('two lit, and it is still the first one',
    nextDeadline(h.state() as Grid) === h.state()?.grids[B]?.[11]?.burstAt);
}

for (const t of [startAndWait, readyTimeout, arming, slowTaps, saving, bursting, nonsense, ending, walkout, deadlines]) {
  await t();
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
