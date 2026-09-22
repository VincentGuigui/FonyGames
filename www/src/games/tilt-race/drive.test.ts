import type { Point } from '../../../../shared/tiltTrack';
import {
  CAR_END_RADIUS,
  TILT_UPRIGHT_HEADING,
  carContact,
  carEnds,
  endContact,
  carFits,
  progress,
  skidToward,
  spoolFor,
  startDrive,
  step,
  type Drive,
  type DriveInput,
} from './drive';
import {
  TILT_ALIGN_MAX,
  TILT_ALIGN_RELAX_MS,
  TILT_CAR_LENGTH,
  TILT_CAR_WIDTH,
  TILT_WHEELBASE,
  TILT_CORNER_RATE,
  TILT_CRUISE_SPEED,
  TILT_RAIL_CRAWL,
  TILT_RAIL_DRIVE,
  TILT_REVERSE_SPEED,
  TILT_SCRAPE_ALIGNED,
  TILT_SCRAPE_DECEL,
  TILT_SKID_TAU_MS,
  TILT_SPOOL_MS,
  TILT_TOP_SPEED,
  tiltSpeedAt,
} from '../../../../shared/protocol';
import { TRACK_HALF_WIDTH, atArc, locate, rollTrack, type Track } from '../../../../shared/tiltTrack';

/**
 * Tilt Race's car.
 * Spec: docs/specs/games/tilt-race.md §2, §2.1, §2.2
 *
 * The circuit is `shared/tiltTrack.test.ts`'s business. What this pins is the
 * driving, and specifically the four rules the issue actually states — because
 * each one is a number that decides whether the game is fun, and each one is
 * silently wrong if it is applied in the wrong order:
 *
 * - **forward is automatic** and spools 0 → cruise → top;
 * - **the heading is the phone's own rotation, 1:1** — no gain, no rate;
 * - **above cruise the car skids**, so the momentum lags the heading;
 * - **a rail costs what the angle of the hit says**, then keeps costing while
 *   the car is against it;
 * - **reverse** backs out of a mistake.
 *
 * Plus the thing that would be invisible until somebody played a whole race:
 * that a car driven round the circuit actually gets round it, and its lap
 * counter goes up exactly once.
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

function seeded(seed: number): () => number {
  let h = seed >>> 0;
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 4294967296;
  };
}

const TRACK = rollTrack(seeded(11)) as Track;

/**
 * A wide circle, built by hand.
 *
 * The spool, skid and rail rules have to be tested with a *known* input, and a
 * rolled circuit is the wrong instrument for that: it has a corner every tile,
 * so "drive with zero tilt for three seconds" runs straight into a rail and
 * measures the rail rather than the spool. That is correct behaviour, and it
 * is exactly why it cannot be the fixture.
 *
 * The radius is chosen so a car going straight stays on the road for the
 * longest run any test here does: the drift off a circle of radius R after
 * distance d is about d² / 2R, and 7.5 s covers ~1200 units.
 *
 * **Sized up once the car became a body rather than a point.** At R = 20000
 * that drift is ~36 units, which a point car got away with against a
 * half-width of 36 and a 31-wide car does not: half the body plus its corner
 * rounding is already 18 of the 36, so the spool and skid fixtures arrived at
 * the rail part-way through and were measuring a scrape instead of the curve
 * they exist to measure. R = 200000 puts the drift back under 4 units and
 * leaves the straight genuinely straight.
 */
