import {
  CM_CATCH_RADIUS,
  CM_CAT_COOLDOWN_MS,
  CM_GRACE_MS,
  CM_LIVES,
  CM_MOUSE_SPEED,
  CM_ROUND_CAP_MS,
  CM_TICK_MS,
  PREROUND_MS,
  type ServerMessage,
} from '../shared/protocol';
import { CM_CENTRE } from '../shared/catMouse';
import {
  nextDeadline,
  onMove,
  onPlayerGone,
  startCatMouse,
  tick,
  type CatMouse,
  type Ctx,
} from './catMouse';

/**
 * Logic harness for worker/catMouse.ts. Same shape as spill.test.ts and
 * slingPuck.test.ts: a fake Ctx with a clock we control (docs/testing.md §1.1).
 *
 * This game is client-authoritative about *movement*, so what is worth testing is
 * exactly the part that is not: the bounds, the speed truncation, and every rule
 * that decides a catch. Those are the rules a modified client would attack and the
 * ones a play test cannot see.
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
const C = 'p-c';

function harness() {
  let clock = 4_000_000;
  let seq = 0;
  let stored: CatMouse | null = null;
  const sent: ServerMessage[] = [];

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    // Cloned in and out, so a test cannot accidentally hold a live reference to
    // the server's own state and "prove" a mutation that never persisted.
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as CatMouse) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as CatMouse;
    },
    setAlarm: async () => {},
  };

  return {
    ctx,
    sent,
    state: () => stored,
    at: (id: string) => stored?.at[id],
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    of: <T extends ServerMessage['t']>(t: T) =>
      sent.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[],
    clear: () => {
      sent.length = 0;
    },
  };
}

/** Start a round and step past the rules panel, which gates all input. */
async function running(ids: string[], drag: 'direct' | 'capped' = 'capped') {
  const h = harness();
  const ok = await startCatMouse(h.ctx, 1, ids, drag);
  h.advance(PREROUND_MS);
  h.clear();
  return { h, ok };
}

async function startup(): Promise<void> {
  console.log('\nstarting a round');

  const { h, ok } = await running([A, B, C]);
  check('three players start', ok);

  const s = h.state();
  check('the cat is one of them', s !== null && s.players.includes(s.catId), s?.catId);
  check('the cat stands in the centre',
    h.at(s?.catId ?? '')?.x === CM_CENTRE.x && h.at(s?.catId ?? '')?.y === CM_CENTRE.y);

  const mice = (s?.players ?? []).filter((p) => p !== s?.catId);
  check('everyone else is a mouse', mice.length === 2, mice);
  check('each mouse has full lives',
    mice.every((p) => h.at(p)?.lives === CM_LIVES));

  // Nobody may start already caught: a random scatter occasionally does exactly
  // that, which is why the ring is not random.
  const cat = h.at(s?.catId ?? '');
  check('no mouse starts within catching distance',
    mice.every((p) => {
      const m = h.at(p);
      return !!m && !!cat && Math.hypot(m.x - cat.x, m.y - cat.y) > CM_CATCH_RADIUS * 2;
    }));

  // Two mice must be spread, not stacked — the ring is evenly spaced for exactly
  // this reason.
  const m1 = h.at(mice[0] ?? '');
  const m2 = h.at(mice[1] ?? '');
  check('the mice do not start on top of each other',
    !!m1 && !!m2 && Math.hypot(m1.x - m2.x, m1.y - m2.y) > CM_CATCH_RADIUS * 2);

  const tooFew = await startCatMouse(harness().ctx, 1, [A], 'direct');
  check('one player is not a round', tooFew === false);
  const tooMany = await startCatMouse(harness().ctx, 1, [A, B, C, 'd', 'e', 'f', 'g'], 'direct');
  check('seven players is refused', tooMany === false);
}

