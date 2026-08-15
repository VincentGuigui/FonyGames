/**
 * Logic harness for worker/spill.ts. Drives the referee through a fake Ctx —
 * no wrangler, no sockets, and a clock we control, so the timing rules are
 * actually testable rather than raced against.
 */
import {
  PREROUND_MS,
  SPILL_APPROACH_MS,
  SPILL_HOLD_MS,
  SPILL_LOSE_LEVEL,
  SPILL_START_LEVEL,
  type ServerMessage,
} from '../shared/protocol';
import {
  SPILL_FLICK_CONE,
  SPILL_NOMINAL_ASPECT,
  bounceArriving,
  bounceLeaving,
  foldInto,
  screenAngleTo,
} from '../shared/spillGeometry';
import {
  nextDeadline,
  onCatch,
  onFling,
  onPlayerGone,
  startSpill,
  tick,
  type Ctx,
  type Spill,
} from './spill';

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

type Harness = {
  ctx: Ctx;
  sent: ServerMessage[];
  advance(ms: number): void;
  at(): number;
  state(): Spill;
  /** Run every alarm the referee asks for, up to `limit` firings. */
  drain(limit?: number): Promise<void>;
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined;
  of<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[];
};

function harness(): Harness {
  let clock = 1_000_000;
  let seq = 0;
  let stored: Spill | null = null;
  const sent: ServerMessage[] = [];

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as Spill) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as Spill;
    },
    // Room ignores the requested time and recomputes from state, so drain()
    // does the same rather than trusting whatever the module asked for.
    setAlarm: async () => {},
  };

  return {
    ctx,
    sent,
    advance: (ms) => {
      clock += ms;
    },
    at: () => clock,
    state: () => {
      if (!stored) throw new Error('no state');
      return stored;
    },
    async drain(limit = 50) {
      for (let i = 0; i < limit; i++) {
        if (!stored || stored.phase !== 'running') return;
        const due = nextDeadline(stored);
        if (due > clock) return;
        await tick(ctx);
      }
      throw new Error('drain did not settle');
    },
    last: (t) => [...sent].reverse().find((m) => m.t === t) as never,
    of: (t) => sent.filter((m) => m.t === t) as never,
  };
}

const A = 'p-a';
const B = 'p-b';
const C = 'p-c';
const D = 'p-d';

/* ---------------------------------------------------------------- */

async function seating(): Promise<void> {
  console.log('\nseating and start');
  const h = harness();

  check('2 is allowed', await startSpill(h.ctx, 1, [A, B]));
  check('1 player is refused', !(await startSpill(harness().ctx, 1, [A])));
  check('5 players are refused', !(await startSpill(harness().ctx, 1, [A, B, C, D, 'p-e'])));

  const s = h.state();
  check('everyone starts half full', s.levels[A] === SPILL_START_LEVEL && s.levels[B] === SPILL_START_LEVEL);
  check('seats follow join order', s.seats.join() === [A, B].join());
  const first = h.last('spill');
  check('state is broadcast at start', first?.d.roundId === 1 && first.d.phase === 'running');
}

async function preRound(): Promise<void> {
  console.log('\nthe rules panel window');
  const h = harness();
  await startSpill(h.ctx, 1, [A, B]);

  const start = h.last('spill');
  check('the round announces when play begins', start?.d.startsAt === h.at() + PREROUND_MS, {
    startsAt: start?.d.startsAt,
    now: h.at(),
  });

  // The whole point of enforcing it server-side: a client that skipped the
  // panel must not get a head start.
  await onFling(h.ctx, A, 1, screenAngleTo(0, 1, 2), 3);
  check('no flinging while the rules are up', h.of('drop').length === 0);
  check('and no water is lost trying', h.state().levels[A] === SPILL_START_LEVEL);

  h.advance(PREROUND_MS - 100);
  await onFling(h.ctx, A, 1, screenAngleTo(0, 1, 2), 3);
  check('still refused just before the panel ends', h.of('drop').length === 0);

  h.advance(200);
  await onFling(h.ctx, A, 1, screenAngleTo(0, 1, 2), 3);
  check('allowed once play begins', h.of('drop').length === 1);

  // "Play again" gets no panel and therefore no window: everyone has just read
  // the rules and played a round. A window with the panel suppressed would only
  // be four silent seconds of a board that looks live (protocol.ts preroundFor).
  const again = harness();
  await startSpill(again.ctx, 2, [A, B]);
  const replay = again.last('spill');
  check('a replay starts immediately', replay?.d.startsAt === again.at(), {
    startsAt: replay?.d.startsAt,
    now: again.at(),
  });
  await onFling(again.ctx, A, 2, screenAngleTo(0, 1, 2), 3);
  check('and takes a fling straight away', again.of('drop').length === 1);
}

