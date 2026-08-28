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
 * of any pick AND drawn (but hidden) the instant choosing opens, an unpicked player
 * landing somewhere rather than being safe by default, a destroyed barn staying
 * destroyed for the rest of the match, and a full 3-round match reaching a winner
 * (or nobody, on a tie).
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

function harness(at = 1_000_000, rolls?: number[]) {
  let now = at;
  let seq = 0;
  let r = 0;
  let stored: Abduct | null = null;
  let roster: string[] = [];
  const sent: ServerMessage[] = [];
  let alarm = 0;

  const originalRandom = Math.random;
  if (rolls) Math.random = () => rolls[r++ % rolls.length] as number;

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

/**
 * The lowest-numbered barn that is neither `avoid` nor already destroyed — for
 * a player scripted to dodge a target. Reads destruction straight off `state`
 * rather than trusting a test to track it by hand, because the referee now
 * refuses a pick on a destroyed barn (spec §2.1): a test picking blind into one
 * from an earlier round would silently leave that player unpicked instead of
 * exercising what it meant to.
 */
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
  check('choosing first', h.state?.phase === 'choosing');
  check('five fresh barns', h.state?.barns.length === ABDUCT_BARN_COUNT);
  check('none destroyed yet', !!h.state?.barns.every((b) => !b.destroyed));
  check('nobody has picked', Object.keys(h.state?.picks ?? {}).length === 0);
  check('everyone starts scoreless', h.state?.scores[A] === 0 && h.state?.scores[B] === 0);
  check('the deadline is the choosing window', h.state?.deadlineAt === h.now + ABDUCT_CHOOSE_MS);
  check('a state frame went out', h.count('abduct') === 1);
  check('and the alarm matches the deadline', h.alarm === h.state?.deadlineAt);

  check(
    'the target is already drawn internally, the instant choosing opens',
    typeof h.state?.target === 'number' && h.state.target >= 0 && h.state.target < ABDUCT_BARN_COUNT,
    h.state?.target,
  );
  const startFrame = h.last('abduct');
  check('but hidden from the wire while choosing', startFrame?.t === 'abduct' && startFrame.d.target === null);

  const solo = harness();
  solo.setRoster([A]);
  check('one player is not a match', (await startAbduct(solo.ctx, 1, [A])) === false);
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
}

console.log('\nthe target is revealed only at the deadline, unchanged from what was drawn at round start');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  const drawnAtStart = h.state?.target;
  await onPick(h.ctx, A, 1, 1, safeBarn(h.state!, drawnAtStart!));

  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx);
  check('choosing resolves to revealing', h.state?.phase === 'revealing');
  check('the target did not change between the draw and the reveal', h.state?.target === drawnAtStart, {
    drawnAtStart,
    revealed: h.state?.target,
  });
  const revealFrame = h.last('abduct');
  check('and it is now on the wire', revealFrame?.t === 'abduct' && revealFrame.d.target === drawnAtStart);
  check('the reveal deadline is the reveal window', h.state?.deadlineAt === h.now + ABDUCT_REVEAL_MS);
  check('and the alarm follows it', h.alarm === h.state?.deadlineAt);
}

console.log('\nan unpicked player is not safe by default — they land somewhere too');

{
  // Same roll every time it is asked (valid barns never change in this test), so
  // the auto-assignment for C lands on the SAME barn the round-start draw already
  // chose — deliberately forcing the "unlucky" case to prove it is reachable.
  const h = harness(1_000_000, [0.41]);
  h.setRoster([A, B, C]);
  await startAbduct(h.ctx, 1, [A, B, C]);
  const target = h.state?.target as number;
  await onPick(h.ctx, A, 1, 1, safeBarn(h.state!, target));
  await onPick(h.ctx, B, 1, 1, safeBarn(h.state!, target));
  // C never picks.

  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx);
  check('C ended up somewhere, not nowhere', typeof h.state?.picks[C] === 'number');
  check('and it is a real, undestroyed barn', h.state?.barns[h.state.picks[C] as number]?.destroyed === false);
  check('that somewhere happens to be the target this time', h.state?.picks[C] === target);
  check('so C is abducted, exactly like a player who chose it themselves', !!h.state?.abducted.includes(C));
  check('C scores nothing this round', h.state?.scores[C] === 0);
  h.restoreRandom();
}

console.log('\nabduction and destruction');

{
  const h = harness();
  h.setRoster([A, B, C]);
  await startAbduct(h.ctx, 1, [A, B, C]);
  const target = h.state?.target as number;
  await onPick(h.ctx, A, 1, 1, target);
  await onPick(h.ctx, B, 1, 1, target);
  await onPick(h.ctx, C, 1, 1, safeBarn(h.state!, target));

  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx);
  check('both cows on the target are abducted together', new Set(h.state?.abducted).size === 2
    && !!h.state?.abducted.includes(A) && !!h.state?.abducted.includes(B));
  check('the barn itself is not destroyed when cows were there', h.state?.barns[target]?.destroyed === false);
  check('the abducted score nothing this round', h.state?.scores[A] === 0 && h.state?.scores[B] === 0);
  check('a cow that dodged it scores', h.state?.scores[C] === 1);
}

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  const target = h.state?.target as number;
  await onPick(h.ctx, A, 1, 1, safeBarn(h.state!, target));
  await onPick(h.ctx, B, 1, 1, safeBarn(h.state!, target));

  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx);
  check('nobody was on the target', h.state?.abducted.length === 0);
  check('so the barn is destroyed instead', h.state?.barns[target]?.destroyed === true);
  check('everyone connected scores', h.state?.scores[A] === 1 && h.state?.scores[B] === 1);
}

