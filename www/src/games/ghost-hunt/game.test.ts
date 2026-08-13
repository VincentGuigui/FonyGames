import {
  applyHunt,
  createLock,
  heat,
  myIndex,
  myTarget,
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
import { sobel, RING_PX, EDGE_THRESHOLD } from './vision';
import { dragTo, project, DRAG_SENSITIVITY, FOV_DEG } from './photosphere';
import {
  ELEVATION_MAX_DEG,
  ELEVATION_MIN_DEG,
  LOCK_CONE_DEG,
  LOCK_DWELL_MS,
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
 * The lock. This is the thing that awards a point, and the dwell is what stops a
 * sweep straight through the ghost from scoring (spec §2).
 */
console.log('\nlocking on');

{
  const lock = createLock();
  const target: Aim = { azimuth: 30, elevation: 20 };
  const off: Aim = { azimuth: 120, elevation: 0 };
  const on: Aim = { azimuth: 30, elevation: 20 };

  let s = lock.update(off, target, 0);
  check('pointing elsewhere is not a lock', !s.locked && s.dwell === 0);
  check('and the error is reported for the ring', s.error > LOCK_CONE_DEG, s.error);

  s = lock.update(on, target, 1000);
  check('arriving on target starts the dwell', s.dwell === 0 && !s.locked);
  check('with the error at zero', s.error < 1e-4);

  s = lock.update(on, target, 1000 + LOCK_DWELL_MS / 2);
  check('half way through the dwell', close(s.dwell, 0.5, 1e-9), s.dwell);
  check('still not a lock', !s.locked);

  s = lock.update(on, target, 1000 + LOCK_DWELL_MS);
  check('holding it out the full dwell locks', s.locked === true);
  check('and the rim is full', s.dwell === 1);

  // One dwell, one point — however many sensor frames land while the phone sits
  // there. Without the latch a player would score the same ghost sixty times.
  s = lock.update(on, target, 1000 + LOCK_DWELL_MS + 100);
  check('but it only fires once', !s.locked);
  check('while still reading as held', s.dwell === 1);
}

{
  // A sweep straight through: inside the cone for one frame, then gone.
  const lock = createLock();
  const target: Aim = { azimuth: 0, elevation: 0 };
  let fired = 0;
  for (let t = 0; t <= 2000; t += 50) {
    // Sweeps past at 60°/s, so it is inside a 12° cone for about 200 ms.
    const azimuth = -60 + (t / 1000) * 60;
    if (lock.update({ azimuth, elevation: 0 }, target, t).locked) fired++;
  }
  check('a sweep straight through never locks', fired === 0, fired);
}

{
  // Leaving the cone and coming back starts the dwell again, rather than resuming.
  const lock = createLock();
  const target: Aim = { azimuth: 0, elevation: 0 };
  lock.update({ azimuth: 0, elevation: 0 }, target, 0);
  lock.update({ azimuth: 0, elevation: 0 }, target, LOCK_DWELL_MS - 100);
  lock.update({ azimuth: 90, elevation: 0 }, target, LOCK_DWELL_MS - 50);
  const back = lock.update({ azimuth: 0, elevation: 0 }, target, LOCK_DWELL_MS);
  check('wandering off discards the progress', back.dwell === 0, back.dwell);
  const later = lock.update({ azimuth: 0, elevation: 0 }, target, LOCK_DWELL_MS * 2);
  check('and the clock restarts from where it came back', later.locked === true);
}

{
  // The edge of the cone counts as inside it: a hard boundary a player cannot see
  // is better slightly generous than slightly mean.
  const lock = createLock();
  const target: Aim = { azimuth: 0, elevation: 0 };
  const edge: Aim = { azimuth: LOCK_CONE_DEG - 0.01, elevation: 0 };
  lock.update(edge, target, 0);
  check('the edge of the cone is inside it', lock.update(edge, target, LOCK_DWELL_MS).locked === true);

  const outside = createLock();
  const just: Aim = { azimuth: LOCK_CONE_DEG + 0.5, elevation: 0 };
  outside.update(just, target, 0);
  check('and just outside it is not', outside.update(just, target, LOCK_DWELL_MS).locked === false);
}

{
  // No target and no aim must be quiet rather than a lock at "zero degrees off".
  const lock = createLock();
  const s = lock.update(null, null, 0);
  check('nothing to aim at is not a lock', !s.locked && s.dwell === 0);
  check('and the error is not a number a ring would draw', !Number.isFinite(s.error));
  const s2 = lock.update({ azimuth: 0, elevation: 0 }, null, LOCK_DWELL_MS * 3);
  check('nor is a phone aiming at no ghost', !s2.locked);
}

console.log('\nthe hot/cold ring');

{
  check('dead on is fully hot', heat(0) === 1);
  check('anywhere inside the cone is fully hot', heat(LOCK_CONE_DEG) === 1);
  check('far away is cold', heat(HOT_FROM_DEG) === 0);
  check('and further is still cold, not negative', heat(179) === 0);
  check('it warms through the approach', heat(30) > 0 && heat(30) < 1, heat(30));
  // The signal has to move through the sweep, not only in the last few degrees.
  check('and warms monotonically', heat(50) < heat(35) && heat(35) < heat(20));
  check('nonsense reads as cold rather than as a win', heat(Number.NaN) === 0);
}

console.log('\nthe frames');

const hunt = (s: number, over: Partial<{ index: Record<string, number>; scores: Record<string, number>; roundId: number; targets: Aim[] }> = {}): ServerMessage => ({
  t: 'hunt',
  s,
  d: {
    roundId: over.roundId ?? 1,
    targets: over.targets ?? [{ azimuth: 10, elevation: 5 }, { azimuth: 120, elevation: -20 }],
    index: over.index ?? { a: 0, b: 0, c: 0 },
    endsAt: 90_000,
    scores: over.scores ?? { a: 0, b: 0, c: 0 },
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
  d: { roundId: 1, scores: { a: 4, b: 2, c: 0 }, best: { player: B, ms: 900 } },
});
check('over', st?.phase === 'over');
check('with the final counts', st?.scores['a'] === 4);
check('and the fastest find called out', st?.best?.player === B);

{
  const before = st;
  st = applyHunt(st, { t: 'hunt-end', s: 2, d: { roundId: 1, scores: {}, best: null } });
  check('a stale result cannot blank the scores', st?.scores['a'] === 4);
  check('nor cause a render', st === before);
}

console.log('\na new round wipes the last one');

{
  const next = applyHunt(st, hunt(1, { roundId: 2 }));
  check('accepted even though its seq restarts low', next?.roundId === 2);
  check('running again', next?.phase === 'running');
  check('scores back to zero', next?.scores['a'] === 0);
  check('and no stale best', next?.best === null);

  const before = next;
  check('and a frame from the finished round is dropped', applyHunt(next, hunt(9)) === before);
}

console.log('\nwho is winning');

{
  const board = applyHunt(null, hunt(1, { scores: { a: 2, b: 7, c: 5 } }));
  check('most found first', ranking(board!, [A, B, C]).join() === 'b,c,a');
  check('a player who left the room is not drawn', ranking(board!, [A, C]).join() === 'c,a');
}

/*
 * The edge detector. Testable without a camera, a canvas or a DOM because it is a
 * pure function over a buffer — which matters, since the alternative way to
 * answer "is the ring showing anything" is to point a phone at a room.
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
  check('and it is still opaque, not see-through', out[3] === 255);

  // A hard vertical boundary down the middle: the classic thing a room is full of.
  sobel(rgba((x) => (x < 8 ? 20 : 220)), out, W, H);
  check('a hard edge is found', lit(out) > 0);
  check('it lands on the boundary', at(out, 7, 8) > 0 || at(out, 8, 8) > 0);
  check('and not out in the flat', at(out, 2, 8) === 0 && at(out, 14, 8) === 0);

  // A gentle gradient is not an edge — otherwise every wall lights up and the
  // ring is a white disc.
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

  // The border is never sampled, because a 3x3 window has no neighbours there.
  sobel(rgba((_, y) => (y === 0 ? 255 : 0)), out, W, H);
  check('the frame edge is not mistaken for a room edge', at(out, 0, 0) === 0);

  check('the ring buffer is square and small enough to filter in JS', RING_PX * RING_PX < 30_000);
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

  const home = { azimuth: 0, elevation: 0 };
  check('dragging right looks right', dragTo(home, 100, 0).azimuth > 0);
  check('dragging up looks up', dragTo(home, 0, -100).elevation > 0);
  check('by the sensitivity it advertises', close(dragTo(home, 100, 0).azimuth, 100 * DRAG_SENSITIVITY));

  // Azimuth wraps because the sphere is continuous sideways...
  const far = dragTo({ azimuth: 170, elevation: 0 }, 200, 0);
  check('the azimuth wraps past the seam rather than piling up', far.azimuth < 0, far.azimuth);
  check('and stays in range', Math.abs(far.azimuth) <= 180);

  // ...but elevation clamps, or a drag rolls you upside down.
  const up = dragTo(home, 0, -100_000);
  check('you cannot roll over the top', up.elevation <= ELEVATION_MAX_DEG + 15, up.elevation);
  const down = dragTo(home, 0, 100_000);
  check('nor under the bottom', down.elevation >= ELEVATION_MIN_DEG - 15, down.elevation);
  // The clamp has to sit OUTSIDE the band the ghosts live in, or the ones at the
  // extremes are unreachable by drag.
  check('but every ghost is still reachable',
    up.elevation >= ELEVATION_MAX_DEG && down.elevation <= ELEVATION_MIN_DEG);

  // The view has to be narrower than the sphere or the seam is on screen twice.
  check('the field of view is a window, not the whole sphere', FOV_DEG > 0 && FOV_DEG < 180);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
