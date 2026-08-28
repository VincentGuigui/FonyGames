import {
  ABDUCT_BARN_COUNT,
  ABDUCT_COUNTDOWN_MS,
  ABDUCT_REVEAL_MS,
  ABDUCT_WAIT_MS,
  type ServerMessage,
} from '../shared/protocol';
import { abductTick, nextDeadline, onPick, startAbduct, type Abduct, type Ctx } from './aliensLoveCows';

/**
 * Aliens love cows' referee.
 * Spec: docs/specs/games/aliens-love-cows.md
 *
 * Three phases repeat until one cow is left standing: `waiting` (up to
 * ABDUCT_WAIT_MS, ends early the instant every active player has a barn),
 * `countdown` (a fixed beat once everyone does), then `revealing`. What is
 * worth asserting: the early-vs-deadline transition into `countdown`, a
 * straggler landing somewhere rather than nowhere, a target barn always
 * destroyed whether or not cows were on it, permanent elimination (an out
 * player can neither pick nor block anyone else's `waiting`), barns
 * replenishing once every one of them is gone, and the match ending on
 * players — last one standing, or nobody if the last two go together.
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

function harness(at = 1_000_000) {
  let now = at;
  let seq = 0;
  let stored: Abduct | null = null;
  let roster: string[] = [];
  const sent: ServerMessage[] = [];
  let alarm = 0;

  const ctx: Ctx = {
    now: () => now,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as Abduct) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as Abduct;
    },
    setAlarm: async (a) => {
      alarm = a;
    },
    connected: async () => roster,
  };

  return {
    ctx,
    sent,
    /** The REAL internal state — unlike a client, a test is allowed to see the
     *  target before it is revealed, since that is exactly what needs checking. */
    get state() {
      return stored;
    },
    get alarm() {
      return alarm;
    },
    setRoster: (ids: string[]) => {
      roster = ids;
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

/** The lowest-numbered barn that is none of `avoid` and not already destroyed. */
function safeBarn(state: Abduct, ...avoid: number[]): number {
  for (let i = 0; i < ABDUCT_BARN_COUNT; i++) {
    if (avoid.includes(i) || state.barns[i]?.destroyed) continue;
    return i;
  }
  throw new Error('no safe barn left to pick in this test');
}

console.log('\nstarting a match');

{
  const h = harness();
  h.setRoster([A, B, C]);
  const ok = await startAbduct(h.ctx, 1, [A, B, C]);
  check('three players is a match', ok === true);
  check('round one', h.state?.round === 1);
  check('waiting first', h.state?.phase === 'waiting');
  check('five fresh barns', h.state?.barns.length === ABDUCT_BARN_COUNT);
  check('none destroyed yet', !!h.state?.barns.every((b) => !b.destroyed));
  check('nobody has picked', Object.keys(h.state?.picks ?? {}).length === 0);
  check('nobody is out yet', h.state?.out.length === 0);
  check('everyone starts scoreless', h.state?.scores[A] === 0 && h.state?.scores[B] === 0);
  check('the deadline is the waiting cap', h.state?.deadlineAt === h.now + ABDUCT_WAIT_MS);
  check('a state frame went out', h.count('abduct') === 1);
  check('and the alarm matches the deadline', h.alarm === h.state?.deadlineAt);

  const startFrame = h.last('abduct');
  check('the target is drawn internally already', typeof h.state?.target === 'number');
  check('but hidden from the wire while waiting', startFrame?.t === 'abduct' && startFrame.d.target === null);

  const solo = harness();
  solo.setRoster([A]);
  check('one player is a solo match', (await startAbduct(solo.ctx, 1, [A], true)) === true);
  const notSolo = harness();
  notSolo.setRoster([A]);
  check('one player is not a match otherwise', (await startAbduct(notSolo.ctx, 1, [A])) === false);
}

console.log('\nwaiting ends the instant everyone has a barn, not at its own deadline');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  const target = h.state?.target as number;

  await onPick(h.ctx, A, 1, 1, safeBarn(h.state!, target));
  check('still waiting with one pick outstanding', h.state?.phase === 'waiting');

  h.advance(1_200); // well short of ABDUCT_WAIT_MS
  await onPick(h.ctx, B, 1, 1, safeBarn(h.state!, target));
  check('countdown starts the instant the last active player picks', h.state?.phase === 'countdown');
  check('from right now, not from when waiting opened', h.state?.deadlineAt === h.now + ABDUCT_COUNTDOWN_MS);
  check('and the alarm follows it', h.alarm === h.state?.deadlineAt);
}

