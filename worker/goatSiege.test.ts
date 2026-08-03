import {
  PREROUND_MS,
  SIEGE_ADULT_FLIGHT_MS,
  SIEGE_CABBAGES,
  SIEGE_KID_FLIGHT_MS,
  SIEGE_LOB_COOLDOWN_MS,
  type ServerMessage,
} from '../shared/protocol';
import {
  nextDeadline,
  onLob,
  onPlayerGone,
  onShoo,
  startSiege,
  tick,
  type Ctx,
  type Siege,
} from './goatSiege';

/**
 * Logic harness for worker/goatSiege.ts, same shape as spill.test.ts: a fake
 * Ctx with a clock we control, so the flight windows are tested rather than
 * raced against. See docs/testing.md §1.1.
 */

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

function harness() {
  let clock = 2_000_000;
  let seq = 0;
  let stored: Siege | null = null;
  const sent: ServerMessage[] = [];

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as Siege) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as Siege;
    },
    setAlarm: async () => {},
  };

  return {
    ctx,
    sent,
    advance: (ms: number) => {
      clock += ms;
    },
    at: () => clock,
    state: () => {
      if (!stored) throw new Error('no state');
      return stored;
    },
    async drain(limit = 60) {
      for (let i = 0; i < limit; i++) {
        if (!stored || stored.phase !== 'running') return;
        if (nextDeadline(stored) > clock) return;
        await tick(ctx);
      }
      throw new Error('drain did not settle');
    },
    of: <T extends ServerMessage['t']>(t: T) =>
      sent.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[],
    last: <T extends ServerMessage['t']>(t: T) =>
      [...sent].reverse().find((m) => m.t === t) as
        | Extract<ServerMessage, { t: T }>
        | undefined,
  };
}

const A = 'p-a';
const B = 'p-b';
const C = 'p-c';

async function starting(): Promise<void> {
  console.log('\nstart');
  const h = harness();
  check('two players is a game', await startSiege(h.ctx, 1, [A, B]));
  check('one is not', !(await startSiege(harness().ctx, 1, [A])));
  check('five is too many', !(await startSiege(harness().ctx, 1, [A, B, C, 'd', 'e'])));
  check(
    'everyone gets a full patch',
    h.state().cabbages[A] === SIEGE_CABBAGES && h.state().cabbages[B] === SIEGE_CABBAGES,
  );
}

async function preRound(): Promise<void> {
  console.log('\nthe rules panel window');
  const h = harness();
  await startSiege(h.ctx, 1, [A, B]);

  const start = h.last('siege');
  check('the round announces when play begins', start?.d.startsAt === h.at() + PREROUND_MS, {
    startsAt: start?.d.startsAt,
    now: h.at(),
  });

  // Enforced server-side so skipping the panel is not a head start.
  await onLob(h.ctx, A, 1, B);
  check('no lobbing while the rules are up', h.of('goat').length === 0);

  h.advance(PREROUND_MS + 1);
  await onLob(h.ctx, A, 1, B);
  check('allowed once play begins', h.of('goat').length === 1);
}

async function lobbing(): Promise<void> {
  console.log('\nlobbing and chomping');
  const h = harness();
  await startSiege(h.ctx, 1, [A, B, C]);
  h.advance(PREROUND_MS + 1); // past the rules panel; see the guard test below

  await onLob(h.ctx, A, 1, B);
  const goat = h.last('goat');
  check('a goat is in the air', !!goat);
  check('aimed at the chosen patch', goat?.d.victim === B, goat?.d);
  check('it is an adult', goat?.d.kind === 'adult');
  check('the flight is the specced length', goat!.d.arrivesAt - goat!.d.launchedAt === SIEGE_ADULT_FLIGHT_MS);
  check('the lane is inside the patch', goat!.d.lane >= 0 && goat!.d.lane <= 1, goat?.d.lane);

  // Cooldown.
  await onLob(h.ctx, A, 1, B);
  check('the lob cooldown holds', h.of('goat').length === 1);
  h.advance(SIEGE_LOB_COOLDOWN_MS + 1);
  await onLob(h.ctx, A, 1, C);
  check('free again after the cooldown', h.of('goat').length === 2);

  // You cannot lob at yourself.
  h.advance(SIEGE_LOB_COOLDOWN_MS + 1);
  await onLob(h.ctx, A, 1, A);
  check('you cannot lob at your own patch', h.of('goat').length === 2);

  h.advance(SIEGE_ADULT_FLIGHT_MS + 10);
  await h.drain();
  check('a cabbage is eaten', h.state().cabbages[B] === SIEGE_CABBAGES - 1, h.state().cabbages);
  check('and one in the other patch', h.state().cabbages[C] === SIEGE_CABBAGES - 1);
  check('the thrower loses nothing', h.state().cabbages[A] === SIEGE_CABBAGES);
  const chomp = h.last('chomp');
  check('the chomp names the victim', chomp?.d.victim === C || chomp?.d.victim === B, chomp?.d);
}

