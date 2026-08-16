import {
  findPoints,
  nextDeadline,
  onFound,
  onHuntTick,
  pickTarget,
  separation,
  startHunt,
  type Ctx,
  type Hunt,
  type Target,
} from './ghostHunt';
import {
  ELEVATION_MAX_DEG,
  ELEVATION_MIN_DEG,
  HUNT_ROUND_MS,
  HUNT_POINTS_FLOOR,
  HUNT_POINTS_PER_FIND,
  HUNT_TICK_MS,
  MIN_FIND_MS,
  TARGET_MIN_SEPARATION_DEG,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';

/**
 * Ghost Hunt's referee.
 * Spec: docs/specs/games/ghost-hunt.md
 *
 * The server cannot see where a phone is pointing — no orientation crosses the
 * wire at all — so everything worth asserting here is about the two things it CAN
 * see: the sequence it hands out, and the clock.
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

/**
 * A believable find: the SERVER's elapsed and the client's claim both have to clear
 * `MIN_FIND_MS`, so a test that means "an honest find" has to advance the clock by at
 * least this and claim at least this.
 *
 * Named rather than written as 1000, which is what these tests used to say. When the
 * hold went from 600 ms to four seconds every one of those became a claim the server
 * must reject — and the index-validation checks below would then have passed because
 * of the timing rather than because of the index they exist to test.
 */
const HONEST = MIN_FIND_MS;

const A = 'a' as PlayerId;
const B = 'b' as PlayerId;
const C = 'c' as PlayerId;

/**
 * A referee harness with a clock AND a random source we drive by hand.
 *
 * The sequence is the game, so leaving it to `Math.random()` would make half of
 * these assertions probabilistic. `rolls` is consumed in order and then repeats.
 */
function harness(at = 1_000_000, rolls = [0.1, 0.9, 0.5, 0.2, 0.8, 0.35]) {
  let now = at;
  let seq = 0;
  let r = 0;
  let stored: Hunt | null = null;
  const sent: ServerMessage[] = [];
  let alarm = 0;

  const ctx: Ctx = {
    now: () => now,
    nextSeq: () => ++seq,
    random: () => rolls[r++ % rolls.length] as number,
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

console.log('\nstarting a hunt');

{
  const h = harness();
  const ok = await startHunt(h.ctx, 1, [A, B, C]);
  check('three players is a hunt', ok === true);
  check('everyone starts on nothing', h.state?.players[A]?.score === 0);
  check('everyone is on the first ghost', h.state?.players[A]?.index === 0);
  check('the round is 90 seconds', h.state?.endsAt === h.now + HUNT_ROUND_MS);
  check('a state frame went out', h.count('hunt') === 1);
  check('and the alarm is the tick', h.alarm === h.now + HUNT_TICK_MS);

  const first = h.last('hunt');
  check('carrying the sequence', first?.t === 'hunt' && first.d.targets.length === 1);
  check('with a real direction in it', first?.t === 'hunt' && Number.isFinite(first.d.targets[0]?.azimuth));
  check('and where each player has got to', first?.t === 'hunt' && first.d.index[A] === 0);

  const solo = harness();
  check('one player is not a hunt', (await startHunt(solo.ctx, 1, [A])) === false);
}

/*
 * The sequence. Two targets close together makes the second one free, so the
 * separation rule is what keeps every find costing a movement (spec §2).
 */
console.log('\nwhere the ghosts go');

{
  // Not `=== 0`: acos of a dot product that float arithmetic makes 0.999...9 is a
  // few millionths of a degree, which is zero for every purpose this game has.
  check('the same direction is zero apart', separation({ azimuth: 30, elevation: 10 }, { azimuth: 30, elevation: 10 }) < 1e-4);
  check('opposite is 180', Math.abs(separation({ azimuth: 0, elevation: 0 }, { azimuth: 180, elevation: 0 }) - 180) < 1e-9);
  check('a quarter turn is 90', Math.abs(separation({ azimuth: 0, elevation: 0 }, { azimuth: 90, elevation: 0 }) - 90) < 1e-9);
  check('and elevation counts too', Math.abs(separation({ azimuth: 0, elevation: 0 }, { azimuth: 0, elevation: 45 }) - 45) < 1e-9);
  // The wrap is where a naive subtraction goes wrong, and it is the common case:
  // a ghost at 170 and one at -170 are 20 apart, not 340.
  check('the azimuth wraps the short way', Math.abs(separation({ azimuth: 170, elevation: 0 }, { azimuth: -170, elevation: 0 }) - 20) < 1e-9);

  // A thousand consecutive picks, none of them adjacent to the last.
  let random = 12345;
  const next = (): number => {
    random = (random * 1103515245 + 12345) % 2147483648;
    return random / 2147483648;
  };

  let previous: Target | null = null;
  let tooClose = 0;
  let outOfBand = 0;
  for (let i = 0; i < 1000; i++) {
    const t = pickTarget(next, previous);
    if (previous && separation(t, previous) < TARGET_MIN_SEPARATION_DEG) tooClose++;
    if (t.elevation < ELEVATION_MIN_DEG || t.elevation > ELEVATION_MAX_DEG) outOfBand++;
    if (Math.abs(t.azimuth) > 180) outOfBand++;
    previous = t;
  }
  check('a thousand picks never put two ghosts next to each other', tooClose === 0, tooClose);
  check('and every one is inside the safe elevation band', outOfBand === 0, outOfBand);

  // Nothing at your feet, nothing behind your head — which is a safety rule, not
  // a taste one: staring straight up while turning is how someone hits a table.
  check('the band excludes underfoot', ELEVATION_MIN_DEG > -90);
  check('and straight overhead', ELEVATION_MAX_DEG < 90);
}

/*
 * THE anti-cheat (spec §8), and the only one available: the server cannot see an
 * aim, so it checks the clock — both clocks, and the stricter wins.
 */
console.log('\nfinding one');

{
  const h = harness();
  await startHunt(h.ctx, 1, [A, B]);
  const target = h.state?.targets[0];

  h.advance(200);
  await onFound(h.ctx, A, 1, 0, 200);
  check('an instant find is refused', h.state?.players[A]?.score === 0, h.state?.players[A]);
  check('and the hunter did not move on', h.state?.players[A]?.index === 0);

  h.advance(MIN_FIND_MS);
  await onFound(h.ctx, A, 1, 0, 100);
  check('so is one where only the CLIENT claims to be fast', h.state?.players[A]?.score === 0);

  // Derived from the floor rather than written as a number: the floor moved when the
  // hold went from 600 ms to four seconds, and a literal here would have quietly
  // become "a claim the server must reject" while still calling itself honest.
  await onFound(h.ctx, A, 1, 0, MIN_FIND_MS);
  check('an honest find scores', h.state?.players[A]?.score === 1);
  check('and moves that hunter to the next ghost', h.state?.players[A]?.index === 1);
  check('which is somewhere else entirely',
    separation(h.state?.targets[1] as Target, target as Target) >= TARGET_MIN_SEPARATION_DEG);
  check('the sequence grew to hold it', h.state?.targets.length === 2);
  check('and the room was told', h.last('hunt')?.t === 'hunt');

  // The find time recorded is the SERVER's elapsed, not the client's claim — a
  // fastest-find board built from numbers the client picked is a board of liars.
  check('the time recorded is the one the server measured', h.state?.players[A]?.best === MIN_FIND_MS + 200, h.state?.players[A]?.best);
}

console.log('\nfinding it twice, and finding the wrong one');

{
  const h = harness();
  await startHunt(h.ctx, 1, [A, B]);
  h.advance(HONEST);

  await onFound(h.ctx, A, 1, 0, HONEST);
  check('the first find scores', h.state?.players[A]?.score === 1);

  await onFound(h.ctx, A, 1, 0, HONEST);
  check('a repeat of the same index does not', h.state?.players[A]?.score === 1);
  check('and does not advance them again', h.state?.players[A]?.index === 1);

  h.advance(HONEST);
  await onFound(h.ctx, A, 1, 0, HONEST);
  check('nor does a late lock on the target that has gone', h.state?.players[A]?.score === 1);

  await onFound(h.ctx, A, 1, 5, HONEST);
  check('nor one from the future', h.state?.players[A]?.score === 1);

  await onFound(h.ctx, A, 7, 1, HONEST);
  check('nor one from another round', h.state?.players[A]?.score === 1);

  await onFound(h.ctx, 'nobody' as PlayerId, 1, 1, HONEST);
  check('and an unknown player changes nothing', Object.keys(h.state?.players ?? {}).length === 2);

  await onFound(h.ctx, B, 1, 1, Number.NaN);
  check('NaN is a rejection, not a comparison that passes', h.state?.players[B]?.score === 0);
}

/*
 * Two people finding the same ghost, and a fast player not stealing it.
 *
 * This is why progress is per player. Advancing one shared target on the first
 * find made the ghost vanish mid-sweep for everyone slower AND gave the second
 * finder nothing, which spec §7 says should score.
 */
console.log('\ntwo hunters, one ghost');

{
  const h = harness();
  await startHunt(h.ctx, 1, [A, B]);
  const ghost = h.state?.targets[0];

  h.advance(HONEST);
  await onFound(h.ctx, A, 1, 0, HONEST);
  check('the fast one scores', h.state?.players[A]?.score === 1);
  check('but B is still hunting the same ghost', h.state?.players[B]?.index === 0);
  check('and it has not moved under them', h.state?.targets[0] === ghost);

  h.advance(HONEST);
  await onFound(h.ctx, B, 1, 0, HONEST);
  check('so B scores it too', h.state?.players[B]?.score === 1);
  check('and now moves on', h.state?.players[B]?.index === 1);
  check('to the same next ghost A got', h.state?.targets.length === 2);

  // The whole point of a shared sequence: the same puzzle, so it is a fair race.
  h.advance(HONEST);
  await onFound(h.ctx, A, 1, 1, HONEST);
  check('A pulls ahead by finding the next one first', h.state?.players[A]?.score === 2);
  check('while B is still on it', h.state?.players[B]?.index === 1);
  check('and the sequence only extends for the leader', h.state?.targets.length === 3);
}

/*
 * The hunt runs its full hundred seconds — nothing closes it early.
 *
 * It used to end the moment somebody reached five catches. A window makes the closing
 * seconds matter again, but only because the score is points: under a bare count you cannot
 * finish a four-second hold in the last three seconds, so nothing you do in them can change
 * anything. A late catch is still worth most of a hundred.
 */
console.log('\nthe hunt runs its full length');

{
  const h = harness();
  await startHunt(h.ctx, 1, [A, B]);

  for (let i = 0; i < 8; i++) {
    h.advance(HONEST);
    await onFound(h.ctx, A, 1, i, HONEST);
  }

  check('eight catches do not close it', h.state?.phase === 'running', h.state?.phase);
  check('they all counted', h.state?.players[A]?.score === 8, h.state?.players[A]?.score);
  check('and the clock is still the only thing that will', h.now < (h.state?.endsAt ?? 0));
}

console.log('\nwhat a ghost is worth');

{
  check('a hundred, less the seconds', findPoints(6_000) === 94, findPoints(6_000));
  check('rounded to a whole point', findPoints(6_400) === 94 && findPoints(6_600) === 93);
  check('the quickest possible catch is worth nearly all of it',
    findPoints(MIN_FIND_MS) === 96, findPoints(MIN_FIND_MS));
  /*
   * The floor. At the top of the round the arithmetic reaches zero, and a catch worth
   * nothing is indistinguishable from not catching it — which is the wrong thing to tell a
   * player in a game about catching them.
   */
  check('and the slowest is still worth something', findPoints(HUNT_ROUND_MS) === HUNT_POINTS_FLOOR,
    findPoints(HUNT_ROUND_MS));
  check('never less', findPoints(HUNT_ROUND_MS * 3) === HUNT_POINTS_FLOOR);

  /*
   * THE inequality the whole scoring rests on, and the reason it is asserted rather than
   * commented: a ghost has to be worth more than the largest possible time difference, or
   * a player who caught fewer could finish ahead of one who caught more. A player's total
   * is the round at most, so the round has to be shorter than a ghost is worth. Lengthen
   * `HUNT_ROUND_MS` past `HUNT_POINTS_PER_FIND` seconds and this is what fails, rather
   * than a scoreboard quietly ranking the wrong way in a room somewhere.
   */
  check('a ghost outweighs any time difference the round can produce',
    HUNT_ROUND_MS / 1000 <= HUNT_POINTS_PER_FIND,
    { round: HUNT_ROUND_MS / 1000, perFind: HUNT_POINTS_PER_FIND });
}

/*
 * THE claim behind the change of scoring: points rank exactly as the old rule did.
 *
 * The old rule was "most caught, then the lowest total time", two values facing opposite
 * ways, and the reason one number can replace it is arithmetic rather than taste — a ghost
 * is worth `HUNT_POINTS_PER_FIND` and no total can span more than the round, so the time
 * term can never bridge a catch. This plays real finds and compares the two orders.
 */
console.log('\npoints rank the same way the old rule did');

{
  const profiles = [
    { id: 'p-0', finds: [5_000, 5_000, 5_000] },     // three, quick
    { id: 'p-1', finds: [20_000, 22_000, 18_000] },  // three, slow
    { id: 'p-2', finds: [4_000] },                   // one, the quickest single find
    { id: 'p-3', finds: [] },                        // nothing
    { id: 'p-4', finds: [9_000, 30_000] },           // two, mixed
  ];

  const h = harness();
  await startHunt(h.ctx, 1, profiles.map((p) => p.id));
  // Each player is walked through their own finds; the clock only ever moves forward, so
  // the server's elapsed for each is the gap it was given.
  for (const p of profiles) {
    for (const [i, ms] of p.finds.entries()) {
      const player = h.state?.players[p.id];
      if (player) player.shownAt = h.now;
      await h.ctx.save(h.state!);
      h.advance(ms);
      await onFound(h.ctx, p.id, 1, i, ms);
    }
  }

  const players = h.state?.players ?? {};
  const byPoints = [...profiles].sort((a, b) =>
    (players[b.id]?.points ?? 0) - (players[a.id]?.points ?? 0));
  const byOldRule = [...profiles].sort((a, b) => {
    const count = (players[b.id]?.score ?? 0) - (players[a.id]?.score ?? 0);
    return count !== 0 ? count : (players[a.id]?.total ?? 0) - (players[b.id]?.total ?? 0);
  });

  check('the two orders agree',
    byPoints.map((p) => p.id).join() === byOldRule.map((p) => p.id).join(),
    { byPoints: byPoints.map((p) => `${p.id}:${players[p.id]?.points}`), byOldRule: byOldRule.map((p) => p.id) });

  // The two ends of it, spelled out: three slow catches still beat one fast one, and a
  // player who caught nothing is last however little time they spent doing it.
  check('three slow beat one fast',
    (players['p-1']?.points ?? 0) > (players['p-2']?.points ?? 0),
    { slow: players['p-1']?.points, fast: players['p-2']?.points });
  check('and nothing caught is nothing scored', players['p-3']?.points === 0);
}

{
  // The total is cumulative and server-measured — a client claiming a small `ms` cannot
  // make its own total look better, because the server uses its own elapsed.
  const h = harness();
  await startHunt(h.ctx, 1, [A, B]);

  h.advance(HONEST + 5_000);
  await onFound(h.ctx, A, 1, 0, HONEST);
  check('the total is the SERVER elapsed, not the claim',
    h.state?.players[A]?.total === HONEST + 5_000, h.state?.players[A]);

  h.advance(HONEST);
  await onFound(h.ctx, A, 1, 1, HONEST);
  check('and it accumulates', h.state?.players[A]?.total === HONEST * 2 + 5_000, h.state?.players[A]);
  check('while a player who has found nothing has none', h.state?.players[B]?.total === 0);
}

console.log('\nthe round ends');

{
  const h = harness();
  await startHunt(h.ctx, 1, [A, B, C]);

  // Everyone walks the same sequence from 0, so B's first find is index 0 too.
  h.advance(HONEST);
  await onFound(h.ctx, A, 1, 0, HONEST);
  // Slower than A on purpose, so "the fastest single find" below has a right answer.
  h.advance(HONEST + 1000);
  await onFound(h.ctx, B, 1, 0, HONEST + 1000);
  h.advance(HONEST);
  await onFound(h.ctx, A, 1, 1, HONEST);

  h.advance(HUNT_ROUND_MS);
  const over = await onHuntTick(h.ctx);
  check('the tick ends it', over === true);

  const end = h.last('hunt-end');
  check('a result went out', end?.t === 'hunt-end');
  if (end?.t === 'hunt-end') {
    check('with the counts', end.d.scores[A] === 2 && end.d.scores[B] === 1, end.d.scores);
    check('and everyone in it, even a blank', end.d.scores[C] === 0);
    /*
     * Per player now, rather than one fastest for the whole room: the end screen puts all
     * three times under each name, and a single room-wide best cannot fill that.
     *
     * A caught two — the first the moment it appeared, the second only after B had taken
     * their turn — so the two ends of their round are `HONEST` apart from each other.
     */
    const slow = HONEST * 2 + 1000;
    check('with each hunter\'s fastest find', end.d.fastest[A] === HONEST, end.d.fastest);
    check('and their slowest', end.d.slowest[A] === slow, end.d.slowest);
    check('one catch is its own fastest and slowest',
      end.d.fastest[B] === slow && end.d.slowest[B] === slow, { f: end.d.fastest, s: end.d.slowest });
    // B claimed `HONEST + 1000`; the server recorded what its own clock saw instead.
    check('measured by the server, not claimed', end.d.fastest[B] !== HONEST + 1000, end.d.fastest);
    check('and nothing at all for a player who caught nothing',
      end.d.fastest[C] === 0 && end.d.slowest[C] === 0, { f: end.d.fastest, s: end.d.slowest });
    check('the points came too', end.d.points[A] === findPoints(HONEST) + findPoints(slow),
      end.d.points);
  }

  h.advance(HONEST);
  await onFound(h.ctx, A, 1, 2, HONEST);
  check('a find after the end scores nothing', h.state?.players[A]?.score === 2);
}

/*
 * The deadline, asked the way Room asks it. Steady Hand shipped a version that
 * was never due — `now >= now + TICK` is false forever — and lost its whole
 * server tick while still looking alive. Written as Room's own expression.
 */
console.log('\nthe deadline is a moment, and it comes round');

{
  const h = harness();
  await startHunt(h.ctx, 1, [A, B]);
  const s = h.state as Hunt;

  check('it is a tick away, not a tick long', nextDeadline(s) === h.now + HUNT_TICK_MS);
  check('so it is not due yet', !(h.now >= nextDeadline(s)));
  check('and it is what the alarm was set to', h.alarm === nextDeadline(s));

  for (let i = 0; i < 3; i++) {
    h.advance(HUNT_TICK_MS);
    check(`tick ${i + 1} is due`, h.now >= nextDeadline(h.state as Hunt));
    await onHuntTick(h.ctx);
    check(`tick ${i + 1} armed the next one`, h.alarm === h.now + HUNT_TICK_MS);
  }
  check('and every one of them broadcast the room', h.count('hunt') === 4);
  check('the ghost stayed put while nobody found it', h.state?.targets.length === 1);
  check('and nobody advanced', h.state?.players[A]?.index === 0);
  check('the deadline is clamped to the end',
    nextDeadline({ ...(h.state as Hunt), tickAt: (h.state as Hunt).endsAt + 10 }) === (h.state as Hunt).endsAt);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
