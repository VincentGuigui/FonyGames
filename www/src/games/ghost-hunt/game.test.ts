import {
  applyHunt,
  createLock,
  findTimes,
  findTimesLine,
  ghostSpeed,
  heat,
  leaderOf,
  myIndex,
  myTarget,
  pointsOf,
  ranking,
  HOT_FROM_DEG,
  type HuntState,
} from './game';
import {
  aimVector,
  angleBetween,
  toAim,
  toVector,
  wrapDeg,
  type Aim,
} from '../../core/sensors/orientation';
import { sobel, EDGE_GROUND_ALPHA, RADAR_PX, EDGE_THRESHOLD } from './vision';
import { dragTo, project, DRAG_SENSITIVITY, V_FOV_DEG } from './photosphere';
import { bearingDeg, ghostAt, offsetDeg, radarSpot } from './radar';
import {
  ELEVATION_MAX_DEG,
  ELEVATION_MIN_DEG,
  GHOST_HOLD_MS,
  GHOST_ROAM_DEG,
  GHOST_ROAM_MS,
  GHOST_SPEED_MAX,
  RADAR_FOV_DEG,
  TARGET_MIN_SEPARATION_DEG,
  type PlayerId,
  type ServerMessage,
} from '../../../../shared/protocol';

/**
 * The phone's half of Ghost Hunt.
 * Spec: docs/specs/games/ghost-hunt.md
 *
 * The server cannot see an aim, so **the lock is decided here** — which makes this
 * the one client reducer in the catalogue that actually awards a point. The
 * geometry underneath it is worth asserting hardest of all: an aim that is 90° off
 * is not something a play test reliably notices, it just feels like the game is
 * broken.
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

const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

/*
 * The geometry. `aimVector` builds the third column of the W3C Z-X'-Y'' rotation
 * matrix and negates it, which is "where does the BACK of the phone point" — both
 * the natural hold-it-up gesture and exactly where the rear camera looks.
 *
 * World frame: x east, y north, z up.
 */
console.log('\nwhere the phone is pointing');

{
  // Held upright, screen towards you, alpha 0: the back faces north.
  const up = aimVector(0, 90, 0);
  check('upright and facing forward aims level ahead', close(up.x, 0) && close(up.y, 1) && close(up.z, 0), up);

  // Flat on a table, screen up: the back points at the table.
  const flat = aimVector(0, 0, 0);
  check('flat on its back aims straight down', close(flat.z, -1), flat);

  // Upright, turned a quarter turn. Alpha grows anticlockwise, so the aim goes east.
  const turned = aimVector(-90, 90, 0);
  check('a quarter turn aims east', close(turned.x, 1, 1e-6) && close(turned.y, 0, 1e-6), turned);

  // Tipped back past vertical: the back looks up.
  const skyward = aimVector(0, 135, 0);
  check('tipped back, it looks up', skyward.z > 0.7, skyward);
}

console.log('\nangles and directions');

{
  check('north is azimuth 0', close(toAim({ x: 0, y: 1, z: 0 }).azimuth, 0));
  check('east is 90', close(toAim({ x: 1, y: 0, z: 0 }).azimuth, 90));
  check('west is -90', close(toAim({ x: -1, y: 0, z: 0 }).azimuth, -90));
  check('straight up is elevation 90', close(toAim({ x: 0, y: 0, z: 1 }).elevation, 90));

  // Round trip, because the two are used against each other constantly.
  for (const aim of [
    { azimuth: 0, elevation: 0 },
    { azimuth: 37, elevation: -12 },
    { azimuth: -140, elevation: 65 },
  ] as Aim[]) {
    const back = toAim(toVector(aim));
    check(`a direction survives the round trip (${aim.azimuth}, ${aim.elevation})`,
      close(back.azimuth, aim.azimuth, 1e-9) && close(back.elevation, aim.elevation, 1e-9), back);
  }

  check('an angle wraps into -180..180', wrapDeg(190) === -170 && wrapDeg(-190) === 170);
  check('and leaves one already in range alone', wrapDeg(90) === 90);

  check('the same direction is zero apart',
    angleBetween({ azimuth: 20, elevation: 5 }, { azimuth: 20, elevation: 5 }) < 1e-4);
  check('a quarter turn is 90',
    close(angleBetween({ azimuth: 0, elevation: 0 }, { azimuth: 90, elevation: 0 }), 90, 1e-9));
  // The wrap is where a naive subtraction goes wrong, and it is the common case.
  check('and it takes the short way round the back',
    close(angleBetween({ azimuth: 175, elevation: 0 }, { azimuth: -175, elevation: 0 }), 10, 1e-9));
  check('elevation counts as much as azimuth',
    close(angleBetween({ azimuth: 0, elevation: 0 }, { azimuth: 0, elevation: 30 }), 30, 1e-9));
  // Near the pole a degree of azimuth is worth almost nothing, which is exactly
  // why the angle is spherical rather than a difference of two numbers.
  check('near the top, azimuth barely matters',
    angleBetween({ azimuth: 0, elevation: 89 }, { azimuth: 90, elevation: 89 }) < 2);
}