async function splitting(): Promise<void> {
  console.log('\nshooing splits the problem in two');
  const h = harness();
  await startSiege(h.ctx, 1, [A, B]);
  h.advance(PREROUND_MS + 1); // past the rules panel; see the guard test below
  await onLob(h.ctx, A, 1, B);
  const goat = h.last('goat')!;

  // Only the target can shoo it.
  await onShoo(h.ctx, A, 1, goat.d.goatId);
  check('only the victim may shoo', h.of('split').length === 0);

  h.advance(500);
  await onShoo(h.ctx, B, 1, goat.d.goatId);
  const split = h.last('split');
  check('it splits', split?.d.kids.length === 2, split?.d);
  check('the kids target the same patch', split!.d.kids.every((k) => k.victim === B));
  check('kids are kids', split!.d.kids.every((k) => k.kind === 'kid'));
  check(
    'the kids scatter to different lanes',
    split!.d.kids[0]!.lane !== split!.d.kids[1]!.lane,
    split!.d.kids.map((k) => k.lane),
  );
  check(
    'kids stay inside the patch',
    split!.d.kids.every((k) => k.lane >= 0 && k.lane <= 1),
    split!.d.kids.map((k) => k.lane),
  );
  check(
    'kids fly shorter',
    split!.d.kids.every((k) => k.arrivesAt - k.launchedAt === SIEGE_KID_FLIGHT_MS),
  );
  check('the adult is gone', !h.state().air[goat.d.goatId]);

  // The tension: shooing and then missing both kids costs *more*.
  h.advance(SIEGE_KID_FLIGHT_MS + 10);
  await h.drain();
  check(
    'two ignored kids eat two cabbages',
    h.state().cabbages[B] === SIEGE_CABBAGES - 2,
    h.state().cabbages,
  );
}

async function kidsDoNotSplit(): Promise<void> {
  console.log('\nkids do not split again');
  const h = harness();
  await startSiege(h.ctx, 1, [A, B]);
  h.advance(PREROUND_MS + 1); // past the rules panel; see the guard test below
  await onLob(h.ctx, A, 1, B);
  h.advance(300);
  await onShoo(h.ctx, B, 1, h.last('goat')!.d.goatId);
  const kid = h.last('split')!.d.kids[0]!;

  h.advance(200);
  await onShoo(h.ctx, B, 1, kid.goatId);
  const last = h.last('split');
  check('shooing a kid produces nothing further', last?.d.kids.length === 0, last?.d);
  check('the kid is gone for good', !h.state().air[kid.goatId]);

  h.advance(SIEGE_KID_FLIGHT_MS + 10);
  await h.drain();
  check('only the un-shooed kid ate', h.state().cabbages[B] === SIEGE_CABBAGES - 1, h.state().cabbages);
}

async function lateShoo(): Promise<void> {
  console.log('\ntoo late to shoo');
  const h = harness();
  await startSiege(h.ctx, 1, [A, B]);
  h.advance(PREROUND_MS + 1); // past the rules panel; see the guard test below
  await onLob(h.ctx, A, 1, B);
  const goat = h.last('goat')!;

  h.advance(SIEGE_ADULT_FLIGHT_MS + 10);
  await h.drain();
  check('it already ate', h.state().cabbages[B] === SIEGE_CABBAGES - 1);

  await onShoo(h.ctx, B, 1, goat.d.goatId);
  check('a shoo after the chomp does nothing', h.of('split').length === 0);
}

async function elimination(): Promise<void> {
  console.log('\nlosing the patch');
  const h = harness();
  await startSiege(h.ctx, 1, [A, B, C]);
  h.advance(PREROUND_MS + 1); // past the rules panel; see the guard test below
  const s = h.state();
  s.cabbages[B] = 1;
  await h.ctx.save(s);

  await onLob(h.ctx, A, 1, B);
  h.advance(SIEGE_ADULT_FLIGHT_MS + 10);
  await h.drain();
  check('B is out at zero cabbages', h.state().out.includes(B), h.state());
  check('the round continues', h.state().phase === 'running');

  // A patch that is out cannot be targeted.
  h.advance(SIEGE_LOB_COOLDOWN_MS + 1);
  const before = h.of('goat').length;
  await onLob(h.ctx, A, 1, B);
  check('you cannot lob at an empty patch', h.of('goat').length === before);

  // Knock out C and the round ends.
  const s2 = h.state();
  s2.cabbages[C] = 1;
  await h.ctx.save(s2);
  await onLob(h.ctx, A, 1, C);
  h.advance(SIEGE_ADULT_FLIGHT_MS + 10);
  await h.drain();
  const over = h.last('siege-over');
  check('last patch standing wins', over?.d.winnerId === A, over?.d);
  check('the round is done', h.state().phase === 'done');

  const sent = h.sent.length;
  await onLob(h.ctx, A, 1, B);
  check('nothing works after the round', h.sent.length === sent);
}

async function leaving(): Promise<void> {
  console.log('\nsomeone walks off');
  const h = harness();
  await startSiege(h.ctx, 1, [A, B, C]);
  h.advance(PREROUND_MS + 1); // past the rules panel; see the guard test below
  await onLob(h.ctx, A, 1, B);
  check('a goat is heading for B', h.last('goat')?.d.victim === B);

  await onPlayerGone(h.ctx, B);
  check('B is out', h.state().out.includes(B));
  check('goats aimed at B vanish', Object.keys(h.state().air).length === 0, h.state().air);
  check('the round survives with two left', h.state().phase === 'running');

  await onPlayerGone(h.ctx, C);
  check('below two players it ends', h.last('siege-over')?.d.winnerId === A);
}

async function rejections(): Promise<void> {
  console.log('\nstale and forged frames');
  const h = harness();
  await startSiege(h.ctx, 1, [A, B]);
  h.advance(PREROUND_MS + 1); // past the rules panel; see the guard test below
  const sent = h.sent.length;

  await onLob(h.ctx, A, 99, B);
  check('a stale roundId is ignored', h.sent.length === sent);
  await onLob(h.ctx, 'nobody', 1, B);
  check('an unknown player is ignored', h.sent.length === sent);
  await onShoo(h.ctx, B, 1, 'no-such-goat');
  check('an unknown goat is ignored', h.sent.length === sent);
}

for (const t of [
  starting,
  preRound,
  lobbing,
  splitting,
  kidsDoNotSplit,
  lateShoo,
  elimination,
  leaving,
  rejections,
]) {
  await t();
}

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