async function aimingAndLock(): Promise<void> {
  console.log('\naiming, launch lock, landing');
  const h = harness();
  await startSpill(h.ctx, 1, [A, B, C, D]);
  h.advance(PREROUND_MS + 1); // past the rules panel; see the guard test below

  // A sits at seat 0. Flick straight at seat 2 (the far side of the table).
  const straight = screenAngleTo(0, 2, 4);
  await onFling(h.ctx, A, 1, straight, 3);

  const drop = h.last('drop');
  check('a flick produces a drop', drop !== undefined);
  check('aimed at the opposite seat', drop?.d.to === 2, drop?.d);
  check('one drop leaves the pool', h.state().levels[A] === SPILL_START_LEVEL - 1);
  check('the thrower is locked', (h.state().lockedUntil[A] ?? 0) > h.at());

  // Second flick while locked: refused, and no water leaves.
  await onFling(h.ctx, A, 1, straight, 3);
  check('locked out of a second flick', h.of('drop').length === 1);
  check('a refused flick costs nothing', h.state().levels[A] === SPILL_START_LEVEL - 1);

  // Once it has cleared the screen, flinging is allowed again.
  h.advance((drop?.d.leavesAt ?? 0) - h.at() + 1);
  await onFling(h.ctx, A, 1, straight, 3);
  check('free again once it has left the screen', h.of('drop').length === 2);

  // Let both land.
  h.advance(5000);
  await h.drain();
  const land = h.last('land');
  check('it lands on the player it was aimed at', land?.d.on === C, land?.d);
  check('the target takes the water', h.state().levels[C] === SPILL_START_LEVEL + 2);
  check('the thrower is 2 lighter', h.state().levels[A] === SPILL_START_LEVEL - 2);

  // A wild flick backwards is folded into the forward cone (the phone would not have sent
  // it at all) and, at the edge of it, still misses everyone.
  await onFling(h.ctx, A, 1, Math.PI, 3);
  const wild = h.last('drop');
  check('a backwards flick hits nothing', wild?.d.to === null, wild?.d);
  h.advance(5000);
  await h.drain();
  const lost = h.last('land');
  check('lost water lands on nobody', lost?.d.on === null);
  const total = [A, B, C, D].reduce((n, p) => n + (h.state().levels[p] ?? 0), 0);
  check('water left the game entirely', total === SPILL_START_LEVEL * 4 - 1, total);
}

async function catching(): Promise<void> {
  console.log('\ncatching');
  const h = harness();
  await startSpill(h.ctx, 1, [A, B, C, D]);
  h.advance(PREROUND_MS + 1); // past the rules panel; see the guard test below
  await onFling(h.ctx, A, 1, screenAngleTo(0, 2, 4), 3);
  const drop = h.last('drop')!;
  const id = drop.d.dropId;

  // Too early: it is not on the target's screen yet.
  await onCatch(h.ctx, C, 1, id);
  check('cannot catch before the approach window', h.of('caught').length === 0);

  // The wrong player cannot catch it either.
  h.advance(drop.d.arrivesAt - SPILL_APPROACH_MS + 50 - h.at());
  await onCatch(h.ctx, B, 1, id);
  check('only the target can catch it', h.of('caught').length === 0);

  await onCatch(h.ctx, C, 1, id);
  const caught = h.last('caught');
  check('the target catches it', caught?.d.by === C);
  check('a caught drop is worth double', caught?.d.size === 2, caught?.d);
  check('catching does not add to your water', h.state().levels[C] === SPILL_START_LEVEL);

  // Re-fling the held drop: it carries the doubled payload and costs nothing.
  h.advance(1000);
  const before = h.state().levels[C];
  await onFling(h.ctx, C, 1, screenAngleTo(2, 0, 4), 3, id);
  const relob = h.last('drop');
  check('re-flinging carries the doubled size', relob?.d.size === 2, relob?.d);
  check('re-flinging costs no water of your own', h.state().levels[C] === before);
  check('you may send it anywhere', relob?.d.to === 0, relob?.d);

  h.advance(5000);
  await h.drain();
  check('a doubled drop lands doubled', h.state().levels[A] === SPILL_START_LEVEL - 1 + 2);

  // Regression: the drop frame must name the hold it came from, or the client
  // keeps a phantom hold, attaches its dead id to every later fling, and the
  // server silently rejects all of them — a permanent lock-out.
  check('re-flinging echoes which hold it replaces', relob?.d.replaces === id, relob?.d);
  const plain = h.of('drop').find((m) => m.d.dropId === drop.d.dropId);
  check('an ordinary fling replaces nothing', plain?.d.replaces === undefined, plain?.d);
  check('the server forgets the hold', h.state().held[id] === undefined, h.state().held);

  // And the throw after that must still work — this is what actually broke.
  h.advance(3000);
  const sent = h.of('drop').length;
  await onFling(h.ctx, C, 1, screenAngleTo(2, 0, 4), 3);
  check('you can still fling after throwing a caught drop on', h.of('drop').length === sent + 1);
}

