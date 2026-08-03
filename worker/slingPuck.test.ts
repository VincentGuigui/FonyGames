import {
  PREROUND_MS,
  SLING_MIN_GAP_MS,
  SLING_ROUND_CAP_MS,
  SLING_SPEED_MAX,
  SLING_START_PUCKS,
  type ServerMessage,
} from '../shared/protocol';
import {
  nextDeadline,
  onCross,
  onPlayerGone,
  rotate,
  startSling,
  tick,
  type Ctx,
  type Sling,
} from './slingPuck';

/**
 * Logic harness for worker/slingPuck.ts, same shape as spill.test.ts and
 * goatSiege.test.ts: a fake Ctx with a clock we control. See docs/testing.md §1.1.
 *
 * The physics is *not* tested here — it is not here. It lives on the client and
 * has its own harness (www/src/games/sling-puck/physics.test.ts). What the server
 * owns is the count, the rotation and the anti-cheat floor, and that is what this
 * covers.
 */

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
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
  let stored: Sling | null = null;
  const sent: ServerMessage[] = [];

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as Sling) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as Sling;
    },
    setAlarm: async () => {},
  };

  return {
    ctx,
    sent,
    advance: (ms: number) => {
      clock += ms;
    },
    state: () => {
      if (!stored) throw new Error('no state');
      return stored;
    },
  };
}

/** A started round, already past the rules panel and ready for play. */
async function running() {
  const h = harness();
  await startSling(h.ctx, 1, [A, B]);
  h.advance(PREROUND_MS);
  h.sent.length = 0;
  return h;
}

const shot = { x: 0.5, vx: 0, vy: -1 };

/** Cross, then wait out the rate gate, so a test can throw repeatedly. */
async function crossAndWait(h: Awaited<ReturnType<typeof running>>, from: string) {
  await onCross(h.ctx, from, 1, shot);
  h.advance(SLING_MIN_GAP_MS);
}

/* ---------------------------------------------------------------- */

async function starting(): Promise<void> {
  console.log('\nstarting a round');

  const h = harness();
  check('two players start a round', (await startSling(h.ctx, 1, [A, B])) === true);
  check('both sides start full', h.state().pucks[A] === SLING_START_PUCKS &&
    h.state().pucks[B] === SLING_START_PUCKS, h.state().pucks);
  check('play begins after the rules panel', h.state().startsAt > 0);

  const first = h.sent[0];
  check('the whole state goes out first', first?.t === 'sling', first);

  // Exactly two. Not a range: a third phone has no gap of its own (spec §2).
  const solo = harness();
  check('one player cannot start', (await startSling(solo.ctx, 1, [A])) === false);
  const three = harness();
  check('three players cannot either', (await startSling(three.ctx, 1, [A, B, 'p-c'])) === false);
}

async function preRound(): Promise<void> {
  console.log('\nthe rules panel is not a suggestion');

  const h = harness();
  await startSling(h.ctx, 1, [A, B]);
  h.sent.length = 0;

  // Server-enforced, or skipping the panel would be a head start.
  await onCross(h.ctx, A, 1, shot);
  check('a crossing before play does nothing', h.sent.length === 0, h.sent);
  check('and nobody loses a puck', h.state().pucks[A] === SLING_START_PUCKS);

  h.advance(PREROUND_MS);
  await onCross(h.ctx, A, 1, shot);
  check('after the panel it counts', h.sent.some((m) => m.t === 'puck'), h.sent);
}

async function crossing(): Promise<void> {
  console.log('\na puck crosses');

  const h = await running();
  await onCross(h.ctx, A, 1, { x: 0.4, vx: 0.2, vy: -1.1 });

  const msg = h.sent.find((m) => m.t === 'puck');
  check('a puck frame goes out', msg !== undefined, h.sent);
  if (msg?.t === 'puck') {
    check('from the thrower to the other player', msg.d.from === A && msg.d.to === B, msg.d);
    check('counts ride along', msg.d.pucks[A] === SLING_START_PUCKS - 1 &&
      msg.d.pucks[B] === SLING_START_PUCKS + 1, msg.d.pucks);
  }

  check('the thrower is one lighter', h.state().pucks[A] === SLING_START_PUCKS - 1);
  check('the receiver is one heavier', h.state().pucks[B] === SLING_START_PUCKS + 1);

  // Conservation is the whole reason the counts mean anything (spec §10).
  const total = (h.state().pucks[A] ?? 0) + (h.state().pucks[B] ?? 0);
  check('nothing is created or destroyed', total === SLING_START_PUCKS * 2, total);
}

