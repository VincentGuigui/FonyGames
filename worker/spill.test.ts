/**
 * Logic harness for worker/spill.ts. Drives the referee through a fake Ctx —
 * no wrangler, no sockets, and a clock we control, so the timing rules are
 * actually testable rather than raced against.
 */
import {
  SPILL_APPROACH_MS,
  SPILL_HOLD_MS,
  SPILL_LOSE_LEVEL,
  SPILL_START_LEVEL,
  type ServerMessage,
} from '../shared/protocol';
import { screenAngleTo } from '../shared/spillGeometry';
import {
  nextDeadline,
  onCatch,
  onFling,
  onPlayerGone,
  startSpill,
  tick,
  type Ctx,
  type Spill,
} from './spill';

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

type Harness = {
  ctx: Ctx;
  sent: ServerMessage[];
  advance(ms: number): void;
  at(): number;
  state(): Spill;
  /** Run every alarm the referee asks for, up to `limit` firings. */
  drain(limit?: number): Promise<void>;
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined;
  of<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[];
};

function harness(): Harness {
  let clock = 1_000_000;
  let seq = 0;
  let stored: Spill | null = null;
  const sent: ServerMessage[] = [];

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as Spill) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as Spill;
    },
    // Room ignores the requested time and recomputes from state, so drain()
    // does the same rather than trusting whatever the module asked for.
    setAlarm: async () => {},
  };

  return {
    ctx,
    sent,
    advance: (ms) => {
      clock += ms;
    },
    at: () => clock,
    state: () => {
      if (!stored) throw new Error('no state');
      return stored;
    },
    async drain(limit = 50) {
      for (let i = 0; i < limit; i++) {
        if (!stored || stored.phase !== 'running') return;
        const due = nextDeadline(stored);
        if (due > clock) return;
        await tick(ctx);
      }
      throw new Error('drain did not settle');
    },
    last: (t) => [...sent].reverse().find((m) => m.t === t) as never,
    of: (t) => sent.filter((m) => m.t === t) as never,
  };
}

const A = 'p-a';
const B = 'p-b';
const C = 'p-c';
const D = 'p-d';

/* ---------------------------------------------------------------- */

async function seating(): Promise<void> {
  console.log('\nseating and start');
  const h = harness();

  check('2 is allowed', await startSpill(h.ctx, 1, [A, B]));
  check('1 player is refused', !(await startSpill(harness().ctx, 1, [A])));
  check('5 players are refused', !(await startSpill(harness().ctx, 1, [A, B, C, D, 'p-e'])));

  const s = h.state();
  check('everyone starts half full', s.levels[A] === SPILL_START_LEVEL && s.levels[B] === SPILL_START_LEVEL);
  check('seats follow join order', s.seats.join() === [A, B].join());
  const first = h.last('spill');
  check('state is broadcast at start', first?.d.roundId === 1 && first.d.phase === 'running');
}

