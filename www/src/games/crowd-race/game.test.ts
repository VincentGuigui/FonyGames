import {
  CROWD_BIKE_STUN_MS,
  CROWD_BOUNCE_MS,
  CROWD_FINISH_Y,
  CROWD_START_CLEAR,
  CROWD_START_Y,
  CROWD_STREET_WIDTH,
  CROWD_WALK_SPEED,
} from '../../../../shared/protocol';
import { startRun, step, type CrowdRun, type LiveObstacle } from './game';

/**
 * One player's own walk: movement from tilt, the street's own bounds, and
 * the collision/bounce/cascade rules. Spec: docs/specs/games/crowd-race.md §2
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

const FRAME = 1000 / 60;
const FLAT = { gamma: null, beta: null };
const UPRIGHT = { gamma: 0, beta: 90 };
const UPSIDE_DOWN = { gamma: 0, beta: -90 };

/** Run `frames` steps of `FRAME` ms each, with no obstacles in the way. */
function walk(run: CrowdRun, tilt: { gamma: number | null; beta: number | null }, frames: number): CrowdRun {
  let r: CrowdRun = { ...run, obstacles: [] };
  for (let i = 0; i < frames; i++) r = step(r, tilt, FRAME);
  return r;
}

function movement(): void {
  console.log('\nmovement is the gravity vector itself (§2)');

  const start = startRun(1);
  check('starts centred on the street', Math.abs(start.x - CROWD_STREET_WIDTH / 2) < 1e-6);
  check('starts a small margin up from the bottom', start.y === CROWD_START_Y);

  const upright1s = walk(start, UPRIGHT, 60);
  check('held upright, a second of walking covers CROWD_WALK_SPEED', Math.abs((upright1s.y - start.y) - CROWD_WALK_SPEED) < 1, upright1s.y);
  check('and stays centred — no lateral drift with no roll', Math.abs(upright1s.x - start.x) < 1e-6);

  // A short burst rather than a full second — CROWD_START_Y is small, and a
  // full second at CROWD_WALK_SPEED would run into the fixed floor `bounds()`
  // below tests on its own; this is testing the mirrored distance, not that.
  const briefBack = walk(start, UPSIDE_DOWN, 20);
  check('upside down walks the other way — down the street', briefBack.y < start.y, briefBack.y);
  check('by the same distance, mirrored', Math.abs((briefBack.y - start.y) + CROWD_WALK_SPEED / 3) < 1, briefBack.y);

  // beta=90 exactly is a gimbal lock (cos(90°)=0 zeroes out any gamma), the
  // same trap Tilt Race's own `downVector` doc warns about — a realistic
  // "mostly upright with a roll" pose has to sit a little short of it.
  const rolled = walk(start, { gamma: 30, beta: 70 }, 60);
  check('a roll while upright moves the player sideways too', Math.abs(rolled.x - start.x) > 1, rolled.x);

  const wasUpright = walk(start, UPRIGHT, 30);
  const thenFlat = walk(wasUpright, FLAT, 30);
  check('a flat phone holds the last heading rather than stopping', thenFlat.y > wasUpright.y);
}

function bounds(): void {
  console.log('\nthe street has walls, and a fixed floor at the very bottom of the screen (§2)');

  const hardLeft = walk(startRun(2), { gamma: -90, beta: 0 }, 300);
  check('the left edge is a wall', hardLeft.x >= 0 && hardLeft.x < CROWD_PERSON_RX_PLUS, hardLeft.x);

  const hardRight = walk(startRun(3), { gamma: 90, beta: 0 }, 300);
  check('the right edge is a wall', hardRight.x <= CROWD_STREET_WIDTH && hardRight.x > CROWD_STREET_WIDTH - CROWD_PERSON_RX_PLUS, hardRight.x);

  // Walk forward a good distance (short of the finish — CROWD_COURSE_LENGTH
  // is under 10 s of clean walking now, so a full 10 s forward would finish
  // the race before this can test the floor at all), then walk backward for
  // far longer than it would take to reach world y = 0 — the fixed screen's
  // own bottom edge, not a ratchet that follows the player (there is no
  // camera to).
  const ahead = walk(startRun(4), UPRIGHT, 180); // 3 s forward
  const pushedBack = walk(ahead, UPSIDE_DOWN, 6000); // 100 s backward — far more than enough
  check(
    'pushed back a long way, it stops at the very bottom of the fixed screen',
    Math.abs(pushedBack.y - 0) < 2,
    { best: ahead.y, floor: pushedBack.y },
  );
}
const CROWD_PERSON_RX_PLUS = 20; // generous slack around the hitbox radius for the wall checks above