async function soaking(): Promise<void> {
  console.log('\nholding too long');
  const h = harness();
  await startSpill(h.ctx, 1, [A, B]);
  h.advance(PREROUND_MS + 1); // past the rules panel; see the guard test below
  await onFling(h.ctx, A, 1, screenAngleTo(0, 1, 2), 3);
  const drop = h.last('drop')!;

  h.advance(drop.d.arrivesAt - 100 - h.at());
  await onCatch(h.ctx, B, 1, drop.d.dropId);
  check('caught', h.of('caught').length === 1);

  h.advance(SPILL_HOLD_MS + 10);
  await h.drain();
  check('hold it too long and it soaks in', h.state().levels[B] === SPILL_START_LEVEL + 2);
  const land = h.last('land');
  check('a soak reports as a landing on the holder', land?.d.on === B && land.d.size === 2);
}

async function winning(): Promise<void> {
  console.log('\nwinning by emptying');
  const h = harness();
  await startSpill(h.ctx, 1, [A, B]);
  h.advance(PREROUND_MS + 1); // past the rules panel; see the guard test below
  const s = h.state();
  s.levels[A] = 1;
  await h.ctx.save(s);

  await onFling(h.ctx, A, 1, screenAngleTo(0, 1, 2), 3);
  const over = h.last('spill-over');
  check('emptying your phone wins immediately', over?.d.winnerId === A, over?.d);
  check('the round is done', h.state().phase === 'done');

  // Nothing works after the round ends.
  const sent = h.sent.length;
  await onFling(h.ctx, B, 1, 0, 3);
  check('no flinging after the round is over', h.sent.length === sent);
}

async function flooding(): Promise<void> {
  console.log('\nflooding out');
  const h = harness();
  await startSpill(h.ctx, 1, [A, B, C]);
  h.advance(PREROUND_MS + 1); // past the rules panel; see the guard test below
  const s = h.state();
  s.levels[C] = SPILL_LOSE_LEVEL - 1;
  await h.ctx.save(s);

  await onFling(h.ctx, A, 1, screenAngleTo(0, 2, 3), 3);
  check('aimed at C', h.last('drop')?.d.to === 2, h.last('drop')?.d);
  h.advance(5000);
  await h.drain();

  check('C is out at the ceiling', h.state().out.includes(C), h.state().levels);
  check('the round continues with two left', h.state().phase === 'running');

  // C's seat is now a hole: water aimed there is lost.
  h.advance(2000);
  await onFling(h.ctx, B, 1, screenAngleTo(1, 2, 3), 3);
  const atHole = h.last('drop');
  check('a seat that is out swallows nothing', atHole?.d.to === null, atHole?.d);

  // Flooding the second-to-last player ends it.
  const s2 = h.state();
  s2.levels[B] = SPILL_LOSE_LEVEL - 1;
  await h.ctx.save(s2);
  h.advance(3000);
  await onFling(h.ctx, A, 1, screenAngleTo(0, 1, 3), 3);
  h.advance(5000);
  await h.drain();
  const over = h.last('spill-over');
  check('last one standing wins', over?.d.winnerId === A, over?.d);
}

