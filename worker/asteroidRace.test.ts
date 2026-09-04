import {
  ASTEROID_AWAY_MS,
  ASTEROID_BOOST_COOLDOWN_MS,
  ASTEROID_CLAIM_SLACK,
  ASTEROID_CRUISE_SPEED,
  ASTEROID_LIVES,
  ASTEROID_REPORT_MS,
  ASTEROID_ROUND_CAP_MS,
  ASTEROID_STUN_MS,
  ASTEROID_TRACK_LENGTH,
  type ServerMessage,
} from '../shared/protocol';
import {
  nextDeadline,
  onAsteroidReport,
  onPlayerGone,
  reachableBy,
  startAsteroidRace,
  tick,
  toState,
  type AsteroidRace,
  type Ctx,
} from './asteroidRace';

/**
 * Asteroid Race's referee.
 * Spec: docs/specs/games/asteroid-race.md §6-§8
 *
 * This referee flies nothing (spec §2.2), so almost everything worth asserting
 * here is about what it does to a report it does not trust: the two clamps in
 * §8, lives that may only fall, and who the race belongs to when it ends three
 * different ways.
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
const C = 'p-c';

function harness() {
  let clock = 5_000_000;
  let seq = 0;
  let stored: AsteroidRace | null = null;
  const sent: ServerMessage[] = [];

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as AsteroidRace) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as AsteroidRace;
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
    run: (id: string) => stored?.players[id],
    last: () => [...sent].reverse().find((m) => m.t === 'asteroid') as
      | Extract<ServerMessage, { t: 'asteroid' }>
      | undefined,
    clear: () => void (sent.length = 0),
  };
}

/** A report claiming everything the clock could possibly allow. */
async function claimEverything(h: ReturnType<typeof harness>, id: string, lives = ASTEROID_LIVES, hits = 0): Promise<void> {
  await onAsteroidReport(h.ctx, id, 1, Number.MAX_SAFE_INTEGER, lives, hits, h.now);
}

async function starting(): Promise<void> {
  console.log('\nstarting a race');

  const h = harness();
  check('two players can start', (await startAsteroidRace(h.ctx, 1, [A, B])) === true);
  check('so can one — the field is deterministic, so a solo run is a time trial',
    (await startAsteroidRace(harness().ctx, 1, [A])) === true);
  check('nine cannot', (await startAsteroidRace(harness().ctx, 1, [A, B, C, 'd', 'e', 'f', 'g', 'h', 'i'])) === false);

  const s = h.state();
  check('the race is running', s?.phase === 'running');
  check(`both start on ${ASTEROID_LIVES} lives`, s?.players[A]?.lives === ASTEROID_LIVES && s?.players[B]?.lives === ASTEROID_LIVES);
  check('and on the start line', s?.players[A]?.distance === 0 && s?.players[B]?.distance === 0);
  check('nobody has crossed', s?.players[A]?.finishedAt === null);
  check('nobody is away yet', s?.players[A]?.away === false);
  check('the cap is 120 s out', s?.endsAt === h.now + ASTEROID_ROUND_CAP_MS, s?.endsAt);
  check('and the ladder ticks before it', nextDeadline(s as AsteroidRace) === h.now + ASTEROID_REPORT_MS);

  // Everyone is on the ladder from the first frame rather than appearing on
  // their own first report — an empty grid reads as broken.
  const frame = h.last();
  check('the opening frame already carries both runs',
    !!frame && Object.keys(frame.d.runs).length === 2, frame && Object.keys(frame.d.runs));

  // A room with two real players is not a time trial.
  check('two players is not solo', s?.solo === false);
  const alone = harness();
  await startAsteroidRace(alone.ctx, 1, [A]);
  check('one player is', alone.state()?.solo === true);
}