async function aimingAndLock(): Promise<void> {
  console.log('\naiming, launch lock, landing');
  const h = harness();
  await startSpill(h.ctx, 1, [A, B, C, D]);

  // A sits at seat 0. Flick straight at seat 2 (the far side of the table).
  const straight = screenAngleTo(0, 2, 4);
  await onFling(h.ctx, A, 1, straight, 3);

  const drop = h.last('drop');
  check('a flick produces a drop', drop !== undefined);
  check('aimed at the opposite seat', drop?.d.to === 2, drop?.d);
  check('one drop leaves the pool', h.state().levels[A] === SPILL_START_LEVEL - 1);
  check('the thrower is locked', (h.state().lockedUntil[A] ?? 0) > h.at());

  // Second flick while locked: refused, and no water leaves.
  await onFling(h.ctx, A, 1, straight, 3);
  check('locked out of a second flick', h.of('drop').length === 1);
  check('a refused flick costs nothing', h.state().levels[A] === SPILL_START_LEVEL - 1);

  // Once it has cleared the screen, flinging is allowed again.
  h.advance((drop?.d.leavesAt ?? 0) - h.at() + 1);
  await onFling(h.ctx, A, 1, straight, 3);
  check('free again once it has left the screen', h.of('drop').length === 2);

  // Let both land.
  h.advance(5000);
  await h.drain();
  const land = h.last('land');
  check('it lands on the player it was aimed at', land?.d.on === C, land?.d);
  check('the target takes the water', h.state().levels[C] === SPILL_START_LEVEL + 2);
  check('the thrower is 2 lighter', h.state().levels[A] === SPILL_START_LEVEL - 2);

  // A wild flick backwards misses the table entirely.
  await onFling(h.ctx, A, 1, Math.PI, 3);
  const wild = h.last('drop');
  check('a backwards flick hits nothing', wild?.d.to === null, wild?.d);
  h.advance(5000);
  await h.drain();
  const lost = h.last('land');
  check('lost water lands on nobody', lost?.d.on === null);
  const total = [A, B, C, D].reduce((n, p) => n + (h.state().levels[p] ?? 0), 0);
  check('water left the game entirely', total === SPILL_START_LEVEL * 4 - 1, total);
}

async function catching(): Promise<void> {
  console.log('\ncatching');
  const h = harness();
  await startSpill(h.ctx, 1, [A, B, C, D]);
  await onFling(h.ctx, A, 1, screenAngleTo(0, 2, 4), 3);
  const drop = h.last('drop')!;
  const id = drop.d.dropId;

  // Too early: it is not on the target's screen yet.
  await onCatch(h.ctx, C, 1, id);
  check('cannot catch before the approach window', h.of('caught').length === 0);

  // The wrong player cannot catch it either.
  h.advance(drop.d.arrivesAt - SPILL_APPROACH_MS + 50 - h.at());
  await onCatch(h.ctx, B, 1, id);
  check('only the target can catch it', h.of('caught').length === 0);

  await onCatch(h.ctx, C, 1, id);
  const caught = h.last('caught');
  check('the target catches it', caught?.d.by === C);
  check('a caught drop is worth double', caught?.d.size === 2, caught?.d);
  check('catching does not add to your water', h.state().levels[C] === SPILL_START_LEVEL);

  // Re-fling the held drop: it carries the doubled payload and costs nothing.
  h.advance(1000);
  const before = h.state().levels[C];
  await onFling(h.ctx, C, 1, screenAngleTo(2, 0, 4), 3, id);
  const relob = h.last('drop');
  check('re-flinging carries the doubled size', relob?.d.size === 2, relob?.d);
  check('re-flinging costs no water of your own', h.state().levels[C] === before);
  check('you may send it anywhere', relob?.d.to === 0, relob?.d);

  h.advance(5000);
  await h.drain();
  check('a doubled drop lands doubled', h.state().levels[A] === SPILL_START_LEVEL - 1 + 2);
}

async function soaking(): Promise<void> {
  console.log('\nholding too long');
  const h = harness();
  await startSpill(h.ctx, 1, [A, B]);
  await onFling(h.ctx, A, 1, screenAngleTo(0, 1, 2), 3);
  const drop = h.last('drop')!;

  h.advance(drop.d.arrivesAt - 100 - h.at());
  await onCatch(h.ctx, B, 1, drop.d.dropId);
  check('caught', h.of('caught').length === 1);

  h.advance(SPILL_HOLD_MS + 10);
  await h.drain();
  check('hold it too long and it soaks in', h.state().levels[B] === SPILL_START_LEVEL + 2);
  const land = h.last('land');
  check('a soak reports as a landing on the holder', land?.d.on === B && land.d.size === 2);
}