async function theCatRotates(): Promise<void> {
  console.log('\nthe cat rotates');

  const seen = new Set<string>();
  for (const roundId of [1, 2, 3]) {
    const h = harness();
    await startCatMouse(h.ctx, roundId, [A, B, C], 'direct');
    seen.add(h.state()?.catId ?? '');
  }
  check('three rounds give three different cats', seen.size === 3, [...seen]);

  const h = harness();
  await startCatMouse(h.ctx, 4, [A, B, C], 'direct');
  check('round four comes back round', h.state()?.catId === A, h.state()?.catId);
}

async function movement(): Promise<void> {
  console.log('\nwhere a client says it is');

  const { h } = await running([A, B, C], 'capped');
  const s = h.state();
  const mouse = (s?.players ?? []).find((p) => p !== s?.catId) as string;

  // Off the floor entirely.
  await onMove(h.ctx, mouse, 1, { x: 9, y: -4 });
  const out = h.at(mouse);
  check('nothing leaves the floor',
    !!out && out.x >= 0 && out.x <= 1 && out.y >= 0, out);

  // A stale round id is not this round.
  const before = h.at(mouse);
  await onMove(h.ctx, mouse, 99, { x: 0.1, y: 0.1 });
  check('a move for another round is ignored',
    h.at(mouse)?.x === before?.x && h.at(mouse)?.y === before?.y);

  await onMove(h.ctx, mouse, 1, { x: Number.NaN, y: 0.5 });
  check('NaN is ignored', Number.isFinite(h.at(mouse)?.x ?? Number.NaN));

  // Nothing moves behind the rules panel — the same gate spill and goat-siege use.
  const fresh = harness();
  await startCatMouse(fresh.ctx, 1, [A, B, C], 'capped');
  const catId = fresh.state()?.catId ?? '';
  const early = (fresh.state()?.players ?? []).find((p) => p !== catId) as string;
  const startPos = fresh.at(early);
  await onMove(fresh.ctx, early, 1, { x: 0.9, y: 0.9 });
  check('a move during the rules panel is ignored',
    fresh.at(early)?.x === startPos?.x && fresh.at(early)?.y === startPos?.y);
}

async function speedLimit(): Promise<void> {
  console.log('\ncapped mode: truncated, not rejected');

  const { h } = await running([A, B, C], 'capped');
  const s = h.state();
  const mouse = (s?.players ?? []).find((p) => p !== s?.catId) as string;
  const from = h.at(mouse);

  // A teleport across the whole floor, 100 ms after the last accepted move.
  h.advance(100);
  await onMove(h.ctx, mouse, 1, { x: 1, y: 0 });
  const after = h.at(mouse);
  const travelled = Math.hypot((after?.x ?? 0) - (from?.x ?? 0), (after?.y ?? 0) - (from?.y ?? 0));

  // The point of truncating rather than rejecting: it still moved, and it moved
  // the way it asked to.
  check('it moved', travelled > 0, travelled);
  check('but not further than its speed allows',
    travelled < CM_MOUSE_SPEED * 0.5, { travelled, budget: CM_MOUSE_SPEED * 0.1 });
  check('and it moved toward where it asked to go',
    (after?.x ?? 0) > (from?.x ?? 0), { from, after });

  // An honest small step inside the budget is untouched.
  const h2 = (await running([A, B, C], 'capped')).h;
  const s2 = h2.state();
  const m2 = (s2?.players ?? []).find((p) => p !== s2?.catId) as string;
  const p0 = h2.at(m2);
  h2.advance(100);
  const want = { x: (p0?.x ?? 0) + 0.01, y: p0?.y ?? 0 };
  await onMove(h2.ctx, m2, 1, want);
  const p1 = h2.at(m2);
  check('a legal step arrives exactly as sent',
    Math.abs((p1?.x ?? 0) - want.x) < 1e-9 && Math.abs((p1?.y ?? 0) - want.y) < 1e-9,
    { want, got: p1 });

  // `direct` has no speed to clamp to, so the same flick must go through. This is
  // the honest cost written down in spec §9, asserted so it cannot be "fixed" by
  // accident into a rule that breaks a fast thumb.
  const h3 = (await running([A, B, C], 'direct')).h;
  const s3 = h3.state();
  const m3 = (s3?.players ?? []).find((p) => p !== s3?.catId) as string;
  const q0 = h3.at(m3);
  h3.advance(100);
  await onMove(h3.ctx, m3, 1, { x: 1, y: 0 });
  const q1 = h3.at(m3);
  const flick = Math.hypot((q1?.x ?? 0) - (q0?.x ?? 0), (q1?.y ?? 0) - (q0?.y ?? 0));
  check('direct mode lets a real flick cross the floor',
    flick > CM_MOUSE_SPEED, flick);
}