function collisions(): void {
  console.log('\ncollisions bounce, cascade, and respect each kind (§2.1)');

  // A lone tree, dead ahead of an upright walk.
  const treeObstacles: LiveObstacle[] = [
    { id: 't', kind: 'tree', x: CROWD_STREET_WIDTH / 2, y: 40, dir: 0, speed: 0, rx: 18, ry: 18, bounce: null, stunUntil: 0 },
  ];
  const treeRun = { ...startRun(10), x: CROWD_STREET_WIDTH / 2, y: 0, obstacles: treeObstacles };
  let r = treeRun;
  let hitTree = false;
  for (let i = 0; i < 600 && !hitTree; i++) {
    r = step(r, UPRIGHT, FRAME);
    if (r.bounce) hitTree = true;
  }
  check('walking into a tree bounces the player', hitTree);
  check(
    'the tree itself never moves',
    r.obstacles[0]!.x === treeObstacles[0]!.x && r.obstacles[0]!.y === treeObstacles[0]!.y,
    r.obstacles[0],
  );
  let afterTree = r;
  for (let i = 0; i < 5; i++) afterTree = step(afterTree, UPRIGHT, FRAME);
  check(
    'the tree is still exactly where it was, a few frames later',
    afterTree.obstacles[0]!.x === treeObstacles[0]!.x && afterTree.obstacles[0]!.y === treeObstacles[0]!.y,
  );

  // A pedestrian standing still (dir 0 would make it a tree in real data, but
  // the physics only cares about `kind` for what happens on contact — a
  // stationary pedestrian is a valid test fixture for "the fixture bounces").
  const pedObstacles: LiveObstacle[] = [
    { id: 'p', kind: 'pedestrian', x: CROWD_STREET_WIDTH / 2, y: 40, dir: 1, speed: 0, rx: 14, ry: 20, bounce: null, stunUntil: 0 },
  ];
  // Started at the very bottom (world y: 0) rather than the default start
  // line — CROWD_START_Y now sits exactly on this fixture's own y, which
  // would overlap it from frame one instead of walking into it.
  const pedRun = { ...startRun(11), x: CROWD_STREET_WIDTH / 2, y: 0, obstacles: pedObstacles };
  let r2 = pedRun;
  for (let i = 0; i < 600; i++) {
    r2 = step(r2, UPRIGHT, FRAME);
    if (r2.bounce) break;
  }
  check('walking into a pedestrian bounces the player too', r2.bounce !== null);
  check('and bounces the pedestrian the other way', r2.obstacles[0]!.bounce !== null && (r2.obstacles[0]!.bounce as { vy: number }).vy > 0, r2.obstacles[0]);

  // A bicycle: stops, does not bounce.
  const bikeObstacles: LiveObstacle[] = [
    { id: 'b', kind: 'bicycle', x: CROWD_STREET_WIDTH / 2, y: 40, dir: 1, speed: 0, rx: 15, ry: 28, bounce: null, stunUntil: 0 },
  ];
  const bikeRun = { ...startRun(12), x: CROWD_STREET_WIDTH / 2, y: 0, obstacles: bikeObstacles };
  let r3 = bikeRun;
  for (let i = 0; i < 600; i++) {
    r3 = step(r3, UPRIGHT, FRAME);
    if (r3.bounce) break;
  }
  check('the bike stuns rather than bounces', r3.obstacles[0]!.bounce === null && r3.obstacles[0]!.stunUntil > r3.clockMs, r3.obstacles[0]);
  check('for CROWD_BIKE_STUN_MS', Math.abs(r3.obstacles[0]!.stunUntil - r3.clockMs - CROWD_BIKE_STUN_MS) < FRAME);

  // Cascade: a pedestrian bounced squarely into a second one right behind it
  // must, within a few frames, bounce that second one too.
  const cascadeObstacles: LiveObstacle[] = [
    { id: 'p1', kind: 'pedestrian', x: CROWD_STREET_WIDTH / 2, y: 40, dir: 1, speed: 0, rx: 14, ry: 20, bounce: null, stunUntil: 0 },
    { id: 'p2', kind: 'pedestrian', x: CROWD_STREET_WIDTH / 2, y: 80, dir: 1, speed: 0, rx: 14, ry: 20, bounce: null, stunUntil: 0 },
  ];
  const cascadeRun = { ...startRun(13), x: CROWD_STREET_WIDTH / 2, y: 0, obstacles: cascadeObstacles };
  let r4 = cascadeRun;
  let p2Bounced = false;
  for (let i = 0; i < 600 && !p2Bounced; i++) {
    r4 = step(r4, UPRIGHT, FRAME);
    if (r4.obstacles.find((o) => o.id === 'p2')?.bounce) p2Bounced = true;
  }
  check('a bounce cascades into the next pedestrian in line', p2Bounced);

  // Bounce is temporary: the player resumes tilt-driven walking afterward.
  const settleRun = { ...startRun(14), obstacles: [] };
  const withBounce: CrowdRun = { ...settleRun, bounce: { until: settleRun.clockMs + CROWD_BOUNCE_MS, vx: 0, vy: -50 } };
  const past = step(withBounce, UPRIGHT, CROWD_BOUNCE_MS + FRAME * 2);
  check('once a bounce ends, normal walking resumes', past.bounce === null);
}