/*
 * The radar's geometry, which is new and load-bearing: the ghost roams, so "is it on
 * the dial" is now a moving question and the answer is what awards a point.
 */
console.log('\nthe ghost roams, identically for everyone');

{
  const home: Aim = { azimuth: 30, elevation: 10 };

  check('at birth it is on its home direction, not at the edge of its excursion',
    angleBetween(ghostAt(home, 0, 0), home) < GHOST_ROAM_DEG, angleBetween(ghostAt(home, 0, 0), home));

  // The inequality the whole game rests on: it roams further than the radar can hold,
  // so a phone parked where the ghost started loses it and has to follow.
  check('it roams further than the radar sees', GHOST_ROAM_DEG > RADAR_FOV_DEG);

  let worst = 0;
  let everLeft = false;
  for (let t = 0; t <= GHOST_ROAM_MS * 2; t += 50) {
    const d = angleBetween(ghostAt(home, 0, t), home);
    worst = Math.max(worst, d);
    if (d > RADAR_FOV_DEG) everLeft = true;
  }
  check('and never further than it says', worst <= GHOST_ROAM_DEG + 1e-6, worst);
  check('so a still phone does lose it', everLeft);

  // Fairness. Everyone hunts the same ghosts in the same order (spec §2), so two
  // players on the same index must get the identical path from the identical start —
  // a roam drawn from Math.random would make this a different race per phone.
  const one = ghostAt(home, 3, 1234);
  const two = ghostAt(home, 3, 1234);
  check('the path is a function of index and age, not of chance',
    one.azimuth === two.azimuth && one.elevation === two.elevation);
  const other = ghostAt(home, 4, 1234);
  check('but a different ghost moves differently', other.azimuth !== one.azimuth);

  // Slow. The hunt is following a drift, not chasing a fly.
  const step = angleBetween(ghostAt(home, 1, 1000), ghostAt(home, 1, 1100));
  check('it drifts rather than darts', step < 2, step);

  // A degree of azimuth is a smaller angle the higher you look, so without the cos
  // correction a ghost near the top of the band would roam a fraction of the distance
  // and be quietly easier to hold.
  const low = { azimuth: 0, elevation: 0 };
  const high = { azimuth: 0, elevation: 65 };
  let lowMax = 0;
  let highMax = 0;
  for (let t = 0; t <= GHOST_ROAM_MS; t += 100) {
    lowMax = Math.max(lowMax, angleBetween(ghostAt(low, 2, t), low));
    highMax = Math.max(highMax, angleBetween(ghostAt(high, 2, t), high));
  }
  check('and it roams as far up high as on the horizon', Math.abs(lowMax - highMax) < 2,
    { lowMax, highMax });
}

console.log('\nwhere it lands on the dial');