/** Put the cat on top of a mouse without going through the speed limit. */
function pin(h: ReturnType<typeof harness>, mouse: string): void {
  const s = h.state();
  if (!s) return;
  const m = s.at[mouse];
  const cat = s.at[s.catId];
  if (!m || !cat) return;
  cat.x = m.x;
  cat.y = m.y;
  // Written straight into storage: this is a test fixture, not a move.
  void h.ctx.save(s);
}

async function catching(): Promise<void> {
  console.log('\nthe cat catches');

  const { h } = await running([A, B, C], 'capped');
  const s = h.state();
  const mouse = (s?.players ?? []).find((p) => p !== s?.catId) as string;
  pin(h, mouse);

  await tick(h.ctx);
  const caught = h.of('cm-catch');
  check('a catch is broadcast', caught.length === 1, caught.length);
  check('it costs one life', h.at(mouse)?.lives === CM_LIVES - 1, h.at(mouse)?.lives);
  check('the mouse comes back to the centre',
    h.at(mouse)?.x === CM_CENTRE.x && h.at(mouse)?.y === CM_CENTRE.y);
  check('with grace',
    (h.at(mouse)?.graceUntil ?? 0) === h.now() + CM_GRACE_MS);

  // Grace is what stops the cat parking on the respawn and taking all three
  // lives in a quarter of a second.
  h.clear();
  pin(h, mouse);
  h.advance(CM_TICK_MS);
  await tick(h.ctx);
  check('a mouse in grace cannot be caught', h.of('cm-catch').length === 0);
  check('and still has the same lives', h.at(mouse)?.lives === CM_LIVES - 1);

  // A mouse can move during grace — the whole point of it (spec §6).
  await onMove(h.ctx, mouse, 1, { x: CM_CENTRE.x + 0.02, y: CM_CENTRE.y });
  check('and can move while it lasts', (h.at(mouse)?.x ?? 0) > CM_CENTRE.x);

  // Once grace is over the same mouse is catchable again. Grace is the binding
  // constraint here, not the cooldown: CM_GRACE_MS is the longer of the two, so
  // for a *repeat* catch on the same mouse the cooldown has already expired.
  check('grace outlasts the cooldown', CM_GRACE_MS > CM_CAT_COOLDOWN_MS);
  h.clear();
  h.advance(CM_GRACE_MS);
  pin(h, mouse);
  await tick(h.ctx);
  check('once grace is over it catches again', h.of('cm-catch').length === 1);
  check('now on two lives lost', h.at(mouse)?.lives === CM_LIVES - 2);
}

