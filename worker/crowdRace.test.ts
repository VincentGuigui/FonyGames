import {
  CROWD_AWAY_MS,
  CROWD_CLAIM_SLACK,
  CROWD_FINISH_Y,
  CROWD_MAX_PLAYERS,
  CROWD_REPORT_MS,
  CROWD_RUN_CAP_MS,
  CROWD_START_Y,
  CROWD_STREET_WIDTH,
  CROWD_WALK_SPEED,
  type ServerMessage,
} from '../shared/protocol';
import {
  nextDeadline,
  onCrowdMove,
  onPlayerGone,
  reachableBy,
  startCrowdRace,
  tick,
  toState,
  type CrowdRace,
  type Ctx,
} from './crowdRace';

/**
 * Crowd Race's referee.
 * Spec: docs/specs/games/crowd-race.md §6-§8
 *
 * This referee never walks anybody and never sees the crowd (spec §2.2), so
 * almost everything worth asserting here is about the one bound it does
 * trust a report against: how far an honest, un-throttled walk could have
 * covered — simpler than Asteroid Race's own `reachableBy` because there is
 * no boost to account for, and who the race belongs to when it ends.
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
  let clock = 5_000_000;
  let seq = 0;
  let stored: CrowdRace | null = null;
  const sent: ServerMessage[] = [];

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as CrowdRace) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as CrowdRace;
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
    walker: (id: string) => stored?.players[id],
    last: () => [...sent].reverse().find((m) => m.t === 'crowd') as Extract<ServerMessage, { t: 'crowd' }> | undefined,
  };
}

/** A report claiming the finish line itself, right now. */
async function claimEverything(h: ReturnType<typeof harness>, id: string): Promise<void> {
  await onCrowdMove(h.ctx, id, 1, CROWD_STREET_WIDTH / 2, Number.MAX_SAFE_INTEGER, h.now);
}

async function starting(): Promise<void> {
  console.log('\nstarting a race');

  const h = harness();
  check('two players can start', (await startCrowdRace(h.ctx, 1, [A, B])) === true);
  check('so can one — solo is a time trial', (await startCrowdRace(harness().ctx, 1, [A])) === true);
  const nineIds = Array.from({ length: CROWD_MAX_PLAYERS + 1 }, (_, i) => `p-${i}`);
  check('more than the max cannot', (await startCrowdRace(harness().ctx, 1, nineIds)) === false);

  const s = h.state();
  check('the race is running', s?.phase === 'running');
  check('both start on the start line', s?.players[A]?.y === CROWD_START_Y && s?.players[B]?.y === CROWD_START_Y);
  check('centred on the street', s?.players[A]?.x === CROWD_STREET_WIDTH / 2);
  check('nobody has crossed', s?.players[A]?.finishedAt === null);
  check('nobody is away yet', s?.players[A]?.away === false);
  check('the cap is out', s?.endsAt === h.now + CROWD_RUN_CAP_MS, s?.endsAt);
  check('and the ladder ticks before it', nextDeadline(s as CrowdRace) === h.now + CROWD_REPORT_MS);

  const frame = h.last();
  check('the opening frame already carries both walkers', !!frame && Object.keys(frame.d.walkers).length === 2, frame && Object.keys(frame.d.walkers));

  check('two players is not solo', s?.solo === false);
  const alone = harness();
  await startCrowdRace(alone.ctx, 1, [A]);
  check('one player is', alone.state()?.solo === true);
}

async function theBound(): Promise<void> {
  console.log('\nthe furthest an honest walk could have got (spec §8)');

  const oneSecond = reachableBy(1000);
  check('a second of walking, plus the slack', Math.abs(oneSecond - CROWD_WALK_SPEED - CROWD_CLAIM_SLACK) < 1e-9, oneSecond);
  check('and it grows with the clock', reachableBy(2000) > oneSecond);
  check('a zero-length window still allows the slack', reachableBy(0) === CROWD_CLAIM_SLACK);
  check('never negative', reachableBy(-500) >= 0);
}