console.log('\na destroyed barn stays destroyed for the rest of the match');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  const round1Target = h.state?.target as number;
  await onPick(h.ctx, A, 1, 1, safeBarn(h.state!, round1Target));
  await onPick(h.ctx, B, 1, 1, safeBarn(h.state!, round1Target));
  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx); // -> revealing, round1Target destroyed (nobody there)
  check('round 1\'s empty target is destroyed', h.state?.barns[round1Target]?.destroyed === true);

  h.advance(ABDUCT_REVEAL_MS);
  await abductTick(h.ctx); // -> round 2, choosing, fresh target
  check('round 2 started', h.state?.round === 2);
  check('the barn destroyed in round 1 is STILL destroyed — barns do not reset', h.state?.barns[round1Target]?.destroyed === true);
  check('and round 2\'s own draw never lands on a destroyed barn', h.state?.target !== round1Target, h.state?.target);
  check('every other barn is still standing', h.state?.barns.filter((b) => b.destroyed).length === 1);

  const round2Target = h.state?.target as number;
  // Exclude round1Target too — it is already destroyed, and the referee now
  // refuses a pick on a destroyed barn (spec §2.1), so it is not a "safe" pick.
  await onPick(h.ctx, A, 1, 2, safeBarn(h.state!, round2Target, round1Target));
  await onPick(h.ctx, B, 1, 2, safeBarn(h.state!, round2Target, round1Target));
  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx);
  h.advance(ABDUCT_REVEAL_MS);
  await abductTick(h.ctx); // -> round 3

  check('two different barns can end up destroyed across the match',
    h.state?.barns.filter((b) => b.destroyed).length === 2);
  check('round 3\'s draw avoids both of them',
    h.state?.target !== round1Target && h.state?.target !== round2Target, h.state?.target);
}

console.log('\na full three-round match ends with a winner');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);

  for (let round = 1; round <= ABDUCT_ROUNDS; round++) {
    const target = h.state?.target as number;
    await onPick(h.ctx, A, 1, round, safeBarn(h.state!, target)); // A always dodges
    await onPick(h.ctx, B, 1, round, target); // B always walks right in
    h.advance(ABDUCT_CHOOSE_MS);
    await abductTick(h.ctx); // choosing -> revealing
    h.advance(ABDUCT_REVEAL_MS);
    await abductTick(h.ctx); // revealing -> next round, or done
  }

  check('the match is done after three rounds', h.state?.phase === 'done', h.state);
  check('A, never abducted, wins', h.state?.winner === A, h.state?.scores);
  check('B, caught every time, has nothing', h.state?.scores[B] === 0, h.state?.scores);

  const before = JSON.stringify(h.state);
  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx);
  check('a tick after done is a no-op', JSON.stringify(h.state) === before);
}

console.log('\na tie at the end is nobody\'s win');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);

  for (let round = 1; round <= ABDUCT_ROUNDS; round++) {
    const target = h.state?.target as number;
    const safe = safeBarn(h.state!, target);
    await onPick(h.ctx, A, 1, round, safe);
    await onPick(h.ctx, B, 1, round, safe);
    h.advance(ABDUCT_CHOOSE_MS);
    await abductTick(h.ctx);
    h.advance(ABDUCT_REVEAL_MS);
    await abductTick(h.ctx);
  }

  check('an equal score is not ranked', h.state?.winner === null, h.state?.scores);
}

console.log('\nonly the connected roster scores at resolution');

{
  const h = harness();
  h.setRoster([A, B]);
  await startAbduct(h.ctx, 1, [A, B]);
  const target = h.state?.target as number;
  // A and B pick a barn they know is safe — this test is about C leaving, not
  // about the (separately covered) random assignment an unpicked player gets.
  await onPick(h.ctx, A, 1, 1, safeBarn(h.state!, target));
  await onPick(h.ctx, B, 1, 1, safeBarn(h.state!, target));
  // C leaves before the reveal — should not be scored even if they had picked before.
  await onPick(h.ctx, C, 1, 1, safeBarn(h.state!, target));
  h.setRoster([A, B]);

  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx);
  check('a disconnected player is not scored this round', h.state?.scores[C] === 0, h.state?.scores);
  check('connected players are', h.state?.scores[A] === 1 && h.state?.scores[B] === 1);
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

  check('it is the choosing window away', nextDeadline(s) === h.now + ABDUCT_CHOOSE_MS);
  check('not due yet', !(h.now >= nextDeadline(s)));
  check('and the alarm matches', h.alarm === nextDeadline(s));

  h.advance(ABDUCT_CHOOSE_MS);
  await abductTick(h.ctx);
  check('revealing is due next at its own deadline', h.alarm === (h.state as Abduct).deadlineAt);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
