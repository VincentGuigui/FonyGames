import { applyUfoHunt, leaderOf, ranking, scoreOf, type UfoHuntState, type UfoHuntView } from './game';
import { bearingDeg, offsetDeg, saucerAt, scopeHeat, screenSpot, VIEW_FOV_DEG } from './scope';
import { cornerBeams, LASER_GAP_PX } from './beam';
import {
  UFOHUNT_SCOPE_DEG,
  ufoPositionAt,
  type ServerMessage,
  type UfoWave,
} from '../../../../shared/protocol';

/**
 * UFO Hunt, client side. Spec: docs/specs/games/ufo-hunt.md
 *
 * `applyUfoHunt` has no referee to catch a mistake either — it only projects the
 * one public frame the server sends. `scope.ts`'s geometry is the other half worth
 * checking directly: it has to place the saucer exactly where the referee's own
 * `ufoPositionAt` says it is, or a shot that looks dead-centre on screen would not
 * score what the referee actually credits.
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

const WAVE: UfoWave = { index: 0, kind: 1, maxHealth: 50, health: 30, homeAz: 10, homeEl: 5, spawnedAt: 1_000 };

/** A view — everything `applyUfoHunt` produces, `seq` included. Doubles as the wire
 *  `d` payload for `msg()` below, which strips `seq` (it travels as `msg.s`, not in `d`). */
function view(over: Partial<UfoHuntView> = {}): UfoHuntView {
  return {
    roundId: 1,
    startsAt: 0,
    endsAt: 120_000,
    wave: WAVE,
    scores: { [ME]: 10, [OTHER]: 20 },
    winner: null,
    phase: 'running',
    seq: 1,
    ...over,
  };
}

function msg(v: UfoHuntView, s = 1): ServerMessage {
  const { seq: _seq, ...d } = v;
  return { t: 'ufo-hunt', s, d };
}

function projecting(): void {
  console.log('\napplying frames');
  let state: UfoHuntState = null;
  state = applyUfoHunt(state, msg(view()));
  check('the wave came through', state?.wave.health === 30);
  check('so did both scores', state?.scores[ME] === 10 && state?.scores[OTHER] === 20);
  check('phase is running', state?.phase === 'running');

  // A later frame, same round: normal progress.
  state = applyUfoHunt(state, msg(view({ wave: { ...WAVE, health: 10 }, scores: { [ME]: 20, [OTHER]: 20 } }), 2));
  check('health dropped', state?.wave.health === 10);
  check('a score moved', state?.scores[ME] === 20);

  // A stale frame — lower seq, same round — changes nothing.
  const stale = applyUfoHunt(state, msg(view({ wave: { ...WAVE, health: 999 } }), 1));
  check('a stale frame is ignored', stale === state);

  // A frame for an earlier round is ignored too.
  const earlier = applyUfoHunt(state, msg(view({ roundId: 0 }), 99));
  check('an earlier round is ignored', earlier === state);

  // Other message types pass through untouched.
  const untouched = applyUfoHunt(state, { t: 'presence', s: 3, d: { code: 'ABCDEF', players: [], hostId: null } });
  check('an unrelated message changes nothing', untouched === state);

  // A new round resets, even with a lower seq — a fresh instance's seq starts over.
  const fresh = applyUfoHunt(state, msg(view({ roundId: 2, wave: { ...WAVE, index: 0, health: 50 } }), 1));
  check('a new round is accepted despite a lower seq', fresh?.roundId === 2 && fresh.wave.health === 50);
}

function scoring(): void {
  console.log('\nscore, ranking and the leader');
  const state = view({ scores: { a: 30, b: 30, c: 10 } });
  check('a scoreless player reads zero', scoreOf(state, 'nobody') === 0);
  // Stable sort: a and b tie at 30, so they keep their relative order from the input.
  check('ranking sorts high to low, ties keeping room order', ranking(state, ['c', 'a', 'b']).join() === 'a,b,c');
  check('a tie at the top has no leader', leaderOf(state, ['a', 'b', 'c']) === null);

  const clear = view({ scores: { a: 40, b: 10 } });
  check('a clear lead wins', leaderOf(clear, ['a', 'b']) === 'a');

  const nobody = view({ scores: { a: 0, b: 0 } });
  check('nobody scoring anything has no leader', leaderOf(nobody, ['a', 'b']) === null);
}