{
  const aim: Aim = { azimuth: 0, elevation: 0 };

  check('dead ahead is the middle', (() => {
    const spot = radarSpot(aim, aim);
    return spot !== null && close(spot.x, 0) && close(spot.y, 0);
  })());

  const right = radarSpot(aim, { azimuth: RADAR_FOV_DEG / 2, elevation: 0 });
  check('a ghost to the right is to the right', right !== null && close(right.x, 0.5, 1e-9), right);
  const above = radarSpot(aim, { azimuth: 0, elevation: RADAR_FOV_DEG / 2 });
  check('and one above is up, in the y that grows upwards',
    above !== null && close(above.y, 0.5, 1e-9), above);

  check('the rim is on the dial', radarSpot(aim, { azimuth: RADAR_FOV_DEG - 0.01, elevation: 0 }) !== null);
  check('and a degree past it is not', radarSpot(aim, { azimuth: RADAR_FOV_DEG + 1, elevation: 0 }) === null);

  // Containment is the true angle on the sphere, so it cannot be cheated by
  // approaching along the diagonal where a flat box would still say "inside".
  const diagonal = { azimuth: RADAR_FOV_DEG * 0.8, elevation: RADAR_FOV_DEG * 0.8 };
  check('the dial is round, not square', radarSpot(aim, diagonal) === null);

  // The arrow. This is the only help a player gets when the ghost is behind them, so
  // it is defined at every distance rather than only on the dial.
  check('up is zero', close(bearingDeg(aim, { azimuth: 0, elevation: 30 }), 0, 1e-9));
  check('right is a quarter turn', close(bearingDeg(aim, { azimuth: 40, elevation: 0 }), 90, 1e-9));
  check('down is half', Math.abs(bearingDeg(aim, { azimuth: 0, elevation: -30 })) === 180);
  check('left is three quarters', close(bearingDeg(aim, { azimuth: -40, elevation: 0 }), -90, 1e-9));
  check('and it still answers for a ghost behind you',
    Number.isFinite(bearingDeg(aim, { azimuth: 150, elevation: 0 })));

  // Read from either end, the same distance.
  const a: Aim = { azimuth: 10, elevation: 20 };
  const b: Aim = { azimuth: 20, elevation: 30 };
  check('the offset is symmetric', close(offsetDeg(a, b).x, -offsetDeg(b, a).x, 1e-9));
}

/*
 * The hold. This is the thing that awards a point, and it is what stops a sweep
 * straight past the ghost from scoring (spec §2).
 */
console.log('\nholding a ghost on the dial');

{
  const lock = createLock();
  const ghost: Aim = { azimuth: 30, elevation: 20 };
  const off: Aim = { azimuth: 120, elevation: 0 };
  const on: Aim = { azimuth: 30, elevation: 20 };

  let s = lock.update(off, ghost, 0);
  check('pointing elsewhere is not a find', !s.locked && s.dwell === 0);
  check('and the error is reported for the radar', s.error > RADAR_FOV_DEG, s.error);
  check('the ghost is not drawn on the dial', s.spot === null);
  check('but the arrow still points at it', s.bearing !== null);

  s = lock.update(on, ghost, 1000);
  check('it appearing on the dial starts the hold', s.dwell === 0 && !s.locked);
  check('with the error at zero', s.error < 1e-4);
  check('and now it is drawn', s.spot !== null);

  s = lock.update(on, ghost, 1000 + GHOST_HOLD_MS / 2);
  check('half way through the hold', close(s.dwell, 0.5, 1e-9), s.dwell);
  check('still not a find', !s.locked);

  s = lock.update(on, ghost, 1000 + GHOST_HOLD_MS);
  check('keeping it there the full four seconds catches it', s.locked === true);
  check('and the rim is full', s.dwell === 1);

  // One hold, one point — however many sensor frames land while the phone sits
  // there. Without the latch a player would score the same ghost sixty times.
  s = lock.update(on, ghost, 1000 + GHOST_HOLD_MS + 100);
  check('but it only fires once', !s.locked);
  check('while still reading as held', s.dwell === 1);
}

{
  // A sweep straight through: on the dial for a moment, then gone.
  const lock = createLock();
  const ghost: Aim = { azimuth: 0, elevation: 0 };
  let fired = 0;
  for (let t = 0; t <= 6000; t += 50) {
    // 60°/s, so it crosses a 40°-wide dial in about two thirds of a second.
    const azimuth = -60 + (t / 1000) * 60;
    if (lock.update({ azimuth, elevation: 0 }, ghost, t).locked) fired++;
  }
  check('a sweep straight through never catches anything', fired === 0, fired);
}

