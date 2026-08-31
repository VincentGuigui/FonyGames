import { applyBomb, isAlive, type BombState } from './game';
import type { BombMatch, PlayerId, ServerMessage } from '../../../../shared/protocol';

/**
 * The phone's view of the bomb.
 * Spec: docs/specs/games/pass-the-bomb.md §6, §7
 *
 * The referee has its own suite (`worker/passTheBomb.test.ts`). This covers the half that lives
 * on the phone, and it exists for two rules that are invisible until they break in a room full
 * of people: a late frame must not move the bomb backwards, and the round ends without anything
 * announcing that it has.
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

/** A match nobody has scored in yet — the standings are not what this file tests. */
const match = (over: Partial<BombMatch> = {}): BombMatch => ({
  round: 1,
  rounds: 5,
  wins: {},
  champion: null,
  done: false,
  ...over,
});

const bomb = (s: number, holder: PlayerId, alive: PlayerId[], roundId = 1): ServerMessage => ({
  t: 'bomb',
  s,
  d: { roundId, holder, alive, match: match() },
});
const boom = (
  s: number,
  victim: PlayerId,
  alive: PlayerId[],
  roundId = 1,
  over = alive.length <= 1,
): ServerMessage => ({
  t: 'boom',
  s,
  d: { roundId, victim, alive, over, match: match() },
});

console.log('\nthe first frame starts the round');

let st: BombState = applyBomb(null, bomb(1, A, [A, B, C]), 1000);
check('holder is set', st?.holder === A, st);
check('everyone is alive', st?.alive.length === 3);
check('phase is running', st?.phase === 'running');
check('no explosion yet', st?.lastBoom === null);
check('the first holder is not a pass yet (issue #12)', st?.passes === 0, st?.passes);

console.log('\na pass moves the bomb');

st = applyBomb(st, bomb(2, B, [A, B, C]), 1100);
check('holder followed the frame', st?.holder === B, st?.holder);
check('and it counts as one pass', st?.passes === 1, st?.passes);

/*
 * THE ordering rule (spec §6). WebSocket delivery can reorder, and the bomb rendering on two
 * phones at once is the failure this prevents — so a frame with a lower `s` is dropped even
 * though it is a perfectly well-formed bomb frame.
 */
console.log('\na late frame must not move the bomb backwards');

const beforeLate = st;
st = applyBomb(st, bomb(1, A, [A, B, C]), 1200);
check('lower seq is ignored', st?.holder === B, st?.holder);
check('state object is untouched, so no re-render', st === beforeLate);
st = applyBomb(st, bomb(2, A, [A, B, C]), 1200);
check('equal seq is ignored too', st?.holder === B, st?.holder);

console.log('\na boom eliminates the holder');

st = applyBomb(st, boom(3, B, [A, C]), 2000);
check('victim recorded for the explosion', st?.lastBoom?.victim === B, st?.lastBoom);
check('explosion stamped with the time given', st?.lastBoom?.at === 2000);
check('victim dropped from alive', st?.alive.join() === 'a,c', st?.alive);
check('round continues with two left', st?.phase === 'running');
check('no winner yet', st?.winner === null);
check('the victim is now a spectator', !isAlive(st, B));
check('and the survivors are not', isAlive(st, A) && isAlive(st, C));

// A boom the round survives is followed by a fresh `bomb` frame reassigning the holder
// among the survivors — from any phone's view the bomb just moved again, so it counts.
st = applyBomb(st, bomb(4, C, [A, C]), 2100);
check('a fuse-survivor reassignment counts as a pass too', st?.passes === 2, st?.passes);

console.log('\nthe referee says when the round is over');

st = applyBomb(st, boom(5, A, [C]), 3000);
check('phase is over', st?.phase === 'over', st?.phase);
check('last one standing wins', st?.winner === C, st?.winner);

/*
 * The two endings this reducer used to get wrong, both by counting heads instead of reading
 * the frame: a two-player round is over after ONE boom with the survivor still standing, and
 * the five-minute safety cap ends a round with a whole circle left in it.
 */
console.log('\ntwo more ways a round ends, neither of them "one player left"');

let duel: BombState = applyBomb(null, bomb(1, A, [A, B]), 0);
duel = applyBomb(duel, boom(2, A, [B], 1, true), 100);
check('a duel round ends on the first boom', duel?.phase === 'over', duel?.phase);
check('and the survivor took it', duel?.winner === B, duel?.winner);

let capped: BombState = applyBomb(null, bomb(1, A, [A, B, C]), 0);
capped = applyBomb(capped, boom(2, A, [B, C], 1, true), 100);
check('the safety cap ends one with a circle left', capped?.phase === 'over', capped?.phase);
check('and nobody is called the winner of it', capped?.winner === null, capped?.winner);

let carries: BombState = applyBomb(null, bomb(1, A, [A, B, C]), 0);
check('the match rides along on every frame', carries?.match.rounds === 5, carries?.match);

console.log('\nedge cases from §7');

// onPlayerGone can empty the room: everyone quit at once, so there is no winner to name.
let gone: BombState = applyBomb(null, bomb(1, A, [A, B]), 0);
gone = applyBomb(gone, boom(2, A, [], 1, true), 10);
check('an empty room ends with no winner rather than a wrong one', gone?.winner === null, gone);
check('and is still over', gone?.phase === 'over');

// "Play again" bumps the roundId. A straggler from the previous round must not resurrect it.
let next: BombState = applyBomb(st, bomb(1, A, [A, B, C], 2), 4000);
check('a new round is accepted even though its seq restarts low', next?.roundId === 2, next?.roundId);
check('and it is running again', next?.phase === 'running');
check('the previous explosion is cleared', next?.lastBoom === null);
check('and so is the pass count, for the new round\'s own heartbeat (issue #12)', next?.passes === 0, next?.passes);
const beforeStraggler = next;
next = applyBomb(next, bomb(9, B, [A, B, C], 1), 4100);
check('a frame from the finished round is dropped', next === beforeStraggler);

// A boom for a round we are not in says nothing about this one.
const beforeAlien = next;
next = applyBomb(next, boom(9, A, [B], 1), 4200);
check("a boom from another round is ignored", next === beforeAlien);

console.log('\ncalm-down is not this reducer\'s business');
const beforeCalm = next;
next = applyBomb(next, { t: 'calm-down', d: { untilServerTime: 9999 } }, 4300);
check('it changes nothing about where the bomb is', next === beforeCalm);

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