async function rotation(): Promise<void> {
  console.log('\nthe 180° handoff');

  // Straight up the middle of my board arrives straight down the middle of yours.
  const mid = rotate({ x: 0.5, vx: 0, vy: -1 });
  check('the middle stays the middle', Math.abs(mid.x - 0.5) < 1e-9, mid);
  check('upward becomes downward', mid.vy > 0, mid);

  // My left is your right — that is the entire point of the rotation.
  const left = rotate({ x: 0.2, vx: -0.3, vy: -1 });
  check('my left is your right', Math.abs(left.x - 0.8) < 1e-9, left);
  check('and the drift flips with it', left.vx > 0, left);

  const right = rotate({ x: 0.8, vx: 0.3, vy: -1 });
  check('and the reverse holds', Math.abs(right.x - 0.2) < 1e-9, right);
  check('the two are mirror images', Math.abs(left.vx + right.vx) < 1e-9, { left, right });

  // Doing it twice is doing nothing — the sign of a real rotation, and what
  // makes a puck crossing back and forth land where it should each time.
  const there = rotate({ x: 0.31, vx: 0.44, vy: -0.9 });
  const back = rotate({ x: there.x, vx: there.vx, vy: -there.vy });
  check('rotating twice is the identity', Math.abs(back.x - 0.31) < 1e-9 &&
    Math.abs(back.vx - 0.44) < 1e-9, back);
}

async function forgery(): Promise<void> {
  console.log('\na forged crossing cannot break the board');

  const wild = rotate({ x: 4.2, vx: 0, vy: -1 });
  check('x is clamped onto the board', wild.x >= 0 && wild.x <= 1, wild);

  const fast = rotate({ x: 0.5, vx: 40, vy: -40 });
  const speed = Math.sqrt(fast.vx * fast.vx + fast.vy * fast.vy);
  check('speed is capped', speed <= SLING_SPEED_MAX + 1e-9, speed);
  // Capping the speed, not each axis, so the cap cannot bend a shot sideways.
  check('and the direction survives capping', Math.abs(fast.vx + fast.vy) < 1e-9, fast);

  // A puck came *through* the gap, so it must be entering the receiver's half.
  // A frame claiming otherwise would shove it straight back out of the board.
  const backwards = rotate({ x: 0.5, vx: 0, vy: 1.2 });
  check('it always arrives heading inward', backwards.vy > 0, backwards);

  const junk = rotate({ x: Number.NaN, vx: Number.POSITIVE_INFINITY, vy: Number.NaN });
  check('nonsense numbers do not get through', Number.isFinite(junk.x) &&
    Number.isFinite(junk.vx) && Number.isFinite(junk.vy), junk);
}

async function cheatFloor(): Promise<void> {
  console.log('\nthe rate floor');

  const h = await running();
  await onCross(h.ctx, A, 1, shot);
  const after = h.sent.filter((m) => m.t === 'puck').length;

  // Back-to-back in the same millisecond: no human throws twice at once.
  await onCross(h.ctx, A, 1, shot);
  check('a second crossing straight away is refused',
    h.sent.filter((m) => m.t === 'puck').length === after, h.sent.length);
  check('and the count did not move', h.state().pucks[A] === SLING_START_PUCKS - 1);

  h.advance(SLING_MIN_GAP_MS);
  await onCross(h.ctx, A, 1, shot);
  check('after the gap it is allowed again',
    h.sent.filter((m) => m.t === 'puck').length === after + 1);

  // The gate is per player: A throwing must not silence B.
  const g = await running();
  await onCross(g.ctx, A, 1, shot);
  await onCross(g.ctx, B, 1, shot);
  check('one player cannot gate the other',
    g.sent.filter((m) => m.t === 'puck').length === 2, g.sent.length);
}

