import { applyRush, progress, standings, toGo, type RushState } from './game';
import { shakeCounter } from '../../core/sensors/shake';
import { MELODY, NOTES_AFTER_THE_LINE, PHRASE, noteFor } from './melody';
import {
  RUSH_DISTANCE,
  SHAKE_REFRACTORY_MS,
  SHAKE_THRESHOLD,
  type PlayerId,
  type ServerMessage,
} from '../../../../shared/protocol';

/**
 * The phone's half of Shake Rush.
 * Spec: docs/specs/games/shake-rush.md
 *
 * Two things are worth asserting rather than eyeballing: the frame ordering, for
 * the same reason as every other game, and the shake counter — which is the rule
 * that decides who wins, and "was that one shake or two" is not something to
 * settle by waving a phone about.
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

const rush = (
  s: number,
  over: Partial<{ at: Record<string, number>; finished: PlayerId[]; away: PlayerId[]; roundId: number }> = {},
): ServerMessage => ({
  t: 'rush',
  s,
  d: {
    roundId: over.roundId ?? 1,
    endsAt: 90_000,
    at: over.at ?? { a: 10, b: 4, c: 0 },
    finished: over.finished ?? [],
    away: over.away ?? [],
  },
});

console.log('\nthe first frame opens the race');

let st: RushState = applyRush(null, rush(1));
check('everyone is on the track', Object.keys(st?.at ?? {}).length === 3);
check('running', st?.phase === 'running');
check('nobody home yet', st?.finished.length === 0);

console.log('\nrunners advance as frames arrive');

st = applyRush(st, rush(2, { at: { a: 30, b: 9, c: 1 } }));
check('the track follows', st?.at['a'] === 30);

{
  const before = st;
  st = applyRush(st, rush(1, { at: { a: 1, b: 1, c: 1 } }));
  check('a late frame cannot drag anyone backwards', st?.at['a'] === 30, st?.at);
  check('and the object is untouched, so no re-render', st === before);
}

console.log('\ngoing quiet');

st = applyRush(st, rush(3, { at: { a: 40, b: 9, c: 1 }, away: [C] }));
check('the track says who is frozen', st?.away.join() === 'c');

console.log('\nthe finish');

st = applyRush(
  st,
  { t: 'rush-end', s: 4, d: { roundId: 1, order: [A, B, C], at: { a: RUSH_DISTANCE, b: 60, c: 1 } } },
);
check('over', st?.phase === 'over');
check('with a placing', st?.order.join() === 'a,b,c');
check('and final distances', st?.at['a'] === RUSH_DISTANCE);

{
  const before = st;
  st = applyRush(st, { t: 'rush-end', s: 3, d: { roundId: 1, order: [C, B, A], at: {} } });
  check('a stale result cannot rewrite the placing', st?.order.join() === 'a,b,c');
  check('nor cause a render', st === before);
}

console.log('\na new race wipes the last one');

{
  const next = applyRush(st, rush(1, { roundId: 2, at: { a: 0, b: 0, c: 0 } }));
  check('accepted even though its seq restarts low', next?.roundId === 2);
  check('running again', next?.phase === 'running');
  check('no stale placing', next?.order.length === 0);
  check('and everyone is back on the line', next?.at['a'] === 0);

  const before = next;
  const straggler = applyRush(next, rush(9));
  check('and a frame from the finished race is dropped', straggler === before);
}

console.log('\nthe track');

check('the start is empty', progress(0) === 0);
check('half way', Math.abs(progress(RUSH_DISTANCE / 2) - 0.5) < 1e-9);
check('the line is full', progress(RUSH_DISTANCE) === 1);
// Drawn past the line reads as a result; drawn off the end reads as a bug.
check('and it cannot overflow', progress(RUSH_DISTANCE * 3) === 1);
check('a nonsense distance reads as the start, not as a win', progress(Number.NaN) === 0);
check('a missing runner is on the line', progress(undefined) === 0);

check('the countdown starts at the full distance', toGo(0) === RUSH_DISTANCE);
check('and reaches zero at the line', toGo(RUSH_DISTANCE) === 0);
check('never going negative', toGo(RUSH_DISTANCE + 50) === 0);

console.log('\nwho is ahead');

{
  const mid = applyRush(null, rush(1, { at: { a: 5, b: 50, c: 20 } }));
  check('furthest first', standings(mid!, [A, B, C]).join() === 'b,c,a');

  const oneHome = applyRush(null, rush(1, { at: { a: 5, b: RUSH_DISTANCE, c: 20 }, finished: [B] }));
  check('a finisher stays ahead of the field', standings(oneHome!, [A, B, C]).join() === 'b,c,a');

  // Two runners can sit on the same distance and only one of them won, which is
  // why finish order beats distance rather than tying with it.
  const both = applyRush(null, rush(1, { at: { a: RUSH_DISTANCE, b: RUSH_DISTANCE, c: 0 }, finished: [B, A] }));
  check('and finish order settles a tie on distance', standings(both!, [A, B, C]).join() === 'b,a,c');

  const done = applyRush(both, { t: 'rush-end', s: 2, d: { roundId: 1, order: [B, A, C], at: {} } });
  check('once over, the placing is the standings', standings(done!, [A, B, C]).join() === 'b,a,c');
  check('a player who left the room is not drawn', standings(done!, [A, C]).join() === 'a,c');
}

/*
 * The shake counter. This is the load-bearing rule of the whole game (spec §2.1):
 * a shake is a direction REVERSAL, not a magnitude, because summing acceleration
 * rewards swinging a phone as hard as a human can — which is how a phone leaves
 * someone's hand.
 */