async function theBound(): Promise<void> {
  console.log('\nthe fastest run the clock allows (spec §8)');

  // Cruise alone: distance is a function of time, which is the whole reason
  // this bound can exist at all.
  const oneSecond = reachableBy(1000, 0);
  check('a second of cruising, plus one boost and the slack',
    oneSecond > ASTEROID_CRUISE_SPEED && oneSecond < ASTEROID_CRUISE_SPEED * 2 + ASTEROID_CLAIM_SLACK, oneSecond);
  check('and it grows with the clock', reachableBy(2000, 0) > oneSecond);

  // Boost is bounded by the cooldown, not by what anybody claims: one at the
  // start, and one more per cooldown elapsed.
  const justBefore = reachableBy(ASTEROID_BOOST_COOLDOWN_MS - 1, 0);
  const justAfter = reachableBy(ASTEROID_BOOST_COOLDOWN_MS + 1, 0);
  check('a second boost only becomes available once its cooldown has passed',
    justAfter - justBefore > ASTEROID_CRUISE_SPEED, { justBefore, justAfter });

  // A player who admits to hits gets a lower bound — each one is a second
  // standing still.
  const clean = reachableBy(10_000, 0);
  const clipped = reachableBy(10_000, 3);
  check('every reported hit takes a stunned second off the bound',
    Math.abs(clean - clipped - (3 * ASTEROID_CRUISE_SPEED * ASTEROID_STUN_MS) / 1000) < 1e-9, { clean, clipped });
  check('and it never goes negative, however many hits are claimed', reachableBy(1000, 500) >= 0);
  check('a zero-length window still allows the slack', reachableBy(0, 0) === ASTEROID_CLAIM_SLACK);
}

async function clamping(): Promise<void> {
  console.log('\nwhat a lying phone gets');

  const h = harness();
  await startAsteroidRace(h.ctx, 1, [A, B]);

  // The trajectory cap: claim the whole track one second in, get one second's
  // worth of track.
  h.advance(1000);
  await claimEverything(h, A);
  const after1s = h.run(A)?.distance ?? 0;
  check('a phone claiming the finish line one second in is clipped, not believed',
    after1s < ASTEROID_CRUISE_SPEED * 3, after1s);
  check('and it is not zeroed either — an honest second still counts',
    after1s >= ASTEROID_CRUISE_SPEED, after1s);
  check('nobody has won anything', h.state()?.phase === 'running');

  // The claim window: going quiet for a long time and then claiming all of it
  // is worth at most `ASTEROID_AWAY_MS` of flying.
  const quiet = harness();
  await startAsteroidRace(quiet.ctx, 1, [A, B]);
  quiet.advance(60_000);
  await claimEverything(quiet, A);
  const banked = quiet.run(A)?.distance ?? 0;
  check('a minute of silence cannot be spent in one frame',
    banked <= reachableBy(ASTEROID_AWAY_MS, 0) + 1e-9, banked);
  check('which is far short of the line', banked < ASTEROID_TRACK_LENGTH);

  // Honest reporting, on the other hand, is not punished: a real run that
  // reports every second arrives where the clock says it should.
  const honest = harness();
  await startAsteroidRace(honest.ctx, 1, [A, B]);
  let walked = 0;
  for (let i = 0; i < 30; i++) {
    honest.advance(ASTEROID_REPORT_MS);
    walked += (ASTEROID_CRUISE_SPEED * ASTEROID_REPORT_MS) / 1000;
    await onAsteroidReport(honest.ctx, A, 1, walked, ASTEROID_LIVES, 0, honest.now);
  }
  check('an honest cruising run is never clipped',
    Math.abs((honest.run(A)?.distance ?? 0) - walked) < 1e-9, honest.run(A)?.distance);

  // And nothing ever goes backwards, so a stale frame cannot undo progress.
  await onAsteroidReport(honest.ctx, A, 1, 10, ASTEROID_LIVES, 0, honest.now);
  check('a report claiming less than the referee already has is ignored',
    Math.abs((honest.run(A)?.distance ?? 0) - walked) < 1e-9, honest.run(A)?.distance);
}