async function winning(): Promise<void> {
  console.log('\nwinning by emptying');
  const h = harness();
  await startSpill(h.ctx, 1, [A, B]);
  const s = h.state();
  s.levels[A] = 1;
  await h.ctx.save(s);

  await onFling(h.ctx, A, 1, screenAngleTo(0, 1, 2), 3);
  const over = h.last('spill-over');
  check('emptying your phone wins immediately', over?.d.winnerId === A, over?.d);
  check('the round is done', h.state().phase === 'done');

  // Nothing works after the round ends.
  const sent = h.sent.length;
  await onFling(h.ctx, B, 1, 0, 3);
  check('no flinging after the round is over', h.sent.length === sent);
}

async function flooding(): Promise<void> {
  console.log('\nflooding out');
  const h = harness();
  await startSpill(h.ctx, 1, [A, B, C]);
  const s = h.state();
  s.levels[C] = SPILL_LOSE_LEVEL - 1;
  await h.ctx.save(s);

  await onFling(h.ctx, A, 1, screenAngleTo(0, 2, 3), 3);
  check('aimed at C', h.last('drop')?.d.to === 2, h.last('drop')?.d);
  h.advance(5000);
  await h.drain();

  check('C is out at the ceiling', h.state().out.includes(C), h.state().levels);
  check('the round continues with two left', h.state().phase === 'running');

  // C's seat is now a hole: water aimed there is lost.
  h.advance(2000);
  await onFling(h.ctx, B, 1, screenAngleTo(1, 2, 3), 3);
  const atHole = h.last('drop');
  check('a seat that is out swallows nothing', atHole?.d.to === null, atHole?.d);

  // Flooding the second-to-last player ends it.
  const s2 = h.state();
  s2.levels[B] = SPILL_LOSE_LEVEL - 1;
  await h.ctx.save(s2);
  h.advance(3000);
  await onFling(h.ctx, A, 1, screenAngleTo(0, 1, 3), 3);
  h.advance(5000);
  await h.drain();
  const over = h.last('spill-over');
  check('last one standing wins', over?.d.winnerId === A, over?.d);
}

async function leaving(): Promise<void> {
  console.log('\nsomeone walks off');
  const h = harness();
  await startSpill(h.ctx, 1, [A, B, C, D]);

  const seatsBefore = h.state().seats.join();
  await onPlayerGone(h.ctx, B);
  check('their seat stays put', h.state().seats.join() === seatsBefore);
  check('they are out', h.state().out.includes(B));
  check('the round survives', h.state().phase === 'running');

  // The crucial bit: everyone else's aim is unchanged.
  await onFling(h.ctx, A, 1, screenAngleTo(0, 3, 4), 3);
  check('D is still at seat 3', h.last('drop')?.d.to === 3, h.last('drop')?.d);

  await onPlayerGone(h.ctx, C);
  await onPlayerGone(h.ctx, D);
  const over = h.last('spill-over');
  check('below two players the round ends', over?.d.winnerId === A, over?.d);
}

async function cheating(): Promise<void> {
  console.log('\nclamping and stale rounds');
  const h = harness();
  await startSpill(h.ctx, 1, [A, B]);

  await onFling(h.ctx, A, 1, screenAngleTo(0, 1, 2), 10_000);
  const fast = h.last('drop')!;
  const lockMs = fast.d.leavesAt - fast.d.launchedAt;
  check('an impossible speed is clamped, not rejected', lockMs >= 250, lockMs);

  // A stale frame from a previous round must not move anything.
  const sent = h.sent.length;
  await onFling(h.ctx, B, 99, 0, 3);
  await onCatch(h.ctx, B, 99, fast.d.dropId);
  check('stale roundId is ignored', h.sent.length === sent);

  // Garbage never reaches the state.
  await onFling(h.ctx, B, 1, Number.NaN, 3);
  check('NaN angle is ignored', h.sent.length === sent);
  check('B has not lost water to a bad frame', h.state().levels[B] === SPILL_START_LEVEL);
}

for (const t of [seating, aimingAndLock, catching, soaking, winning, flooding, leaving, cheating]) {
  await t();
}

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
