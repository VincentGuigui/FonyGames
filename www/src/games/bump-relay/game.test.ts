import { applyRelay, isAlive, type RelayState } from './game';
import type { PlayerId, ServerMessage } from '../../../../shared/protocol';

/**
 * The phone's view of the bomb.
 * Spec: docs/specs/games/bump-relay.md §6, §7
 *
 * The referee has its own suite (`worker/bumpRelay.test.ts`). This covers the half that lives
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

const bomb = (s: number, holder: PlayerId, alive: PlayerId[], roundId = 1): ServerMessage => ({
  t: 'bomb',
  s,
  d: { roundId, holder, alive },
});
const boom = (s: number, victim: PlayerId, alive: PlayerId[], roundId = 1): ServerMessage => ({
  t: 'boom',
  s,
  d: { roundId, victim, alive },
});

console.log('\nthe first frame starts the round');

let st: RelayState = applyRelay(null, bomb(1, A, [A, B, C]), 1000);
check('holder is set', st?.holder === A, st);
check('everyone is alive', st?.alive.length === 3);
check('phase is running', st?.phase === 'running');
check('no explosion yet', st?.lastBoom === null);

console.log('\na pass moves the bomb');

st = applyRelay(st, bomb(2, B, [A, B, C]), 1100);
check('holder followed the frame', st?.holder === B, st?.holder);

/*
 * THE ordering rule (spec §6). WebSocket delivery can reorder, and the bomb rendering on two
 * phones at once is the failure this prevents — so a frame with a lower `s` is dropped even
 * though it is a perfectly well-formed bomb frame.
 */
console.log('\na late frame must not move the bomb backwards');

const beforeLate = st;
st = applyRelay(st, bomb(1, A, [A, B, C]), 1200);
check('lower seq is ignored', st?.holder === B, st?.holder);
check('state object is untouched, so no re-render', st === beforeLate);
st = applyRelay(st, bomb(2, A, [A, B, C]), 1200);
check('equal seq is ignored too', st?.holder === B, st?.holder);

console.log('\na boom eliminates the holder');

st = applyRelay(st, boom(3, B, [A, C]), 2000);
check('victim recorded for the explosion', st?.lastBoom?.victim === B, st?.lastBoom);
check('explosion stamped with the time given', st?.lastBoom?.at === 2000);
check('victim dropped from alive', st?.alive.join() === 'a,c', st?.alive);
check('round continues with two left', st?.phase === 'running');
check('no winner yet', st?.winner === null);
check('the victim is now a spectator', !isAlive(st, B));
check('and the survivors are not', isAlive(st, A) && isAlive(st, C));

console.log('\nthe round ends without anything announcing it');

// The referee sends no `round-end` frame — the spec's §6 table lists one that was never
// built. A boom leaving one player IS the end, and a client waiting for an end frame hangs.
st = applyRelay(st, boom(4, A, [C]), 3000);
check('phase is over', st?.phase === 'over', st?.phase);
check('last one standing wins', st?.winner === C, st?.winner);

console.log('\nedge cases from §7');

// onPlayerGone can empty the room: everyone quit at once, so there is no winner to name.
let gone: RelayState = applyRelay(null, bomb(1, A, [A, B]), 0);
gone = applyRelay(gone, boom(2, A, []), 10);
check('an empty room ends with no winner rather than a wrong one', gone?.winner === null, gone);
check('and is still over', gone?.phase === 'over');

// "Play again" bumps the roundId. A straggler from the previous round must not resurrect it.
let next: RelayState = applyRelay(st, bomb(1, A, [A, B, C], 2), 4000);
check('a new round is accepted even though its seq restarts low', next?.roundId === 2, next?.roundId);
check('and it is running again', next?.phase === 'running');
check('the previous explosion is cleared', next?.lastBoom === null);
const beforeStraggler = next;
next = applyRelay(next, bomb(9, B, [A, B, C], 1), 4100);
check('a frame from the finished round is dropped', next === beforeStraggler);

// A boom for a round we are not in says nothing about this one.
const beforeAlien = next;
next = applyRelay(next, boom(9, A, [B], 1), 4200);
check("a boom from another round is ignored", next === beforeAlien);

console.log('\ncalm-down is not this reducer\'s business');
const beforeCalm = next;
next = applyRelay(next, { t: 'calm-down', d: { untilServerTime: 9999 } }, 4300);
check('it changes nothing about where the bomb is', next === beforeCalm);

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
