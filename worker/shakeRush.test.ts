import {
  allowedIn,
  awayAt,
  reachableBy,
  nextDeadline,
  onPlayerGone,
  onRushTick,
  onShake,
  startRush,
  type Ctx,
  type Rush,
} from './shakeRush';
import {
  RUSH_AWAY_MS,
  RUSH_BROADCAST_MS,
  RUSH_CAP_MS,
  RUSH_DISTANCE,
  SHAKE_RATE_CAP,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';

/**
 * Shake Rush's referee.
 * Spec: docs/specs/games/shake-rush.md
 *
 * Two rules carry this game and both are invisible until a room full of people
 * finds them: the rate cap, which is the only thing standing between the race and
 * a client that claims a thousand shakes, and the crossing, which has to be
 * settled on the frame that arrives rather than on the next broadcast.
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

/** A referee harness with a clock we drive by hand. */
function harness(at = 1_000_000) {
  let now = at;
  let seq = 0;
  let stored: Rush | null = null;
  const sent: ServerMessage[] = [];
  let alarm = 0;

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
  };

  return {
    ctx,
    sent,
    get state() {
      return stored;
    },
    get alarm() {
      return alarm;
    },
    advance: (ms: number) => {
      now += ms;
    },
    get now() {
      return now;
    },
    last: (t: string) => [...sent].reverse().find((m) => m.t === t),
    count: (t: string) => sent.filter((m) => m.t === t).length,
  };
}

/**
 * Shake honestly for `seconds` at `rate` shakes a second, in 150 ms frames.
 *
 * The fractional remainder is carried between frames rather than rounded away:
 * 8/s across a 150 ms tick is 1.2 shakes, and rounding that to 1 quietly turns a
 * capped shaker into a 6.7/s one — which is how the first version of this helper
 * failed to reach the finish line at all.
 */
async function run(
  h: ReturnType<typeof harness>,
  id: PlayerId,
  seconds: number,
  rate = SHAKE_RATE_CAP,
): Promise<void> {
  const frames = Math.round((seconds * 1000) / 150);
  let owed = 0;
  for (let i = 0; i < frames; i++) {
    h.advance(150);
    owed += (rate * 150) / 1000;
    const n = Math.floor(owed);
    owed -= n;
    await onShake(h.ctx, id, 1, n);
  }
}

console.log('\nstarting a race');

{
  const h = harness();
  const ok = await startRush(h.ctx, 1, [A, B, C]);
  check('three players is a race', ok === true);
  check('everyone starts on the line', h.state?.players[A]?.at === 0);
  check('the cap is set', h.state?.endsAt === h.now + RUSH_CAP_MS);
  check('a track frame went out', h.count('rush') === 1);
  check('and the alarm is the broadcast tick', h.alarm === h.now + RUSH_BROADCAST_MS);

  const solo = harness();
  check('one player is not a race', (await startRush(solo.ctx, 1, [A])) === false);
}

/*
 * THE anti-cheat (spec §8). Everything else on the list is honest-but-weak; this
 * is the one that actually holds, because it is the only claim the server can
 * check against something it knows — the clock.
 */
console.log('\nthe rate cap');

{
  check('a frame covering nothing still allows one', allowedIn(0) === 1);
  check('150 ms allows about a tick of honest shaking', allowedIn(150) === 2, allowedIn(150));
  check('a second allows the cap', allowedIn(1000) === SHAKE_RATE_CAP + 1);
  check('and a negative elapsed cannot widen it', allowedIn(-9999) === 1);

  const h = harness();
  await startRush(h.ctx, 1, [A, B]);

  h.advance(150);
  await onShake(h.ctx, A, 1, 500);
  check('a five-hundred-shake frame is clipped, not believed', h.state?.players[A]?.at === 2, h.state?.players[A]?.at);

  h.advance(150);
  await onShake(h.ctx, B, 1, 2);
  check('while an honest frame is taken at face value', h.state?.players[B]?.at === 2);

  // The cheat that actually pays: split the lie across many frames, each of
  // which is individually plausible. The trajectory cap is what closes it.
  const t = h.now - (h.state as Rush).startsAt;
  for (let i = 0; i < 50; i++) await onShake(h.ctx, A, 1, 500);
  check('fifty frames in the same millisecond gain nothing beyond the clock',
    h.state?.players[A]?.at === allowedIn(t), { at: h.state?.players[A]?.at, ceiling: allowedIn(t) });
}