async function livesAndHits(): Promise<void> {
  console.log('\nlives only fall, hits only climb');

  const h = harness();
  await startAsteroidRace(h.ctx, 1, [A, B]);
  h.advance(2000);

  await onAsteroidReport(h.ctx, A, 1, 50, ASTEROID_LIVES - 2, 2, h.now);
  check('two lives gone is two lives gone', h.run(A)?.lives === ASTEROID_LIVES - 2, h.run(A)?.lives);
  check('and the hits with them', h.run(A)?.hits === 2, h.run(A)?.hits);

  await onAsteroidReport(h.ctx, A, 1, 60, ASTEROID_LIVES, 0, h.now);
  check('a phone cannot heal itself', h.run(A)?.lives === ASTEROID_LIVES - 2, h.run(A)?.lives);
  check('nor forget a hit it already reported', h.run(A)?.hits === 2, h.run(A)?.hits);

  await onAsteroidReport(h.ctx, A, 1, 70, Number.NaN, Number.POSITIVE_INFINITY, h.now);
  check('a non-finite life count moves nothing', h.run(A)?.lives === ASTEROID_LIVES - 2, h.run(A)?.lives);
  check('nor does a non-finite hit count', h.run(A)?.hits === 2, h.run(A)?.hits);

  // A stale round, and a stranger, change nothing.
  await onAsteroidReport(h.ctx, A, 99, 2000, 1, 9, h.now);
  check('a report for a stale round is ignored', h.run(A)?.distance === 70, h.run(A)?.distance);
  await onAsteroidReport(h.ctx, 'nobody', 1, 2000, 1, 0, h.now);
  check('and a stranger is not on the ladder at all', h.state()?.players['nobody'] === undefined);
}

async function crossing(): Promise<void> {
  console.log('\nfirst over the line takes it');

  const h = harness();
  await startAsteroidRace(h.ctx, 1, [A, B]);

  // Fly both honestly, reporting every second, until one crosses.
  let flown = 0;
  for (let i = 0; i < 200 && h.state()?.phase === 'running'; i++) {
    h.advance(ASTEROID_REPORT_MS);
    flown += (ASTEROID_CRUISE_SPEED * ASTEROID_REPORT_MS) / 1000;
    await onAsteroidReport(h.ctx, A, 1, flown, ASTEROID_LIVES, 0, h.now);
    await onAsteroidReport(h.ctx, B, 1, flown * 0.8, ASTEROID_LIVES, 0, h.now);
  }

  check('the race ends the moment somebody crosses', h.state()?.phase === 'done', h.state()?.phase);
  check('and it goes to whoever got there', h.state()?.winner === A, h.state()?.winner);
  check('their finish time is recorded', (h.run(A)?.finishedAt ?? 0) > 0, h.run(A)?.finishedAt);
  check('the runner-up has no finish time', h.run(B)?.finishedAt === null);
  check('a clean run took about 60 s',
    Math.abs((h.run(A)?.finishedAt ?? 0) - h.state()!.startsAt - 60_000) < 2 * ASTEROID_REPORT_MS,
    (h.run(A)?.finishedAt ?? 0) - h.state()!.startsAt);

  // Nothing moves after the end.
  const frozen = h.run(B)?.distance ?? 0;
  await onAsteroidReport(h.ctx, B, 1, ASTEROID_TRACK_LENGTH, ASTEROID_LIVES, 0, h.now);
  check('a crossing claimed after the race is over is ignored', h.run(B)?.distance === frozen, h.run(B)?.distance);
  check('and the winner does not change', h.state()?.winner === A);

  // A finish time is the phone's own stamp, but only within a window it could
  // honestly name — a phone claiming it crossed before the race began does not
  // get to say so.
  const stamped = harness();
  await startAsteroidRace(stamped.ctx, 1, [A, B]);
  let honest = 0;
  for (let i = 0; i < 200 && stamped.state()?.phase === 'running'; i++) {
    stamped.advance(ASTEROID_REPORT_MS);
    honest += (ASTEROID_CRUISE_SPEED * ASTEROID_REPORT_MS) / 1000;
    await onAsteroidReport(stamped.ctx, A, 1, honest, ASTEROID_LIVES, 0, 1);
  }
  const at = stamped.run(A)?.finishedAt ?? 0;
  check('an impossible finish stamp is clamped into the race, not taken as read',
    at >= stamped.state()!.startsAt && at <= stamped.now, at);

  // And the same claim WITHOUT the honest flying behind it never crosses at
  // all — the claim window (§8) is what stands between the two.
  const teleport = harness();
  await startAsteroidRace(teleport.ctx, 1, [A, B]);
  teleport.advance(70_000);
  await onAsteroidReport(teleport.ctx, A, 1, ASTEROID_TRACK_LENGTH, ASTEROID_LIVES, 0, teleport.now);
  check('a phone that flew the race in one silent frame does not finish it',
    teleport.state()?.phase === 'running' && teleport.run(A)?.finishedAt === null, teleport.run(A));
}