console.log('\na straggler is assigned somewhere at the waiting deadline, not left safe');

{
  const h = harness();
  h.setRoster([A, B, C]);
  await startAbduct(h.ctx, 1, [A, B, C]);
  const target = h.state?.target as number;
  await onPick(h.ctx, A, 1, 1, safeBarn(h.state!, target));
  await onPick(h.ctx, B, 1, 1, safeBarn(h.state!, target));
  check('C never picked, still waiting', h.state?.phase === 'waiting');

  h.advance(ABDUCT_WAIT_MS);
  await abductTick(h.ctx);
  check('C landed somewhere', typeof h.state?.picks[C] === 'number');
  check('waiting resolved into countdown', h.state?.phase === 'countdown');
  check('a fresh countdown window', h.state?.deadlineAt === h.now + ABDUCT_COUNTDOWN_MS);
}

console.log('\nthe target is revealed only at the countdown\'s end, unchanged from the draw');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  const drawnAtStart = h.state?.target;
  await onPick(h.ctx, A, 1, 1, safeBarn(h.state!, drawnAtStart!));
  await onPick(h.ctx, B, 1, 1, safeBarn(h.state!, drawnAtStart!));
  check('countdown reached', h.state?.phase === 'countdown');
  check('still hidden mid-countdown', h.last('abduct')?.t === 'abduct' && (h.last('abduct') as { d: { target: unknown } }).d.target === null);

  h.advance(ABDUCT_COUNTDOWN_MS);
  await abductTick(h.ctx);
  check('countdown resolves to revealing', h.state?.phase === 'revealing');
  check('the target never changed', h.state?.target === drawnAtStart);
  const revealFrame = h.last('abduct');
  check('and it is now on the wire', revealFrame?.t === 'abduct' && revealFrame.d.target === drawnAtStart);
}

console.log('\na target barn is destroyed whether or not cows were on it');

{
  // Cows present: both A and B walk right into the target.
  const h = harness();
  h.setRoster([A, B, C]);
  await startAbduct(h.ctx, 1, [A, B, C]);
  const target = h.state?.target as number;
  await onPick(h.ctx, A, 1, 1, target);
  await onPick(h.ctx, B, 1, 1, target);
  await onPick(h.ctx, C, 1, 1, safeBarn(h.state!, target));
  h.advance(ABDUCT_COUNTDOWN_MS);
  await abductTick(h.ctx);
  check('both cows on the target are abducted', new Set(h.state?.abducted).size === 2
    && !!h.state?.abducted.includes(A) && !!h.state?.abducted.includes(B));
  check('they are permanently out', !!h.state?.out.includes(A) && !!h.state?.out.includes(B));
  check('the barn is destroyed too, not just emptied of cows', h.state?.barns[target]?.destroyed === true);
  check('the abducted score nothing this round', h.state?.scores[A] === 0 && h.state?.scores[B] === 0);
  check('the cow that dodged scores', h.state?.scores[C] === 1);
}

{
  // Nobody home: same destruction, no elimination.
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  const target = h.state?.target as number;
  await onPick(h.ctx, A, 1, 1, safeBarn(h.state!, target));
  await onPick(h.ctx, B, 1, 1, safeBarn(h.state!, target));
  h.advance(ABDUCT_COUNTDOWN_MS);
  await abductTick(h.ctx);
  check('nobody was on the target', h.state?.abducted.length === 0);
  check('nobody is out', h.state?.out.length === 0);
  check('the barn is destroyed anyway', h.state?.barns[target]?.destroyed === true);
  check('everyone still in scores', h.state?.scores[A] === 1 && h.state?.scores[B] === 1);
}