/*
 * The frame cap has a shake of slack in it, which is deliberate — an honest frame
 * that lands early must not be clipped. Farmed across a 150 ms tick that slack is
 * worth 13 shakes a second against a cap of 8, so the position is bounded too.
 */
console.log('\nthe trajectory cap');

{
  const h = harness();
  await startRush(h.ctx, 1, [A, B]);

  // Claim the frame maximum every single tick — each frame individually legal.
  for (let i = 0; i < 40; i++) {
    h.advance(150);
    await onShake(h.ctx, A, 1, allowedIn(150));
  }

  const elapsed = h.now - (h.state as Rush).startsAt;
  const honest = (elapsed / 1000) * SHAKE_RATE_CAP;
  check('forty legal-looking frames cannot outrun the clock',
    (h.state?.players[A]?.at ?? 0) <= honest + 1, { at: h.state?.players[A]?.at, honest });
  check('and the ceiling is what bounded them', h.state?.players[A]?.at === reachableBy(h.state as Rush, h.now));

  /*
   * The third rule, and the one both caps miss on their own: credit must not BANK
   * while a phone is silent. B has never reported, so without a window limit this
   * single frame carries sixteen seconds of allowance and takes a standing start
   * to the finish line — with both caps satisfied, because both measure from a
   * clock B has simply been ignoring.
   */
  h.advance(10_000);
  const before = h.state?.players[B]?.at ?? 0;
  await onShake(h.ctx, B, 1, 999);
  const jumped = (h.state?.players[B]?.at ?? 0) - before;
  check('ten seconds of silence does not become ten seconds of progress',
    jumped === allowedIn(RUSH_AWAY_MS), { jumped, most: allowedIn(RUSH_AWAY_MS) });
  check('and it is nowhere near the line', jumped < RUSH_DISTANCE / 10, jumped);
  check('the race is still on', h.state?.phase === 'running');

  // The slack is still there for an ordinary hiccup: a couple of dropped frames
  // must not cost an honest player the shakes they really did.
  h.advance(2 * 150);
  const mid = h.state?.players[B]?.at ?? 0;
  await onShake(h.ctx, B, 1, 3);
  check('but two dropped frames cost nothing', (h.state?.players[B]?.at ?? 0) - mid === 3);
}

console.log('\nnonsense in a frame');

{
  const h = harness();
  await startRush(h.ctx, 1, [A, B]);
  h.advance(1000);

  await onShake(h.ctx, A, 1, Number.NaN);
  check('NaN moves nobody', h.state?.players[A]?.at === 0, h.state?.players[A]?.at);
  await onShake(h.ctx, A, 1, -50);
  check('nor does a negative', h.state?.players[A]?.at === 0);
  await onShake(h.ctx, A, 1, Number.POSITIVE_INFINITY);
  check('nor does Infinity', h.state?.players[A]?.at === 0);
  await onShake(h.ctx, A, 1, 1.9);
  check('a fraction is floored, not rounded up', h.state?.players[A]?.at === 1);
  await onShake(h.ctx, 'nobody' as PlayerId, 1, 5);
  check('and an unknown player changes nothing', Object.keys(h.state?.players ?? {}).length === 2);
}

console.log('\nfrom another round');

{
  const h = harness();
  await startRush(h.ctx, 1, [A, B]);
  h.advance(1000);
  await onShake(h.ctx, A, 7, 5);
  check('a frame for round 7 does nothing to round 1', h.state?.players[A]?.at === 0);
}

console.log('\ncrossing the line');

{
  const h = harness();
  await startRush(h.ctx, 1, [A, B, C]);

  // B gets a head start, so the result is not just "everyone at zero".
  await run(h, B, 4);
  await run(h, A, RUSH_DISTANCE / SHAKE_RATE_CAP + 2);

  check('A is home', h.state?.players[A]?.at === RUSH_DISTANCE, h.state?.players[A]?.at);
  check('and not past it', (h.state?.players[A]?.at ?? 0) <= RUSH_DISTANCE);
  check('the round is over the moment they cross', h.state?.phase === 'done');

  const end = h.last('rush-end');
  check('a result went out', end?.t === 'rush-end');
  if (end?.t === 'rush-end') {
    check('the winner is first in the order', end.d.order[0] === A, end.d.order);
    check('then the furthest of the rest', end.d.order[1] === B, end.d.order);
    check('and everyone is placed', end.d.order.length === 3);
    check('with distances for the track', end.d.at[B] !== undefined && (end.d.at[B] ?? 0) > 0);
    check('C never moved and comes last', end.d.order[2] === C && end.d.at[C] === 0);
  }

  // The race is over; a straggler's frame must not restart it or move anyone.
  const at = h.state?.players[B]?.at;
  await onShake(h.ctx, B, 1, 5);
  check('a frame after the finish is ignored', h.state?.players[B]?.at === at);
  check('and the round stays done', h.state?.phase === 'done');
}

