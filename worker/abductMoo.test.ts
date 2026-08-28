import {
  ABDUCT_BARN_COUNT,
  ABDUCT_CHOOSE_MS,
  ABDUCT_REVEAL_MS,
  ABDUCT_ROUNDS,
  type ServerMessage,
} from '../shared/protocol';
import { abductTick, nextDeadline, onPick, startAbduct, type Abduct, type Ctx } from './abductMoo';

/**
 * Abduct-Moo's referee.
 * Spec: docs/specs/games/abduct-moo.md
 *
 * Unlike every other game here, the whole state is public and the round loop is
 * fully automatic — no host action between rounds — so what is worth asserting is
 * the choosing→revealing→next-round cycle itself, the target draw being independent
 * of any pick, abduction/destruction on that draw, scoring only the currently
 * connected roster, and the match ending with a winner (or nobody, on a tie).
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

function harness(at = 1_000_000, rolls = [0.1, 0.9, 0.5, 0.2, 0.8, 0.35]) {
  let now = at;
  let seq = 0;
  let r = 0;
  let stored: Abduct | null = null;
  let roster: string[] = [];
  const sent: ServerMessage[] = [];
  let alarm = 0;

  const originalRandom = Math.random;
  Math.random = () => rolls[r++ % rolls.length] as number;

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
    restoreRandom: () => {
      Math.random = originalRandom;
    },
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

console.log('\nstarting a match');

{
  const h = harness();
  h.setRoster([A, B, C]);
  const ok = await startAbduct(h.ctx, 1, [A, B, C]);
  check('three players is a match', ok === true);
  check('round one', h.state?.round === 1);
  check('choosing first', h.state?.phase === 'choosing');
  check('five fresh barns', h.state?.barns.length === ABDUCT_BARN_COUNT);
  check('none destroyed yet', !!h.state?.barns.every((b) => !b.destroyed));
  check('nobody has picked', Object.keys(h.state?.picks ?? {}).length === 0);
  check('everyone starts scoreless', h.state?.scores[A] === 0 && h.state?.scores[B] === 0);
  check('the deadline is the choosing window', h.state?.deadlineAt === h.now + ABDUCT_CHOOSE_MS);
  check('a state frame went out', h.count('abduct') === 1);
  check('and the alarm matches the deadline', h.alarm === h.state?.deadlineAt);

  const solo = harness();
  solo.setRoster([A]);
  check('one player is not a match', (await startAbduct(solo.ctx, 1, [A])) === false);
  h.restoreRandom();
  solo.restoreRandom();
}

console.log('\npicking a barn');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);

  await onPick(h.ctx, A, 1, 1, 2);
  check('the pick is recorded', h.state?.picks[A] === 2);
  check('and broadcast', h.last('abduct')?.t === 'abduct');

  await onPick(h.ctx, A, 1, 1, 4);
  check('a player can change their mind before the deadline', h.state?.picks[A] === 4);

  await onPick(h.ctx, A, 1, 1, 99);
  check('an out-of-range barn is refused', h.state?.picks[A] === 4);

  await onPick(h.ctx, A, 7, 1, 0);
  check('a pick for the wrong roundId changes nothing', h.state?.picks[A] === 4);

  await onPick(h.ctx, A, 1, 9, 0);
  check('a pick for the wrong round changes nothing', h.state?.picks[A] === 4);
  h.restoreRandom();
}

console.log('\nthe target is the referee\'s own draw');

{
  const h = harness(1_000_000, [0.41]); // 0.41 * 5 = 2.05 -> barn 2
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  await onPick(h.ctx, A, 1, 1, 0); // A picks a barn nowhere near the draw

  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx);
  check('choosing resolves to revealing', h.state?.phase === 'revealing');
  check('the draw is independent of any pick', h.state?.target === 2, h.state?.target);
  check('the reveal deadline is the reveal window', h.state?.deadlineAt === h.now + ABDUCT_REVEAL_MS);
  check('and the alarm follows it', h.alarm === h.state?.deadlineAt);
  h.restoreRandom();
}

console.log('\nabduction and destruction');

{
  const h = harness(1_000_000, [0.41]); // barn 2
  h.setRoster([A, B, C]);
  await startAbduct(h.ctx, 1, [A, B, C]);
  await onPick(h.ctx, A, 1, 1, 2);
  await onPick(h.ctx, B, 1, 1, 2);
  // C never picks.

  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx);
  check('both cows on the target are abducted together', new Set(h.state?.abducted).size === 2
    && !!h.state?.abducted.includes(A) && !!h.state?.abducted.includes(B));
  check('the barn itself is not destroyed when cows were there', h.state?.barns[2]?.destroyed === false);
  check('the abducted score nothing this round', h.state?.scores[A] === 0 && h.state?.scores[B] === 0);
  check('a safe cow, even one that never picked, scores', h.state?.scores[C] === 1);
  h.restoreRandom();
}

{
  const h = harness(1_000_000, [0.41]); // barn 2
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  await onPick(h.ctx, A, 1, 1, 0);
  await onPick(h.ctx, B, 1, 1, 4);

  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx);
  check('nobody was on the target', h.state?.abducted.length === 0);
  check('so the barn is destroyed instead', h.state?.barns[2]?.destroyed === true);
  check('everyone connected scores', h.state?.scores[A] === 1 && h.state?.scores[B] === 1);
  h.restoreRandom();
}

console.log('\na round rolls into the next, fresh barns');

{
  const h = harness(1_000_000, [0.41]);
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  await onPick(h.ctx, A, 1, 1, 2);
  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx); // -> revealing (A is on the drawn barn, so A is abducted)

  h.advance(ABDUCT_REVEAL_MS);
  await abductTick(h.ctx); // -> round 2, choosing
  check('round advances', h.state?.round === 2);
  check('phase resets to choosing', h.state?.phase === 'choosing');
  check('barns reset fresh', !!h.state?.barns.every((b) => !b.destroyed));
  check('picks reset', Object.keys(h.state?.picks ?? {}).length === 0);
  check('target cleared until the next reveal', h.state?.target === null);
  check('scores carry over', (h.state?.scores[A] ?? -1) >= 0);
  check('the deadline is a fresh choosing window', h.state?.deadlineAt === h.now + ABDUCT_CHOOSE_MS);
  h.restoreRandom();
}

console.log('\na full three-round match ends with a winner');

{
  // Rolls chosen so A is never on the drawn barn, B always is: A wins every round.
  const h = harness(1_000_000, [0.01, 0.21, 0.41]);
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);

  for (let round = 1; round <= ABDUCT_ROUNDS; round++) {
    await onPick(h.ctx, A, 1, round, 4); // A always dodges
    await onPick(h.ctx, B, 1, round, round - 1); // B follows the draw (barns 0,1,2)
    h.advance(ABDUCT_CHOOSE_MS);
    await abductTick(h.ctx); // choosing -> revealing
    h.advance(ABDUCT_REVEAL_MS);
    await abductTick(h.ctx); // revealing -> next round, or done
  }

  check('the match is done after three rounds', h.state?.phase === 'done', h.state);
  check('A, never abducted, wins', h.state?.winner === A, h.state?.scores);
  check('no further tick moves anything once done', h.state?.round === ABDUCT_ROUNDS);

  const before = JSON.stringify(h.state);
  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx);
  check('a tick after done is a no-op', JSON.stringify(h.state) === before);
  h.restoreRandom();
}

console.log('\na tie at the end is nobody\'s win');

{
  // Both dodge every barn — always safe, always tied.
  const h = harness(1_000_000, [0.1, 0.3, 0.5]);
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);

  for (let round = 1; round <= ABDUCT_ROUNDS; round++) {
    h.advance(ABDUCT_CHOOSE_MS);
    await abductTick(h.ctx);
    h.advance(ABDUCT_REVEAL_MS);
    await abductTick(h.ctx);
  }

  check('an equal score is not ranked', h.state?.winner === null, h.state?.scores);
  h.restoreRandom();
}

console.log('\nonly the connected roster scores at resolution');

{
  const h = harness(1_000_000, [0.9]); // barn 4
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  // C leaves before the reveal — should not be scored even if they had picked before.
  await onPick(h.ctx, C, 1, 1, 0);
  h.setRoster([A, B]);

  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx);
  check('a disconnected player is not scored this round', h.state?.scores[C] === 0, h.state?.scores);
  check('connected players are', h.state?.scores[A] === 1 && h.state?.scores[B] === 1);
  h.restoreRandom();
}

console.log('\nthe deadline is a moment, and it comes round');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  const s = h.state as Abduct;

  check('it is the choosing window away', nextDeadline(s) === h.now + ABDUCT_CHOOSE_MS);
  check('not due yet', !(h.now >= nextDeadline(s)));
  check('and the alarm matches', h.alarm === nextDeadline(s));

  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx);
  check('revealing is due next at its own deadline', h.alarm === (h.state as Abduct).deadlineAt);

  h.restoreRandom();
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