{
  // Losing it and finding it again starts the hold over, rather than resuming.
  const lock = createLock();
  const ghost: Aim = { azimuth: 0, elevation: 0 };
  lock.update({ azimuth: 0, elevation: 0 }, ghost, 0);
  lock.update({ azimuth: 0, elevation: 0 }, ghost, GHOST_HOLD_MS - 100);
  lock.update({ azimuth: 90, elevation: 0 }, ghost, GHOST_HOLD_MS - 50);
  const back = lock.update({ azimuth: 0, elevation: 0 }, ghost, GHOST_HOLD_MS);
  check('letting it off the dial discards the progress', back.dwell === 0, back.dwell);
  const later = lock.update({ azimuth: 0, elevation: 0 }, ghost, GHOST_HOLD_MS * 2);
  check('and the clock restarts from where it came back', later.locked === true);
}

{
  // The rim counts as on the dial: a hard boundary a player cannot see is better
  // slightly generous than slightly mean.
  const lock = createLock();
  const ghost: Aim = { azimuth: 0, elevation: 0 };
  const edge: Aim = { azimuth: RADAR_FOV_DEG - 0.01, elevation: 0 };
  lock.update(edge, ghost, 0);
  check('the rim is inside the dial', lock.update(edge, ghost, GHOST_HOLD_MS).locked === true);

  const outside = createLock();
  const just: Aim = { azimuth: RADAR_FOV_DEG + 0.5, elevation: 0 };
  outside.update(just, ghost, 0);
  check('and just past it is not', outside.update(just, ghost, GHOST_HOLD_MS).locked === false);
}

{
  // The whole point of the roam, played out: hold still and you lose it, follow it and
  // you get it. This is the check that a roam smaller than the radar would fail.
  const home: Aim = { azimuth: 0, elevation: 0 };

  const still = createLock();
  let stillGot = 0;
  for (let t = 0; t <= GHOST_ROAM_MS; t += 50) {
    if (still.update(home, ghostAt(home, 0, t), t).locked) stillGot++;
  }
  check('a phone that never moves does not catch it', stillGot === 0, stillGot);

  const follows = createLock();
  let followed = 0;
  for (let t = 0; t <= GHOST_ROAM_MS; t += 50) {
    // Aiming straight at it — what following perfectly looks like.
    if (follows.update(ghostAt(home, 0, t), ghostAt(home, 0, t), t).locked) followed++;
  }
  check('a phone that follows it does', followed === 1, followed);
}

{
  // The separation rule has to keep the NEXT ghost off the dial of a phone that has
  // not moved, roam included, or a find hands out a free point.
  check('a fresh ghost cannot roam onto a stale aim',
    TARGET_MIN_SEPARATION_DEG > RADAR_FOV_DEG + GHOST_ROAM_DEG,
    { TARGET_MIN_SEPARATION_DEG, RADAR_FOV_DEG, GHOST_ROAM_DEG });
}

{
  // No ghost and no aim must be quiet rather than a find at "zero degrees off".
  const lock = createLock();
  const s = lock.update(null, null, 0);
  check('nothing to aim at is not a find', !s.locked && s.dwell === 0);
  check('and the error is not a number a radar would draw', !Number.isFinite(s.error));
  check('with nothing drawn on the dial', s.spot === null && s.bearing === null);
  const s2 = lock.update({ azimuth: 0, elevation: 0 }, null, GHOST_HOLD_MS * 3);
  check('nor is a phone aiming at no ghost', !s2.locked);
}

console.log('\nthe hot/cold radar');

{
  check('dead on is fully hot', heat(0) === 1);
  check('anywhere on the dial is fully hot', heat(RADAR_FOV_DEG) === 1);
  check('far away is cold', heat(HOT_FROM_DEG) === 0);
  check('and further is still cold, not negative', heat(179) === 0);
  check('it warms through the approach', heat(30) > 0 && heat(30) < 1, heat(30));
  // The signal has to move through the sweep, not only in the last few degrees.
  check('and warms monotonically', heat(50) < heat(35) && heat(35) < heat(20));
  check('nonsense reads as cold rather than as a win', heat(Number.NaN) === 0);
}

