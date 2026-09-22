import { MAXJUMP_ATTEMPTS, MAXJUMP_MAX_PLAYERS, MAXJUMP_ROUND_CAP_MS, type ServerMessage } from '../shared/protocol';
import { bestPossible } from '../www/src/games/maximum-jump/jump';
import {
  nextDeadline,
  onJumpResult,
  onPlayerGone,
  startMaximumJump,
  tick,
  toState,
  type Ctx,
  type MaximumJump,
} from './maximumJump';

/**
 * Maximum Jump's referee.
 * Spec: docs/specs/games/maximum-jump.md §6-§8
 *
 * The attempt itself happens on the phone and this file cannot see any of it,
 * so what is asserted here is the three things it does own: the attempt count,
 * the physical bound on a claimed distance, and who the round belongs to.
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
  let clock = 3_000_000;
  let seq = 0;
  let stored: MaximumJump | null = null;
  const sent: ServerMessage[] = [];

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as MaximumJump) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as MaximumJump;
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
    jumper: (id: string) => stored?.jumpers[id],
    last: () =>
      [...sent].reverse().find((m) => m.t === 'maximum-jump') as
        | Extract<ServerMessage, { t: 'maximum-jump' }>
        | undefined,
  };
}

/** Spend all three attempts for one player, landing `far` each time. */
async function jumpAll(h: ReturnType<typeof harness>, id: string, far: number): Promise<void> {
  for (let n = 1; n <= MAXJUMP_ATTEMPTS; n++) await onJumpResult(h.ctx, id, 1, n, 9, far);
}

async function starting(): Promise<void> {
  console.log('\nstarting a round');

  const h = harness();
  check('one player alone is a round', await startMaximumJump(h.ctx, 1, [A]));
  check('and is marked solo', h.state()?.solo === true);
  check('nobody at all is not', !(await startMaximumJump(harness().ctx, 1, [])));

  const tooMany = Array.from({ length: MAXJUMP_MAX_PLAYERS + 1 }, (_, i) => `p-${i}`);
  check('a room over the cap cannot start', !(await startMaximumJump(harness().ctx, 1, tooMany)));

  const h2 = harness();
  await startMaximumJump(h2.ctx, 7, [A, B]);
  const s = h2.state()!;
  check('everyone is on the board with no attempts spent', s.jumpers[A]?.used === 0 && s.jumpers[B]?.used === 0);
  check('and nothing jumped yet', s.jumpers[A]?.best === 0);
  check('the cap is the only deadline', nextDeadline(s) === s.endsAt);
  check('and it is the round cap out', s.endsAt - s.startsAt === MAXJUMP_ROUND_CAP_MS);
  check('the first state goes straight out', h2.last()?.d.roundId === 7);
}

async function attempts(): Promise<void> {
  console.log('\nthree attempts, best one counting (§2)');

  const h = harness();
  await startMaximumJump(h.ctx, 1, [A, B]);

  await onJumpResult(h.ctx, A, 1, 1, 9.2, 7.4);
  check('the first jump is banked', h.jumper(A)?.best === 7.4 && h.jumper(A)?.used === 1);
  check('with the speed behind it', h.jumper(A)?.speed === 9.2);

  await onJumpResult(h.ctx, A, 1, 2, 6, 5.1);
  check('a worse jump still spends an attempt', h.jumper(A)?.used === 2);
  check('but does not replace the best', h.jumper(A)?.best === 7.4 && h.jumper(A)?.speed === 9.2, h.jumper(A));

  await onJumpResult(h.ctx, A, 1, 2, 11, 12);
  check('a repeated attempt number is dropped', h.jumper(A)?.used === 2 && h.jumper(A)?.best === 7.4);
  await onJumpResult(h.ctx, A, 1, 7, 11, 12);
  check('and so is one out of order', h.jumper(A)?.used === 2);

  await onJumpResult(h.ctx, A, 1, 3, 10.5, 9.9);
  check('the third improves it', h.jumper(A)?.best === 9.9 && h.jumper(A)?.used === 3);
  await onJumpResult(h.ctx, A, 1, 4, 11, 13);
  check('a fourth is refused', h.jumper(A)?.used === 3 && h.jumper(A)?.best === 9.9);

  // A faceplant arrives as zero and costs the attempt, which is the whole
  // price of fouling (spec §2).
  await onJumpResult(h.ctx, B, 1, 1, 10, 0);
  check('a faceplant spends an attempt and scores nothing', h.jumper(B)?.used === 1 && h.jumper(B)?.best === 0);

  await onJumpResult(h.ctx, 'nobody', 1, 1, 9, 8);
  check('a stranger is not added to the board', !('nobody' in (h.state()?.jumpers ?? {})));
  await onJumpResult(h.ctx, B, 2, 2, 9, 8);
  check('a result for another round is ignored', h.jumper(B)?.used === 1);
}

