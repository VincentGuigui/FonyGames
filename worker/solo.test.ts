import { enoughToStart, lastStanding, PLAYERS } from '../shared/players';
import { startSteady, onSteadyTick, onWobble, type Steady } from './steadyHand';
import { startBomb, onFuse, type Bomb } from './passTheBomb';
import { startSiege, tick as siegeTick, type Siege } from './goatSiege';
import { startSpill, tick as spillTick, type Spill } from './spill';
import { startRush, type Rush } from './shakeRush';
import { startHunt, type Hunt } from './ghostHunt';
import { startSling } from './slingPuck';
import { startCatMouse, type CatMouse } from './catMouse';
import {
  STEADY_SETTLE_MS,
  STEADY_TICK_MS,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';

/**
 * Solo test mode, across every referee.
 * Spec: docs/specs/backoffice.md §6 · the rule: `enoughToStart` and `lastStanding` in
 * shared/players.ts
 *
 * The feature has one promise and one trap, and this file is organised around them.
 *
 * The promise: an operator alone can start a game and **look at it**. So the checks are
 * not "does it start" but "does it start and then keep running" — a round that begins
 * and ends in the same tick renders nothing, which is the entire thing solo mode exists
 * to avoid.
 *
 * The trap: writing the relaxation as `!solo && left <= 1` reads correctly and is wrong.
 * It does not lower the threshold, it deletes the condition — so a solo round whose only
 * player is eliminated runs on with nobody in it, and Pass the Bomb then draws its next
 * holder from an empty array and broadcasts `undefined` as a player id. Every referee is
 * checked for that below, because the bug is invisible until somebody plays badly.
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

/**
 * One harness for every referee.
 *
 * Their `Ctx` types differ only by additions — Pass the Bomb wants `sendTo`, Ghost Hunt
 * wants `random` — so the union of them is supplied here and each referee ignores what
 * it does not use. `random` is a fixed number rather than `Math.random`: this file never
 * asserts on where a ghost is, and a test that changes between two runs is worse than no
 * test at all.
 */
function harness<S>(at = 1_000_000) {
  let now = at;
  let seq = 0;
  let stored: S | null = null;
  const sent: ServerMessage[] = [];

  const ctx = {
    now: () => now,
    nextSeq: () => ++seq,
    random: () => 0.5,
    broadcast: (m: ServerMessage) => sent.push(m),
    sendTo: (_id: PlayerId, m: ServerMessage) => sent.push(m),
    load: async () => stored,
    save: async (s: S) => {
      stored = s;
    },
    setAlarm: async (_a: number) => {},
  };

  return {
    ctx,
    sent,
    get state() {
      return stored;
    },
    advance: (ms: number) => {
      now += ms;
    },
    get now() {
      return now;
    },
    last: (t: string) => [...sent].reverse().find((m) => m.t === t),
  };
}

/* ── The rule itself ─────────────────────────────────────────────────────── */

console.log('\nthe minimum, and only the minimum, is relaxed');

{
  // Every game in the catalogue, so a new one cannot quietly land outside the rule.
  for (const [slug, limits] of Object.entries(PLAYERS)) {
    const [min, max] = limits;
    check(`${slug}: one player is not a game`, enoughToStart(1, limits) === (min <= 1));
    check(`${slug}: one player IS a solo test`, enoughToStart(1, limits, true) === true);
    // The point of the whole feature: nothing else about the room changes.
    check(`${slug}: the maximum still holds in solo`, enoughToStart(max + 1, limits, true) === false);
    check(`${slug}: an empty room is still empty`, enoughToStart(0, limits, true) === false);
  }
}

console.log('\nlast one standing is lowered, not deleted');

{
  check('two left is a game either way', lastStanding(2, false) === false && lastStanding(2, true) === false);
  check('one left ends an ordinary round', lastStanding(1, false) === true);
  check('one left keeps a solo round alive', lastStanding(1, true) === false);
  // The trap. Without this, a solo round with nobody in it runs to its cap.
  check('nobody left ends a solo round too', lastStanding(0, true) === true);
  check('and ends an ordinary one', lastStanding(0, false) === true);
}

/* ── Every referee, alone ────────────────────────────────────────────────── */

console.log('\nevery referee accepts one player when asked, and refuses when not');

{
  const cases: Array<[string, (ctx: never, alone: PlayerId[], solo: boolean) => Promise<boolean>]> = [
    ['steady hand', (c, p, s) => startSteady(c, 1, p, s)],
    ['pass the bomb', (c, p, s) => startBomb(c, 1, p, s)],
    ['goat siege', (c, p, s) => startSiege(c, 1, p, s)],
    ['spill', (c, p, s) => startSpill(c, 1, p, s)],
    ['shake rush', (c, p, s) => startRush(c, 1, p, s)],
    ['ghost hunt', (c, p, s) => startHunt(c, 1, p, s)],
    ['cat and mouse', (c, p, s) => startCatMouse(c, 1, p, 'direct', s)],
  ];

  for (const [name, start] of cases) {
    const alone = harness<never>();
    const pair = harness<never>();
    check(
      `${name}: refuses one player normally`,
      (await start(alone.ctx as never, [A], false)) === false,
    );
    check(`${name}: accepts one player in solo`, (await start(pair.ctx as never, [A], true)) === true);
  }

  /*
   * Sling Puck is the exception, and deliberately still refuses. It is two phones
   * facing each other across a gap: a solo board has no opposite half, so "supporting"
   * it would mean inventing a second player rather than relaxing a rule. The lobby says
   * so on screen (GameLobby's `soloSupported`), and this check is what keeps the two
   * from drifting apart.
   */
  const sling = harness<never>();
  check(
    'sling puck: still refuses one player, even in solo',
    (await startSling(sling.ctx as never, 1, [A])) === false,
  );
}

/* ── And then keeps running ──────────────────────────────────────────────── */

console.log('\na solo round does not end in the tick it started');

{
  const h = harness<Steady>();
  await startSteady(h.ctx, 1, [A], true);
  h.advance(STEADY_SETTLE_MS + STEADY_TICK_MS);
  await onWobble(h.ctx, A, 1, 0.01, true);
  const over = await onSteadyTick(h.ctx);
  check('steady hand: still running with one player', over === false);
  check('and they are still in it', h.state?.alive.includes(A) === true, h.state?.alive);
}

{
  const h = harness<Siege>();
  await startSiege(h.ctx, 1, [A], true);
  h.advance(1000);
  check('goat siege: still running with one player', (await siegeTick(h.ctx)) === false);
}

{
  const h = harness<Spill>();
  await startSpill(h.ctx, 1, [A], true);
  h.advance(1000);
  check('spill: still running with one player', (await spillTick(h.ctx)) === false);
}

{
  const h = harness<Bomb>();
  await startBomb(h.ctx, 1, [A], true);
  check('pass the bomb: the lone player holds it', h.state?.holder === A, h.state?.holder);
  check('and the round is running', h.state?.phase === 'running');
}

{
  const h = harness<Rush>();
  await startRush(h.ctx, 1, [A], true);
  check('shake rush: a lane exists for the lone runner', h.state?.players[A]?.at === 0);
  check('and the round is running', h.state?.phase === 'running');
}

{
  const h = harness<Hunt>();
  await startHunt(h.ctx, 1, [A], true);
  check('ghost hunt: the lone hunter has a target', h.state?.phase === 'running');
}

{
  const h = harness<CatMouse>();
  await startCatMouse(h.ctx, 1, [A], 'direct', true);
  check('cat and mouse: the lone player is the cat', h.state?.phase === 'running');
}

/* ── The trap ────────────────────────────────────────────────────────────── */

console.log('\nbut a solo round with nobody left in it does end');

{
  /*
   * Pass the Bomb is where the bad version of this rule does visible damage: after the
   * fuse blows the only player is out, and a round that refuses to end then picks its
   * next holder with `alive[Math.floor(random * 0)]` — `undefined`, broadcast to the
   * room as a player id.
   */
  const h = harness<Bomb>();
  await startBomb(h.ctx, 1, [A], true);
  h.advance(60_000);
  const over = await onFuse(h.ctx);
  check('pass the bomb: the round is over once the lone player is out', over === true);
  check('and it was marked done', h.state?.phase === 'done', h.state?.phase);
  const bomb = h.last('bomb');
  check(
    'no holder was handed out after the end',
    bomb === undefined || (bomb.t === 'bomb' && bomb.d.holder !== undefined),
    bomb,
  );
}

{
  // The same shape in Steady Hand: silence eliminates the lone player, and the round
  // must not run on to its two-minute cap with an empty room.
  const h = harness<Steady>();
  await startSteady(h.ctx, 1, [A], true);
  h.advance(STEADY_SETTLE_MS + 4 * STEADY_TICK_MS);
  const over = await onSteadyTick(h.ctx);
  check('steady hand: the round ends when its only player goes quiet', over === true);
  check('and nobody is left standing', h.state?.alive.length === 0, h.state?.alive);
}

/* ── Not a solo round ────────────────────────────────────────────────────── */

console.log('\nan ordinary round is untouched');

{
  const h = harness<Steady>();
  await startSteady(h.ctx, 1, [A, B]);
  check('two players still start without the flag', h.state?.phase === 'running');
  check('and the round is not marked solo', h.state?.solo === false, h.state?.solo);

  // The rule that solo relaxes still bites in an ordinary round: one left ends it.
  h.advance(STEADY_SETTLE_MS + 4 * STEADY_TICK_MS);
  await onWobble(h.ctx, A, 1, 0.01, true);
  const over = await onSteadyTick(h.ctx);
  check('the quiet player is out and the round ends', over === true);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