console.log('\nthe frames');

const hunt = (
  s: number,
  over: Partial<{
    index: Record<string, number>;
    scores: Record<string, number>;
    totals: Record<string, number>;
    points: Record<string, number>;
    roundId: number;
    targets: Aim[];
  }> = {},
): ServerMessage => ({
  t: 'hunt',
  s,
  d: {
    roundId: over.roundId ?? 1,
    targets: over.targets ?? [{ azimuth: 10, elevation: 5 }, { azimuth: 120, elevation: -20 }],
    index: over.index ?? { a: 0, b: 0, c: 0 },
    endsAt: 100_000,
    scores: over.scores ?? { a: 0, b: 0, c: 0 },
    totals: over.totals ?? { a: 0, b: 0, c: 0 },
    points: over.points ?? { a: 0, b: 0, c: 0 },
  },
});

let st: HuntState = applyHunt(null, hunt(1));
check('the sequence arrives', st?.targets.length === 2);
check('everyone starts on the first ghost', myIndex(st!, A) === 0);
check('and it is the one to hunt', myTarget(st!, A)?.azimuth === 10);
check('running', st?.phase === 'running');

st = applyHunt(st, hunt(2, { index: { a: 1, b: 0, c: 0 }, scores: { a: 1, b: 0, c: 0 } }));
check('a find moves that player on', myIndex(st!, A) === 1);
check('to the next ghost', myTarget(st!, A)?.azimuth === 120);
check('while everyone else stays put', myIndex(st!, B) === 0);
check('and the score follows', st?.scores['a'] === 1);

{
  const before = st;
  st = applyHunt(st, hunt(1, { index: { a: 0, b: 0, c: 0 } }));
  check('a late frame cannot walk anyone backwards', myIndex(st!, A) === 1);
  check('and the object is untouched, so no re-render', st === before);
}

check('a player with no index yet has no ghost', myTarget(st!, 'stranger' as PlayerId) === null);
check('and an index past the sequence is quiet, not a crash',
  myTarget({ ...(st as NonNullable<HuntState>), index: { a: 99 } }, A) === null);

st = applyHunt(st, {
  t: 'hunt-end',
  s: 3,
  d: {
    roundId: 1,
    scores: { a: 4, b: 2, c: 0 },
    totals: { a: 40_000, b: 18_000, c: 0 },
    points: { a: 360, b: 182, c: 0 },
    fastest: { a: 6_000, b: 8_000, c: 0 },
    slowest: { a: 14_000, b: 10_000, c: 0 },
  },
});
check('over', st?.phase === 'over');
check('with the final counts', st?.scores['a'] === 4);
check('and the scores', st?.points['a'] === 360);
check('and the find times, which only the end frame carries', st?.fastest['a'] === 6_000);

{
  const before = st;
  st = applyHunt(st, {
    t: 'hunt-end',
    s: 2,
    d: { roundId: 1, scores: {}, totals: {}, points: {}, fastest: {}, slowest: {} },
  });
  check('a stale result cannot blank the scores', st?.scores['a'] === 4);
  check('nor cause a render', st === before);
}

console.log('\na new round wipes the last one');

{
  const next = applyHunt(st, hunt(1, { roundId: 2 }));
  check('accepted even though its seq restarts low', next?.roundId === 2);
  check('running again', next?.phase === 'running');
  check('scores back to zero', next?.scores['a'] === 0);
  check('and no stale find times', Object.keys(next?.fastest ?? { x: 1 }).length === 0);

  const before = next;
  check('and a frame from the finished round is dropped', applyHunt(next, hunt(9)) === before);
}

/*
 * Who is winning — one number now, and one direction.
 *
 * It used to be two values pulling opposite ways: most caught, then the lowest time, and
 * never either on its own. Points fold both into a figure that only goes up, so what these
 * check is that the fold really did keep the old order rather than merely looking tidier.
 * `worker/ghostHunt.test.ts` proves the two orders agree on real finds; these cover what
 * the phone does with the numbers once they arrive.
 */