console.log('\nthe cap arrives with nobody home');

{
  const h = harness();
  await startRush(h.ctx, 1, [A, B]);
  await run(h, A, 3);
  await run(h, B, 1);

  h.advance(RUSH_CAP_MS);
  const over = await onRushTick(h.ctx);
  check('the tick ends it', over === true);
  const end = h.last('rush-end');
  check('the furthest wins', end?.t === 'rush-end' && end.d.order[0] === A, end);
  check('nobody is recorded as having finished', h.state?.finished.length === 0);
}

/*
 * Going quiet freezes a runner rather than eliminating one. A race punishes
 * silence by itself — there is nothing to add, and eliminating someone for a
 * dropped connection would end a party game on a network blip.
 */
console.log('\ngoing quiet');

{
  const h = harness();
  await startRush(h.ctx, 1, [A, B]);
  h.advance(150);
  await onShake(h.ctx, A, 1, 1);
  await onShake(h.ctx, B, 1, 1);

  check('nobody is away while both report', awayAt(h.state as Rush, h.now).length === 0);

  h.advance(RUSH_AWAY_MS + 1);
  const away = awayAt(h.state as Rush, h.now);
  check('both are away once neither has spoken', away.length === 2, away);

  await onShake(h.ctx, A, 1, 1);
  check('and one frame brings a runner back', awayAt(h.state as Rush, h.now).join() === 'b');

  const at = h.state?.players[B]?.at;
  await onRushTick(h.ctx);
  check('the frozen runner did not move', h.state?.players[B]?.at === at);
  check('and the round did not end', h.state?.phase === 'running');

  const frame = h.last('rush');
  check('the track says who is away', frame?.t === 'rush' && frame.d.away.join() === 'b', frame);
}

console.log('\nleaving');

{
  const h = harness();
  await startRush(h.ctx, 1, [A, B, C]);
  await run(h, A, 1);

  await onPlayerGone(h.ctx, A);
  check('their runner is marked away at once', awayAt(h.state as Rush, h.now).includes(A));
  check('but keeps its place on the track', (h.state?.players[A]?.at ?? 0) > 0);
  check('and the race carries on', h.state?.phase === 'running');

  // Rejoining is just reporting again — there is no seat to restore.
  h.advance(150);
  await onShake(h.ctx, A, 1, 1);
  check('rejoining resumes from the same distance', awayAt(h.state as Rush, h.now).includes(A) === false);
}

/*
 * The deadline, asked the way Room asks it. Steady Hand shipped a version of this
 * that was never due — `now >= now + TICK` is false forever — and the round lost
 * its whole server tick while still looking alive. Written as Room's expression.
 */
console.log('\nthe deadline is a moment, and it comes round');

{
  const h = harness();
  await startRush(h.ctx, 1, [A, B]);
  const s = h.state as Rush;

  check('it is a tick away, not a tick long', nextDeadline(s) === h.now + RUSH_BROADCAST_MS);
  check('so it is not due yet', !(h.now >= nextDeadline(s)));
  check('and it is what the alarm was set to', h.alarm === nextDeadline(s));

  for (let i = 0; i < 3; i++) {
    h.advance(RUSH_BROADCAST_MS);
    check(`tick ${i + 1} is due`, h.now >= nextDeadline(h.state as Rush));
    await onRushTick(h.ctx);
    check(`tick ${i + 1} armed the next one`, h.alarm === h.now + RUSH_BROADCAST_MS);
  }
  check('and every one of them broadcast the track', h.count('rush') === 4);
  check('the deadline is clamped to the cap',
    nextDeadline({ ...(h.state as Rush), tickAt: (h.state as Rush).endsAt + 10 }) === (h.state as Rush).endsAt);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
