import {
  nextDeadline,
  onAlive,
  onLevel,
  onPlayerGone,
  onScore,
  startScreamMeter,
  tick,
  toState,
  type Ctx,
  type ScreamMeter,
} from './screamMeter';
import {
  SCREAM_COUNTDOWN_MS,
  SCREAM_MIN_ALIVE,
  SCREAM_REPORT_GRACE_MS,
  SCREAM_REVEAL_MS,
  SCREAM_ROUNDS,
  SCREAM_WINDOW_MS,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { SCREAM_DB_FLOOR, SCREAM_PROMPTS } from '../shared/scream';

/**
 * Scream Meter's referee.
 * Spec: docs/specs/games/scream-meter.md
 *
 * The scoring maths is `shared/scream.test.ts`'s business. What matters here is
 * the uncomfortable part: **the phone reports its own loudness, so the phone
 * can lie**, and there is no way to check without sending audio, which §10
 * forbids. So most of these checks are about what a lying client cannot get
 * away with —
 *
 * - a score with no heartbeats behind it is refused, because it cannot have
 *   been measured;
 * - a score is clamped to the range a real microphone can report;
 * - a second report cannot improve on a first;
 * - and nothing numeric is on the wire until a round closes, so nobody can see
 *   what they have to beat while there is still time to beat it.
 *
 * Plus the shape a MATCH actually has now: ten rounds back to back, a brief
 * `'reveal'` between one round's close and the next round's countdown, a
 * running total that is what the match is actually decided on, and a draw as
 * a real outcome rather than an error.
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
  let stored: ScreamMeter | null = null;
  const sent: ServerMessage[] = [];
  let alarm = 0;
  let h = 0xFACE;
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
    get state(): ScreamMeter {
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
      const frames = sent.filter((m) => m.t === 'scream');
      const frame = frames[frames.length - 1];
      if (!frame || frame.t !== 'scream') throw new Error('no scream frame');
      return frame.d;
    },
  };
}

/** Start a match and open round 1's window. */
async function screaming(ids: PlayerId[] = [A, B], solo = false): Promise<ReturnType<typeof harness>> {
  const h = harness();
  await startScreamMeter(h.ctx, 1, ids, solo);
  h.at(h.state.startsAt);
  await tick(h.ctx);
  return h;
}

/** Send the heartbeats a phone that really sampled would send, for the round in flight. */
async function beats(h: ReturnType<typeof harness>, id: PlayerId, n = SCREAM_MIN_ALIVE): Promise<void> {
  for (let i = 0; i < n; i++) await onAlive(h.ctx, id, h.state.roundId, h.state.round);
}

/** Report a score for the round in flight. */
async function report(
  h: ReturnType<typeof harness>,
  id: PlayerId,
  score: number,
  peak: number,
  floor: number,
  partial = false,
): Promise<void> {
  await onScore(h.ctx, id, h.state.roundId, h.state.round, score, peak, floor, partial);
}

/** Close the round in flight — everyone still owing a report is timed out. */
async function closeRound(h: ReturnType<typeof harness>): Promise<void> {
  h.at(h.state.endsAt + SCREAM_REPORT_GRACE_MS);
  await tick(h.ctx);
}

/** Move past a 'reveal' into the next round's countdown (or the match's end). */
async function afterReveal(h: ReturnType<typeof harness>): Promise<void> {
  h.at(h.state.revealEndsAt);
  await tick(h.ctx);
}

async function starting(): Promise<void> {
  console.log('\nstarting a match (§2)');

  const h = harness();
  check('a room of two starts', await startScreamMeter(h.ctx, 4, [A, B]));
  check('it opens on round 1', h.state.round === 1);
  check('on a countdown', h.state.phase === 'countdown');
  check(`the countdown is ${SCREAM_COUNTDOWN_MS} ms`, h.state.startsAt === T0 + SCREAM_COUNTDOWN_MS);
  check(`the window is ${SCREAM_WINDOW_MS} ms and starts after it`, h.state.endsAt - h.state.startsAt === SCREAM_WINDOW_MS);
  check('a prompt was dealt', (SCREAM_PROMPTS as readonly string[]).includes(h.state.prompt));
  check('and it is on the wire, with the round and its total', h.last.prompt === h.state.prompt && h.last.round === 1 && h.last.rounds === SCREAM_ROUNDS);
  check('everybody is an entrant, at zero', h.state.entrants.length === 2 && h.state.totals[A] === 0 && h.state.totals[B] === 0);
  check('nobody has reported', h.last.reported.length === 0);
  check('the alarm is the start of the screaming', h.alarm === h.state.startsAt);

  const alone = harness();
  check('one player cannot start', !(await startScreamMeter(alone.ctx, 1, [A])));
  check('unless it is solo testing', await startScreamMeter(alone.ctx, 1, [A], true));

  const crowd = harness();
  check('nine cannot start', !(await startScreamMeter(crowd.ctx, 1, [A, B, C, 'd', 'e', 'f', 'g', 'h', 'i'] as PlayerId[])));

  const open = await screaming();
  check('the window opens on the alarm', open.state.phase === 'window');
  check('and the alarm moves to the close plus the grace', open.alarm === open.state.endsAt + SCREAM_REPORT_GRACE_MS);
  check(`the reporting grace is ${SCREAM_REPORT_GRACE_MS} ms`, open.alarm - open.state.endsAt === SCREAM_REPORT_GRACE_MS);
}

async function nothingLeaksMidWindow(): Promise<void> {
  console.log('\nnobody sees what they have to beat, this round or the running total (§4)');

  const h = await screaming([A, B]);
  await beats(h, A);
  h.advance(4_000);
  await report(h, A, 88, -8, -55);

  check('the referee has the score', h.state.reports[A]?.score === 88);
  check('but no number is on the wire', Object.keys(h.last.scores).length === 0);
  check('only that they reported', h.last.reported.includes(A));
  check('a phone joining mid-window sees the same', Object.keys(toState(h.state).scores).length === 0);
  check('the total does not move until the round closes', h.last.totals[A] === 0);

  await closeRound(h);
  check('the round closes into a reveal, not straight to done', h.state.phase === 'reveal');
  check('the reveal shows the numbers', h.last.scores[A]?.score === 88);
  check('with the peak beside them', h.last.scores[A]?.peak === -8);
  check('and the total now includes this round', h.last.totals[A] === 88);
}

async function theHeartbeat(): Promise<void> {
  console.log('\na score with nothing behind it (§8)');

  const h = await screaming([A, B]);
  await report(h, A, 100, -2, -60);
  check('a score with no heartbeats is refused', !(A in h.state.reports));

  for (let i = 0; i < SCREAM_MIN_ALIVE - 1; i++) await onAlive(h.ctx, A, h.state.roundId, h.state.round);
  await report(h, A, 100, -2, -60);
  check('and so is one with too few', !(A in h.state.reports), h.state.alive[A]);

  await onAlive(h.ctx, A, h.state.roundId, h.state.round);
  await report(h, A, 100, -2, -60);
  check('with enough, it counts', h.state.reports[A]?.score === 100);

  // Heartbeats are counted, not stored as timestamps — a list of when somebody
  // was in a room is data this game has no reason to keep.
  check('the referee keeps a count, not a log', typeof h.state.alive[A] === 'number');

  /*
   * A heartbeat is accepted on the same deadline as a score. A phone sampling
   * right up to the close sends its last ones AT the close, and 300 ms of lag
   * puts them after it — refusing those would make this requirement punish
   * latency rather than catch a client that never sampled.
   */
  const closed = await screaming([A, B]);
  closed.at(closed.state.endsAt + SCREAM_REPORT_GRACE_MS);
  await onAlive(closed.ctx, A, closed.state.roundId, closed.state.round);
  check('a heartbeat still in flight at the close counts', (closed.state.alive[A] ?? 0) === 1);
  closed.at(closed.state.endsAt + SCREAM_REPORT_GRACE_MS + 1);
  await onAlive(closed.ctx, A, closed.state.roundId, closed.state.round);
  check('one past the grace does not', (closed.state.alive[A] ?? 0) === 1);

  const early = harness();
  await startScreamMeter(early.ctx, 1, [A, B]);
  await onAlive(early.ctx, A, early.state.roundId, early.state.round);
  check('and one during the countdown too', (early.state.alive[A] ?? 0) === 0);

  const wrongRound = await screaming([A, B]);
  await onAlive(wrongRound.ctx, A, wrongRound.state.roundId, wrongRound.state.round + 1);
  check('a heartbeat for the wrong round does not count either', (wrongRound.state.alive[A] ?? 0) === 0);
}

async function theClamp(): Promise<void> {
  console.log('\nwhat a claimed score cannot be (§8)');

  const h = await screaming([A, B, C]);
  await beats(h, A);
  await beats(h, B);
  await beats(h, C);

  await report(h, A, 900, -2, -60);
  check('a score over 100 is clamped to 100', h.state.reports[A]?.score === 100);
  await report(h, B, -40, -2, -60);
  check('a negative one is clamped to 0', h.state.reports[B]?.score === 0);
  await report(h, C, 61.7, 12, -900);
  check('a fractional score is rounded', h.state.reports[C]?.score === 62);
  check('a positive dBFS peak is clamped to full scale', h.state.reports[C]?.peak === 0);
  check('and an absurd floor to the floor constant', h.state.reports[C]?.floor === SCREAM_DB_FLOOR);

  const junk = await screaming([A, B]);
  await beats(junk, A);
  await report(junk, A, Number.NaN, -2, -60);
  check('a NaN score is refused outright', !(A in junk.state.reports));
  await onScore(junk.ctx, A, junk.state.roundId, junk.state.round, 'loud' as unknown as number, -2, -60, false);
  check('and a string', !(A in junk.state.reports));
  await report(junk, A, 50, Number.NaN, Number.NaN);
  check('but a NaN peak or floor only loses those numbers', junk.state.reports[A]?.score === 50);
  check('which become the floor constant', junk.state.reports[A]?.peak === SCREAM_DB_FLOOR);

  const second = await screaming([A, B]);
  await beats(second, A);
  await report(second, A, 30, -20, -55);
  await report(second, A, 95, -3, -55);
  check('a second report cannot improve on the first', second.state.reports[A]?.score === 30);

  const stranger = await screaming([A, B]);
  await onScore(stranger.ctx, 'nobody' as PlayerId, stranger.state.roundId, stranger.state.round, 80, -5, -55, false);
  check('a stranger cannot report', !('nobody' in stranger.state.reports));
  await onScore(stranger.ctx, A, 99, stranger.state.round, 80, -5, -55, false);
  check('nor can a report for another match', !(A in stranger.state.reports));
  await onScore(stranger.ctx, A, stranger.state.roundId, 99, 80, -5, -55, false);
  check('nor for another round of this one', !(A in stranger.state.reports));
}

async function theGrace(): Promise<void> {
  console.log('\nlate reports (§6)');

  const h = await screaming([A, B]);
  await beats(h, A);
  h.at(h.state.endsAt + SCREAM_REPORT_GRACE_MS);
  await report(h, A, 70, -9, -55);
  check('a report inside the grace counts', h.state.reports[A]?.score === 70);

  const late = await screaming([A, B]);
  await beats(late, A);
  late.at(late.state.endsAt + SCREAM_REPORT_GRACE_MS + 1);
  await report(late, A, 70, -9, -55);
  check('one past it does not', !(A in late.state.reports));
  await tick(late.ctx);
  check('the round closes into reveal regardless', late.state.phase === 'reveal');
  check('and that phone scored nothing this round', !(A in late.last.scores));
  check('so its total does not move', late.last.totals[A] === 0);

  // Everybody in early: close the round now rather than making a room of two
  // wait out the grace.
  const quick = await screaming([A, B]);
  await beats(quick, A);
  await beats(quick, B);
  await report(quick, A, 60, -12, -55);
  check('one report does not close it', quick.state.phase === 'window');
  await report(quick, B, 40, -18, -55);
  check('everybody in closes it immediately', quick.state.phase === 'reveal');
  check(`the reveal holds for ${SCREAM_REVEAL_MS} ms`, quick.state.revealEndsAt - quick.ctx.now() === SCREAM_REVEAL_MS);
}

async function betweenRounds(): Promise<void> {
  console.log('\none reveal, then the next round (§2)');

  const h = await screaming([A, B]);
  await beats(h, A);
  await beats(h, B);
  await report(h, A, 60, -12, -55);
  await report(h, B, 40, -18, -55);
  check('closed into a reveal', h.state.phase === 'reveal');
  check('a tick before the reveal ends does nothing', (await tick(h.ctx)) === false && h.state.phase === 'reveal');

  const prompt1 = h.state.prompt;
  await afterReveal(h);
  check('round 2 opens on a fresh countdown', h.state.round === 2 && h.state.phase === 'countdown');
  check('the entrants are unchanged', h.state.entrants.length === 2);
  check('reports and levels are cleared for the new round', Object.keys(h.state.reports).length === 0 && Object.keys(h.state.levels).length === 0);
  check('heartbeats reset to zero', h.state.alive[A] === 0 && h.state.alive[B] === 0);
  check('the total from round 1 carries forward', h.state.totals[A] === 60 && h.state.totals[B] === 40);
  check('and the scores shown reset — round 2 has not happened yet', Object.keys(h.last.scores).length === 0);
  // A prompt CAN repeat by chance, but the machinery that deals it must run again.
  check('a new prompt was actually dealt', typeof h.state.prompt === 'string' && h.state.prompt.length > 0, { prompt1, prompt2: h.state.prompt });

  h.at(h.state.startsAt);
  await tick(h.ctx);
  await beats(h, A);
  await report(h, A, 30, -20, -55);
  await closeRound(h);
  check('round 2 adds to the SAME running total', h.state.totals[A] === 90, h.state.totals);
  check('a report that never came in this round is simply absent', !(B in h.state.reports));
}

async function liveLevels(): Promise<void> {
  console.log('\nthe purely visual side meters, sampled through the window (§4)');

  const h = await screaming([A, B]);
  check('nothing is reported before anyone screams', Object.keys(h.last.levels).length === 0);

  await onLevel(h.ctx, A, h.state.roundId, h.state.round, 0.7);
  check('a level is stored', h.state.levels[A] === 0.7);
  check('and broadcast — unlike a heartbeat, this one is FOR the room', h.last.levels[A] === 0.7);

  await onLevel(h.ctx, B, h.state.roundId, h.state.round, 1.4);
  check('over 1 clamps to 1', h.state.levels[B] === 1);
  await onLevel(h.ctx, B, h.state.roundId, h.state.round, -0.2);
  check('under 0 clamps to 0', h.state.levels[B] === 0);
  await onLevel(h.ctx, B, h.state.roundId, h.state.round, Number.NaN);
  check('garbage is ignored rather than stored', h.state.levels[B] === 0);

  await onLevel(h.ctx, 'nobody' as PlayerId, h.state.roundId, h.state.round, 0.5);
  check('a stranger cannot post a level', !('nobody' in h.state.levels));

  await onLevel(h.ctx, A, h.state.roundId, h.state.round + 1, 0.9);
  check('a level for the wrong round is dropped', h.state.levels[A] === 0.7);

  await closeRound(h);
  check('once the round closes the levels are not shown any more', Object.keys(h.last.levels).length === 0);
  check('though the referee keeps them until the next round arms', h.state.levels[A] === 0.7);

  const beforeStart = harness();
  await startScreamMeter(beforeStart.ctx, 1, [A, B]);
  await onLevel(beforeStart.ctx, A, beforeStart.state.roundId, beforeStart.state.round, 0.5);
  check('a level during the countdown is dropped — the window has not opened', !(A in beforeStart.state.levels));
}

async function partialAndLeaving(): Promise<void> {
  console.log('\nbackgrounded and gone (§7)');

  const h = await screaming([A, B]);
  await beats(h, A);
  await report(h, A, 30, -25, -55, true);
  check('a partial run is accepted and flagged', h.state.reports[A]?.partial === true);
  await beats(h, B);
  await report(h, B, 20, -30, -55, false);
  check('and the flag reaches the reveal', h.last.scores[A]?.partial === true);
  check('a full run is not flagged', h.last.scores[B]?.partial === false);
  check('a partial run still counts toward the total', h.state.totals[A] === 30);

  const gone = await screaming([A, B]);
  await beats(gone, A);
  await onPlayerGone(gone.ctx, B);
  check('a player who left is listed', gone.state.left.includes(B));
  check('and the round does not wait for them', gone.state.phase === 'window');
  await report(gone, A, 55, -15, -55);
  check('the last one reporting closes the round', gone.state.phase === 'reveal');
  check('the leaver has no score this round', !(B in gone.last.scores));

  const allGone = await screaming([A, B]);
  await onPlayerGone(allGone.ctx, A);
  await onPlayerGone(allGone.ctx, B);
  check('everybody leaving ends the MATCH outright, not just the round', allGone.state.phase === 'done');
  check('with nobody to have won', allGone.state.draw && allGone.state.winner === null);

  await onPlayerGone(allGone.ctx, 'nobody' as PlayerId);
  check('a stranger leaving afterwards is harmless', allGone.state.phase === 'done');
}

async function matchOfTenRounds(): Promise<void> {
  console.log(`\na match is ${SCREAM_ROUNDS} rounds, decided on the total (§2)`);

  const h = harness();
  await startScreamMeter(h.ctx, 1, [A, B, C]);
  check('the constant really is ten', SCREAM_ROUNDS === 10);
  check('and round 1 opens the same way every round after it will', h.state.round === 1 && h.state.phase === 'countdown' && h.last.rounds === 10);

  // A drove but a hair behind B every round; C never manages to beat either.
  // Chosen so the running total, not any single round, decides it.
  for (let round = 1; round <= SCREAM_ROUNDS; round++) {
    check(`  round ${round} opens as itself`, h.state.round === round && h.state.phase === 'countdown');
    h.at(h.state.startsAt);
    await tick(h.ctx);
    await beats(h, A);
    await beats(h, B);
    await beats(h, C);
    await report(h, A, 40, -20, -55);
    await report(h, B, 45, -18, -55);
    await report(h, C, 10, -40, -55);
    check(`  round ${round} closes into a reveal`, h.state.phase === 'reveal');

    if (round < SCREAM_ROUNDS) {
      await afterReveal(h);
    }
  }

  check('the match is still open one tick before the last reveal ends', h.state.phase === 'reveal');
  await afterReveal(h);
  check('and done once it does', h.state.phase === 'done');
  check('nextDeadline is never, once done', nextDeadline(h.state) === Infinity);
  check('a tick after the end does nothing', (await tick(h.ctx)) === false);

  check('every round added to the total', h.state.totals[A] === 40 * SCREAM_ROUNDS, h.state.totals[A]);
  check('B\'s total is the highest', h.state.totals[B] === 45 * SCREAM_ROUNDS && (h.last.totals[B] ?? 0) > (h.last.totals[A] ?? 0));
  check('B wins the match on total, not on any one round', h.state.winner === B);
  check('and it is not a draw', !h.state.draw);
}

async function tiesAndDraws(): Promise<void> {
  console.log('\nties and a room too polite to win (§2, §7)');

  // Equal totals, but B screamed louder at least once — the match's own
  // peak tie-break, generalised from the single-round rule.
  const tied = await screaming([A, B]);
  for (let round = 1; round <= SCREAM_ROUNDS; round++) {
    tied.at(tied.state.startsAt);
    await tick(tied.ctx);
    await beats(tied, A);
    await beats(tied, B);
    await report(tied, A, 50, -14, -55);
    await report(tied, B, 50, round === 1 ? -6 : -14, -55);
    if (round < SCREAM_ROUNDS) await afterReveal(tied);
  }
  await afterReveal(tied);
  check('equal totals are broken by the best peak either of them ever hit', tied.state.winner === B, { totals: tied.state.totals });
  check('and that is not called a draw', !tied.state.draw);

  // Equal totals AND equal best peak really is a draw.
  const dead = await screaming([A, B]);
  for (let round = 1; round <= SCREAM_ROUNDS; round++) {
    dead.at(dead.state.startsAt);
    await tick(dead.ctx);
    await beats(dead, A);
    await beats(dead, B);
    await report(dead, A, 50, -10, -55);
    await report(dead, B, 50, -10, -55);
    if (round < SCREAM_ROUNDS) await afterReveal(dead);
  }
  await afterReveal(dead);
  check('a tie on both total and peak is a draw', dead.state.draw && dead.state.winner === null);

  // Nobody ever reports: the match still runs its course and ends a draw.
  const silent = await screaming([A, B]);
  for (let round = 1; round <= SCREAM_ROUNDS; round++) {
    // Round 1 is already in its window (screaming() opened it); every round
    // after arrives on a fresh countdown, so it takes both ticks to close —
    // the same two-step matchOfTenRounds() uses, just with nobody screaming.
    silent.at(silent.state.startsAt);
    await tick(silent.ctx);
    silent.at(silent.state.endsAt + SCREAM_REPORT_GRACE_MS);
    await tick(silent.ctx);
    if (round < SCREAM_ROUNDS) await afterReveal(silent);
  }
  await afterReveal(silent);
  check('a silent match ends as a draw with nobody winning', silent.state.draw && silent.state.winner === null);
  check('every total stayed at zero', silent.state.totals[A] === 0 && silent.state.totals[B] === 0);

  const solo = await screaming([A], true);
  for (let round = 1; round <= SCREAM_ROUNDS; round++) {
    solo.at(solo.state.startsAt);
    await tick(solo.ctx);
    await beats(solo, A);
    await report(solo, A, 95, -3, -55);
    if (round < SCREAM_ROUNDS) await afterReveal(solo);
  }
  await afterReveal(solo);
  check('a solo match runs the full ten rounds', solo.state.round === SCREAM_ROUNDS && solo.state.phase === 'done');
  check('with no winner — nobody to beat', solo.state.winner === null);
}

async function main(): Promise<void> {
  await starting();
  await nothingLeaksMidWindow();
  await theHeartbeat();
  await theClamp();
  await theGrace();
  await betweenRounds();
  await liveLevels();
  await partialAndLeaving();
  await matchOfTenRounds();
  await tiesAndDraws();

  if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
  console.log(`\nall ${checks} passed`);
}

await main();