async function emptySide(): Promise<void> {
  console.log('\nyou cannot pass what you do not have');

  const h = await running();
  // Clear A's side by hand, then have them try to throw anyway.
  h.state().pucks[A] = 0;
  await h.ctx.save(h.state());
  h.sent.length = 0;

  await onCross(h.ctx, A, 1, shot);
  check('an empty side cannot cross', h.sent.length === 0, h.sent);
  check('and cannot go negative', (h.state().pucks[A] ?? 0) === 0, h.state().pucks);
}

async function winning(): Promise<void> {
  console.log('\nclearing your side wins');

  const h = await running();
  for (let i = 0; i < SLING_START_PUCKS; i++) await crossAndWait(h, A);

  const over = h.sent.find((m) => m.t === 'sling-over');
  check('the round ends', over !== undefined, h.sent.map((m) => m.t));
  if (over?.t === 'sling-over') {
    check('the player who cleared wins', over.d.winnerId === A, over.d);
    check('final counts go out', over.d.pucks[A] === 0, over.d.pucks);
  }
  check('the round is marked done', h.state().phase === 'done');

  // Nothing more happens on a finished round.
  h.sent.length = 0;
  h.advance(SLING_MIN_GAP_MS);
  await onCross(h.ctx, B, 1, shot);
  check('a late crossing is ignored', h.sent.length === 0, h.sent);
}

async function bothZero(): Promise<void> {
  console.log('\nboth sides cannot empty at once');

  // A crossing empties one side and fills the other, one message at a time, so
  // the ambiguous case in spec §9 is unreachable rather than handled.
  const h = await running();
  for (let i = 0; i < SLING_START_PUCKS - 1; i++) await crossAndWait(h, A);
  check('A is down to one', h.state().pucks[A] === 1, h.state().pucks);
  check('B has all the rest', h.state().pucks[B] === SLING_START_PUCKS * 2 - 1);
  check('so B cannot also be empty', (h.state().pucks[B] ?? 0) > 0);
}

async function roundCap(): Promise<void> {
  console.log('\nthe round cap');

  const h = await running();
  // B throws once, so A has more pucks and should lose on count.
  await onCross(h.ctx, B, 1, shot);
  h.sent.length = 0;

  h.advance(SLING_ROUND_CAP_MS);
  check('tick reports the round over', (await tick(h.ctx)) === true);
  const over = h.sent.find((m) => m.t === 'sling-over');
  check('fewest pucks wins at the cap', over?.t === 'sling-over' && over.d.winnerId === B, over);

  // Level at the cap is a draw, not a coin toss.
  const d = await running();
  d.advance(SLING_ROUND_CAP_MS);
  await tick(d.ctx);
  const draw = d.sent.find((m) => m.t === 'sling-over');
  check('level is a draw', draw?.t === 'sling-over' && draw.d.winnerId === null, draw);

  // Before the cap there is nothing at all for the server to wake up for: no
  // flight times, no fuses. The cap is the only deadline it has.
  const q = await running();
  check('the cap is the only deadline', nextDeadline(q.state()) === q.state().endsAt);
}

async function leaving(): Promise<void> {
  console.log('\na player leaving');

  const h = await running();
  await onPlayerGone(h.ctx, B);
  const over = h.sent.find((m) => m.t === 'sling-over');
  check('the round ends', over !== undefined, h.sent.map((m) => m.t));
  check('the one still there wins', over?.t === 'sling-over' && over.d.winnerId === A, over);

  // Someone who was never in the round must not end it.
  const g = await running();
  await onPlayerGone(g.ctx, 'p-stranger');
  check('a stranger leaving changes nothing', g.state().phase === 'running');
}

async function staleRound(): Promise<void> {
  console.log('\nframes from an old round');

  const h = await running();
  h.sent.length = 0;
  // A client that reconnected mid-round could still have the old id in flight.
  await onCross(h.ctx, A, 99, shot);
  check('a stale roundId is dropped', h.sent.length === 0, h.sent);
  check('and the counts hold', h.state().pucks[A] === SLING_START_PUCKS);
}

for (const t of [
  starting,
  preRound,
  crossing,
  rotation,
  forgery,
  cheatFloor,
  emptySide,
  winning,
  bothZero,
  roundCap,
  leaving,
  staleRound,
]) {
  await t();
}

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
