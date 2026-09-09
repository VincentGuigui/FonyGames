import {
  CROWD_BIKE_STUN_MS,
  CROWD_BOUNCE_IMPULSE,
  CROWD_BOUNCE_MS,
  CROWD_COURSE_LENGTH,
  CROWD_OBSTACLE_SPACING,
  CROWD_PERSON_RX,
  CROWD_PERSON_RY,
  CROWD_SCREEN_HEIGHT,
  CROWD_START_CLEAR,
  CROWD_STREET_WIDTH,
  CROWD_WALK_SPEED,
} from '../../../../shared/protocol';
import { downVector } from '../../core/sensors/gravity';
import { dealStreet, ellipsesOverlap, type ObstacleSpawn } from './street';

/**
 * One player's own walk down the street: DOM-free and pure enough to drive a
 * whole race in a test, the same split `drive.ts` (Tilt Race) and `game.ts`
 * (Asteroid Race, Gravity Shooter) already use. Spec: docs/specs/games/crowd-race.md §2
 *
 * ## Movement is the gravity vector itself, not an auto-walk plus a steer
 *
 * The issue: "player automatically goes up in the phone sensor referential
 * (gravity up). player tilts the phone to move around (so upside down phone
 * means going down the street)." Read literally, there is no separate
 * "forward" throttle for tilt to add to — the walking direction **is**
 * wherever gravity's own "up" currently points, continuously, at a constant
 * speed. Held upright, gravity's up is up the screen and the player walks up
 * the street; turned upside down, gravity's up flips to point down the
 * screen and the player walks backward — exactly the issue's own example.
 *
 * That is `downVector(gamma, beta)` (`core/sensors/gravity.ts`) itself, used
 * unnegated — which looks backwards until the two sign flips involved are
 * both written down. `downVector` reports gravity's *own* pull in *screen*
 * coordinates, where y grows downward; "forward" here is `y` growing, i.e.
 * *up* the street, which is the opposite sense — one flip. And walking
 * direction is the opposite of down, i.e. up — a second flip. The two cancel,
 * so the raw vector already points the way a pedestrian should walk in this
 * module's own world coordinates: held upright, `downVector` reads `(0, 1)`
 * (down the *screen*), and `(0, 1)` is exactly "no lateral drift, `y`
 * growing" here — forward, up the street, at full speed. Turn the phone
 * upside down and `downVector` flips to `(0, -1)`, which walks `y` backward —
 * the issue's own example.
 *
 * A flat phone has no reliable in-plane reading (`downVector`'s own doc), so
 * below `MIN_TILT` this keeps walking in whatever direction it last had,
 * rather than snapping to a default that would read as the crowd shoving the
 * player sideways for no reason.
 *
 * (An earlier draft of this spec proposed reusing Asteroid Race's calibrated
 * `steer2Filter` instead — "tilt adds to the automatic walk". That control
 * calibrates its zero to however the phone happens to be held at Ready, which
 * would make "upside down" relative to *that* pose rather than to gravity —
 * true for some readings, false for others, depending on how the phone was
 * held when Ready was pressed. The issue's own "upside down" is an absolute
 * statement about gravity, so this build reads literally instead.)
 */

/** Below this much in-plane gravity, `downVector`'s direction is noise (a
 *  phone held nearly flat) — the same shape `ROLL_MIN_GRAVITY` guards in Tilt
 *  Race's `roll.ts`, tuned the same way: about 15° off flat. */
export const CROWD_MIN_TILT = 0.25;

export type BounceState = { until: number; vx: number; vy: number };

export type LiveObstacle = ObstacleSpawn & {
  bounce: BounceState | null;
  /** Bicycle only: halted — no bounce, simply stopped — until this clock time. */
  stunUntil: number;
};