async function leaving(): Promise<void> {
  console.log('\nsomeone walks off');
  const h = harness();
  await startSpill(h.ctx, 1, [A, B, C, D]);
  h.advance(PREROUND_MS + 1); // past the rules panel; see the guard test below

  const seatsBefore = h.state().seats.join();
  await onPlayerGone(h.ctx, B);
  check('their seat stays put', h.state().seats.join() === seatsBefore);
  check('they are out', h.state().out.includes(B));
  check('the round survives', h.state().phase === 'running');

  // The crucial bit: everyone else's aim is unchanged.
  await onFling(h.ctx, A, 1, screenAngleTo(0, 3, 4), 3);
  check('D is still at seat 3', h.last('drop')?.d.to === 3, h.last('drop')?.d);

  await onPlayerGone(h.ctx, C);
  await onPlayerGone(h.ctx, D);
  const over = h.last('spill-over');
  check('below two players the round ends', over?.d.winnerId === A, over?.d);
}

async function cheating(): Promise<void> {
  console.log('\nclamping and stale rounds');
  const h = harness();
  await startSpill(h.ctx, 1, [A, B]);
  h.advance(PREROUND_MS + 1); // past the rules panel; see the guard test below

  await onFling(h.ctx, A, 1, screenAngleTo(0, 1, 2), 10_000);
  const fast = h.last('drop')!;
  const lockMs = fast.d.leavesAt - fast.d.launchedAt;
  check('an impossible speed is clamped, not rejected', lockMs >= 250, lockMs);

  // A stale frame from a previous round must not move anything.
  const sent = h.sent.length;
  await onFling(h.ctx, B, 99, 0, 3);
  await onCatch(h.ctx, B, 99, fast.d.dropId);
  check('stale roundId is ignored', h.sent.length === sent);

  // Garbage never reaches the state.
  await onFling(h.ctx, B, 1, Number.NaN, 3);
  check('NaN angle is ignored', h.sent.length === sent);
  check('B has not lost water to a bad frame', h.state().levels[B] === SPILL_START_LEVEL);

  /*
   * The forward cone, from the referee's side. The phone refuses a backwards drag before it
   * is ever sent (`SpillGame.fling` returns null), so what arrives here out of the cone came
   * from a client somebody wrote themselves — and the answer is the nearest legal heading
   * rather than a lost turn, exactly as it is for an impossible speed above.
   */
  const cone = harness();
  await startSpill(cone.ctx, 1, [A, B]);
  cone.advance(PREROUND_MS + 1);

  await onFling(cone.ctx, A, 1, Math.PI, 3);
  const back = cone.last('drop')!;
  check('a flick behind you is folded to the edge of the cone',
    Math.abs(back.d.angle) <= SPILL_FLICK_CONE + 1e-9, back.d.angle);
  check('and stays behind nothing — it is a forward throw now',
    Math.abs(back.d.angle - SPILL_FLICK_CONE) < 1e-9, back.d.angle);

  cone.advance(2000);
  await onFling(cone.ctx, A, 1, -Math.PI / 2, 3);
  const side = cone.last('drop')!;
  check('and the same on the other side', Math.abs(side.d.angle + SPILL_FLICK_CONE) < 1e-9, side.d.angle);

  cone.advance(2000);
  // Inside the cone nothing is touched: the wide angles are the two-player bounce game.
  await onFling(cone.ctx, A, 1, 1.2, 3);
  const wide = cone.last('drop')!;
  check('a wide but forward flick is left exactly as thrown', Math.abs(wide.d.angle - 1.2) < 1e-9, wide.d.angle);
}


/**
 * The two-player flight path. Spec: docs/specs/games/spill.md §4a
 *
 * Pure geometry, so it gets checks rather than a look at the screen. What matters
 * is not that it looks like a bounce — it is that **both phones agree**, since
 * each computes its own half of the same line and nothing on the wire carries the
 * crossing point.
 */