async function outOfLives(): Promise<void> {
  console.log('\nfive rocks and your race is over');

  const h = harness();
  await startAsteroidRace(h.ctx, 1, [A, B]);

  // Both fly for twenty seconds, reporting every second — a run has to be
  // real before it can end, since five stunned seconds are themselves five
  // seconds the bound in §8 knows about.
  let flown = 0;
  for (let i = 0; i < 20; i++) {
    h.advance(ASTEROID_REPORT_MS);
    flown += (ASTEROID_CRUISE_SPEED * ASTEROID_REPORT_MS) / 1000;
    await onAsteroidReport(h.ctx, A, 1, flown, ASTEROID_LIVES - 4, 4, h.now);
    await onAsteroidReport(h.ctx, B, 1, flown * 0.5, ASTEROID_LIVES - 4, 4, h.now);
  }
  check('four rocks in and still going', h.run(A)?.lives === 1, h.run(A)?.lives);

  h.advance(ASTEROID_REPORT_MS);
  await onAsteroidReport(h.ctx, A, 1, flown, 0, ASTEROID_LIVES, h.now);
  const diedAt = h.run(A)?.distance ?? 0;
  check('the fifth ends that run', h.run(A)?.lives === 0);
  check('but not the race', h.state()?.phase === 'running', h.state()?.phase);
  check('and the other player is untouched', h.run(B)?.lives === 1, h.run(B)?.lives);

  // Frozen where they died: a further report from a dead run changes nothing.
  await onAsteroidReport(h.ctx, A, 1, diedAt + 400, 0, ASTEROID_LIVES, h.now);
  check('a dead run cannot keep flying', h.run(A)?.distance === diedAt, h.run(A)?.distance);

  // Everyone out with nobody home: the furthest wins, on the distance they
  // died at.
  h.advance(ASTEROID_REPORT_MS);
  await onAsteroidReport(h.ctx, B, 1, flown * 0.5, 0, ASTEROID_LIVES, h.now);
  check('once everyone is out, the race ends', h.state()?.phase === 'done', h.state()?.phase);
  check('and the furthest takes it', h.state()?.winner === A, h.state()?.winner);
}

async function theCap(): Promise<void> {
  console.log('\nthe 120 s cap');

  const h = harness();
  await startAsteroidRace(h.ctx, 1, [A, B]);
  h.advance(3000);
  await onAsteroidReport(h.ctx, A, 1, 100, ASTEROID_LIVES, 0, h.now);
  await onAsteroidReport(h.ctx, B, 1, 60, ASTEROID_LIVES, 0, h.now);

  h.advance(ASTEROID_REPORT_MS);
  check('the tick before the cap does not end anything', (await tick(h.ctx)) === false);
  check('and the race is still running', h.state()?.phase === 'running');

  h.advance(ASTEROID_ROUND_CAP_MS);
  check('the cap ends it', (await tick(h.ctx)) === true);
  check('the furthest wins', h.state()?.winner === A, h.state()?.winner);
  check('and nothing is left to wait for', nextDeadline(h.state() as AsteroidRace) === Infinity);

  // A tie at the top is unranked, the same convention every other cap uses.
  const t = harness();
  await startAsteroidRace(t.ctx, 1, [A, B]);
  t.advance(3000);
  await onAsteroidReport(t.ctx, A, 1, 90, ASTEROID_LIVES, 0, t.now);
  await onAsteroidReport(t.ctx, B, 1, 90, ASTEROID_LIVES, 0, t.now);
  t.advance(ASTEROID_ROUND_CAP_MS);
  await tick(t.ctx);
  check('a dead heat at the cap has no winner', t.state()?.phase === 'done' && t.state()?.winner === null, t.state()?.winner);
}

