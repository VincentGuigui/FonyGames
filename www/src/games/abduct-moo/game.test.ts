import { applyAbduct, leaderOf, ranking, scoreOf, ufoDriftAt, type AbductState, type AbductView } from './game';
import type { ServerMessage } from '../../../../shared/protocol';

/**
 * Abduct-Moo, client side. Spec: docs/specs/games/abduct-moo.md
 *
 * `applyAbduct` has no referee to catch a mistake either — it only projects the
 * one public frame the server sends, same shape as UFO Hunt's own `applyUfoHunt`.
 * `ufoDriftAt` is the other half worth checking directly: it must stay a decoration
 * (bounded, never dwelling on either end barn) since it is drawn before the referee
 * has even made its real pick (spec §8).
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

const ME = 'p-me';
const OTHER = 'p-other';

/** A view — everything `applyAbduct` produces, `seq` included. Doubles as the wire
 *  `d` payload for `msg()` below, which strips `seq` (it travels as `msg.s`, not in `d`). */
function view(over: Partial<AbductView> = {}): AbductView {
  return {
    roundId: 1,
    round: 1,
    phase: 'choosing',
    deadlineAt: 3_000,
    barns: [{ destroyed: false }, { destroyed: false }, { destroyed: false }, { destroyed: false }, { destroyed: false }],
    picks: {},
    target: null,
    abducted: [],
    scores: { [ME]: 0, [OTHER]: 0 },
    winner: null,
    seq: 1,
    ...over,
  };
}

function msg(v: AbductView, s = 1): ServerMessage {
  const { seq: _seq, ...d } = v;
  return { t: 'abduct', s, d };
}

function projecting(): void {
  console.log('\napplying frames');
  let state: AbductState = null;
  state = applyAbduct(state, msg(view()));
  check('the phase came through', state?.phase === 'choosing');
  check('so did the barns', state?.barns.length === 5);

  // A later frame, same round: a pick lands.
  state = applyAbduct(state, msg(view({ picks: { [ME]: 2 } }), 2));
  check('the pick came through', state?.picks[ME] === 2);

  // A stale frame — lower seq, same round — changes nothing.
  const stale = applyAbduct(state, msg(view({ picks: { [ME]: 4 } }), 1));
  check('a stale frame is ignored', stale === state);

  // A frame for an earlier round is ignored too.
  const earlier = applyAbduct(state, msg(view({ roundId: 0 }), 99));
  check('an earlier round is ignored', earlier === state);

  // Other message types pass through untouched.
  const untouched = applyAbduct(state, { t: 'presence', s: 3, d: { code: 'ABCDEF', players: [], hostId: null } });
  check('an unrelated message changes nothing', untouched === state);

  // A new round resets, even with a lower seq — a fresh instance's seq starts over.
  const fresh = applyAbduct(state, msg(view({ roundId: 2, round: 2, picks: {} }), 1));
  check('a new round is accepted despite a lower seq', fresh?.roundId === 2 && Object.keys(fresh.picks).length === 0);
}

function scoring(): void {
  console.log('\nscore, ranking and the leader');
  const state = view({ scores: { a: 3, b: 3, c: 1 } });
  check('a scoreless player reads zero', scoreOf(state, 'nobody') === 0);
  // Stable sort: a and b tie at 3, so they keep their relative order from the input.
  check('ranking sorts high to low, ties keeping room order', ranking(state, ['c', 'a', 'b']).join() === 'a,b,c');
  check('a tie at the top has no leader', leaderOf(state, ['a', 'b', 'c']) === null);

  const clear = view({ scores: { a: 3, b: 1 } });
  check('a clear lead wins', leaderOf(clear, ['a', 'b']) === 'a');

  const nobody = view({ scores: { a: 0, b: 0 } });
  check('nobody scoring anything has no leader', leaderOf(nobody, ['a', 'b']) === null);
}

function drift(): void {
  console.log('\nufoDriftAt: a bounded decoration, never resting over an end barn');

  let min = Infinity;
  let max = -Infinity;
  for (let t = 0; t < 20_000; t += 25) {
    const x = ufoDriftAt(t);
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  check('never reaches the leftmost barn', min > 0, min);
  check('never reaches the rightmost barn', max < 1, max);
  check('the same instant always gives the same spot', ufoDriftAt(1_234) === ufoDriftAt(1_234));
  check('it does move over time', ufoDriftAt(0) !== ufoDriftAt(1_000));
}

projecting();
scoring();
drift();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