async function clamping(): Promise<void> {
  console.log('\nwhat a lying phone gets');

  const h = harness();
  await startCrowdRace(h.ctx, 1, [A, B]);

  // The trajectory cap: claim the finish line one second in, get one second's
  // worth of street.
  h.advance(1000);
  await claimEverything(h, A);
  const after1s = h.walker(A)?.y ?? 0;
  check('a phone claiming the finish line one second in is clipped, not believed', after1s < CROWD_WALK_SPEED * 3, after1s);
  check('and it is not zeroed either — an honest second still counts', after1s >= CROWD_WALK_SPEED, after1s);
  check('nobody has won anything', h.state()?.phase === 'running');

  // The claim window: going quiet for a long time and then claiming all of it
  // is worth at most CROWD_AWAY_MS of walking.
  const quiet = harness();
  await startCrowdRace(quiet.ctx, 1, [A, B]);
  quiet.advance(60_000);
  await claimEverything(quiet, A);
  const banked = quiet.walker(A)?.y ?? 0;
  check('a minute of silence cannot be spent in one frame', banked <= CROWD_START_Y + reachableBy(CROWD_AWAY_MS) + 1e-9, banked);
  check('which is far short of the line', banked < CROWD_FINISH_Y);

  // Honest reporting is not punished. A real walker's own `y` is
  // CROWD_START_Y plus distance covered, not distance alone (game.ts's own
  // `startRun`), so that is what an honest report claims too.
  const honest = harness();
  await startCrowdRace(honest.ctx, 1, [A, B]);
  for (let i = 0; i < 10; i++) {
    honest.advance(CROWD_REPORT_MS);
    const walked = (CROWD_WALK_SPEED * (honest.now - 5_000_000)) / 1000;
    await onCrowdMove(honest.ctx, A, 1, CROWD_STREET_WIDTH / 2, CROWD_START_Y + walked, honest.now);
  }
  const honestY = honest.walker(A)?.y ?? 0;
  const elapsed = 10 * CROWD_REPORT_MS;
  check('a real, honestly-reported walk is not clipped short', Math.abs(honestY - (CROWD_START_Y + (CROWD_WALK_SPEED * elapsed) / 1000)) < 1, honestY);

  // Never backwards: a stale or bounced-back report cannot undo real progress
  // on the referee's own ladder.
  const forward = harness();
  await startCrowdRace(forward.ctx, 1, [A, B]);
  forward.advance(5000);
  await onCrowdMove(forward.ctx, A, 1, CROWD_STREET_WIDTH / 2, CROWD_WALK_SPEED * 5, forward.now);
  const best = forward.walker(A)?.y ?? 0;
  await onCrowdMove(forward.ctx, A, 1, CROWD_STREET_WIDTH / 2, 0, forward.now);
  check('a report claiming less than the best-so-far does not roll it back', forward.walker(A)?.y === best, forward.walker(A)?.y);

  // Lateral position is only ever clamped to the street, never trusted beyond it.
  const wide = harness();
  await startCrowdRace(wide.ctx, 1, [A, B]);
  await onCrowdMove(wide.ctx, A, 1, CROWD_STREET_WIDTH * 5, 0, wide.now);
  check('x is clamped to the street width', wide.walker(A)?.x === CROWD_STREET_WIDTH, wide.walker(A)?.x);
  await onCrowdMove(wide.ctx, A, 1, -500, 0, wide.now);
  check('on both sides', wide.walker(A)?.x === 0, wide.walker(A)?.x);
}

