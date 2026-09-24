import {
  applyAbduct,
  barnCenterAt,
  cowGridSlot,
  leaderOf,
  ranking,
  scoreOf,
  ufoAnimFrame,
  ufoDriftAt,
  ufoHoverAt,
  UFO_ANIM_FRAMES,
  type AbductState,
  type AbductView,
} from './game';
import type { ServerMessage } from '../../../../shared/protocol';

/**
 * Aliens love cows, client side. Spec: docs/specs/games/aliens-love-cows.md
 *
 * `applyAbduct` has no referee to catch a mistake either — it only projects the
 * one public frame the server sends, same shape as UFO Hunt's own `applyUfoHunt`.
 * `ufoDriftAt`/`ufoHoverAt` are the other half worth checking directly: both must
 * stay a decoration (bounded, never dwelling on either end barn) since the client
 * is never told the referee's real pick before that round's own reveal (spec §8).
 * `cowGridSlot` is pure geometry — worth pinning down against the grid table the
 * "clarify the timing" request spelled out counts 1 through 8 for.
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
    phase: 'waiting',
    deadlineAt: 3_000,
    barns: [{ destroyed: false }, { destroyed: false }, { destroyed: false }, { destroyed: false }, { destroyed: false }],
    picks: {},
    target: null,
    abducted: [],
    out: [],
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
  check('the phase came through', state?.phase === 'waiting');
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

/** AbductScreen.tsx's own `ABDUCT_HOVER_MS / ABDUCT_HOVER_BOUNCES` — mirrored
 *  here rather than imported, the same way this file already keeps its own
 *  copy of shapes it does not own (that constant lives beside the JSX it
 *  drives, not in this DOM-free module). */
const HOVER_PERIOD_MS = 2_000 / 3;