function traffic(): void {
  console.log('\nobstacles stay on the street, and their own course loops (build note, §2.2)');

  // A cascade pushed hard enough to overshoot the kerb must not leave the
  // pedestrian off the visible street — found by walking a real round, where
  // a repeatedly-bounced pedestrian ended up with a negative x and never drew.
  const edgeObstacles: LiveObstacle[] = [
    { id: 'e', kind: 'pedestrian', x: 1, y: 0, dir: 1, speed: 0, rx: 14, ry: 20, bounce: null, stunUntil: 0 },
  ];
  const edgeRun: CrowdRun = { ...startRun(20), x: CROWD_PERSON_RX_PLUS, y: 0, obstacles: edgeObstacles };
  const afterEdge = step(edgeRun, UPRIGHT, FRAME);
  check(
    'a pedestrian bounced toward the kerb is clamped to the street',
    afterEdge.obstacles[0]!.x >= 14 - 1e-6 && afterEdge.obstacles[0]!.x <= CROWD_STREET_WIDTH - 14 + 1e-6,
    afterEdge.obstacles[0]!.x,
  );

  // A mover that would walk the whole populated band in one lifetime wraps
  // back in rather than walking on forever — the actual cause of "no
  // obstacles visible", where the crowd near the player thinned to nothing
  // well before the finish line.
  const loopers: LiveObstacle[] = [
    { id: 'l', kind: 'pedestrian', x: 100, y: CROWD_FINISH_Y - 0.1, dir: 1, speed: CROWD_WALK_SPEED, rx: 14, ry: 20, bounce: null, stunUntil: 0 },
  ];
  const loopRun: CrowdRun = { ...startRun(21), obstacles: loopers };
  const afterLoop = step(loopRun, FLAT, FRAME);
  check(
    'walking past the top of the band wraps back to the bottom',
    Math.abs(afterLoop.obstacles[0]!.y - CROWD_START_CLEAR) < 5,
    afterLoop.obstacles[0]!.y,
  );

  // A fixture parked below the band — several tests above rely on this, a
  // pedestrian at `y: 40` so a round trip does not need 30 s of frames — must
  // not be treated as already past a boundary and snapped away.
  const parked: LiveObstacle[] = [
    { id: 'p', kind: 'pedestrian', x: 100, y: 40, dir: 1, speed: 0, rx: 14, ry: 20, bounce: null, stunUntil: 0 },
  ];
  const parkedRun: CrowdRun = { ...startRun(22), obstacles: parked };
  const afterParked = step(parkedRun, FLAT, FRAME);
  check('a fixture below the band, not yet walking, stays put', afterParked.obstacles[0]!.y === 40, afterParked.obstacles[0]!.y);
}

movement();
bounds();
collisions();
traffic();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