function geometry(): void {
  console.log('\nscreen geometry agrees with the referee\'s own roam');

  check('saucerAt matches ufoPositionAt directly',
    JSON.stringify(saucerAt(WAVE, 5_000)) === JSON.stringify(ufoPositionAt(WAVE.homeAz, WAVE.homeEl, WAVE.index, 4_000)));
  check('clamps a negative elapsed to zero', JSON.stringify(saucerAt(WAVE, 0)) === JSON.stringify(saucerAt(WAVE, 1_000)));

  const aim = { azimuth: 0, elevation: 0 };
  const dead = { azimuth: 0, elevation: 0 };
  check('dead centre offsets to nothing', offsetDeg(aim, dead).x === 0 && offsetDeg(aim, dead).y === 0);

  const spotCentre = screenSpot(aim, dead);
  check('dead centre is at the middle of the screen', spotCentre?.x === 0 && spotCentre?.y === 0, spotCentre);

  const justInside = { azimuth: VIEW_FOV_DEG - 1, elevation: 0 };
  check('just inside the view is on screen', screenSpot(aim, justInside) !== null);

  const wayOff = { azimuth: 170, elevation: 0 };
  check('far outside the view is off screen', screenSpot(aim, wayOff) === null);
  check('but a bearing is still defined for it', Number.isFinite(bearingDeg(aim, wayOff)));

  check('scopeHeat is full dead centre', scopeHeat(aim, dead, UFOHUNT_SCOPE_DEG) === 1);
  // Not `=== 0`: acos at the edge is a hair either side of the exact boundary in
  // float arithmetic, same reasoning ghostHunt.test.ts's own separation() checks use.
  check('scopeHeat is nothing at the edge of the scope',
    scopeHeat(aim, { azimuth: UFOHUNT_SCOPE_DEG, elevation: 0 }, UFOHUNT_SCOPE_DEG) < 1e-6);
  check('and clamps rather than going negative beyond it',
    scopeHeat(aim, { azimuth: UFOHUNT_SCOPE_DEG * 5, elevation: 0 }, UFOHUNT_SCOPE_DEG) === 0);
}

function laserBeams(): void {
  console.log('\ncornerBeams: four beams, each stopping short of the crosshair');

  const w = 400;
  const h = 800;
  const beams = cornerBeams(w, h, LASER_GAP_PX);
  check('one beam per corner', beams.length === 4);

  const corners = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }, { x: w, y: h }];
  for (const [i, corner] of corners.entries()) {
    const b = beams[i]!;
    check(`beam ${i} starts at its own corner`, b.x1 === corner.x && b.y1 === corner.y, b);
    const distToCentre = Math.hypot(w / 2 - b.x2, h / 2 - b.y2);
    check(`beam ${i} stops LASER_GAP_PX short of centre`,
      Math.abs(distToCentre - LASER_GAP_PX) < 1e-6, { distToCentre, expected: LASER_GAP_PX });
    const fullLen = Math.hypot(w / 2 - corner.x, h / 2 - corner.y);
    const beamLen = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
    check(`beam ${i} never reaches the centre`, beamLen < fullLen);
  }

  // A degenerate viewport (zero area) must not divide by zero into NaN endpoints.
  const zero = cornerBeams(0, 0, LASER_GAP_PX);
  check('a zero-sized viewport produces finite beams, not NaN',
    zero.every((b) => [b.x1, b.y1, b.x2, b.y2].every(Number.isFinite)), zero);
}

projecting();
scoring();
geometry();
laserBeams();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
