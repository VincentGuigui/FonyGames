import {
  RHINO_COUNTDOWN_MS,
  RHINO_MAX_PLAYERS,
  RHINO_MAX_RATE,
  RHINO_REPORT_MS,
  RHINO_ROUND_MS,
  type ServerMessage,
} from '../shared/protocol';
import {
  nextDeadline,
  onPlayerGone,
  onRhinoSpins,
  reachableBy,
  startRhinoSpin,
  tick,
  toState,
  type Ctx,
  type RhinoSpin,
} from './rhinoSpin';

/**
 * Rhino Spin's referee.
 * Spec: docs/specs/games/rhino-spin.md §6-§8
 *
 * The referee never sees a throw, so what is worth asserting is the ladder's
 * one rule — a count only ever goes up, and never past what the elapsed
 * window could hold — and who owns the round when the clock runs out.
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
  let stored: RhinoSpin | null = null;
  const sent: ServerMessage[] = [];
  const alarms: number[] = [];

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as RhinoSpin) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as RhinoSpin;
    },
    setAlarm: async (at) => void alarms.push(at),
  };

  return {
    ctx,
    sent,
    alarms,
    get now() {
      return clock;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    state: () => stored,
    last: () =>
      [...sent].reverse().find((m) => m.t === 'rhino-spin') as
        | Extract<ServerMessage, { t: 'rhino-spin' }>
        | undefined,
  };
}

async function starting(): Promise<void> {
  console.log('\nstarting a round');

  const h = harness();
  // A 1-8 game (shared/players.ts): one player alone is a legitimate round,
  // not a solo-test concession, and it still records no winner to chase.
  check('one player alone is a round', await startRhinoSpin(h.ctx, 1, [A]));
  check('and it is marked solo', h.state()?.solo === true);
  check('nobody at all is not', !(await startRhinoSpin(harness().ctx, 1, [])));

  const h2 = harness();
  const tooMany = Array.from({ length: RHINO_MAX_PLAYERS + 1 }, (_, i) => `p-${i}`);
  check('a room over the cap cannot start', !(await startRhinoSpin(h2.ctx, 1, tooMany)));

  const h3 = harness();
  await startRhinoSpin(h3.ctx, 9, [A, B]);
  const s = h3.state()!;
  check('the window opens after the countdown', s.startsAt === h3.now + RHINO_COUNTDOWN_MS, s.startsAt - h3.now);
  check('and runs for the round length', s.endsAt - s.startsAt === RHINO_ROUND_MS);
  check('everyone is on the ladder at zero from the first frame', s.spins[A] === 0 && s.spins[B] === 0);
  check('the first state goes straight out', h3.last()?.d.roundId === 9);
  check('the first alarm is the window opening', h3.alarms[0] === s.startsAt, h3.alarms);
}

async function claiming(): Promise<void> {
  console.log('\na phone reports its running total (§6)');

  const h = harness();
  await startRhinoSpin(h.ctx, 1, [A, B]);
  h.advance(RHINO_COUNTDOWN_MS + 1000);

  await onRhinoSpins(h.ctx, A, 1, 3, h.now);
  check('an honest count is taken', h.state()?.spins[A] === 3, h.state()?.spins);

  await onRhinoSpins(h.ctx, A, 1, 1, h.now);
  check('a lower count never lowers the ladder', h.state()?.spins[A] === 3, h.state()?.spins);

  await onRhinoSpins(h.ctx, A, 1, 1e9, h.now);
  const ceiling = reachableBy(h.state()!, h.now);
  check(`an absurd claim is clamped to the window (${h.state()?.spins[A]} = ${ceiling})`, h.state()?.spins[A] === ceiling);
  check('and that ceiling is about one second of spinning', ceiling <= RHINO_MAX_RATE + 1, ceiling);

  await onRhinoSpins(h.ctx, 'nobody', 1, 5, h.now);
  check('a stranger is not added to the ladder', !('nobody' in (h.state()?.spins ?? {})));

  await onRhinoSpins(h.ctx, B, 2, 5, h.now);
  check('a report for another round is ignored', h.state()?.spins[B] === 0);

  await onRhinoSpins(h.ctx, B, 1, Number.NaN, h.now);
  await onRhinoSpins(h.ctx, B, 1, Number.POSITIVE_INFINITY, h.now);
  check('and nonsense numbers are too', h.state()?.spins[B] === 0, h.state()?.spins);

  await onRhinoSpins(h.ctx, B, 1, 2.9, h.now);
  check('a fractional claim banks only whole turns', h.state()?.spins[B] === 2, h.state()?.spins);

  // The ceiling grows with the window, so the same claim lands differently
  // late on — that is the whole point of measuring against elapsed time.
  const early = reachableBy(h.state()!, h.state()!.startsAt + 1000);
  const late = reachableBy(h.state()!, h.state()!.startsAt + 10_000);
  check(`the ceiling grows with the round (${early} then ${late})`, late > early);
  const past = reachableBy(h.state()!, h.state()!.endsAt + 60_000);
  check('and stops growing when the window shuts', past === reachableBy(h.state()!, h.state()!.endsAt), past);
  check('nothing is reachable before the window opens', reachableBy(h.state()!, h.state()!.startsAt - 5000) === 1);
}

async function running(): Promise<void> {
  console.log('\nthe clock');

  const h = harness();
  await startRhinoSpin(h.ctx, 1, [A, B]);
  h.advance(RHINO_COUNTDOWN_MS);

  const before = h.sent.length;
  check('a tick before its time does nothing', (await tick(h.ctx)) === false && h.sent.length > before);

  h.advance(RHINO_REPORT_MS);
  check('the ladder goes out on the tick', (await tick(h.ctx)) === false);
  check('and the next one is scheduled', nextDeadline(h.state()!) === h.now + RHINO_REPORT_MS);

  await onRhinoSpins(h.ctx, A, 1, 4, h.now);
  await onRhinoSpins(h.ctx, B, 1, 2, h.now);
  h.advance(RHINO_ROUND_MS);
  check('the window closing ends the round', (await tick(h.ctx)) === true);
  check('the phase is done', h.state()?.phase === 'done');
  check('the best spinner won', h.last()?.d.winner === A, h.last()?.d);
  check('a finished round has no deadline left', nextDeadline(h.state()!) === Infinity);
  check('a tick after the end does nothing', (await tick(h.ctx)) === false);

  await onRhinoSpins(h.ctx, B, 1, 99, h.now);
  check('and no report can change the result', h.state()?.spins[B] === 2, h.state()?.spins);
}

async function endings(): Promise<void> {
  console.log('\nwho wins');

  const tie = harness();
  await startRhinoSpin(tie.ctx, 1, [A, B]);
  tie.advance(RHINO_COUNTDOWN_MS + 2000);
  await onRhinoSpins(tie.ctx, A, 1, 5, tie.now);
  await onRhinoSpins(tie.ctx, B, 1, 5, tie.now);
  tie.advance(RHINO_ROUND_MS);
  await tick(tie.ctx);
  check('a tie at the top is unranked', tie.last()?.d.winner === null, tie.last()?.d);

  const nobody = harness();
  await startRhinoSpin(nobody.ctx, 1, [A, B]);
  nobody.advance(RHINO_COUNTDOWN_MS + RHINO_ROUND_MS);
  await tick(nobody.ctx);
  check('nobody spinning is no winner, not an arbitrary one (§7)', nobody.last()?.d.winner === null);
  check('and everyone still scores zero on the board', nobody.last()?.d.spins[A] === 0);

  const alone = harness();
  await startRhinoSpin(alone.ctx, 1, [A], true);
  alone.advance(RHINO_COUNTDOWN_MS + 1000);
  await onRhinoSpins(alone.ctx, A, 1, 6, alone.now);
  alone.advance(RHINO_ROUND_MS);
  await tick(alone.ctx);
  check('solo keeps the count and names no winner', alone.last()?.d.spins[A] === 6 && alone.last()?.d.winner === null);

  const gone = harness();
  await startRhinoSpin(gone.ctx, 1, [A, B]);
  gone.advance(RHINO_COUNTDOWN_MS + 1000);
  await onRhinoSpins(gone.ctx, A, 1, 3, gone.now);
  await onPlayerGone(gone.ctx, A);
  check('a player who leaves keeps what they spun (§7)', gone.state()?.spins[A] === 3, gone.state()?.spins);
  gone.advance(RHINO_ROUND_MS);
  await tick(gone.ctx);
  check('and can still win it', gone.last()?.d.winner === A);
}

function wire(): void {
  console.log('\nwhat goes on the wire (§10)');

  const s: RhinoSpin = {
    roundId: 3,
    startsAt: 100,
    endsAt: 200,
    nextTickAt: 150,
    spins: { [A]: 4 },
    solo: false,
    winner: A,
    phase: 'done',
  };
  const out = toState(s);
  check('the state carries counts and nothing sensor-shaped', JSON.stringify(Object.keys(out).sort()) ===
    JSON.stringify(['endsAt', 'phase', 'roundId', 'solo', 'spins', 'startsAt', 'winner']), Object.keys(out));
  out.spins[A] = 99;
  check('and it is a copy, not the referee\'s own ladder', s.spins[A] === 4);
}

async function main(): Promise<void> {
  await starting();
  await claiming();
  await running();
  await endings();
  wire();

  if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
  console.log(`\nall ${checks} passed`);
}

void main();
