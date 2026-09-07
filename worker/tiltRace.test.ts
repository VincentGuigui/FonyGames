import {
  nextDeadline,
  onFinish,
  onMove,
  onPlayerGone,
  reachable,
  startTiltRace,
  tick,
  toState,
  type Ctx,
  type TiltRace,
} from './tiltRace';
import {
  TILT_CLAIM_SLACK,
  TILT_COUNTDOWN_MS,
  TILT_RUN_CAP_MS,
  TILT_SPOOL_MS,
  TILT_TOP_SPEED,
  tiltSpeedAt,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';

/**
 * Tilt Race's referee.
 * Spec: docs/specs/games/tilt-race.md
 *
 * The circuit geometry is `shared/tiltTrack.test.ts`'s business. What matters
 * here is the one uncomfortable thing about this game: **each phone reports its
 * own progress**, because the driving runs there. So the checks are mostly
 * about what a lying phone cannot get away with —
 *
 * - it cannot claim more progress than the speed curve allows, and the bound
 *   integrates the spool rather than assuming top speed from the start, so a
 *   flying start is impossible;
 * - it cannot skip a lap, or count one backwards;
 * - it cannot report the finish before the curve could have reached it;
 * - and the referee's own arrival order decides the placings, not a payload.
 *
 * Plus the ordinary shape: a countdown that gets everyone away together, a run
 * cap that ends a race nobody finished, and a whole room getting a placing.
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

const A = 'a' as PlayerId;
const B = 'b' as PlayerId;
const C = 'c' as PlayerId;
const T0 = 1_000_000;

function harness(at = T0) {
  let now = at;
  let seq = 0;
  let stored: TiltRace | null = null;
  const sent: ServerMessage[] = [];
  let alarm = 0;
  let h = 0xBEEF;
  const rand = (): number => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 4294967296;
  };

  const ctx: Ctx = {
    now: () => now,
    nextSeq: () => ++seq,
    broadcast: (m) => sent.push(m),
    load: async () => stored,
    save: async (s) => {
      stored = s;
    },
    setAlarm: async (a) => {
      alarm = a;
    },
    random: rand,
  };

  return {
    ctx,
    sent,
    get state(): TiltRace {
      if (!stored) throw new Error('no state');
      return stored;
    },
    get alarm(): number {
      return alarm;
    },
    at: (t: number) => {
      now = t;
    },
    advance: (ms: number) => {
      now += ms;
    },
    get last() {
      const frames = sent.filter((m) => m.t === 'tilt');
      const frame = frames[frames.length - 1];
      if (!frame || frame.t !== 'tilt') throw new Error('no tilt frame');
      return frame.d;
    },
  };
}

/** Start a race and get the lights green. */
async function racing(ids: PlayerId[] = [A, B], solo = false): Promise<ReturnType<typeof harness>> {
  const h = harness();
  await startTiltRace(h.ctx, 1, ids, solo);
  h.at(h.state.startsAt);
  await tick(h.ctx);
  return h;
}

async function starting(): Promise<void> {
  console.log('\nstarting a race (§2)');

  const h = harness();
  check('a room of two starts', await startTiltRace(h.ctx, 3, [A, B]));
  check('the circuit is rolled and on the wire', h.last.track.length > 12 && h.last.lapLength > 0);
  check('the same circuit for everybody — one broadcast', h.sent.filter((m) => m.t === 'tilt').length === 1);
  check('everybody is on the line at zero', h.state.cars[A]?.s === 0 && h.state.cars[B]?.s === 0);
  check('and on lap zero', h.state.cars[A]?.lap === 0);
  check('nobody has finished', h.last.order.length === 0 && h.last.winner === null);

  check('it opens on a countdown', h.state.phase === 'countdown');
  check(`the countdown is ${TILT_COUNTDOWN_MS} ms`, h.state.startsAt === T0 + TILT_COUNTDOWN_MS);
  check('the alarm is the green light', h.alarm === h.state.startsAt);
  check('the cap runs from the green light, not from the tap', h.state.endsAt === h.state.startsAt + TILT_RUN_CAP_MS);

  const alone = harness();
  check('one player cannot start', !(await startTiltRace(alone.ctx, 1, [A])));
  check('unless it is solo testing', await startTiltRace(alone.ctx, 1, [A], true));

  const crowd = harness();
  check('nine cannot start', !(await startTiltRace(crowd.ctx, 1, [A, B, C, 'd', 'e', 'f', 'g', 'h', 'i'] as PlayerId[])));

  // A move before the lights is ignored: the countdown is what stops a
  // flying start.
  const early = harness();
  await startTiltRace(early.ctx, 1, [A, B]);
  await onMove(early.ctx, A, 1, 500, 0);
  check('a move during the countdown does nothing', early.state.cars[A]?.s === 0);

  const green = await racing();
  check('the lights go green on the alarm', green.state.phase === 'running');
  check('and the clamp starts counting from then', green.state.cars[A]?.reportedAt === green.state.startsAt);
  check('the alarm moves to the run cap', green.alarm === green.state.endsAt);
}

async function theClaimBound(): Promise<void> {
  console.log('\nwhat a phone cannot claim (§8)');

  // The bound integrates the spool. Assuming top speed from the start would
  // let a phone claim a flying start, which is the whole point of this.
  const firstSecond = reachable(0, 1000);
  const flatOut = (TILT_TOP_SPEED * 1 * TILT_CLAIM_SLACK);
  check(`the first second allows ${firstSecond.toFixed(0)} units, not ${flatOut.toFixed(0)}`, firstSecond < flatOut * 0.5, { firstSecond, flatOut });
  check('a later second allows full speed', Math.abs(reachable(30_000, 31_000) - flatOut) < 1);
  check('zero elapsed allows nothing', reachable(5_000, 5_000) === 0);
  check('backwards allows nothing', reachable(5_000, 4_000) === 0);
  check('and the curve itself spools', tiltSpeedAt(0) === 0 && tiltSpeedAt(TILT_SPOOL_MS * 3) === TILT_TOP_SPEED);

  const h = await racing();
  const lap = h.state.track.length;

  // A modest claim is taken as sent.
  h.advance(2_000);
  const honest = reachable(0, 2_000) / TILT_CLAIM_SLACK * 0.5;
  await onMove(h.ctx, A, 1, honest, 0);
  check('an honest claim is taken as sent', Math.abs((h.state.cars[A]?.s ?? 0) - honest) < 1, { got: h.state.cars[A]?.s, honest });

  // A teleport is pulled back to the bound rather than rejected — a rejected
  // report would leave a stuttering phone frozen.
  const before = h.state.cars[B]?.s ?? 0;
  await onMove(h.ctx, B, 1, lap * 0.9, 0);
  const clamped = h.state.cars[B]?.s ?? 0;
  check('a teleport is clamped, not rejected', clamped > before && clamped < lap * 0.9, { clamped, asked: lap * 0.9 });
  check('and clamped to about the bound', Math.abs(clamped - reachable(0, 2_000)) < 2, { clamped, bound: reachable(0, 2_000) });

  // Laps go up by one at a time, and never down.
  await onMove(h.ctx, A, 1, 10, 5);
  check('a five-lap jump is refused', (h.state.cars[A]?.lap ?? 0) <= 1, h.state.cars[A]?.lap);
  h.advance(200_000);
  await onMove(h.ctx, A, 1, 10, 1);
  check('one lap on is allowed once the curve permits it', h.state.cars[A]?.lap === 1);
  await onMove(h.ctx, A, 1, 10, 0);
  check('and it cannot count back down', h.state.cars[A]?.lap === 1);

  // Nonsense payloads.
  const junk = await racing();
  junk.advance(2_000);
  await onMove(junk.ctx, A, 1, Number.NaN, 0);
  check('NaN progress is refused', junk.state.cars[A]?.s === 0);
  await onMove(junk.ctx, A, 1, Infinity, 0);
  check('infinite progress is refused', junk.state.cars[A]?.s === 0);
  await onMove(junk.ctx, A, 1, 'far' as unknown as number, 0);
  check('a string is refused', junk.state.cars[A]?.s === 0);
  await onMove(junk.ctx, A, 1, -500, 0);
  check('negative progress does not move anybody backwards', junk.state.cars[A]?.s === 0);
  await onMove(junk.ctx, 'nobody' as PlayerId, 1, 100, 0);
  check('a stranger reporting is ignored', !('nobody' in junk.state.cars));
  await onMove(junk.ctx, A, 99, 100, 0);
  check('a report for another round is ignored', junk.state.cars[A]?.s === 0);
}

async function finishing(): Promise<void> {
  console.log('\ncrossing the line (§2, §8)');

  const early = await racing();
  early.advance(1_000);
  check('a finish the curve cannot reach is refused', (await onFinish(early.ctx, A, 1)) === false);
  check('and nobody is placed', early.state.order.length === 0);

  const h = await racing([A, B, C]);
  // Long enough that a lap is genuinely reachable.
  h.advance(200_000);
  check('the first home does not end the race', (await onFinish(h.ctx, A, 1)) === false);
  check('but they are placed first', h.state.order[0] === A);
  check('and they are the winner', h.state.winner === A);
  check('their car reads as finished', h.state.cars[A]?.finished === true);
  check('on the final lap', h.state.cars[A]?.lap === h.state.laps);

  await onFinish(h.ctx, B, 1);
  check('the second home is placed second', h.state.order[1] === B);
  check('and does not steal the win', h.state.winner === A);
  check('a second finish from the same phone is refused', (await onFinish(h.ctx, A, 1)) === false);
  check('and does not double-place them', h.state.order.filter((id) => id === A).length === 1);

  const over = await onFinish(h.ctx, C, 1);
  check('the last one home ends the race', over && h.state.phase === 'done');
  check('with everybody placed', h.state.order.length === 3);

  check('a finish for another round is refused', (await onFinish(h.ctx, A, 99)) === false);
}

async function theRunCap(): Promise<void> {
  console.log('\nnobody finishes (§7)');

  const h = await racing([A, B]);
  h.advance(200_000);
  await onMove(h.ctx, A, 1, h.state.track.length * 0.6, 0);
  await onMove(h.ctx, B, 1, h.state.track.length * 0.2, 0);

  h.at(h.state.endsAt);
  const done = await tick(h.ctx);
  check('the run cap ends the race', done && h.state.phase === 'done');
  check('placings are by distance', h.state.order[0] === A && h.state.order[1] === B);
  check('and the furthest takes it', h.state.winner === A);
  check('a tick after the end does nothing', (await tick(h.ctx)) === false);
  check('and nextDeadline is never', nextDeadline(h.state) === Infinity);

  // A finished race takes no more reports.
  await onMove(h.ctx, A, 1, h.state.track.length, 1);
  check('a move after the end is ignored', h.state.cars[A]?.lap === 0);

  const solo = await racing([A], true);
  solo.at(solo.state.endsAt);
  await tick(solo.ctx);
  check('a solo run ends on its cap', solo.state.phase === 'done');
  check('with no winner — nobody to beat', solo.state.winner === null);
}

async function leaving(): Promise<void> {
  console.log('\na player leaves (§7)');

  const h = await racing([A, B]);
  h.advance(200_000);
  await onMove(h.ctx, A, 1, h.state.track.length * 0.5, 0);
  await onPlayerGone(h.ctx, A);
  check('they are marked as left', h.state.cars[A]?.left === true);
  check('but their progress stays on the board', (h.state.cars[A]?.s ?? 0) > 0);
  check('and the race runs on', h.state.phase === 'running');
  check('the field says so', h.last.field[A]?.left === true);

  await onMove(h.ctx, A, 1, h.state.track.length * 0.9, 0);
  check('a phone that left cannot keep reporting', (h.state.cars[A]?.s ?? 0) < h.state.track.length * 0.9);
  check('and cannot finish', (await onFinish(h.ctx, A, 1)) === false);

  await onPlayerGone(h.ctx, B);
  check('the last car leaving ends the race', h.state.phase === 'done');
  check('and everybody is still placed', h.state.order.length === 2);

  await onPlayerGone(h.ctx, 'nobody' as PlayerId);
  check('a stranger leaving is harmless', h.state.phase === 'done');
}

async function theWire(): Promise<void> {
  console.log('\nwhat goes on the wire (§6)');

  const h = await racing([A, B]);
  const d = toState(h.state);
  check('the circuit travels once, in full', d.track.length === h.state.track.points.length);
  check('with the lap length a report is measured against', d.lapLength === h.state.track.length);
  check('and the cells to draw the ground from', d.cells.length > 0);
  check('the field is arc lengths, not positions', Object.values(d.field).every((c) => typeof c.s === 'number' && !('x' in c)));

  // A report broadcasts, because a report IS the field update — there is no
  // second clock (spec §6).
  const before = h.sent.filter((m) => m.t === 'tilt').length;
  h.advance(1_000);
  await onMove(h.ctx, A, 1, 50, 0);
  check('a report broadcasts the new field', h.sent.filter((m) => m.t === 'tilt').length === before + 1);
}

async function main(): Promise<void> {
  await starting();
  await theClaimBound();
  await finishing();
  await theRunCap();
  await leaving();
  await theWire();

  if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
  console.log(`\nall ${checks} passed`);
}

await main();