console.log('\nan abducted player can neither pick again nor block the next waiting phase');

{
  const h = harness();
  h.setRoster([A, B, C]);
  await startAbduct(h.ctx, 1, [A, B, C]);
  const target = h.state?.target as number;
  await onPick(h.ctx, A, 1, 1, safeBarn(h.state!, target));
  await onPick(h.ctx, B, 1, 1, safeBarn(h.state!, target));
  await onPick(h.ctx, C, 1, 1, target); // C alone walks in
  h.advance(ABDUCT_COUNTDOWN_MS);
  await abductTick(h.ctx); // -> revealing
  check('C is out', !!h.state?.out.includes(C));

  h.advance(ABDUCT_REVEAL_MS);
  await abductTick(h.ctx); // -> round 2, waiting (A and B both still in)
  check('round 2 opens', h.state?.round === 2, h.state);
  check('still waiting', h.state?.phase === 'waiting');

  await onPick(h.ctx, C, 1, 2, safeBarn(h.state!));
  check('an out player\'s pick is silently ignored', h.state?.picks[C] === undefined || h.state?.picks[C] === target);

  const target2 = h.state?.target as number;
  await onPick(h.ctx, A, 1, 2, safeBarn(h.state!, target2));
  check('still waiting on B alone — C does not count', h.state?.phase === 'waiting');
  await onPick(h.ctx, B, 1, 2, safeBarn(h.state!, target2));
  check('A and B alone are enough to start the countdown', h.state?.phase === 'countdown');
}

console.log('\ndestroying one barn a round eventually leaves nowhere left to dodge to');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);

  // Both always dodge — nobody is eliminated yet, but every round's own
  // target is destroyed regardless of cows (spec §2.1), so the pool of
  // open barns shrinks by exactly one a round whether or not anyone is caught.
  for (let round = 1; round <= ABDUCT_BARN_COUNT - 1; round++) {
    const target = h.state?.target as number;
    const safe = safeBarn(h.state!, target);
    await onPick(h.ctx, A, 1, round, safe);
    await onPick(h.ctx, B, 1, round, safe);
    h.advance(ABDUCT_COUNTDOWN_MS);
    await abductTick(h.ctx); // -> revealing
    h.advance(ABDUCT_REVEAL_MS);
    await abductTick(h.ctx); // -> next round
  }

  check('nobody caught yet', h.state?.out.length === 0, h.state?.out);
  check(`${ABDUCT_BARN_COUNT - 1} barns destroyed, one left standing`,
    h.state?.barns.filter((b) => b.destroyed).length === ABDUCT_BARN_COUNT - 1);
  check('the match is still going', h.state?.phase === 'waiting');

  // Only one barn is left standing, so it IS this round's own target — there
  // is nowhere left to dodge to.
  const lastBarn = h.state?.barns.findIndex((b) => !b.destroyed);
  check('the sole remaining barn is this round\'s own target', h.state?.target === lastBarn);

  h.advance(ABDUCT_WAIT_MS); // neither player can do anything but land on it
  await abductTick(h.ctx); // waiting -> countdown, both assigned the only barn left
  h.advance(ABDUCT_COUNTDOWN_MS);
  await abductTick(h.ctx); // countdown -> revealing: everyone still in is caught
  h.advance(ABDUCT_REVEAL_MS);
  await abductTick(h.ctx); // revealing -> done: nobody is left

  check('every barn is destroyed', !!h.state?.barns.every((b) => b.destroyed));
  check('both players were caught together', h.state?.out.length === 2);
  check('the match ends with nobody left to win it', h.state?.phase === 'done' && h.state.winner === null, h.state);
}