console.log('\nwho is winning');

{
  const board = applyHunt(null, hunt(1, {
    scores: { a: 2, b: 7, c: 5 },
    points: { a: 178, b: 622, c: 440 },
  }))!;
  check('most points first', ranking(board, [A, B, C]).join() === 'b,c,a');
  check('a player who left the room is not drawn', ranking(board, [A, C]).join() === 'c,a');

  /*
   * THE check, kept from the old rule. A has spent the least time of anyone — ten seconds
   * for their two — and under a score that was a time, lowest winning, they came first for
   * having barely played. Points cannot do that: two ghosts is two ghosts.
   */
  check('and barely playing does not win it', ranking(board, [A, B, C])[0] === B);
}

{
  // Level on catches: the quicker player has more points, because less was taken off.
  const board = applyHunt(null, hunt(1, {
    scores: { a: 3, b: 3, c: 3 },
    points: { a: 270, b: 288, c: 279 },
  }))!;
  check('on level catches the fastest is first', ranking(board, [A, B, C]).join() === 'b,c,a');
  check('and the leader is that player', leaderOf(board, [A, B, C]) === B);
}

{
  // Nobody has caught anything: every score is nil, and crowning the first row would be
  // inventing a winner out of room order.
  const empty = applyHunt(null, hunt(1))!;
  check('a round nobody has scored in has no leader', leaderOf(empty, [A, B, C]) === null);
  check('and everyone reads zero, which is true', pointsOf(empty, A) === 0);

  const tied = applyHunt(null, hunt(1, {
    scores: { a: 2, b: 2, c: 0 },
    points: { a: 180, b: 180, c: 0 },
  }))!;
  check('a dead heat has no leader either', leaderOf(tied, [A, B, C]) === null);

  const clear = applyHunt(null, hunt(1, {
    scores: { a: 2, b: 2, c: 0 },
    points: { a: 180, b: 181, c: 0 },
  }))!;
  check('a single point between them is a leader', leaderOf(clear, [A, B, C]) === B);
  check('never the player who has not started', leaderOf(clear, [A, B, C]) !== C);
}

console.log('\nthe three times, per player');

{
  const over = applyHunt(applyHunt(null, hunt(1, { scores: { a: 3, b: 0, c: 1 } })), {
    t: 'hunt-end',
    s: 2,
    d: {
      roundId: 1,
      scores: { a: 3, b: 0, c: 1 },
      totals: { a: 42_300, b: 0, c: 8_000 },
      points: { a: 258, b: 0, c: 92 },
      fastest: { a: 5_200, b: 0, c: 8_000 },
      slowest: { a: 21_400, b: 0, c: 8_000 },
    },
  })!;

  const a = findTimes(over, A)!;
  check('the fastest is theirs, not the room\'s', a.fastest === 5.2, a);
  check('so is the slowest', a.slowest === 21.4, a);
  // Divided here rather than sent: three numbers that cannot disagree beat four that can.
  check('and the average is the total over the count', Math.abs(a.average - 14.1) < 0.001, a);

  check('one find is its own fastest and slowest', findTimes(over, C)?.slowest === 8, findTimes(over, C));
  check('and a player who caught nothing has no times at all', findTimes(over, B) === null);
  check('so there is no line under their name', findTimesLine(over, B) === undefined);
  check('while a hunter gets all three',
    findTimesLine(over, A) === 'fastest 5.2s · slowest 21.4s · avg 14.1s', findTimesLine(over, A));
}

console.log('\nthe ghost speeds up as you catch them');

