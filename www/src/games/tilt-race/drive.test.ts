import { TILT_UPRIGHT_HEADING, progress, railKeep, spoolFor, startDrive, step, type Drive, type DriveInput } from './drive';
import {
  TILT_CORNER_RATE,
  TILT_CRUISE_SPEED,
  TILT_REVERSE_SPEED,
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
 * distance d is about d² / 2R, and 7.5 s covers ~800 units, so R = 20000 keeps
 * that under 17 units against a half-width of 36. At 6000 — the first guess,
 * sized for a 6 s run — a 7.5 s run drifted 53 units and grazed the rail near
 * the end, so the "above cruise" fixtures were arriving already stopped.
 */
function circleTrack(radius = 20000, steps = 720): Track {
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
const FRAME = 1000 / 60;

/** Run `ms` of driving with a fixed input. */
function drive(car: Drive, input: DriveInput, ms: number, track = TRACK): Drive {
  let out = car;
  for (let t = 0; t < ms; t += FRAME) out = step(track, out, input, FRAME);
  return out;
}

/**
 * An autopilot that keeps the car near the centreline: aim along the track,
 * corrected back toward the middle, and steer hard enough to get there.
 *
 * This is a test instrument, not a game feature, and it earns its place by
 * being the only thing that can answer "is this circuit drivable at all?".
 * Now that the heading is the phone's own rotation, an autopilot is simply a
 * hand: it names the angle it wants the car to point at, and the car points
 * there. That is a much more honest instrument than the old one, which had to
 * guess a gain and hope the turn rate could keep up.
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

  const quarter = Math.PI / 2;
  check('a quarter turn of the wrist is a quarter turn of the car',
    Math.abs(step(CIRCLE, car, { roll: quarter, reverse: false }, 100).heading - (car.base + quarter)) < 1e-12);
  check('and the other way, the other way',
    Math.abs(step(CIRCLE, car, { roll: -quarter, reverse: false }, 100).heading - (car.base - quarter)) < 1e-12);
  check('no rotation holds the heading', step(CIRCLE, car, STRAIGHT, 100).heading === car.heading);

  // The property that makes it "1:1" rather than "proportional": it is an
  // angle, not a rate, so holding still does not keep turning.
  const held = drive(car, { roll: 0.4, reverse: false }, 1_000, CIRCLE);
  check('holding a rotation does not keep turning', Math.abs(held.heading - (car.base + 0.4)) < 1e-12, held.heading - car.base);
  check('and it does not depend on how long the frame was',
    Math.abs(step(CIRCLE, car, { roll: 0.4, reverse: false }, 5).heading
      - step(CIRCLE, car, { roll: 0.4, reverse: false }, 500).heading) < 1e-12);

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
   * The lag settles rather than growing. Held at full tilt the car leaves the
   * road in a fifth of a second and the collision drops it below cruise, which
   * switches the skid off — so the first version of this measured a crash and
   * read a gap of exactly zero. Pinning the car to the centreline each frame
   * isolates the rotational state, which is all this assertion is about:
   * `step` derives `heading` and `drift` from the input and the previous pair,
   * never from the position.
   */
  let held = fast;
  let turned = 0;
  for (let i = 0; i < 120; i++) {
    // A wrist turning steadily at the rate the tightest corner demands, which
    // is the worst case the circuit can actually ask for.
    turned += TILT_CORNER_RATE * (FRAME / 1000);
    held = step(CIRCLE, held, { roll: turned, reverse: false }, FRAME);
    const on = atArc(CIRCLE, held.s);
    held = { ...held, at: { x: on.at.x, y: on.at.y } };
  }
  /*
   * A constant turn rate against a first-order lag settles at `w × t` radians,
   * so this is the product of the two constants rather than a number picked by
   * eye — which is what makes it fail if either is changed alone.
   */
  const gap = Math.abs(held.heading - held.drift);
  const steady = TILT_CORNER_RATE * (TILT_SKID_TAU_MS / 1000);
  check(`the skid settles at w x t = ${steady.toFixed(2)} rad, and it did (${gap.toFixed(2)})`, Math.abs(gap - steady) < 0.05, { gap, steady });
  check(`which is a slide (${((steady * 180) / Math.PI).toFixed(0)} deg), not a spin`, steady < 0.7, steady);
  check('and the car is still at speed, so it really was skidding', held.speed > TILT_CRUISE_SPEED, held.speed);
}

function rails(): void {
  console.log('\nguardrails cost speed (§2)');

  const at = atArc(CIRCLE, CIRCLE.length * 0.5);
  const normal = { x: -at.tangent.y, y: at.tangent.x };
  const fast = drive(startDrive(CIRCLE, CIRCLE.length * 0.5), STRAIGHT, TILT_SPOOL_MS * 2.5, CIRCLE);
  check(`the fixture is up to speed (${fast.speed.toFixed(0)})`, fast.speed > TILT_CRUISE_SPEED, fast.speed);

  /**
   * Step until the car actually touches a rail, and hand back that frame.
   *
   * The first version drove a fixed 400 ms and read the last frame — by which
   * time the car had hit, stopped, and was reporting `none` for every
   * subsequent frame it failed to move on. The second placed it a hair inside
   * the rail and stepped once, which at a shallow angle does not reach the
   * rail at all. What both wanted was this.
   */
  const untilBump = (from: Drive, frames = 30): Drive => {
    let car = from;
    for (let i = 0; i < frames; i++) {
      car = step(CIRCLE, car, STRAIGHT, FRAME);
      if (car.bump !== 'none') return car;
    }
    return car;
  };

  const outward = Math.atan2(normal.y, normal.x);
  const intoWall: Drive = {
    ...fast,
    at: { x: at.at.x + normal.x * TRACK_HALF_WIDTH * 0.9, y: at.at.y + normal.y * TRACK_HALF_WIDTH * 0.9 },
    heading: outward,
    // `base` too, not just `heading`: the heading is derived from it every
    // frame now, so a fixture that set only the heading would be steered
    // straight back onto the track by the next step.
    base: outward,
    drift: outward,
  };
  const hit = untilBump(intoWall);
  check('a square-on hit is reported as head-on', hit.bump === 'head-on', hit.bump);
  check('and leaves nothing at all', hit.speed === 0, hit.speed);
  check('and winds the spool back to the start', hit.runMs === 0);
  check('the car is still on the road', locate(CIRCLE, hit.at, hit.index).offset <= TRACK_HALF_WIDTH + 1e-6);

  /*
   * The curve itself, at the two points it was specified by: square on to the
   * rail keeps nothing, forty-five degrees keeps half. `railKeep` takes the
   * fraction of the momentum pointing ACROSS the track, so square-on is 1 and
   * a 45-degree approach is cos 45.
   */
  check('square on to the rail keeps nothing', railKeep(1) === 0);
  check('forty-five degrees keeps exactly half', Math.abs(railKeep(Math.cos(Math.PI / 4)) - 0.5) < 1e-12, railKeep(Math.cos(Math.PI / 4)));
  check('and a pure graze keeps everything, on impact', railKeep(0) === 1);
  check('it only ever falls as the hit squares up', (() => {
    for (let i = 1; i <= 40; i++) if (railKeep(i / 40) > railKeep((i - 1) / 40)) return false;
    return true;
  })());

  // A shallow approach: mostly along the track, a little across it.
  const alongAngle = Math.atan2(at.tangent.y, at.tangent.x);
  const shallow = alongAngle + 0.3;
  const grazing: Drive = {
    ...fast,
    at: { x: at.at.x + normal.x * TRACK_HALF_WIDTH * 0.9, y: at.at.y + normal.y * TRACK_HALF_WIDTH * 0.9 },
    heading: shallow,
    base: shallow,
    drift: shallow,
  };
  const scraped = untilBump(grazing);
  check(`a glancing hit is reported as a graze (${scraped.bump})`, scraped.bump === 'graze', scraped.bump);
  // sin(0.3) of the momentum is across the rail, so the impact alone keeps
  // 1 - sin^2 = cos^2(0.3) ≈ 91%. What actually takes the speed off a shallow
  // hit is the scrape, one frame of which is TILT_SCRAPE_DECEL * dt.
  const impactOnly = grazing.speed * railKeep(Math.abs(Math.sin(0.3)));
  const oneFrameOfScrape = TILT_SCRAPE_DECEL * (FRAME / 1000);
  check('the impact itself barely touches it', Math.abs(impactOnly - grazing.speed * 0.91) < grazing.speed * 0.02, { impactOnly, before: grazing.speed });
  check(`and the scrape is what costs, ${oneFrameOfScrape.toFixed(0)} per frame of contact`, scraped.speed < impactOnly - oneFrameOfScrape * 0.5, { after: scraped.speed, impactOnly });
  check('rather than stopping the car dead', scraped.speed > grazing.speed * 0.2, scraped.speed);
  check('and it keeps its place on the track rather than sticking', locate(CIRCLE, scraped.at, scraped.index).offset <= TRACK_HALF_WIDTH + 1e-6);

  /*
   * The scrape is a rate, not a one-off — which is the whole difference between
   * a wall you bounce off and a wall you must not ride. Held against the rail,
   * the speed keeps falling frame after frame.
   */
  let riding = scraped;
  const trail: number[] = [riding.speed];
  for (let i = 0; i < 20 && riding.bump !== 'none'; i++) {
    riding = step(CIRCLE, riding, { roll: riding.heading - riding.base, reverse: false }, FRAME);
    trail.push(riding.speed);
  }
  check(`riding the rail keeps costing (${trail[0]?.toFixed(0)} → ${riding.speed.toFixed(0)})`, riding.speed < (trail[0] ?? 0), trail.map((v) => Math.round(v)));
  check('and the scrape beats the spool, or a wall would be a free guide', TILT_SCRAPE_DECEL > TILT_CRUISE_SPEED, TILT_SCRAPE_DECEL);

  check('a clean lap step reports no bump', drive(startDrive(CIRCLE), STRAIGHT, 200, CIRCLE).bump === 'none');
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

  // Put a car just past the line with a lap already banked, then back it up
  // over the line: the lap must come back off rather than counting twice.
  let car = startDrive(TRACK, TRACK.length * 0.02);
  car = { ...car, lap: 1 };
  const backed = drive(car, { roll: 0, reverse: true }, 3_000);
  check('backing over the line takes the lap back off', backed.lap <= 1, backed.lap);
  const forward = drive(backed, STRAIGHT, 4_000);
  check('and driving forward over it again re-earns it, not double-counts', forward.lap <= 1 + 1, forward.lap);
}

theTrack();
spooling();
steering();
skidding();
rails();
reversing();
aWholeLap();
reversingOverTheLine();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