function hover(): void {
  console.log('\nufoHoverAt: the reveal\'s own faster sweep, same bounds, different pace');

  let min = Infinity;
  let max = -Infinity;
  for (let t = 0; t < 20_000; t += 25) {
    const x = ufoHoverAt(t, HOVER_PERIOD_MS);
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  check('never reaches the leftmost barn', min > 0, min);
  check('never reaches the rightmost barn', max < 1, max);
  check('the same instant always gives the same spot', ufoHoverAt(1_234, HOVER_PERIOD_MS) === ufoHoverAt(1_234, HOVER_PERIOD_MS));
  check('it sweeps faster than the choosing-phase drift',
    Math.abs(ufoHoverAt(500, HOVER_PERIOD_MS) - ufoHoverAt(0, HOVER_PERIOD_MS)) > Math.abs(ufoDriftAt(500) - ufoDriftAt(0)));

  // Exactly 3 bounces across the reveal's own 2s hover beat (a "bounce" being
  // one full out-and-back: margin -> 1-margin -> margin) — the number the
  // maintainer asked for, not however many a hardcoded period happened to fit.
  let peaks = 0;
  let rising = true;
  let prev = ufoHoverAt(0, HOVER_PERIOD_MS);
  for (let t = 5; t <= 2_000; t += 5) {
    const x = ufoHoverAt(t, HOVER_PERIOD_MS);
    if (rising && x < prev) { peaks++; rising = false; }
    else if (!rising && x > prev) { rising = true; }
    prev = x;
  }
  check('exactly 3 bounces over the 2s hover beat', peaks === 3, peaks);
  check('and it is back at its own starting point when the beat ends',
    Math.abs(ufoHoverAt(2_000, HOVER_PERIOD_MS) - ufoHoverAt(0, HOVER_PERIOD_MS)) < 1e-6);
}

function cowGrid(): void {
  console.log('\ncowGridSlot: the grid table from the brief, counts 1 through 8');

  const shapes: Record<number, Array<{ col: number; row: number }>> = {
    1: [{ col: 0, row: 0 }],
    2: [{ col: 0, row: 0 }, { col: 0, row: 1 }],
    3: [{ col: 0, row: 0 }, { col: 0, row: 1 }, { col: 0, row: 2 }],
    4: [{ col: -0.5, row: 0 }, { col: 0.5, row: 0 }, { col: -0.5, row: 1 }, { col: 0.5, row: 1 }],
    5: [{ col: -0.5, row: 0 }, { col: 0.5, row: 0 }, { col: -0.5, row: 1 }, { col: 0.5, row: 1 }, { col: 0, row: 2 }],
    6: [{ col: -0.5, row: 0 }, { col: 0.5, row: 0 }, { col: -0.5, row: 1 }, { col: 0.5, row: 1 }, { col: -0.5, row: 2 }, { col: 0.5, row: 2 }],
    7: [
      { col: -0.5, row: 0 }, { col: 0.5, row: 0 }, { col: -0.5, row: 1 }, { col: 0.5, row: 1 },
      { col: -0.5, row: 2 }, { col: 0.5, row: 2 }, { col: 0, row: 3 },
    ],
    8: [
      { col: -0.5, row: 0 }, { col: 0.5, row: 0 }, { col: -0.5, row: 1 }, { col: 0.5, row: 1 },
      { col: -0.5, row: 2 }, { col: 0.5, row: 2 }, { col: -0.5, row: 3 }, { col: 0.5, row: 3 },
    ],
  };

  for (const [count, expected] of Object.entries(shapes)) {
    const n = Number(count);
    for (let i = 0; i < n; i++) {
      const slot = cowGridSlot(i, n);
      const want = expected[i]!;
      check(`count ${n}, cow ${i}: col ${want.col}, row ${want.row}`,
        slot.col === want.col && slot.row === want.row, slot);
    }
  }
}

function ufoAnim(): void {
  console.log('\nufoAnimFrame: the sprite sheet\'s own pace, off the wall clock');

  check('frame 0 at the very start', ufoAnimFrame(0, 2) === 0);
  check('at 2 fps, still frame 0 just under 500ms', ufoAnimFrame(499, 2) === 0);
  check('and frame 1 right at 500ms', ufoAnimFrame(500, 2) === 1);
  check('a full cycle at 2 fps is 2 seconds, back to frame 0', ufoAnimFrame(2_000, 2) === 0);
  check('every frame is inside the sheet', [0, 1, 2, 3].every((i) => i < UFO_ANIM_FRAMES));

  check('the same instant always gives the same frame', ufoAnimFrame(1_234, 4) === ufoAnimFrame(1_234, 4));
  check('a higher fps cycles faster',
    ufoAnimFrame(125, 16) !== ufoAnimFrame(0, 16) && ufoAnimFrame(125, 2) === ufoAnimFrame(0, 2));

  // The wall clock, not a per-beat elapsed time: two different fps values fed
  // the same instant do not have to agree, but neither ever resets to 0 just
  // because the caller switched tiers mid-animation.
  const sawEveryFrame = new Set<number>();
  for (let t = 0; t < 4_000; t += 25) sawEveryFrame.add(ufoAnimFrame(t, 4));
  check('a long enough run visits every frame in the sheet', sawEveryFrame.size === UFO_ANIM_FRAMES, [...sawEveryFrame]);
}

function barnCenters(): void {
  console.log('\nbarnCenterAt: interpolates real (unevenly-spaced) measured centres');

  // Not evenly spaced on purpose — the whole point is that these come from
  // flexbox `space-evenly` plus padding, not from a formula.
  const centers = [12.6, 31.3, 50, 68.7, 87.4];

  check('sitting exactly on a barn returns its own centre', barnCenterAt(centers, 2) === 50);
  check('halfway between two barns is their own midpoint',
    Math.abs(barnCenterAt(centers, 0.5) - (centers[0]! + centers[1]!) / 2) < 1e-9);
  check('a fractional index elsewhere interpolates linearly',
    Math.abs(barnCenterAt(centers, 3.25) - (centers[3]! + (centers[4]! - centers[3]!) * 0.25)) < 1e-9);
  check('an index below the row clamps to the first barn', barnCenterAt(centers, -1) === centers[0]);
  check('an index past the row clamps to the last barn', barnCenterAt(centers, 9) === centers[4]);
}

projecting();
scoring();
drift();
hover();
cowGrid();
ufoAnim();
barnCenters();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