{
  check('a first ghost drifts at the base pace', ghostSpeed(0) === 1);
  check('and each catch adds to it', ghostSpeed(1) > 1 && ghostSpeed(3) > ghostSpeed(1));
  // Capped, or the roam outruns the four-second hold and the game stops being winnable
  // rather than becoming hard.
  check('but it never runs away', ghostSpeed(50) === GHOST_SPEED_MAX, ghostSpeed(50));
  check('and a count below zero cannot slow it down', ghostSpeed(-3) === 1);

  // The pace is a pure function of the count, so two players level on catches are hunting
  // the identical ghost — which is the half of the fairness rule worth keeping.
  const home: Aim = { azimuth: 30, elevation: 10 };
  const same = angleBetween(ghostAt(home, 2, 3_000, ghostSpeed(2)), ghostAt(home, 2, 3_000, ghostSpeed(2)));
  check('two players on the same count see the same ghost', same === 0, same);

  // Faster means further along the same path in the same time, not a wider path.
  let far = 0;
  for (let t = 0; t <= GHOST_ROAM_MS; t += 100) {
    far = Math.max(far, angleBetween(ghostAt(home, 0, t, GHOST_SPEED_MAX), home));
  }
  check('and it still never leaves its own roam', far <= GHOST_ROAM_DEG + 0.001, far);
}

/*
 * The edge detector. Testable without a camera, a canvas or a DOM because it is a
 * pure function over a buffer — which matters, since the alternative way to
 * answer "is the radar showing anything" is to point a phone at a room.
 */
console.log('\nthe edge detector');

{
  const W = 16;
  const H = 16;
  const rgba = (fill: (x: number, y: number) => number): Uint8ClampedArray => {
    const buf = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = fill(x, y);
        const p = (y * W + x) * 4;
        buf[p] = v;
        buf[p + 1] = v;
        buf[p + 2] = v;
        buf[p + 3] = 255;
      }
    }
    return buf;
  };
  const lit = (buf: Uint8ClampedArray): number => {
    let n = 0;
    for (let p = 0; p < buf.length; p += 4) if ((buf[p] as number) > 0) n++;
    return n;
  };
  const at = (buf: Uint8ClampedArray, x: number, y: number): number => buf[(y * W + x) * 4] as number;

  const out = new Uint8ClampedArray(W * H * 4);

  sobel(rgba(() => 128), out, W, H);
  check('a flat wall has no edges', lit(out) === 0, lit(out));
  /*
   * The ground is translucent now, not opaque. It was a solid black disc while the radar
   * showed a wider view than the screen behind it — two disagreeing pictures, so one had
   * to be hidden. The dial is a window onto the same view at the same scale now, so the
   * feed showing faintly through lines up with the trace instead of fighting it.
   */
  check('the ground is translucent, not a black disc', out[3] === EDGE_GROUND_ALPHA, out[3]);

  // A hard vertical boundary down the middle: the classic thing a room is full of.
  sobel(rgba((x) => (x < 8 ? 20 : 220)), out, W, H);
  check('a hard edge is found', lit(out) > 0);
  check('it lands on the boundary', at(out, 7, 8) > 0 || at(out, 8, 8) > 0);
  check('and not out in the flat', at(out, 2, 8) === 0 && at(out, 14, 8) === 0);

  // A gentle gradient is not an edge — otherwise every wall lights up and the
  // radar is a lit disc.
  sobel(rgba((x) => 100 + x), out, W, H);
  check('a soft gradient is not an edge', lit(out) === 0, lit(out));

  // Strength carries into brightness, so a real outline reads stronger than noise
  // that just squeaked over the line.
  const soft = new Uint8ClampedArray(W * H * 4);
  sobel(rgba((x) => (x < 8 ? 100 : 160)), soft, W, H);
  const hard = new Uint8ClampedArray(W * H * 4);
  sobel(rgba((x) => (x < 8 ? 0 : 255)), hard, W, H);
  check('a stronger edge is drawn brighter', at(hard, 7, 8) >= at(soft, 7, 8), [at(hard, 7, 8), at(soft, 7, 8)]);
  check('and nothing exceeds white', at(hard, 7, 8) <= 255);
  // Whatever the ground does, an edge is fully there — a half-visible outline on a
  // half-visible ground is nothing at all.
  check('an edge itself is opaque', hard[(8 * W + 7) * 4 + 3] === 255 || hard[(8 * W + 8) * 4 + 3] === 255);

  // The border is never sampled, because a 3x3 window has no neighbours there.
  sobel(rgba((_, y) => (y === 0 ? 255 : 0)), out, W, H);
  check('the frame edge is not mistaken for a room edge', at(out, 0, 0) === 0);

  check('the radar buffer is square and small enough to filter in JS', RADAR_PX * RADAR_PX < 30_000);
  check('and the threshold is above sensor noise', EDGE_THRESHOLD > 30);
}