async function bounds(): Promise<void> {
  console.log('\nwhat the referee will believe (§8)');

  const h = harness();
  await startMaximumJump(h.ctx, 1, [A]);

  await onJumpResult(h.ctx, A, 1, 1, 1e9, 1e9);
  check(`an absurd claim is clamped to the physics (${h.jumper(A)?.best.toFixed(2)} m)`, h.jumper(A)?.best === bestPossible());
  check('the ceiling comes from the game, not a copy of it', bestPossible() > 0);

  const h2 = harness();
  await startMaximumJump(h2.ctx, 1, [A]);
  await onJumpResult(h2.ctx, A, 1, 1, Number.NaN, Number.NaN);
  check('a nonsense distance lands as zero', h2.jumper(A)?.best === 0);
  await onJumpResult(h2.ctx, A, 1, 2, 9, -50);
  check('and so does a negative one', h2.jumper(A)?.best === 0);
  await onJumpResult(h2.ctx, A, 1, 3, Number.POSITIVE_INFINITY, 6);
  check('a nonsense speed does not poison a real jump', h2.jumper(A)?.best === 6 && h2.jumper(A)?.speed === 0);
}

async function endings(): Promise<void> {
  console.log('\nwhen it ends, and to whom (§7)');

  const h = harness();
  await startMaximumJump(h.ctx, 1, [A, B]);
  await jumpAll(h, A, 7.5);
  check('the round is still on while somebody has jumps left', h.state()?.phase === 'jumping');
  await jumpAll(h, B, 6.2);
  check('everyone finishing ends it without waiting for the cap', h.state()?.phase === 'done');
  check('and the longest jump wins', h.last()?.d.winner === A, h.last()?.d);

  const tie = harness();
  await startMaximumJump(tie.ctx, 1, [A, B]);
  await jumpAll(tie, A, 7);
  await jumpAll(tie, B, 7);
  check('a tie at the top is unranked', tie.last()?.d.winner === null);

  const nobody = harness();
  await startMaximumJump(nobody.ctx, 1, [A, B]);
  await jumpAll(nobody, A, 0);
  await jumpAll(nobody, B, 0);
  check('a room of faceplants has no winner', nobody.last()?.d.winner === null);

  const capped = harness();
  await startMaximumJump(capped.ctx, 1, [A, B]);
  await onJumpResult(capped.ctx, A, 1, 1, 9, 8.1);
  check('the cap does not fire early', (await tick(capped.ctx)) === false);
  capped.advance(MAXJUMP_ROUND_CAP_MS);
  check('but it does end a round nobody finished', (await tick(capped.ctx)) === true);
  check('on the best anybody managed', capped.last()?.d.winner === A, capped.last()?.d);
  check('and a finished round has no deadline left', nextDeadline(capped.state()!) === Infinity);
  check('a tick after the end does nothing', (await tick(capped.ctx)) === false);

  const alone = harness();
  await startMaximumJump(alone.ctx, 1, [A]);
  await jumpAll(alone, A, 8.8);
  check('solo keeps the distance and names no winner', alone.last()?.d.jumpers[A]?.best === 8.8 && alone.last()?.d.winner === null);

  const gone = harness();
  await startMaximumJump(gone.ctx, 1, [A, B]);
  await onJumpResult(gone.ctx, A, 1, 1, 9, 9.4);
  await onPlayerGone(gone.ctx, A);
  check('a player who leaves keeps their best', gone.jumper(A)?.best === 9.4);
  check('but stops holding the room open', gone.jumper(A)?.used === MAXJUMP_ATTEMPTS);
  check('the round runs on for whoever is left', gone.state()?.phase === 'jumping');
  await jumpAll(gone, B, 5);
  check('and the one who left can still win it', gone.last()?.d.winner === A);
}

function wire(): void {
  console.log('\nwhat goes on the wire (§10)');

  const s: MaximumJump = {
    roundId: 2,
    startsAt: 10,
    endsAt: 20,
    jumpers: { [A]: { best: 8, speed: 10, used: 2 } },
    solo: false,
    winner: A,
    phase: 'done',
  };
  const out = toState(s);
  check(
    'the state is two numbers and a count per player',
    JSON.stringify(Object.keys(out.jumpers[A] ?? {}).sort()) === JSON.stringify(['best', 'speed', 'used']),
    out.jumpers[A],
  );
  out.jumpers[A]!.best = 99;
  check('and it is a copy, not the referee\'s own board', s.jumpers[A]?.best === 8);
}

async function main(): Promise<void> {
  await starting();
  await attempts();
  await bounds();
  await endings();
  wire();

  if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
  console.log(`\nall ${checks} passed`);
}

void main();
