import {
  nextDeadline,
  onAlive,
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
 * - and nothing numeric is on the wire until the close, so nobody can see what
 *   they have to beat while there is still time to beat it.
 *
 * Plus the ordinary shape: a countdown, a ten-second cap that cannot be
 * extended, and a draw as a real outcome rather than an error.
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

/** Start a round and open the window. */
async function screaming(ids: PlayerId[] = [A, B], solo = false): Promise<ReturnType<typeof harness>> {
  const h = harness();
  await startScreamMeter(h.ctx, 1, ids, solo);
  h.at(h.state.startsAt);
  await tick(h.ctx);
  return h;
}

/** Send the heartbeats a phone that really sampled would send. */
async function beats(h: ReturnType<typeof harness>, id: PlayerId, n = SCREAM_MIN_ALIVE): Promise<void> {
  for (let i = 0; i < n; i++) await onAlive(h.ctx, id, h.state.roundId);
}

async function starting(): Promise<void> {
  console.log('\nstarting a round (§2)');

  const h = harness();
  check('a room of two starts', await startScreamMeter(h.ctx, 4, [A, B]));
  check('it opens on a countdown', h.state.phase === 'countdown');
  check(`the countdown is ${SCREAM_COUNTDOWN_MS} ms`, h.state.startsAt === T0 + SCREAM_COUNTDOWN_MS);
  check(`the window is ${SCREAM_WINDOW_MS} ms and starts after it`, h.state.endsAt - h.state.startsAt === SCREAM_WINDOW_MS);
  check('a prompt was dealt', (SCREAM_PROMPTS as readonly string[]).includes(h.state.prompt));
  check('and it is on the wire', h.last.prompt === h.state.prompt);
  check('everybody is an entrant', h.state.entrants.length === 2);
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
  console.log('\nnobody sees what they have to beat (§4)');

  const h = await screaming([A, B]);
  await beats(h, A);
  h.advance(4_000);
  await onScore(h.ctx, A, 1, 88, -8, -55, false);

  check('the referee has the score', h.state.reports[A]?.score === 88);
  check('but no number is on the wire', Object.keys(h.last.scores).length === 0);
  check('only that they reported', h.last.reported.includes(A));
  check('a phone joining mid-window sees the same', Object.keys(toState(h.state).scores).length === 0);

  h.at(h.state.endsAt + SCREAM_REPORT_GRACE_MS);
  await tick(h.ctx);
  check('the close reveals the numbers', h.last.scores[A]?.score === 88);
  check('with the peak beside them', h.last.scores[A]?.peak === -8);
}

async function theHeartbeat(): Promise<void> {
  console.log('\na score with nothing behind it (§8)');

  const h = await screaming([A, B]);
  await onScore(h.ctx, A, 1, 100, -2, -60, false);
  check('a score with no heartbeats is refused', !(A in h.state.reports));

  for (let i = 0; i < SCREAM_MIN_ALIVE - 1; i++) await onAlive(h.ctx, A, 1);
  await onScore(h.ctx, A, 1, 100, -2, -60, false);
  check('and so is one with too few', !(A in h.state.reports), h.state.alive[A]);

  await onAlive(h.ctx, A, 1);
  await onScore(h.ctx, A, 1, 100, -2, -60, false);
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
  await onAlive(closed.ctx, A, 1);
  check('a heartbeat still in flight at the close counts', (closed.state.alive[A] ?? 0) === 1);
  closed.at(closed.state.endsAt + SCREAM_REPORT_GRACE_MS + 1);
  await onAlive(closed.ctx, A, 1);
  check('one past the grace does not', (closed.state.alive[A] ?? 0) === 1);

  const early = harness();
  await startScreamMeter(early.ctx, 1, [A, B]);
  await onAlive(early.ctx, A, 1);
  check('and one during the countdown too', (early.state.alive[A] ?? 0) === 0);
}

async function theClamp(): Promise<void> {
  console.log('\nwhat a claimed score cannot be (§8)');

  const h = await screaming([A, B, C]);
  await beats(h, A);
  await beats(h, B);
  await beats(h, C);

  await onScore(h.ctx, A, 1, 900, -2, -60, false);
  check('a score over 100 is clamped to 100', h.state.reports[A]?.score === 100);
  await onScore(h.ctx, B, 1, -40, -2, -60, false);
  check('a negative one is clamped to 0', h.state.reports[B]?.score === 0);
  await onScore(h.ctx, C, 1, 61.7, 12, -900, false);
  check('a fractional score is rounded', h.state.reports[C]?.score === 62);
  check('a positive dBFS peak is clamped to full scale', h.state.reports[C]?.peak === 0);
  check('and an absurd floor to the floor constant', h.state.reports[C]?.floor === SCREAM_DB_FLOOR);

  const junk = await screaming([A, B]);
  await beats(junk, A);
  await onScore(junk.ctx, A, 1, Number.NaN, -2, -60, false);
  check('a NaN score is refused outright', !(A in junk.state.reports));
  await onScore(junk.ctx, A, 1, 'loud' as unknown as number, -2, -60, false);
  check('and a string', !(A in junk.state.reports));
  await onScore(junk.ctx, A, 1, 50, Number.NaN, Number.NaN, false);
  check('but a NaN peak or floor only loses those numbers', junk.state.reports[A]?.score === 50);
  check('which become the floor constant', junk.state.reports[A]?.peak === SCREAM_DB_FLOOR);

  const second = await screaming([A, B]);
  await beats(second, A);
  await onScore(second.ctx, A, 1, 30, -20, -55, false);
  await onScore(second.ctx, A, 1, 95, -3, -55, false);
  check('a second report cannot improve on the first', second.state.reports[A]?.score === 30);

  const stranger = await screaming([A, B]);
  await onScore(stranger.ctx, 'nobody' as PlayerId, 1, 80, -5, -55, false);
  check('a stranger cannot report', !('nobody' in stranger.state.reports));
  await onScore(stranger.ctx, A, 99, 80, -5, -55, false);
  check('nor can a report for another round', !(A in stranger.state.reports));
}

async function theGrace(): Promise<void> {
  console.log('\nlate reports (§6)');

  const h = await screaming([A, B]);
  await beats(h, A);
  h.at(h.state.endsAt + SCREAM_REPORT_GRACE_MS);
  await onScore(h.ctx, A, 1, 70, -9, -55, false);
  check('a report inside the grace counts', h.state.reports[A]?.score === 70);

  const late = await screaming([A, B]);
  await beats(late, A);
  late.at(late.state.endsAt + SCREAM_REPORT_GRACE_MS + 1);
  await onScore(late.ctx, A, 1, 70, -9, -55, false);
  check('one past it does not', !(A in late.state.reports));
  late.at(late.state.endsAt + SCREAM_REPORT_GRACE_MS + 1);
  await tick(late.ctx);
  check('and that phone scores nothing', late.state.phase === 'done' && !(A in late.last.scores));

  // Everybody in early: rank now rather than making a room of two wait out
  // the grace.
  const quick = await screaming([A, B]);
  await beats(quick, A);
  await beats(quick, B);
  await onScore(quick.ctx, A, 1, 60, -12, -55, false);
  check('one report does not end it', quick.state.phase === 'window');
  await onScore(quick.ctx, B, 1, 40, -18, -55, false);
  check('everybody in ends it immediately', quick.state.phase === 'done');
  check('with the louder winning', quick.state.winner === A);
}

async function ranking(): Promise<void> {
  console.log('\nranking the room (§2, §7)');

  const h = await screaming([A, B, C]);
  await beats(h, A);
  await beats(h, B);
  await beats(h, C);
  await onScore(h.ctx, A, 1, 70, -10, -55, false);
  await onScore(h.ctx, B, 1, 90, -4, -55, false);
  await onScore(h.ctx, C, 1, 70, -11, -55, false);
  check('the highest score wins', h.state.winner === B && h.state.phase === 'done');
  check('and it is not a draw', !h.state.draw);

  // A tie on score goes to the peak.
  const tied = await screaming([A, B]);
  await beats(tied, A);
  await beats(tied, B);
  await onScore(tied.ctx, A, 1, 80, -14, -55, false);
  await onScore(tied.ctx, B, 1, 80, -6, -55, false);
  check('a tie on score is broken by peak loudness', tied.state.winner === B, { winner: tied.state.winner });
  check('and is not called a draw', !tied.state.draw);

  // A tie on both really is a draw.
  const dead = await screaming([A, B]);
  await beats(dead, A);
  await beats(dead, B);
  await onScore(dead.ctx, A, 1, 80, -10, -55, false);
  await onScore(dead.ctx, B, 1, 80, -10, -55, false);
  check('a tie on both is a draw', dead.state.draw && dead.state.winner === null);

  // Everybody silent is a legitimate outcome, not an error.
  const silent = await screaming([A, B]);
  await beats(silent, A);
  await beats(silent, B);
  await onScore(silent.ctx, A, 1, 0, SCREAM_DB_FLOOR, -55, false);
  await onScore(silent.ctx, B, 1, 0, SCREAM_DB_FLOOR, -55, false);
  check('a silent room is a draw with nobody winning', silent.state.draw && silent.state.winner === null);

  // Nobody reports at all: the cap still ends it.
  const empty = await screaming([A, B]);
  empty.at(empty.state.endsAt + SCREAM_REPORT_GRACE_MS);
  const over = await tick(empty.ctx);
  check('a round nobody reported in still ends', over && empty.state.phase === 'done');
  check('as a draw', empty.state.draw);

  const solo = await screaming([A], true);
  await beats(solo, A);
  await onScore(solo.ctx, A, 1, 95, -3, -55, false);
  check('a solo round ends on its own report', solo.state.phase === 'done');
  check('with no winner — nobody to beat', solo.state.winner === null);

  check('a tick after the end does nothing', (await tick(solo.ctx)) === false);
  check('and nextDeadline is never', nextDeadline(solo.state) === Infinity);
}

async function partialAndLeaving(): Promise<void> {
  console.log('\nbackgrounded and gone (§7)');

  const h = await screaming([A, B]);
  await beats(h, A);
  await onScore(h.ctx, A, 1, 30, -25, -55, true);
  check('a partial run is accepted and flagged', h.state.reports[A]?.partial === true);
  await beats(h, B);
  await onScore(h.ctx, B, 1, 20, -30, -55, false);
  check('and the flag reaches the results', h.last.scores[A]?.partial === true);
  check('a full run is not flagged', h.last.scores[B]?.partial === false);
  check('a partial run still ranks', h.state.winner === A);

  const gone = await screaming([A, B]);
  await beats(gone, A);
  await onPlayerGone(gone.ctx, B);
  check('a player who left is listed', gone.state.left.includes(B));
  check('and the round does not wait for them', gone.state.phase === 'window');
  await onScore(gone.ctx, A, 1, 55, -15, -55, false);
  check('the last one reporting ends it', gone.state.phase === 'done');
  check('and they win', gone.state.winner === A);
  check('the leaver has no score', !(B in gone.last.scores));

  const allGone = await screaming([A, B]);
  await onPlayerGone(allGone.ctx, A);
  await onPlayerGone(allGone.ctx, B);
  check('everybody leaving ends the round', allGone.state.phase === 'done');

  await onPlayerGone(allGone.ctx, 'nobody' as PlayerId);
  check('a stranger leaving is harmless', allGone.state.phase === 'done');
}

async function main(): Promise<void> {
  await starting();
  await nothingLeaksMidWindow();
  await theHeartbeat();
  await theClamp();
  await theGrace();
  await ranking();
  await partialAndLeaving();

  if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
  console.log(`\nall ${checks} passed`);
}

await main();