async function goingQuiet(): Promise<void> {
  console.log('\na phone that stops talking');

  const h = harness();
  await startAsteroidRace(h.ctx, 1, [A, B]);
  h.advance(1000);
  await onAsteroidReport(h.ctx, A, 1, 40, ASTEROID_LIVES, 0, h.now);
  await onAsteroidReport(h.ctx, B, 1, 40, ASTEROID_LIVES, 0, h.now);

  h.advance(ASTEROID_REPORT_MS);
  await tick(h.ctx);
  check('a phone that reported a moment ago is not away', h.run(A)?.away === false);

  // B keeps reporting; A says nothing.
  for (let i = 0; i < 4; i++) {
    h.advance(ASTEROID_REPORT_MS);
    await onAsteroidReport(h.ctx, B, 1, 40 + 40 * (i + 1), ASTEROID_LIVES, 0, h.now);
    await tick(h.ctx);
  }
  check('one that has been silent past the away threshold is', h.run(A)?.away === true);
  check('while the one still flying is not', h.run(B)?.away === false);
  check('the away run is frozen where it stopped', h.run(A)?.distance === 40, h.run(A)?.distance);
  check('and the race carries on', h.state()?.phase === 'running');

  // Coming back clears it, and resumes from the referee's own number.
  await onAsteroidReport(h.ctx, A, 1, 60, ASTEROID_LIVES, 0, h.now);
  check('a report clears away immediately', h.run(A)?.away === false);
  check('and the run picks up from where the referee had it', (h.run(A)?.distance ?? 0) > 40);

  // A disconnect freezes rather than kills — their lives are still theirs to
  // come back to (spec §7), which is the opposite of Tiles Surfer's call.
  await onPlayerGone(h.ctx, A);
  check('a disconnect marks the run away', h.run(A)?.away === true);
  check('but does not spend its lives', h.run(A)?.lives === ASTEROID_LIVES, h.run(A)?.lives);
  check('and does not end the race', h.state()?.phase === 'running');
}

async function soloRun(): Promise<void> {
  console.log('\nsolo: a time trial, not a walkover');

  const h = harness();
  await startAsteroidRace(h.ctx, 1, [A], true);
  let flown = 0;
  for (let i = 0; i < 200 && h.state()?.phase === 'running'; i++) {
    h.advance(ASTEROID_REPORT_MS);
    flown += (ASTEROID_CRUISE_SPEED * ASTEROID_REPORT_MS) / 1000;
    await onAsteroidReport(h.ctx, A, 1, flown, ASTEROID_LIVES, 0, h.now);
  }
  check('a lone player can finish the track', h.state()?.phase === 'done', h.state()?.phase);
  check('their time is recorded', (h.run(A)?.finishedAt ?? 0) > 0);
  check('and there is no winner, because there was nobody to beat', h.state()?.winner === null);

  // Running out of lives alone ends the run rather than declaring a victory.
  const died = harness();
  await startAsteroidRace(died.ctx, 1, [A], true);
  died.advance(2000);
  await onAsteroidReport(died.ctx, A, 1, 80, 0, ASTEROID_LIVES, died.now);
  check('and dying alone ends it too', died.state()?.phase === 'done', died.state()?.phase);
  check('still with no winner', died.state()?.winner === null);
}

async function wire(): Promise<void> {
  console.log('\nwhat goes out on the wire');

  const h = harness();
  await startAsteroidRace(h.ctx, 1, [A, B, C]);
  h.advance(2000);
  await onAsteroidReport(h.ctx, A, 1, 70, ASTEROID_LIVES - 1, 1, h.now);
  h.advance(ASTEROID_REPORT_MS);
  h.clear();
  await tick(h.ctx);

  const frame = h.last();
  check('the tick broadcasts the whole ladder', !!frame && Object.keys(frame.d.runs).length === 3);
  const mine = frame?.d.runs[A];
  check('carrying distance, lives and hits',
    mine?.distance === 70 && mine?.lives === ASTEROID_LIVES - 1 && mine?.hits === 1, mine);
  check('and nothing about the flight itself',
    !!mine && Object.keys(mine).sort().join(',') === 'away,distance,finishedAt,hits,lives', mine && Object.keys(mine));

  // Small enough to send whole, every second, for a full room — the reason
  // this game is Profile A (spec §6).
  const bytes = JSON.stringify(toState(h.state() as AsteroidRace)).length;
  check('a full-room frame is well inside the 1 KB typical size', bytes < 1024, bytes);
}

for (const t of [starting, theBound, clamping, livesAndHits, crossing, outOfLives, theCap, goingQuiet, soloRun, wire]) {
  await t();
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