async function theCooldownProtectsOtherMice(): Promise<void> {
  console.log('\nthe cooldown protects the mice it did not catch');

  // This is the cooldown's real job, and the reason it is not redundant against
  // grace: a fresh mouse has no grace at all, so without the cooldown a cat
  // sweeping through a cluster would take a life off every mouse it crossed —
  // the scribbling failure mode spec §6 names.
  const { h } = await running([A, B, C], 'capped');
  const s = h.state();
  const mice = (s?.players ?? []).filter((p) => p !== s?.catId);
  const [first, second] = mice as [string, string];

  pin(h, first);
  await tick(h.ctx);
  check('the first mouse is caught', h.at(first)?.lives === CM_LIVES - 1);

  // Straight onto the next mouse, which has never been caught and has no grace.
  h.clear();
  h.advance(CM_TICK_MS);
  pin(h, second);
  await tick(h.ctx);
  check('the next mouse is safe despite having no grace',
    h.of('cm-catch').length === 0 && h.at(second)?.lives === CM_LIVES);

  h.clear();
  h.advance(CM_CAT_COOLDOWN_MS);
  pin(h, second);
  await tick(h.ctx);
  check('and catchable once the cooldown expires',
    h.at(second)?.lives === CM_LIVES - 1, h.at(second)?.lives);
}

async function oneCatchPerTick(): Promise<void> {
  console.log('\nnever two lives in one tick');

  const { h } = await running([A, B, C], 'capped');
  const s = h.state();
  const mice = (s?.players ?? []).filter((p) => p !== s?.catId);

  // Both mice sitting on the cat. Only one may be caught: the cooldown is a
  // property of the cat, not of the mouse.
  const live = h.state();
  if (live) {
    const cat = live.at[live.catId];
    for (const p of mice) {
      const m = live.at[p];
      if (m && cat) {
        m.x = cat.x;
        m.y = cat.y;
      }
    }
    await h.ctx.save(live);
  }

  await tick(h.ctx);
  check('one catch, not two', h.of('cm-catch').length === 1);
  const lost = mice.filter((p) => (h.at(p)?.lives ?? CM_LIVES) < CM_LIVES);
  check('exactly one mouse paid', lost.length === 1, lost);
}

async function elimination(): Promise<void> {
  console.log('\nout of lives, out of the round');

  const { h } = await running([A, B], 'capped');
  const s = h.state();
  const mouse = (s?.players ?? []).find((p) => p !== s?.catId) as string;

  for (let i = 0; i < CM_LIVES; i++) {
    pin(h, mouse);
    await tick(h.ctx);
    h.advance(CM_GRACE_MS + CM_CAT_COOLDOWN_MS);
  }

  check('the mouse is out', h.at(mouse)?.out === true);
  check('with no lives', h.at(mouse)?.lives === 0);
  check('and no grace to protect a corpse', h.at(mouse)?.graceUntil === 0);

  const over = h.of('cm-over');
  check('the round is over', over.length === 1);
  check('the cat won', over[0]?.d.catWins === true);
  check('nobody survived', over[0]?.d.survivors.length === 0);
  check('the state says done', h.state()?.phase === 'done');

  h.clear();
  await tick(h.ctx);
  check('a tick after the end does nothing', h.of('cm-frame').length === 0);
}

async function theClock(): Promise<void> {
  console.log('\nsurviving the clock');

  const { h } = await running([A, B, C], 'capped');
  h.advance(CM_ROUND_CAP_MS);
  await tick(h.ctx);

  const over = h.of('cm-over');
  check('the round ends at the cap', over.length === 1);
  check('the mice won', over[0]?.d.catWins === false);
  check('both survivors are named', over[0]?.d.survivors.length === 2, over[0]?.d.survivors);
  check('and how long they lasted',
    (over[0]?.d.lastedMs ?? 0) >= CM_ROUND_CAP_MS, over[0]?.d.lastedMs);
}