async function finishing(): Promise<void> {
  console.log('\nhow a race ends (spec §7)');

  // Crossing the line wins it outright, for whoever's report arrives first.
  // Reported honestly, every CROWD_REPORT_MS — a single huge jump from a
  // standing start would itself be clipped by the claim window (§8's other
  // clamp), the same trap Asteroid Race's own crossing test avoids.
  const cross = harness();
  await startCrowdRace(cross.ctx, 1, [A, B]);
  let walkedA = 0;
  let walkedB = 0;
  for (let i = 0; i < 400 && cross.state()?.phase === 'running'; i++) {
    cross.advance(CROWD_REPORT_MS);
    walkedA += (CROWD_WALK_SPEED * CROWD_REPORT_MS) / 1000;
    walkedB += (CROWD_WALK_SPEED * CROWD_REPORT_MS) / 1000 * 0.8;
    await onCrowdMove(cross.ctx, A, 1, CROWD_STREET_WIDTH / 2, walkedA, cross.now);
    await onCrowdMove(cross.ctx, B, 1, CROWD_STREET_WIDTH / 2, walkedB, cross.now);
  }
  check('the crosser wins', cross.state()?.winner === A, cross.state()?.winner);
  check('the race is done', cross.state()?.phase === 'done');
  check('their finish time is on the record', cross.walker(A)?.finishedAt !== null);
  check('the runner-up has no finish time', cross.walker(B)?.finishedAt === null);

  // A second crossing after the race is already over changes nothing.
  await claimEverything(cross, B);
  check('a race already won cannot be re-won by someone else', cross.state()?.winner === A);

  // The cap: furthest wins, and a genuine tie is unranked. Reported
  // incrementally, the same honest cadence as `cross` above — a single big
  // jump after a long silence would itself be clipped by the claim window,
  // which is not the rule this is trying to isolate.
  const capped = harness();
  await startCrowdRace(capped.ctx, 1, [A, B]);
  for (let i = 0; i < 10; i++) {
    capped.advance(CROWD_REPORT_MS);
    await onCrowdMove(capped.ctx, A, 1, CROWD_STREET_WIDTH / 2, (i + 1) * 10, capped.now);
    await onCrowdMove(capped.ctx, B, 1, CROWD_STREET_WIDTH / 2, (i + 1) * 4, capped.now);
  }
  capped.advance(CROWD_RUN_CAP_MS);
  await tick(capped.ctx);
  check('the cap hands it to whoever got furthest', capped.state()?.winner === A, capped.state()?.winner);
  check('the race is over', capped.state()?.phase === 'done');

  const tied = harness();
  await startCrowdRace(tied.ctx, 1, [A, B]);
  for (let i = 0; i < 10; i++) {
    tied.advance(CROWD_REPORT_MS);
    await onCrowdMove(tied.ctx, A, 1, CROWD_STREET_WIDTH / 2, (i + 1) * 10, tied.now);
    await onCrowdMove(tied.ctx, B, 1, CROWD_STREET_WIDTH / 2, (i + 1) * 10, tied.now);
  }
  tied.advance(CROWD_RUN_CAP_MS);
  await tick(tied.ctx);
  check('an exact tie at the cap is unranked', tied.state()?.winner === null);

  // Solo: nobody to beat.
  const solo = harness();
  await startCrowdRace(solo.ctx, 1, [A]);
  solo.advance(CROWD_RUN_CAP_MS);
  await tick(solo.ctx);
  check('a solo room never gets a winner, even at the cap', solo.state()?.winner === null);
}

async function goneAndAway(): Promise<void> {
  console.log('\na phone that stops talking (spec §7)');

  const h = harness();
  await startCrowdRace(h.ctx, 1, [A, B]);
  h.advance(CROWD_AWAY_MS + 1000);
  await tick(h.ctx);
  check('a quiet phone is marked away by the tick', h.walker(A)?.away === true);

  await onCrowdMove(h.ctx, A, 1, CROWD_STREET_WIDTH / 2, 10, h.now);
  check('a fresh report clears it', h.walker(A)?.away === false);

  const gone = harness();
  await startCrowdRace(gone.ctx, 1, [A, B]);
  await onPlayerGone(gone.ctx, A);
  check('a disconnect marks them away immediately, not just on the next tick', gone.walker(A)?.away === true);
  check('their position is unchanged — frozen, not removed', gone.walker(A)?.y === CROWD_START_Y);

  const stale = harness();
  await startCrowdRace(stale.ctx, 1, [A, B]);
  await onCrowdMove(stale.ctx, A, 999, CROWD_STREET_WIDTH / 2, 10, stale.now);
  check('a report for a stale roundId is ignored', stale.walker(A)?.y === CROWD_START_Y);
}

function shape(): void {
  console.log('\nwhat goes on the wire (spec §6)');

  const players: CrowdRace['players'] = {};
  for (let i = 0; i < CROWD_MAX_PLAYERS; i++) players[`p-${i}`] = { x: 10, y: 20, finishedAt: null, away: false, lastReportAt: 0 };
  const s: CrowdRace = {
    roundId: 1,
    startsAt: 0,
    endsAt: CROWD_RUN_CAP_MS,
    nextTickAt: CROWD_REPORT_MS,
    players,
    solo: false,
    winner: null,
    phase: 'running',
  };
  const state = toState(s);
  check('the crowd is never in the state — no obstacles field at all', !('obstacles' in state));
  check('a walker is exactly x, y, finishedAt, away', Object.keys(state.walkers['p-0'] as object).sort().join(',') === 'away,finishedAt,x,y');
  check('the frame fits well inside 1 KB even with a full room', JSON.stringify(state).length < 1024, JSON.stringify(state).length);
}

for (const t of [starting, theBound, clamping, finishing, goneAndAway]) await t();
shape();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