function circleTrack(radius = 200000, steps = 720): Track {
  const points = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    points.push({ x: radius + Math.cos(a) * radius, y: radius + Math.sin(a) * radius });
  }
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as { x: number; y: number };
    const b = points[i] as { x: number; y: number };
    cum.push((cum[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const first = points[0] as { x: number; y: number };
  const last = points[points.length - 1] as { x: number; y: number };
  const length = (cum[cum.length - 1] as number) + Math.hypot(first.x - last.x, first.y - last.y);
  return { points, cum, length, cells: [] };
}

const CIRCLE = circleTrack();
const STRAIGHT: DriveInput = { roll: 0, reverse: false };

/** Which end leads: the nose going forwards, the tail in reverse. */
function leadIsForward(d: Drive): boolean {
  return d.speed >= 0;
}

/** Shortest signed angle from `a` to `b` — `drive.ts` keeps its own copy private. */
function angleDeltaT(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
const FRAME = 1000 / 60;

/** Run `ms` of driving with a fixed input. */
function drive(car: Drive, input: DriveInput, ms: number, track = TRACK): Drive {
  let out = car;
  for (let t = 0; t < ms; t += FRAME) out = step(track, out, input, FRAME);
  return out;
}

/**
 * Run `ms` with the wheel held along the road, forwards or in reverse.
 *
 * The lap tests need a car that actually covers track, and `roll: 0` points up
 * the fixed map rather than down the road — from the start line that drives
 * into a rail within a few frames, which makes the distance covered a fact
 * about the guardrail model rather than about the lap counter. Following the
 * tangent keeps them measuring the thing they name.
 */
function alongTrack(car: Drive, ms: number, reverse: boolean, track = TRACK): Drive {
  let out = car;
  for (let t = 0; t < ms; t += FRAME) {
    const found = locate(track, out.at, out.index);
    const roll = Math.atan2(found.tangent.y, found.tangent.x) - out.base;
    out = step(track, out, { roll, reverse }, FRAME);
  }
  return out;
}

/**
 * An autopilot that keeps the car near the centreline: aim along the track,
 * corrected back toward the middle, and steer hard enough to get there.
 *
 * This is a test instrument, not a game feature, and it earns its place by
 * being the only thing that can answer "is this circuit drivable at all?".
 * The heading is the phone's own rotation, so an autopilot is simply a hand:
 * it names the angle it wants the car to point at, and the car points there.
 * No gain to guess, and no turn rate to hope keeps up.
 */
function autopilot(track: Track, car: Drive): DriveInput {
  const found = locate(track, car.at, car.index);
  const normal = { x: -found.tangent.y, y: found.tangent.x };
  // Which side of the centreline, and how far: positive is toward `normal`.
  const side = (car.at.x - found.nearest.x) * normal.x + (car.at.y - found.nearest.y) * normal.y;
  const along = Math.atan2(found.tangent.y, found.tangent.x);
  // Aim across the track proportionally to how far off centre we are, capped
  // so a car on the rail does not try to drive straight at the far one.
  const correction = Math.max(-0.7, Math.min(0.7, -side / (TRACK_HALF_WIDTH * 1.5)));
  const want = along + correction;
  // The roll a wrist would be holding to point the car there: heading is
  // `base + roll`, so the roll it needs is the difference.
  return { roll: want - car.base, reverse: false };
}

function theTrack(): void {
  console.log('\na circuit to drive on');
  check('rolled', !!TRACK && TRACK.points.length > 12);
  check('with a lap length', TRACK.length > 0);
}

function spooling(): void {
  console.log('\nforward is automatic (§2)');

  const car = startDrive(CIRCLE);
  check('a car starts stopped', car.speed === 0);
  check('on the start line', car.s === 0 && car.lap === 0);
  check('pointing up the fixed map, as if the phone were upright', Math.abs(car.heading - car.drift) < 1e-9);

  const spooled = drive(car, STRAIGHT, TILT_SPOOL_MS, CIRCLE);
  check(`after ${TILT_SPOOL_MS} ms it is about at cruise (${spooled.speed.toFixed(0)})`, Math.abs(spooled.speed - TILT_CRUISE_SPEED) < TILT_CRUISE_SPEED * 0.15, spooled.speed);

  const topped = drive(car, STRAIGHT, TILT_SPOOL_MS * 2.5, CIRCLE);
  check(`and after ${TILT_SPOOL_MS * 2} ms at top speed (${topped.speed.toFixed(0)})`, Math.abs(topped.speed - TILT_TOP_SPEED) < 2, topped.speed);
  check('never past it', drive(car, STRAIGHT, 20_000, CIRCLE).speed <= TILT_TOP_SPEED + 1e-6);

  check('the curve is monotonic', tiltSpeedAt(500) < tiltSpeedAt(2_000) && tiltSpeedAt(2_000) < tiltSpeedAt(4_000));
  check('and spoolFor inverts it', Math.abs(tiltSpeedAt(spoolFor(80)) - 80) < 1);
  check('spoolFor of nothing is the start', spoolFor(0) === 0 && spoolFor(-5) === 0);
}

function steering(): void {
  console.log('\nthe heading is the phone\'s own rotation, 1:1 (§2.1)');

  const car = startDrive(CIRCLE);
  check('a car starts at TILT_UPRIGHT_HEADING, with the roll at zero', car.base === car.heading && car.base === TILT_UPRIGHT_HEADING);

  /*
   * Stated as `heading - align`, because a rail is now allowed to turn the car
   * (§2.3) and `align` is exactly how much it has. Take that back off and the
   * wrist's own promise is untouched: the phone sets the heading, one for one,
   * and nothing else ever adds to it.
   */
  const quarter = Math.PI / 2;
  const wristOf = (d: Drive): number => d.heading - d.align;
  check('a quarter turn of the wrist is a quarter turn of the car',
    Math.abs(wristOf(step(CIRCLE, car, { roll: quarter, reverse: false }, 100)) - (car.base + quarter)) < 1e-12);
  check('and the other way, the other way',
    Math.abs(wristOf(step(CIRCLE, car, { roll: -quarter, reverse: false }, 100)) - (car.base - quarter)) < 1e-12);
  check('no rotation holds the heading', step(CIRCLE, car, STRAIGHT, 100).heading === car.heading);

  // The property that makes it "1:1" rather than "proportional": it is an
  // angle, not a rate, so holding still does not keep turning.
  const held = drive(car, { roll: 0.4, reverse: false }, 1_000, CIRCLE);
  check('holding a rotation does not keep turning', Math.abs(wristOf(held) - (car.base + 0.4)) < 1e-12, wristOf(held) - car.base);
  check('and it does not depend on how long the frame was',
    Math.abs(wristOf(step(CIRCLE, car, { roll: 0.4, reverse: false }, 5))
      - wristOf(step(CIRCLE, car, { roll: 0.4, reverse: false }, 500))) < 1e-12);

  // All the way round, which is the point of the control: the wrist can go
  // further than a gamma reading ever could, and the car goes with it.
  for (const turns of [1, 2, -3]) {
    const round = step(CIRCLE, car, { roll: turns * Math.PI * 2, reverse: false }, 100);
    check(`  ${turns} whole turns of the wrist is ${turns} whole turns of the car`,
      Math.abs(round.heading - (car.base + turns * Math.PI * 2)) < 1e-12);
  }

  check('the circuit never asks for more than a wrist can do', TILT_CORNER_RATE < 4, TILT_CORNER_RATE);
}

function skidding(): void {
  console.log('\nabove cruise the car skids (§2.2)');

  // Below cruise the momentum IS the heading: the world turns exactly as far
  // as the tilt says.
  const slow = drive(startDrive(CIRCLE), STRAIGHT, 1_000, CIRCLE);
  check(`below cruise (${slow.speed.toFixed(0)}) there is no skid`, Math.abs(slow.speed) <= TILT_CRUISE_SPEED && Math.abs(slow.heading - slow.drift) < 1e-9);
  const turnedSlow = step(CIRCLE, slow, { roll: 0.3, reverse: false }, FRAME);
  check('so a turn moves the momentum with it', Math.abs(turnedSlow.heading - turnedSlow.drift) < 1e-9);

  // Above it, the momentum lags — the car keeps some of its old direction.
  const fast = drive(startDrive(CIRCLE), STRAIGHT, TILT_SPOOL_MS * 2.5, CIRCLE);
  check(`above cruise (${fast.speed.toFixed(0)})`, fast.speed > TILT_CRUISE_SPEED);
  const turnedFast = step(CIRCLE, fast, { roll: 0.3, reverse: false }, FRAME);
  check('a turn leaves the momentum behind', Math.abs(turnedFast.heading - turnedFast.drift) > 1e-6, {
    heading: turnedFast.heading,
    drift: turnedFast.drift,
  });
  check('but it does follow, rather than sticking', Math.abs(turnedFast.drift - fast.drift) > 0);

  /*
   * The lag settles rather than growing — measured on the filter itself
   * (`skidToward`), not by driving.
   *
   * A wrist turning steadily through every angle is exactly what a body 70
   * long cannot do on a road 72 wide: past ~0.9 rad across it the car is
   * wedged between both rails, so a driven version of this measures the
   * collision rather than the lag (it read a gap of 7.2 rad, the drift held
   * on a rail while the heading span). Nothing about the lag depends on the
   * track, so this tests it without one.
   */
  let drift = 0;
  let heading = 0;
  for (let i = 0; i < 300; i++) {
    // A wrist turning steadily at the rate the tightest corner demands, which
    // is the worst case the circuit can actually ask for.
    heading += TILT_CORNER_RATE * (FRAME / 1000);
    drift = skidToward(drift, heading, FRAME);
  }
  /*
   * A constant turn rate against a first-order lag settles at `w × t` radians,
   * so this is the product of the two constants rather than a number picked by
   * eye — which is what makes it fail if either is changed alone.
   */
  const gap = Math.abs(heading - drift);
  const steady = TILT_CORNER_RATE * (TILT_SKID_TAU_MS / 1000);
  check(`the skid settles at w x t = ${steady.toFixed(2)} rad, and it did (${gap.toFixed(2)})`, Math.abs(gap - steady) < 0.05, { gap, steady });
  check(`which is a slide (${((steady * 180) / Math.PI).toFixed(0)} deg), not a spin`, steady < 0.7, steady);
  check('a still wrist lets the momentum catch all the way up', Math.abs(skidToward(0.4, 0, 10_000)) < 1e-6, skidToward(0.4, 0, 10_000));
  check('and it only ever closes the gap, never overshoots it', (() => {
    let d = 0;
    for (let i = 0; i < 200; i++) {
      const stepped = skidToward(d, 1, FRAME);
      if (stepped < d || stepped > 1) return false;
      d = stepped;
    }
    return Math.abs(d - 1) < 0.01;
  })());
}

/** The circle's own geometry at the fixture point, for the rail tests. */
const RAIL_AT = atArc(CIRCLE, CIRCLE.length * 0.5);
const RAIL_NORMAL = { x: -RAIL_AT.tangent.y, y: RAIL_AT.tangent.x };
const RAIL_ALONG = Math.atan2(RAIL_AT.tangent.y, RAIL_AT.tangent.x);

/**
 * A car up to speed, on the centreline, pointed `angle` radians off the rail's
 * own direction — and `base` set to match, because the heading is derived from
 * `base + roll` every frame, so a fixture that set only `heading` would be
 * steered straight again by the next step.
 *
 * On the centreline rather than a hair off the rail: a body 31 units wide
 * placed at 0.9 of the half-width is already through the rail before the test
 * starts. Aiming it across the road and letting it drive in is the honest way
 * to stage a hit.
 */
function aimedAt(angle: number, speed?: number): Drive {
  const fast = drive(startDrive(CIRCLE, CIRCLE.length * 0.5), STRAIGHT, TILT_SPOOL_MS * 2.5, CIRCLE);
  const heading = RAIL_ALONG + angle;
  return {
    ...fast,
    at: { x: RAIL_AT.at.x, y: RAIL_AT.at.y },
    heading,
    base: heading,
    drift: heading,
    speed: speed ?? fast.speed,
  };
}

/**
 * Step until the body actually touches a rail, and hand back that frame **and
 * the one before it** — the speed a hit costs can only be read against what
 * the car was carrying the instant before it, not against the fixture's
 * opening speed, because it keeps spooling on the way to the wall.
 */
function untilBump(from: Drive, frames = 120): { hit: Drive; before: Drive } {
  let car = from;
  for (let i = 0; i < frames; i++) {
    const next = step(CIRCLE, car, { roll: car.heading - car.base, reverse: false }, FRAME);
    if (next.bump !== 'none') return { hit: next, before: car };
    car = next;
  }
  return { hit: car, before: car };
}

/**
 * The steepest angle across the road a body this long can actually be held at.
 *
 * Solved rather than guessed: a box of half-extents `l` and `w` turned `θ` off
 * the road reaches `l·sinθ + w·cosθ` across it, and that plus the corner
 * radius has to fit inside `TRACK_HALF_WIDTH`. Past it there is NO position on
 * the road that holds the car — it is touching both rails at once.
 */
const WEDGE_ANGLE = (() => {
  // A capsule turned θ off the road reaches `halfWheelbase·sinθ + radius`
  // across it, and that has to fit inside `TRACK_HALF_WIDTH`.
  const room = TRACK_HALF_WIDTH - CAR_END_RADIUS;
  const reach = TILT_WHEELBASE / 2;
  const ratio = room / reach;
  return ratio >= 1 ? Math.PI / 2 : Math.asin(ratio);
})();

function theBody(): void {
  console.log('\nthe car is two points, not a box round its centre (§2.3)');

  const [front, rear] = carEnds({ x: 0, y: 0 }, 0);
  check('a pose has a front and a rear', !!front && !!rear);
  // Heading 0 is +x, so the two points are separated along x.
  check(
    `they sit a wheelbase apart (${Math.hypot(front.x - rear.x, front.y - rear.y).toFixed(1)})`,
    Math.abs(Math.hypot(front.x - rear.x, front.y - rear.y) - TILT_WHEELBASE) < 1e-9,
  );
  check('and the front one is the one in front', front.x > rear.x);
  check(
    `each carries half the car's width (${CAR_END_RADIUS.toFixed(1)})`,
    Math.abs(CAR_END_RADIUS - TILT_CAR_WIDTH / 2) < 1e-9,
  );
  /*
   * The capsule the two points describe is the drawn body: wheelbase plus a
   * radius at each end is the sprite's own length, and twice the radius is its
   * width. That is the whole reason the wheelbase is `LENGTH - WIDTH`.
   */
  check(
    `the capsule is exactly the drawn body (${(TILT_WHEELBASE + 2 * CAR_END_RADIUS).toFixed(0)} x ${(2 * CAR_END_RADIUS).toFixed(0)})`,
    Math.abs(TILT_WHEELBASE + 2 * CAR_END_RADIUS - TILT_CAR_LENGTH) < 1e-9 &&
      Math.abs(2 * CAR_END_RADIUS - TILT_CAR_WIDTH) < 1e-9,
  );
  check('and it is longer than it is wide, like the sprite', TILT_CAR_LENGTH > TILT_CAR_WIDTH);

  // A car on the centreline is on the road; one shoved sideways is not.
  const onLine = { x: RAIL_AT.at.x, y: RAIL_AT.at.y };
  check('a car on the centreline fits', carFits(CIRCLE, onLine, RAIL_ALONG));
  const shoved = {
    x: onLine.x + RAIL_NORMAL.x * (TRACK_HALF_WIDTH - 2),
    y: onLine.y + RAIL_NORMAL.y * (TRACK_HALF_WIDTH - 2),
  };
  check('a car shoved onto the rail does not', !carFits(CIRCLE, shoved, RAIL_ALONG));

  // Each end is measured on its own — that is what makes "which end hit"
  // answerable at all.
  const [f2, r2] = carEnds(shoved, RAIL_ALONG);
  const fc = endContact(CIRCLE, f2);
  const rc = endContact(CIRCLE, r2);
  check(
    `both ends are measured separately (front ${fc.depth.toFixed(1)}, rear ${rc.depth.toFixed(1)} deep)`,
    Number.isFinite(fc.depth) && Number.isFinite(rc.depth),
    { front: fc.depth, rear: rc.depth },
  );
  check('and the inward normal is a unit vector', Math.abs(Math.hypot(fc.inward.x, fc.inward.y) - 1) < 1e-9);
}

/**
 * Steering swings the FRONT of the car about the back of it, not the whole body
 * about its middle (spec §2.3).
 */
function thePivot(): void {
  console.log('\nthe car turns about the end that is not leading (§2.3)');

  const start = startDrive(TRACK);
  const [f0, r0] = carEnds(start.at, start.heading);

  // One frame of a turned wrist, driving forwards.
  const turned = step(TRACK, { ...start, speed: 60, runMs: 4_000 }, { roll: 0.5, reverse: false }, 1);
  const [f1, r1] = carEnds(turned.at, turned.heading);
  const rearMoved = Math.hypot(r1.x - r0.x, r1.y - r0.y);
  const frontMoved = Math.hypot(f1.x - f0.x, f1.y - f0.y);
  check(
    `going forwards the front swings and the rear holds (front ${frontMoved.toFixed(1)}, rear ${rearMoved.toFixed(1)})`,
    frontMoved > rearMoved * 2,
    { frontMoved, rearMoved },
  );

  // And the other way round in reverse: back a car up and the tail is what
  // swings out.
  const backing = { ...start, speed: -TILT_REVERSE_SPEED };
  const [f2, r2] = carEnds(backing.at, backing.heading);
  const backed = step(TRACK, backing, { roll: 0.5, reverse: true }, 1);
  const [f3, r3] = carEnds(backed.at, backed.heading);
  check(
    `reversing the rear swings and the front holds (front ${Math.hypot(f3.x - f2.x, f3.y - f2.y).toFixed(1)}, rear ${Math.hypot(r3.x - r2.x, r3.y - r2.y).toFixed(1)})`,
    Math.hypot(r3.x - r2.x, r3.y - r2.y) > Math.hypot(f3.x - f2.x, f3.y - f2.y) * 2,
  );
}

function rails(): void {
  console.log('\nguardrails turn the car, they do not stop it (§2)');

  const fast = aimedAt(0);
  check(`the fixture is up to speed (${fast.speed.toFixed(0)})`, fast.speed > TILT_CRUISE_SPEED, fast.speed);
  check('a clean step reports no bump', drive(startDrive(CIRCLE), STRAIGHT, 200, CIRCLE).bump === 'none');

  /*
   * The rule, at a spread of angles: what a hit costs is what was going across
   * the rail, and what it keeps is what was already going along it. So the
   * speed kept should track |cos| of the approach angle, with no separate
   * impact penalty on top — that is what stops a car dead.
   */
  for (const angle of [0.2, 0.4, 0.6, 0.8]) {
    const { hit, before } = untilBump(aimedAt(angle));
    const oneFrameOfScrape = TILT_SCRAPE_DECEL * (FRAME / 1000);
    const oneFrameOfPush = TILT_RAIL_DRIVE * (FRAME / 1000);
    // What the projection alone keeps, give or take the frame of scrape and
    // the frame of rear-wheel push that land in the same step.
    const kept = Math.abs(Math.cos(angle)) * before.speed;
    check(
      `a ${angle.toFixed(1)} rad hit keeps about what runs along the rail (${hit.speed.toFixed(0)} of ${kept.toFixed(0)})`,
      hit.bump !== 'none' && Math.abs(hit.speed - kept) < oneFrameOfScrape + oneFrameOfPush + 1,
      { angle, after: hit.speed, kept, before: before.speed },
    );
    check(`  and it is still moving afterwards, not stopped`, hit.speed > 0, hit.speed);
    const gapToTangent = Math.abs(Math.sin(hit.drift - RAIL_ALONG));
    check(`  with its momentum turned along the rail (gap ${gapToTangent.toFixed(3)} rad)`, gapToTangent < 0.05, hit.drift);
  }

  const shallow = untilBump(aimedAt(0.3)).hit;
  check(`a glancing hit is a graze (${shallow.bump})`, shallow.bump === 'graze', shallow.bump);
  check('and it costs little', shallow.speed > fast.speed * 0.8, { after: shallow.speed, before: fast.speed });

  const square = untilBump(aimedAt(Math.PI / 2 - 0.05)).hit;
  check(`a square-on hit is head-on (${square.bump})`, square.bump === 'head-on', square.bump);
  check('and that one really does take everything, since nothing was going along the rail', square.speed < fast.speed * 0.1, square.speed);

  // The body ends up on the road after any hit it is geometrically able to.
  check('the car is left on the road after a graze', carFits(CIRCLE, shallow.at, shallow.heading), carContact(CIRCLE, shallow.at, shallow.heading).clearance);

  /*
   * The scrape is a rate, not a one-off — the whole difference between a wall
   * you bounce off and a wall you must not ride. Held against the rail at a
   * shallow angle, where the rear wheels ARE pushing along it, friction still
   * has to win or wall-riding would be free.
   */
  let riding = shallow;
  const trail: number[] = [riding.speed];
  for (let i = 0; i < 30 && riding.bump !== 'none'; i++) {
    riding = step(CIRCLE, riding, { roll: riding.heading - riding.base, reverse: false }, FRAME);
    trail.push(riding.speed);
  }
  check(
    `riding the rail keeps costing (${trail[0]?.toFixed(0)} → ${riding.speed.toFixed(0)})`,
    riding.speed < (trail[0] ?? 0),
    trail.map((v) => Math.round(v)),
  );
  /*
   * What replaced "the scrape must beat the spool". The scrape is now scaled
   * by the angle, so what has to hold is that being sideways on a wall costs
   * real speed and being square with it costs much less — with neither end of
   * that free. The speed cost of wall-riding is deliberately small now; what
   * keeps it a bad line is the geometry, not the friction (spec §2.3, §12 Q13).
   */
  const broadside = TILT_SCRAPE_DECEL;
  const parallel = TILT_SCRAPE_DECEL * TILT_SCRAPE_ALIGNED;
  check(
    `sideways on a rail costs several times what parallel does (${broadside.toFixed(0)} vs ${parallel.toFixed(0)})`,
    broadside > parallel * 3,
    { broadside, parallel },
  );
  check('and parallel is not free either', parallel > 0, parallel);
}

/**
 * The rear wheels do not just shove the car along the rail, they TURN it onto
 * it — the half of the slide that was missing (spec §2.3).
 *
 * The wrist is held at one fixed roll throughout, which is what makes `align`
 * readable on its own: anything the heading does beyond that fixed roll is the
 * rail's doing and nothing else's.
 */
function aligning(): void {
  console.log('\nthe rear wheels square the car up with the rail (§2.3)');

  const hit = untilBump(aimedAt(0.8)).hit;
  const heldRoll = hit.heading - hit.base - hit.align;
  check(`the fixture is against a rail at an angle (align ${hit.align.toFixed(2)})`, hit.bump !== 'none', hit.bump);

  const gapAt = (car: Drive): number => Math.abs(Math.sin(car.heading - RAIL_ALONG));
  let car = hit;
  const opening = gapAt(car);
  const aligns: number[] = [];
  for (let i = 0; i < 60; i++) {
    car = step(CIRCLE, car, { roll: heldRoll, reverse: false }, FRAME);
    aligns.push(car.align);
  }
  check(
    `a second of contact swings the nose onto the rail (gap ${opening.toFixed(2)} → ${gapAt(car).toFixed(2)})`,
    gapAt(car) < opening,
    { opening, closed: gapAt(car), aligns: aligns.filter((_, i) => i % 10 === 0).map((v) => Number(v.toFixed(3))) },
  );
  check(
    `it is the rail doing it, not the wrist (align ${car.align.toFixed(2)} rad, roll fixed)`,
    Math.abs(car.align) > 0.05,
    car.align,
  );

  /*
   * Issue #42: it must square up by bringing the TAIL to the wall, not by
   * swinging the nose off it. Nose-out leaves the car angled away and never
   * actually sliding, which is what the bug reported.
   */
  const clearOf = (end: Point): number => -endContact(CIRCLE, end).depth;
  const [noseBefore, tailBefore] = carEnds(hit.at, hit.heading);
  const [noseAfter, tailAfter] = carEnds(car.at, car.heading);
  const leadBefore = leadIsForward(hit) ? noseBefore : tailBefore;
  const leadAfter = leadIsForward(car) ? noseAfter : tailAfter;
  const tailGapBefore = clearOf(leadIsForward(hit) ? tailBefore : noseBefore);
  const tailGapAfter = clearOf(leadIsForward(car) ? tailAfter : noseAfter);
  check(
    `the trailing end comes IN to the wall (clearance ${tailGapBefore.toFixed(1)} → ${tailGapAfter.toFixed(1)})`,
    tailGapAfter < tailGapBefore,
    { before: tailGapBefore, after: tailGapAfter },
  );
  check(
    `while the touching end stays on it (${clearOf(leadBefore).toFixed(1)} → ${clearOf(leadAfter).toFixed(1)})`,
    clearOf(leadAfter) < tailGapBefore,
    { lead: clearOf(leadAfter) },
  );
  check(
    `and it is bounded, so the car never leaves the player's hands (|align| ≤ ${TILT_ALIGN_MAX})`,
    aligns.every((a) => Math.abs(a) <= TILT_ALIGN_MAX + 1e-9),
    Math.max(...aligns.map(Math.abs)),
  );

  /*
   * Squaring up is what makes the scrape cheap — that is the whole point of
   * doing it. Same rail, same speed, one car broadside and one running true:
   * the aligned one must keep more.
   */
  const scrapeFor = (gap: number): number =>
    TILT_SCRAPE_DECEL * (TILT_SCRAPE_ALIGNED + (1 - TILT_SCRAPE_ALIGNED) * Math.abs(Math.sin(gap)));
  check(
    `running true costs a fraction of broadside (${scrapeFor(0).toFixed(0)} vs ${scrapeFor(Math.PI / 2).toFixed(0)} u/s²)`,
    scrapeFor(0) * 3 < scrapeFor(Math.PI / 2),
    { aligned: scrapeFor(0), broadside: scrapeFor(Math.PI / 2) },
  );

  /*
   * And the debt is paid back: off the wall the offset bleeds away, so the
   * car comes back under the wrist and the 1:1 promise holds again (§2.1).
   */
  const free: Drive = { ...car, bump: 'none', at: { ...atArc(CIRCLE, car.s).at } };
  let relaxing = free;
  for (let i = 0; i < 30; i++) {
    relaxing = step(CIRCLE, relaxing, { roll: heldRoll, reverse: false }, FRAME);
    if (relaxing.bump !== 'none') break;
  }
  check(
    `off the wall it relaxes back towards the wrist (${car.align.toFixed(2)} → ${relaxing.align.toFixed(2)} rad)`,
    Math.abs(relaxing.align) < Math.abs(car.align),
    { from: car.align, to: relaxing.align, tau: TILT_ALIGN_RELAX_MS },
  );
}


/**
 * Clipping a wall with the end that is NOT being driven into it costs nothing
 * (spec §2.3) — the user-facing half of the two-point body.
 */
function theFreeEnd(): void {
  console.log('\nclipping a wall with the trailing end is free (§2.3)');

  /*
   * A car running along the rail with its TAIL through it and its nose clear.
   * Found by scanning rather than solved, because what matters is that the
   * fixture really is that case — both depths are asserted below.
   */
  const FIXTURE_RUN_MS = TILT_SPOOL_MS * 1.5;
  let fixture: Drive | null = null;
  for (let d = TRACK_HALF_WIDTH - CAR_END_RADIUS; d < TRACK_HALF_WIDTH && !fixture; d += 0.5) {
    for (let theta = -0.6; theta < 0 && !fixture; theta += 0.02) {
      const heading = RAIL_ALONG + theta;
      const at = { x: RAIL_AT.at.x + RAIL_NORMAL.x * d, y: RAIL_AT.at.y + RAIL_NORMAL.y * d };
      const [f, r] = carEnds(at, heading);
      if (endContact(CIRCLE, r).depth > 0.5 && endContact(CIRCLE, f).depth < -0.5) {
        fixture = {
          ...startDrive(CIRCLE), at, heading, drift: heading,
          base: TILT_UPRIGHT_HEADING, align: heading - TILT_UPRIGHT_HEADING,
          // On the curve, not beside it: `step` pulls any speed down to what the
          // spool allows, and a fixture above its own ceiling would lose speed to
          // that rather than to the rail and prove nothing.
          speed: tiltSpeedAt(FIXTURE_RUN_MS), runMs: FIXTURE_RUN_MS,
          index: endContact(CIRCLE, at).found.index,
        };
      }
    }
  }
  if (!fixture) {
    check('a tail-through-the-rail fixture exists', false);
    return;
  }
  const [f0, r0] = carEnds(fixture.at, fixture.heading);
  check(
    `the fixture has its tail through the rail and its nose clear (${endContact(CIRCLE, r0).depth.toFixed(1)} / ${endContact(CIRCLE, f0).depth.toFixed(1)})`,
    endContact(CIRCLE, r0).depth > 0 && endContact(CIRCLE, f0).depth < 0,
  );

  const after = step(CIRCLE, fixture, { roll: fixture.heading - fixture.base - fixture.align, reverse: false }, FRAME);

  /*
   * The rail takes NOTHING. The car is a shade faster afterwards, and that is
   * the spool doing its ordinary job — one frame further up its own curve — so
   * the test is "it did not lose any, and it gained no more than a free car
   * would", which is what "free" actually means here.
   */
  const freeGain = tiltSpeedAt(FIXTURE_RUN_MS + FRAME) - tiltSpeedAt(FIXTURE_RUN_MS);
  check(
    `the rail takes nothing off it (${fixture.speed.toFixed(0)} → ${after.speed.toFixed(2)})`,
    after.speed >= fixture.speed - 1e-9,
    { before: fixture.speed, after: after.speed },
  );
  check(
    `and it gains no more than the spool owes it (+${(after.speed - fixture.speed).toFixed(2)}, free car +${freeGain.toFixed(2)})`,
    after.speed - fixture.speed <= freeGain + 1e-6,
    { gained: after.speed - fixture.speed, freeGain },
  );
  /*
   * The momentum is not snapped onto the rail either, which is what a real hit
   * does. It drifts by the width of one frame of the ordinary skid filter
   * chasing the body's new heading — the same thing it would do on open road.
   */
  check(
    `and its direction of travel, bar one frame of skid (${(angleDeltaT(fixture.drift, after.drift) * 1000).toFixed(1)} mrad)`,
    Math.abs(angleDeltaT(fixture.drift, after.drift)) < 0.02,
    { before: fixture.drift, after: after.drift },
  );
  check('and the spool is untouched, so nothing has to be won back', after.runMs > fixture.runMs);
  check(`no bump is reported for it (${after.bump})`, after.bump === 'none', after.bump);

  // What it DOES do is put the tail back and swing the body round the nose.
  const [f1, r1] = carEnds(after.at, after.heading);
  check(
    `the tail is lifted back onto the road (${endContact(CIRCLE, r1).depth.toFixed(2)} deep now)`,
    endContact(CIRCLE, r1).depth <= 1e-3,
    endContact(CIRCLE, r1).depth,
  );
  check(
    `and it is the tail that moved, not the nose (nose ${Math.hypot(f1.x - f0.x, f1.y - f0.y).toFixed(1)}, tail ${Math.hypot(r1.x - r0.x, r1.y - r0.y).toFixed(1)})`,
    Math.hypot(r1.x - r0.x, r1.y - r0.y) > Math.hypot(f1.x - f0.x, f1.y - f0.y),
  );

  /*
   * The same clip on the LEADING end is not free — that is the contrast the
   * rule only means anything against.
   */
  const nose = untilBump(aimedAt(0.8)).hit;
  check(`driving the nose into the same rail does cost speed (${nose.speed.toFixed(0)})`, nose.bump !== 'none', nose.bump);
}

function rearWheelDrive(): void {
  console.log('\nthe rear wheels keep pushing along the rail (§2)');

  /*
   * The reported bug (#42): a car that stops against a guardrail and stays
   * there. The engine does not stop when the wall arrives — whatever part of
   * its push runs along the rail still moves the car, so a car sitting
   * against a rail at an angle crabs along it instead of sticking.
   */
  const pinned = untilBump(aimedAt(0.8)).hit;
  check('the fixture is against a rail', pinned.bump !== 'none', pinned.bump);

  // Hold the same wheel angle — still aimed at the wall — and let it push.
  let car = pinned;
  const startS = car.s;
  const speeds: number[] = [];
  for (let i = 0; i < 60; i++) {
    car = step(CIRCLE, car, { roll: car.heading - car.base, reverse: false }, FRAME);
    speeds.push(car.speed);
  }
  const travelled = Math.abs(car.s - startS);
  check(
    `held against the rail it keeps moving along it (${travelled.toFixed(0)} units in a second)`,
    travelled > 10,
    { travelled, speeds: speeds.map((v) => Math.round(v)) },
  );
  check('and it never grinds to a standstill', car.speed > 0, car.speed);
  /*
   * It squares up as it goes, so instead of settling to a crawl it works back
   * up its own speed curve. The bound is that the rail cannot push it PAST
   * that curve: a wall can return a car to the speed it was entitled to, never
   * hand it more (spec §2.3).
   */
  check(
    `held against the rail it works back up its curve (${car.speed.toFixed(0)})`,
    car.speed <= tiltSpeedAt(car.runMs) + 1,
    { speed: car.speed, ceiling: tiltSpeedAt(car.runMs) },
  );
  /*
   * The nose ends up nearer the rail than it started. Measured on the HEADING
   * rather than on `align`: this fixture re-reads `roll` from the car every
   * frame, so a wrist that follows the car absorbs the offset and `align`
   * itself stays near zero while the car really has squared up. `aligning()`
   * below holds the wrist still and watches `align` directly.
   */
  const gapBefore = Math.abs(Math.sin(pinned.heading - RAIL_ALONG));
  const gapAfter = Math.abs(Math.sin(car.heading - RAIL_ALONG));
  check(
    `and it has squared up with the rail on the way (${gapBefore.toFixed(2)} → ${gapAfter.toFixed(2)})`,
    gapAfter < gapBefore,
    { gapBefore, gapAfter },
  );
  check(
    `the crawl floor is still slower than reverse, so a pinned nose is the wrong place (${TILT_RAIL_CRAWL})`,
    TILT_RAIL_CRAWL < TILT_REVERSE_SPEED,
    { crawl: TILT_RAIL_CRAWL, reverse: TILT_REVERSE_SPEED },
  );

  /*
   * **The wedge is gone, and that is the two-point body's doing.**
   *
   * The rounded rectangle this replaced stuck its corners out at the diagonal,
   * so past about 53° across the road there was no legal pose at all — the
   * body touched both rails at once and the physics had to keep working in a
   * state with no answer. A capsule is narrower at every angle but head-on:
   * its reach across the road is `halfWheelbase·sinθ + radius`, which tops out
   * at 19.5 + 15.5 = 35 against the 36 the road gives, so a car ON THE
   * CENTRELINE fits sideways and at every angle in between.
   *
   * That is one whole class of edge case deleted rather than handled. A car can
   * still be pinned against a rail — it just always has somewhere legal to be
   * put, which is why `settle` cannot fail.
   */
  check(
    `a capsule fits at every angle on the centreline (worst reach ${(TILT_WHEELBASE / 2 + CAR_END_RADIUS).toFixed(1)} of ${TRACK_HALF_WIDTH})`,
    TILT_WHEELBASE / 2 + CAR_END_RADIUS <= TRACK_HALF_WIDTH,
    { reach: TILT_WHEELBASE / 2 + CAR_END_RADIUS, room: TRACK_HALF_WIDTH },
  );
  check(
    'so square across the road is a legal pose now, not a wedge',
    carFits(CIRCLE, { x: RAIL_AT.at.x, y: RAIL_AT.at.y }, RAIL_ALONG + Math.PI / 2),
  );
  check(`and WEDGE_ANGLE has become the right angle itself (${WEDGE_ANGLE.toFixed(2)})`, Math.abs(WEDGE_ANGLE - Math.PI / 2) < 1e-9, WEDGE_ANGLE);

  // Turned hard across the road and shoved onto a rail, it must still crab
  // along rather than freeze — the reported bug (#42), which the pose being
  // legal does not by itself answer.
  let wedged = untilBump(aimedAt(1.2)).hit;
  const wedgedFrom = wedged.s;
  for (let i = 0; i < 60; i++) wedged = step(CIRCLE, wedged, { roll: wedged.heading - wedged.base, reverse: false }, FRAME);
  check(
    `a car turned hard across the road still crabs along the rail (${Math.abs(wedged.s - wedgedFrom).toFixed(0)} units in a second)`,
    Math.abs(wedged.s - wedgedFrom) > 5,
    { travelled: Math.abs(wedged.s - wedgedFrom), speed: wedged.speed },
  );
  check('rather than stopping dead in it', wedged.speed > 0, wedged.speed);

  /*
   * Nose square into the wall has nothing along the rail to give AT THE MOMENT
   * OF THE HIT, and the rear wheels are what get it out: the push is a torque
   * as well as a shove, so the nose swings off square and the car finds its way
   * along the wall (spec §2.3).
   */
  let stuck = untilBump(aimedAt(Math.PI / 2 - 0.02)).hit;
  /*
   * "Stops" against the entry speed rather than against a flat number: the
   * capsule's round nose meets the rail a shade off square, so a sliver of the
   * momentum is along the rail and survives. A few units out of two hundred is
   * still a car that has stopped.
   */
  const squareFrom = untilBump(aimedAt(Math.PI / 2 - 0.02)).before.speed;
  check(
    `a square hit takes all but a sliver in the frame it lands (${stuck.speed.toFixed(1)} of ${squareFrom.toFixed(0)})`,
    Math.abs(stuck.speed) < squareFrom * 0.05,
    { after: stuck.speed, before: squareFrom },
  );
  const squareAlign = stuck.align;
  for (let i = 0; i < 10; i++) stuck = step(CIRCLE, stuck, { roll: stuck.heading - stuck.base, reverse: false }, FRAME);
  /*
   * And square-on really is the one case with no way out but reverse. The rail
   * turns the car by pushing the touching END sideways, so a nose driven
   * exactly perpendicular into a wall is pushed straight back down its own
   * axis: there is no sideways component, nothing to swing about the tail, and
   * nothing along the rail for the wheels to bite. Off square by any margin at
   * all and the geometry starts turning it out (`aligning()` above, and the
   * hard-across case just before this).
   */
  check(
    `dead square there is nothing to turn it (align ${squareAlign.toFixed(3)} → ${stuck.align.toFixed(3)} rad)`,
    Math.abs(stuck.align) < 0.05,
    { from: squareAlign, to: stuck.align },
  );
  check(`and it is down to a crawl (${stuck.speed.toFixed(1)})`, Math.abs(stuck.speed) < TILT_REVERSE_SPEED, stuck.speed);
  const backedOut = step(CIRCLE, stuck, { roll: stuck.heading - stuck.base, reverse: true }, FRAME);
  check('and reverse is still the way out', backedOut.speed < 0, backedOut.speed);

  /*
   * The reported shape of #42: sliding along the guardrail worked when
   * driving backwards and not when driving forwards. Both directions are the
   * same projection now, so both slide — this measures them side by side
   * rather than trusting that.
   */
  const slideOf = (reverse: boolean): number => {
    let c = untilBump(aimedAt(0.5)).hit;
    const from = c.s;
    for (let i = 0; i < 40; i++) c = step(CIRCLE, c, { roll: c.heading - c.base, reverse }, FRAME);
    return Math.abs(c.s - from);
  };
  const forwards = slideOf(false);
  const backwards = slideOf(true);
  check(`driving forwards into a rail slides along it (${forwards.toFixed(0)} units)`, forwards > 5, forwards);
  check(`and driving backwards does too (${backwards.toFixed(0)} units)`, backwards > 5, backwards);
  check('neither direction is the stuck one', Math.min(forwards, backwards) > 5, { forwards, backwards });

  /*
   * The push is the engine's, so it follows the car's own nose: pointed the
   * other way along the same rail, the car crabs the other way.
   */
  const oneWay = untilBump(aimedAt(0.8)).hit;
  const otherWay = untilBump(aimedAt(Math.PI - 0.8)).hit;
  const alongOne = Math.cos(oneWay.drift) * RAIL_AT.tangent.x + Math.sin(oneWay.drift) * RAIL_AT.tangent.y;
  const alongOther = Math.cos(otherWay.drift) * RAIL_AT.tangent.x + Math.sin(otherWay.drift) * RAIL_AT.tangent.y;
  check(
    'which way it crabs follows the nose, not the wall',
    Math.sign(alongOne) !== Math.sign(alongOther),
    { alongOne, alongOther },
  );
}

function reversing(): void {
  console.log('\nreverse backs out of a mistake (§2)');

  const stuck = drive(startDrive(CIRCLE), STRAIGHT, 2_000, CIRCLE);
  const backing = step(CIRCLE, stuck, { roll: 0, reverse: true }, FRAME);
  check('reverse is a negative speed', backing.speed === -TILT_REVERSE_SPEED);
  check('and it is slow', TILT_REVERSE_SPEED < TILT_CRUISE_SPEED);
  check('it resets the spool', backing.runMs === 0);

  const released = step(CIRCLE, backing, STRAIGHT, FRAME);
  check('releasing it starts the spool again from zero', released.speed >= 0 && released.speed < TILT_CRUISE_SPEED * 0.2, released.speed);
}

function aWholeLap(): void {
  console.log('\na car driven round the circuit gets round it (§2)');

  let car = startDrive(TRACK);
  let bumps = 0;
  let laps = 0;
  const maxSteps = Math.ceil((300_000 / FRAME));
  let steps = 0;
  for (; steps < maxSteps; steps++) {
    car = step(TRACK, car, autopilot(TRACK, car), FRAME);
    if (car.bump !== 'none') bumps++;
    if (car.lap > laps) laps = car.lap;
    if (car.lap >= 1) break;
  }

  check(`the autopilot completed a lap (${((steps * FRAME) / 1000).toFixed(0)}s, ${bumps} rail touches)`, car.lap === 1, { lap: car.lap, steps, bumps });
  check('the lap counter went up exactly once', laps === 1, laps);
  check('and the arc length wrapped to near the start', car.s < TRACK.length * 0.25, car.s);
  check('total progress is a lap and a bit', progress(TRACK, car) > TRACK.length * 0.95);
  check('the car never left the road', locate(TRACK, car.at, car.index).offset <= TRACK_HALF_WIDTH + 1e-6);

  // The lap time is in the right ballpark. Generous bounds — the autopilot is
  // not a good driver, and the point is that it is neither instant nor
  // impossible.
  const secs = (steps * FRAME) / 1000;
  check(`the lap took ${secs.toFixed(0)}s, which is a race rather than a sprint or a slog`, secs > 40 && secs < 300, secs);
}

function reversingOverTheLine(): void {
  console.log('\nthe lap counter cannot be farmed (§8 on the phone side)');

  /*
   * The bug this section exists for, and the one that hid behind it.
   *
   * **Sitting on the line is not a lap.** Every car starts at arc 0, which is
   * the same point as arc `length`, so a plain "did the arc wrap?" test banks a
   * full lap out of the first few units of wobble — a one-lap race over before
   * the flag, and a progress rail riding the referee's cheat clamp instead of
   * the car (spec §8).
   */
  const onTheLine = drive(startDrive(TRACK), { roll: 0, reverse: false }, 1_200);
  check(
    `a car still on the start line has not run a lap (lap ${onTheLine.lap}, ${onTheLine.travelled.toFixed(0)} units covered)`,
    onTheLine.lap === 0,
    { lap: onTheLine.lap, travelled: onTheLine.travelled, s: onTheLine.s },
  );
  // Nudging back and forth across the line is the same story from the other
  // side: arc covered is what counts, and it cancels.
  let jitter = startDrive(TRACK);
  for (let i = 0; i < 20; i++) {
    jitter = alongTrack(jitter, 120, true);
    jitter = alongTrack(jitter, 120, false);
  }
  check(`and nor has one nudged back and forth over it (lap ${jitter.lap})`, jitter.lap === 0, {
    lap: jitter.lap,
    travelled: jitter.travelled,
  });

  // Put a car just past the line with a lap GENUINELY banked — `travelled` is
  // what `lap` is read from, so the fixture has to have covered the distance —
  // then back it up over the line: the lap must come back off, not double up.
  // Just past it, in reach of the reverse: TILT_REVERSE_SPEED over three
  // seconds covers about 135 units.
  const past = 60;
  let car = startDrive(TRACK, past);
  car = { ...car, lap: 1, travelled: TRACK.length + past };
  check('the fixture really has a lap banked', car.lap === 1, car.lap);
  const backed = alongTrack(car, 3_000, true);
  check(`backing over the line takes the lap back off (${backed.lap})`, backed.lap === 0, {
    lap: backed.lap,
    travelled: backed.travelled,
  });
  const forward = alongTrack(backed, 4_000, false);
  check(`and driving forward over it again re-earns it, not double-counts (${forward.lap})`, forward.lap === 1, {
    lap: forward.lap,
    travelled: forward.travelled,
  });
}

theTrack();
spooling();
steering();
skidding();
theBody();
thePivot();
rails();
aligning();
theFreeEnd();
rearWheelDrive();
reversing();
aWholeLap();
reversingOverTheLine();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