async function frames(): Promise<void> {
  console.log('\nframes on a fixed tick');

  const { h } = await running([A, B, C], 'capped');
  await tick(h.ctx);
  const first = h.of('cm-frame')[0];
  check('a frame goes out', first !== undefined);
  check('with everyone on it', Object.keys(first?.d.pos ?? {}).length === 3);
  check('stamped with server time', first?.d.at === h.now());

  // The rate is a property of the tick, not of how often anyone moved: this is
  // what bounds the cost of the catalogue's first streaming game.
  const s = h.state();
  const mouse = (s?.players ?? []).find((p) => p !== s?.catId) as string;
  h.clear();
  for (let i = 0; i < 20; i++) {
    h.advance(2);
    await onMove(h.ctx, mouse, 1, { x: 0.5 + i * 0.001, y: 0.5 });
  }
  check('twenty moves broadcast nothing by themselves', h.of('cm-frame').length === 0);

  // An eliminated mouse leaves the floor rather than sitting there as scenery.
  const h2 = (await running([A, B, C], 'capped')).h;
  const s2 = h2.state();
  const gone = (s2?.players ?? []).find((p) => p !== s2?.catId) as string;
  for (let i = 0; i < CM_LIVES; i++) {
    pin(h2, gone);
    await tick(h2.ctx);
    h2.advance(CM_GRACE_MS + CM_CAT_COOLDOWN_MS);
  }
  h2.clear();
  await tick(h2.ctx);
  const after = h2.of('cm-frame')[0];
  check('an eliminated mouse is not in the frame',
    after === undefined || after.d.pos[gone] === undefined);
}

async function ticksDoNotDrift(): Promise<void> {
  console.log('\na late alarm does not push every later tick late');

  const { h } = await running([A, B, C], 'capped');
  const first = nextDeadline(h.state() as CatMouse);
  await tick(h.ctx);
  const second = nextDeadline(h.state() as CatMouse);
  check('the next tick is one interval on', second - first === CM_TICK_MS, { first, second });

  // Arrive very late. The schedule must catch up rather than restart from now,
  // or a single slow alarm permanently halves the frame rate.
  h.advance(CM_TICK_MS * 5);
  await tick(h.ctx);
  const third = nextDeadline(h.state() as CatMouse);
  check('a late tick does not reset the schedule to now',
    third < h.now() + CM_TICK_MS, { third, now: h.now() });
}

async function leaving(): Promise<void> {
  console.log('\nsomeone leaves');

  // The cat: there is no game without one.
  const { h } = await running([A, B, C], 'capped');
  const catId = h.state()?.catId as string;
  await onPlayerGone(h.ctx, catId);
  const over = h.of('cm-over');
  check('the cat leaving ends the round', over.length === 1);
  check('and the mice win', over[0]?.d.catWins === false);

  // One mouse of two: the round goes on.
  const h2 = (await running([A, B, C], 'capped')).h;
  const s2 = h2.state();
  const mice2 = (s2?.players ?? []).filter((p) => p !== s2?.catId);
  await onPlayerGone(h2.ctx, mice2[0] as string);
  check('one mouse leaving does not end it', h2.of('cm-over').length === 0);
  check('their icon is gone', h2.at(mice2[0] as string)?.out === true);
  check('the other is still playing', h2.at(mice2[1] as string)?.out === false);

  // The last mouse: the cat wins by default rather than the round hanging.
  await onPlayerGone(h2.ctx, mice2[1] as string);
  const over2 = h2.of('cm-over');
  check('the last mouse leaving ends it', over2.length === 1);
  check('the cat wins by default', over2[0]?.d.catWins === true);

  // A stranger changes nothing.
  const h3 = (await running([A, B, C], 'capped')).h;
  await onPlayerGone(h3.ctx, 'nobody');
  check('a stranger leaving changes nothing',
    h3.of('cm-over').length === 0 && h3.state()?.phase === 'running');
}

async function main(): Promise<void> {
  for (const t of [
    startup,
    theCatRotates,
    movement,
    speedLimit,
    catching,
    theCooldownProtectsOtherMice,
    oneCatchPerTick,
    elimination,
    theClock,
    frames,
    ticksDoNotDrift,
    leaving,
  ]) {
    await t();
  }

  if (failures > 0) throw new Error(`${failures} check(s) failed`);
  console.log('\nall passed');
}

await main();