console.log('\nwhat counts as a shake');

{
  const c = shakeCounter();
  const big = SHAKE_THRESHOLD + 5;
  let t = 0;
  /** One sample, `ms` after the last. */
  const at = (x: number, ms = 100): number => {
    t += ms;
    return c.feed(x, -9.81, 0, t);
  };

  // Seeded from the first sample, so resting gravity is not a shake.
  check('the first sample only seeds the baseline', at(0) === 0);
  check('and sitting still counts nothing', at(0) + at(0) + at(0) === 0);

  check('a swing one way is a shake', at(big) === 1);
  check('holding it out there is not another', at(big) === 0, 'still the same swing');
  check('the swing back is', at(-big) === 1);
  check('and back again', at(big) === 1);
}

{
  // Violence must not pay. Two runs, same number of reversals, wildly different
  // force: if magnitude counted, the second would win by a mile.
  const gentle = shakeCounter();
  const wild = shakeCounter();
  let g = 0;
  let w = 0;
  let t = 0;
  gentle.feed(0, -9.81, 0, 0);
  wild.feed(0, -9.81, 0, 0);
  for (let i = 0; i < 10; i++) {
    t += 100;
    const s = i % 2 === 0 ? 1 : -1;
    g += gentle.feed(s * (SHAKE_THRESHOLD + 1), -9.81, 0, t);
    w += wild.feed(s * (SHAKE_THRESHOLD * 20), -9.81, 0, t);
  }
  check('a gentle shake and a violent one score the same', g === w, { g, w });
  check('and both scored every reversal', g === 10, g);
}

{
  // The refractory, and why it is shared across axes rather than per axis: a real
  // shake is never aligned to one, so one movement crosses two or three.
  const c = shakeCounter();
  c.feed(0, 0, 0, 0);
  const big = SHAKE_THRESHOLD + 5;
  check('one movement across three axes is one shake', c.feed(big, big, big, 100) === 1);
  check('and the reverse is one more', c.feed(-big, -big, -big, 300) === 1);

  const fast = shakeCounter();
  fast.feed(0, 0, 0, 0);
  let n = 0;
  // Faster than a human wrist: reversals every 10 ms.
  for (let i = 1; i <= 20; i++) n += fast.feed(i % 2 === 0 ? big : -big, 0, 0, i * 10);
  const elapsed = 200;
  check('an impossible rate is throttled by the refractory',
    n <= Math.ceil(elapsed / SHAKE_REFRACTORY_MS), { n, most: Math.ceil(elapsed / SHAKE_REFRACTORY_MS) });
  check('but it still counts something', n > 0);
}

{
  // Held any way up. Gravity sits on a different axis depending on the grip, and
  // the baseline is what removes it — a phone shaken flat must score like one
  // shaken upright.
  const upright = shakeCounter();
  const flat = shakeCounter();
  upright.feed(0, -9.81, 0, 0);
  flat.feed(0, 0, 9.81, 0);
  let u = 0;
  let f = 0;
  for (let i = 1; i <= 8; i++) {
    const s = i % 2 === 0 ? 1 : -1;
    const d = s * (SHAKE_THRESHOLD + 3);
    u += upright.feed(d, -9.81, 0, i * 100);
    f += flat.feed(d, 0, 9.81, i * 100);
  }
  check('the grip does not change the score', u === f, { u, f });
  check('and both counted', u === 8, u);
}

/* --- the tune ------------------------------------------------------------- */
{
  // The song, twice through, one note per shake. Both halves have to be the same or the
  // second time round is a different tune rather than a reprise.
  check('the melody is the phrase twice', MELODY.length === PHRASE.length * 2, MELODY.length);
  check('and the second half repeats the first',
    MELODY.slice(PHRASE.length).join() === PHRASE.join());
  check('every note is a real pitch', MELODY.every((n) => /^[A-G](#|b)?[0-8]$/.test(n)),
    MELODY.filter((n) => !/^[A-G](#|b)?[0-8]$/.test(n)));

  /*
   * The song is a little longer than the race, and `tune.ts` plays the difference at the
   * finish. Both bounds matter and neither is arbitrary: at zero or less the tune would
   * loop back to its opening while the runner is still going, and a long tail would leave
   * a finisher listening to playback long after the result is on screen.
   */
  check('there is an ending left over at the line', NOTES_AFTER_THE_LINE > 0, NOTES_AFTER_THE_LINE);
  check('and it is a cadence, not another verse',
    NOTES_AFTER_THE_LINE <= PHRASE.length / 4, NOTES_AFTER_THE_LINE);

  check('the first shake plays the first note', noteFor(0) === MELODY[0]);
  check('the last shake of the race is inside the song', noteFor(RUSH_DISTANCE - 1) === MELODY[RUSH_DISTANCE - 1]);
  check('the phrase comes round again half way', noteFor(PHRASE.length) === MELODY[0]);

  // Shaking past the END OF THE SONG — not past the line, which is still song — wraps
  // rather than falling silent, because silence mid-shake reads as a fault.
  check('shaking past the whole song wraps rather than stopping', noteFor(MELODY.length) === MELODY[0]);
  check('and nonsense reads as the start', noteFor(-4) === MELODY[0] && noteFor(NaN) === MELODY[0]);

  // Not one note repeated: the pitch has to move or there is nothing to hear.
  check('the tune actually moves', new Set(MELODY).size > 4, new Set(MELODY).size);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