export type CrowdRun = {
  x: number;
  y: number;
  /** High-water mark of `y`. A bounce may push `y` down, but never below
   *  `bestY - CROWD_SCREEN_HEIGHT` (spec §2: "never off the bottom of the
   *  screen", read as one screen height of give behind the best ever made). */
  bestY: number;
  /** Last direction actually walked, unit vector. Held through a flat phone. */
  heading: { x: number; y: number };
  bounce: BounceState | null;
  obstacles: LiveObstacle[];
  /** Obstacle ids currently overlapping the player — new-touch detection, so
   *  a bounce fires once per approach rather than every frame of contact. */
  touching: Set<string>;
  /** `"idA|idB"` pairs (lexically ordered) currently overlapping each other —
   *  the same new-touch rule, for obstacle-vs-obstacle. */
  obstacleTouching: Set<string>;
  /** Clock time this player crossed `CROWD_COURSE_LENGTH`, or null. */
  finishedAt: number | null;
  /** Milliseconds since this run started. */
  clockMs: number;
};

export function startRun(roundId: number): CrowdRun {
  const obstacles = dealStreet(roundId).map((o) => ({ ...o, bounce: null, stunUntil: 0 }));
  return {
    x: CROWD_STREET_WIDTH / 2,
    y: 0,
    bestY: 0,
    heading: { x: 0, y: 1 },
    bounce: null,
    obstacles,
    touching: new Set(),
    obstacleTouching: new Set(),
    finishedAt: null,
    clockMs: 0,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** The player is walled to the street's width (§2); an obstacle needs the same
 *  clamp wherever a bounce moves it, or a cascade can shove it past the kerb
 *  and off the visible street entirely (found by walking a real round: a
 *  pedestrian pushed by a cascade of hits ended up at a negative `x`, clipped
 *  by nothing since only the player was ever clamped). */
function clampObstacleX(o: LiveObstacle): LiveObstacle {
  const x = clamp(o.x, o.rx, CROWD_STREET_WIDTH - o.rx);
  return x === o.x ? o : { ...o, x };
}

/** The band `dealStreet` actually populates — obstacles that walk out of it
 *  wrap back in at the other end rather than thinning out forever. Without
 *  this, a pedestrian walking at `CROWD_WALK_SPEED` covers the whole
 *  `CROWD_COURSE_LENGTH` in the time a typical run takes to finish, so the
 *  crowd near the player would empty out well before the finish line — found
 *  the same way as the clamp above, by actually walking a round to the point
 *  the local obstacle count visibly dropped to near zero.
 *
 *  Only wraps at the boundary a body is actually walking *toward* — a
 *  down-street mover past the finish end, or an up-street mover past the
 *  start end — rather than snapping anything outside the band back in. A
 *  fixture parked below `CROWD_START_CLEAR` (several tests place one at
 *  `y: 40` so a round trip does not need 30 s of frames) is not "exiting" the
 *  band by being there; only actual travel past the far end counts. */
const CROWD_OBSTACLE_BAND = CROWD_COURSE_LENGTH - CROWD_START_CLEAR;

function wrapObstacleY(y: number, dir: 1 | -1): number {
  if (dir === 1 && y > CROWD_COURSE_LENGTH) return y - CROWD_OBSTACLE_BAND;
  if (dir === -1 && y < CROWD_START_CLEAR) return y + CROWD_OBSTACLE_BAND;
  return y;
}

/** An ellipse's own radius along a unit direction `(ux, uy)` — exact, not the
 *  normalised-distance stand-in `ellipsesOverlap` uses, because a positional
 *  correction has to move bodies by a real world-unit amount. */
function radiusAlong(rx: number, ry: number, ux: number, uy: number): number {
  const denom = Math.sqrt((ux * ux) / (rx * rx) + (uy * uy) / (ry * ry));
  return denom > 0 ? 1 / denom : Math.max(rx, ry);
}

/**
 * The axis a collision bounces along, and how far the two bodies overlap
 * that axis right now — the line joining the two centres doubles as the line
 * through their contact point (exactly true for circles, close enough for
 * two ellipses at first contact), so no separate contact-point geometry is
 * needed (spec §2.1).
 */
function bounceAxis(
  ax: number, ay: number, arx: number, ary: number,
  bx: number, by: number, brx: number, bry: number,
): { ux: number; uy: number; overlap: number } {
  let dx = ax - bx;
  let dy = ay - by;
  let dist = Math.hypot(dx, dy);
  if (dist < 1e-6) {
    // Degenerate: exactly coincident centres. Pick a direction rather than
    // divide by zero — arbitrary, but this pose has no natural axis anyway.
    dx = 0;
    dy = -1;
    dist = 1;
  }
  const ux = dx / dist;
  const uy = dy / dist;
  const overlap = Math.max(0, radiusAlong(arx, ary, ux, uy) + radiusAlong(brx, bry, ux, uy) - dist);
  return { ux, uy, overlap };
}

/** Player vs. one obstacle: the player always bounces; what the obstacle
 *  does depends on its own kind (spec §2.1's table). */
function resolvePlayerHit(
  px: number, py: number, o: LiveObstacle, clockMs: number,
): { px: number; py: number; bounce: BounceState; obstacle: LiveObstacle } {
  const { ux, uy, overlap } = bounceAxis(px, py, CROWD_PERSON_RX, CROWD_PERSON_RY, o.x, o.y, o.rx, o.ry);
  // A tree never gives ground, so the player alone is pushed clear.
  const playerShare = o.kind === 'tree' ? overlap : overlap / 2;
  const obstacleShare = overlap - playerShare;

  const bounce: BounceState = { until: clockMs + CROWD_BOUNCE_MS, vx: ux * CROWD_BOUNCE_IMPULSE, vy: uy * CROWD_BOUNCE_IMPULSE };
  let obstacle = o;
  if (o.kind === 'pedestrian') {
    obstacle = clampObstacleX({ ...o, bounce: { until: clockMs + CROWD_BOUNCE_MS, vx: -ux * CROWD_BOUNCE_IMPULSE, vy: -uy * CROWD_BOUNCE_IMPULSE }, x: o.x - ux * obstacleShare, y: o.y - uy * obstacleShare });
  } else if (o.kind === 'bicycle') {
    obstacle = { ...o, stunUntil: clockMs + CROWD_BIKE_STUN_MS };
  }
  return { px: px + ux * playerShare, py: py + uy * playerShare, bounce, obstacle };
}

/** Two obstacles vs. each other — what lets a bounce cascade (spec §2.1):
 *  whichever of the pair is a pedestrian bounces, a bicycle stuns, a tree
 *  never moves and never gives ground either. */
function resolveObstaclePair(a: LiveObstacle, b: LiveObstacle, clockMs: number): [LiveObstacle, LiveObstacle] {
  const { ux, uy, overlap } = bounceAxis(a.x, a.y, a.rx, a.ry, b.x, b.y, b.rx, b.ry);
  const aFixed = a.kind === 'tree';
  const bFixed = b.kind === 'tree';
  const aShare = aFixed ? 0 : bFixed ? overlap : overlap / 2;
  const bShare = overlap - aShare;

  const hit = (body: LiveObstacle, sign: 1 | -1, share: number): LiveObstacle => {
    if (body.kind === 'tree') return body;
    if (body.kind === 'bicycle') return { ...body, stunUntil: clockMs + CROWD_BIKE_STUN_MS };
    return clampObstacleX({
      ...body,
      x: body.x + sign * ux * share,
      y: body.y + sign * uy * share,
      bounce: { until: clockMs + CROWD_BOUNCE_MS, vx: sign * ux * CROWD_BOUNCE_IMPULSE, vy: sign * uy * CROWD_BOUNCE_IMPULSE },
    });
  };

  return [hit(a, 1, aShare), hit(b, -1, bShare)];
}

/**
 * One frame. `tilt` is a raw `deviceorientation` reading; everything else is
 * plain state, so a whole race can be flown here with no DOM at all.
 */
export function step(run: CrowdRun, tilt: { gamma: number | null; beta: number | null }, dtMs: number): CrowdRun {
  if (run.finishedAt !== null) return { ...run, clockMs: run.clockMs + dtMs };

  const clockMs = run.clockMs + dtMs;
  const dtS = dtMs / 1000;

  // 1. Heading: `downVector` unnegated — see the module doc for why the two
  // sign flips (screen-down-is-world-backward, and walking-is-away-from-down)
  // cancel out.
  const down = downVector(tilt.gamma, tilt.beta);
  const mag = Math.hypot(down.x, down.y);
  const heading = mag >= CROWD_MIN_TILT ? { x: down.x / mag, y: down.y / mag } : run.heading;

  // 2. The player.
  let px = run.x;
  let py = run.y;
  let bounce = run.bounce;
  if (bounce && bounce.until > clockMs) {
    px += bounce.vx * dtS;
    py += bounce.vy * dtS;
  } else {
    bounce = null;
    px += heading.x * CROWD_WALK_SPEED * dtS;
    py += heading.y * CROWD_WALK_SPEED * dtS;
  }
  px = clamp(px, CROWD_PERSON_RX, CROWD_STREET_WIDTH - CROWD_PERSON_RX);
  const bestY = Math.max(run.bestY, py);
  py = Math.max(py, bestY - CROWD_SCREEN_HEIGHT);

  // 3. Obstacles: bounce, or stun, or their own dealt course.
  let obstacles = run.obstacles.map((o): LiveObstacle => {
    if (o.bounce && o.bounce.until > clockMs) return clampObstacleX({ ...o, x: o.x + o.bounce.vx * dtS, y: o.y + o.bounce.vy * dtS });
    if (o.stunUntil > clockMs) return o;
    const settled = o.bounce ? { ...o, bounce: null } : o;
    if (settled.dir === 0) return settled;
    return { ...settled, y: wrapObstacleY(settled.y + settled.dir * settled.speed * dtS, settled.dir) };
  });

  // 4. Player vs. obstacles — new touches only.
  const touching = new Set<string>();
  for (const o of obstacles) {
    if (!ellipsesOverlap(px, py, CROWD_PERSON_RX, CROWD_PERSON_RY, o.x, o.y, o.rx, o.ry)) continue;
    touching.add(o.id);
    if (run.touching.has(o.id)) continue;
    const hit = resolvePlayerHit(px, py, o, clockMs);
    px = hit.px;
    py = hit.py;
    bounce = hit.bounce;
    obstacles = obstacles.map((o2) => (o2.id === o.id ? hit.obstacle : o2));
  }

  // 5. Obstacles vs. each other — this is the cascade: whatever a bounce (or
  // the crowd's own baseline traffic) carries into a neighbour bounces that
  // one too, spread over as many frames as it actually takes to arrive there
  // rather than resolved as an artificial instant chain.
  const obstacleTouching = new Set<string>();
  for (let i = 0; i < obstacles.length; i++) {
    for (let j = i + 1; j < obstacles.length; j++) {
      const a = obstacles[i] as LiveObstacle;
      const b = obstacles[j] as LiveObstacle;
      if (Math.abs(a.y - b.y) > CROWD_OBSTACLE_SPACING) continue; // cheap reject
      if (!ellipsesOverlap(a.x, a.y, a.rx, a.ry, b.x, b.y, b.rx, b.ry)) continue;
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      obstacleTouching.add(key);
      if (run.obstacleTouching.has(key)) continue;
      const [na, nb] = resolveObstaclePair(a, b, clockMs);
      obstacles[i] = na;
      obstacles[j] = nb;
    }
  }

  const finishedAt = py >= CROWD_COURSE_LENGTH ? clockMs : null;

  return { x: px, y: py, bestY, heading, bounce, obstacles, touching, obstacleTouching, finishedAt, clockMs };
}