/*
 * The photosphere. Equirectangular: x is 0..360 of azimuth, y is +90..-90 of
 * elevation, so the horizon is exactly the middle row.
 */
console.log('\nthe photosphere');

{
  check('straight ahead is the middle of the image', close(project({ azimuth: 0, elevation: 0 }).u, 0.5));
  check('and the horizon is the middle row', close(project({ azimuth: 0, elevation: 0 }).v, 0.5));
  check('straight up is the top', close(project({ azimuth: 0, elevation: 90 }).v, 0));
  check('straight down is the bottom', close(project({ azimuth: 0, elevation: -90 }).v, 1));
  // The seam sits behind the player rather than straight ahead, where it would be
  // the first thing anybody noticed.
  check('the seam is directly behind', close(project({ azimuth: 180, elevation: 0 }).u, 0));
  check('a quarter turn is a quarter across', close(project({ azimuth: 90, elevation: 0 }).u, 0.75));
  check('and it never leaves the image', project({ azimuth: 359.9, elevation: 0 }).u < 1);

  /*
   * The finger holds the WORLD, not the camera — drag right and the room comes with
   * you, so the aim goes left. It shipped the other way round, which is the kind of
   * bug that reads as "the controls are broken" rather than as an inverted sign.
   */
  const home = { azimuth: 0, elevation: 0 };
  check('dragging right brings the room right, so the aim goes left',
    dragTo(home, 100, 0).azimuth < 0);
  check('dragging down brings the room down, so the aim goes up',
    dragTo(home, 0, 100).elevation > 0);
  check('and dragging up looks down', dragTo(home, 0, -100).elevation < 0);
  check('by the sensitivity it advertises',
    close(dragTo(home, 100, 0).azimuth, -100 * DRAG_SENSITIVITY));
  // Both axes, or "it does not go up and down" is a thing only a play test finds.
  check('both axes actually move', dragTo(home, 40, 40).azimuth !== 0 && dragTo(home, 40, 40).elevation !== 0);

  // Azimuth wraps because the sphere is continuous sideways...
  const far = dragTo({ azimuth: -170, elevation: 0 }, 200, 0);
  check('the azimuth wraps past the seam rather than piling up', far.azimuth > 0, far.azimuth);
  check('and stays in range', Math.abs(far.azimuth) <= 180);

  // ...but elevation clamps, or a drag rolls you upside down.
  const up = dragTo(home, 0, 100_000);
  check('you cannot roll over the top', up.elevation <= ELEVATION_MAX_DEG + 15, up.elevation);
  const down = dragTo(home, 0, -100_000);
  check('nor under the bottom', down.elevation >= ELEVATION_MIN_DEG - 15, down.elevation);
  // The clamp has to sit OUTSIDE the band the ghosts live in, or the ones at the
  // extremes are unreachable by drag.
  check('but every ghost is still reachable',
    up.elevation >= ELEVATION_MAX_DEG && down.elevation <= ELEVATION_MIN_DEG);

  /*
   * The vertical window has to fit ABOVE a ghost at the top of the band.
   *
   * This is the check for the projection bug: the FOV used to be specified across the
   * screen, so a portrait phone derived a 151° vertical window whose crop was taller
   * than the image — the vertical crop clamped at every elevation and dragging up and
   * down did nothing. Half the window plus the highest ghost has to stay under the
   * zenith, with a little room for the overflow the draw now handles honestly.
   */
  check('the window is a window, not the whole sphere', V_FOV_DEG > 0 && V_FOV_DEG < 180);
  check('and a ghost at the top of the band is nearly centrable',
    ELEVATION_MAX_DEG + V_FOV_DEG / 2 < 90 + V_FOV_DEG / 3,
    { V_FOV_DEG, ELEVATION_MAX_DEG });
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