console.log('\nlast one standing ends the match');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  const target = h.state?.target as number;
  await onPick(h.ctx, A, 1, 1, safeBarn(h.state!, target));
  await onPick(h.ctx, B, 1, 1, target); // B alone walks in
  h.advance(ABDUCT_COUNTDOWN_MS);
  await abductTick(h.ctx); // -> revealing, B out
  h.advance(ABDUCT_REVEAL_MS);
  await abductTick(h.ctx); // -> done: only A is left

  check('the match is done', h.state?.phase === 'done', h.state);
  check('A, the only one left, wins', h.state?.winner === A);
}

console.log('\nthe last two going together ends the match with nobody');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  const target = h.state?.target as number;
  await onPick(h.ctx, A, 1, 1, target);
  await onPick(h.ctx, B, 1, 1, target); // both walk in together
  h.advance(ABDUCT_COUNTDOWN_MS);
  await abductTick(h.ctx); // -> revealing, both out
  h.advance(ABDUCT_REVEAL_MS);
  await abductTick(h.ctx); // -> done: nobody left

  check('the match is done', h.state?.phase === 'done');
  check('nobody is left to win', h.state?.winner === null, h.state?.scores);

  const before = JSON.stringify(h.state);
  h.advance(ABDUCT_WAIT_MS);
  await abductTick(h.ctx);
  check('a tick after done is a no-op', JSON.stringify(h.state) === before);
}

console.log('\nsolo mode lowers the threshold to nobody left, not one');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B], true);
  const target = h.state?.target as number;
  await onPick(h.ctx, A, 1, 1, safeBarn(h.state!, target));
  await onPick(h.ctx, B, 1, 1, target);
  h.advance(ABDUCT_COUNTDOWN_MS);
  await abductTick(h.ctx); // -> revealing, B out
  h.advance(ABDUCT_REVEAL_MS);
  await abductTick(h.ctx); // one left (A) — solo does not end it here

  check('one left is not the end in solo mode', h.state?.phase !== 'done', h.state?.phase);
  check('round 2 opens instead', h.state?.round === 2);
}

console.log('\nonly the connected roster is scored or eliminated');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  const target = h.state?.target as number;
  // C leaves before the countdown resolves — should not be scored or
  // eliminated even if they had walked right into the target.
  await onPick(h.ctx, C, 1, 1, target);
  h.setRoster([A, B]);
  await onPick(h.ctx, A, 1, 1, safeBarn(h.state!, target));
  await onPick(h.ctx, B, 1, 1, safeBarn(h.state!, target));

  h.advance(ABDUCT_COUNTDOWN_MS);
  await abductTick(h.ctx);
  check('a disconnected player is not eliminated', !h.state?.out.includes(C));
  check('nor scored', h.state?.scores[C] === 0, h.state?.scores);
  check('connected players score', h.state?.scores[A] === 1 && h.state?.scores[B] === 1);
}

console.log('\nrejections');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);

  await onPick(h.ctx, A, 7, 1, 2);
  check('a pick for another round changes nothing', h.state?.picks[A] === undefined);

  await onPick(h.ctx, A, 1, 1, -1);
  check('a negative barn is refused', h.state?.picks[A] === undefined);

  await onPick(h.ctx, A, 1, 1, ABDUCT_BARN_COUNT);
  check('a barn at the count itself is out of range', h.state?.picks[A] === undefined);
}

console.log('\nthe deadline is a moment, and it comes round');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  const s = h.state as Abduct;

  check('it is the waiting cap away', nextDeadline(s) === h.now + ABDUCT_WAIT_MS);
  check('not due yet', !(h.now >= nextDeadline(s)));
  check('and the alarm matches', h.alarm === nextDeadline(s));

  h.advance(ABDUCT_WAIT_MS);
  await abductTick(h.ctx);
  check('countdown is due next at its own deadline', h.alarm === (h.state as Abduct).deadlineAt);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