async function bouncing(): Promise<void> {
  console.log('\nthe two-player bounce path');

  const A = SPILL_NOMINAL_ASPECT;

  check('folding leaves an inside value alone', Math.abs(foldInto(0.2, A) - 0.2) < 1e-12);
  check('folding reflects an overshoot', Math.abs(foldInto(A + 0.1, A) - (A - 0.1)) < 1e-12);
  check('and an undershoot', Math.abs(foldInto(-0.1, A) - 0.1) < 1e-12);
  // Many bounces, not just one: a hard sideways flick crosses the board repeatedly.
  check('and keeps folding however far out it goes',
    foldInto(A * 7.3, A) >= 0 && foldInto(A * 7.3, A) <= A, foldInto(A * 7.3, A));

  // Straight up the middle is the case a player will check first.
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    check(`straight up stays in the middle at p=${p}`,
      Math.abs(bounceLeaving(0, p).x - 0.5) < 1e-12, bounceLeaving(0, p));
  }
  check('and comes down the middle of theirs',
    Math.abs(bounceArriving(0, 0.5).x - 0.5) < 1e-12, bounceArriving(0, 0.5));

  // The legs meet: my top edge is their top edge.
  check('the leaving leg starts at my middle',
    bounceLeaving(0.6, 0).y === 0.5, bounceLeaving(0.6, 0));
  check('and ends at the join', bounceLeaving(0.6, 1).y === 0, bounceLeaving(0.6, 1));
  check('the arriving leg starts at the join', bounceArriving(0.6, 0).y === 0);
  check('and ends at their middle', bounceArriving(0.6, 1).y === 0.5);

  // The handoff. Their screen is mirrored, so the same point is 1 - x.
  for (const angle of [0, 0.3, -0.45, 0.9, -1.05]) {
    const out = bounceLeaving(angle, 1).x;
    const inn = bounceArriving(angle, 0).x;
    check(`the crossing point matches at angle ${angle}`, Math.abs(out + inn - 1) < 1e-9, {
      out,
      inn,
    });
  }

  // **Direction survives the crossing.** Moving left on my screen is moving right
  // on theirs, because theirs is mirrored — that is what "keeps the direction"
  // means physically, and it falls out of the mirror rather than being preserved
  // by hand.
  for (const angle of [0.3, -0.45, 0.9]) {
    const dOut = bounceLeaving(angle, 1).x - bounceLeaving(angle, 0.98).x;
    const dIn = bounceArriving(angle, 0.02).x - bounceArriving(angle, 0).x;
    check(`direction carries over at angle ${angle}`, Math.sign(dOut) === -Math.sign(dIn), {
      dOut,
      dIn,
    });
  }

  // It must never be drawn off the screen, at any angle the server will accept.
  let escaped: unknown = null;
  for (const angle of [0, 0.2, -0.2, 0.6, -0.6, 1.0, -1.0, 1.09, -1.09]) {
    for (let i = 0; i <= 200; i++) {
      const a = bounceLeaving(angle, i / 200);
      const b = bounceArriving(angle, i / 200);
      for (const at of [a, b]) {
        if (at.x < -1e-9 || at.x > 1 + 1e-9 || at.y < -1e-9 || at.y > 0.5 + 1e-9) {
          escaped = { angle, at };
        }
      }
    }
  }
  check('it never leaves the screen', escaped === null, escaped);

  // A sideways flick has to actually reach an edge, or "bounce" is a lie.
  let touchedEdge = false;
  for (let i = 0; i <= 200; i++) {
    const x = bounceLeaving(1.0, i / 200).x;
    if (x < 0.02 || x > 0.98) touchedEdge = true;
  }
  check('a hard sideways flick reaches an edge', touchedEdge);
  // And a gentle one does not — otherwise every throw would look the same.
  let straightish = true;
  for (let i = 0; i <= 200; i++) {
    const x = bounceLeaving(0.1, i / 200).x;
    if (x < 0.02 || x > 0.98) straightish = false;
  }
  check('a gentle one does not', straightish);

  // Mirror symmetry: flicking left is flicking right, reflected.
  let mirrored = true;
  for (let i = 0; i <= 50; i++) {
    const p = i / 50;
    if (Math.abs(bounceLeaving(0.7, p).x + bounceLeaving(-0.7, p).x - 1) > 1e-9) mirrored = false;
    if (Math.abs(bounceArriving(0.7, p).x + bounceArriving(-0.7, p).x - 1) > 1e-9) mirrored = false;
  }
  check('left and right are mirror images', mirrored);
}

for (const t of [seating, preRound, aimingAndLock, catching, soaking, winning, flooding, leaving, cheating, bouncing]) {
  await t();
}

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
