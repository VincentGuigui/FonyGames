import {
  TILT_ALIGN_MAX,
  TILT_ALIGN_RELAX_MS,
  TILT_CAR_CORNER,
  TILT_CAR_LENGTH,
  TILT_CAR_WIDTH,
  TILT_HEAD_ON,
  TILT_RAIL_ALIGN,
  TILT_RAIL_CRAWL,
  TILT_RAIL_DRIVE,
  TILT_REVERSE_SPEED,
  TILT_SCRAPE_ALIGNED,
  TILT_SCRAPE_DECEL,
  TILT_SKID_TAU_MS,
  TILT_SPOOL_MS,
  TILT_CRUISE_SPEED,
  tiltSpeedAt,
} from '../../../../shared/protocol';
import { TRACK_HALF_WIDTH, atArc, locate, type OnTrack, type Point, type Track } from '../../../../shared/tiltTrack';

/**
 * The car. Spec: docs/specs/games/tilt-race.md §2, §2.1, §2.2
 *
 * DOM-free on purpose, and not just for tidiness: this repo's test harness is
 * esbuild plus plain Node with no jsdom (docs/testing.md §1.1), so anything
 * worth asserting has to be reachable without a `<canvas>`. The renderer owns
 * the canvas and the sensor; this owns the physics.
 *
 * ## The car is fixed on screen, not in the world (spec §2.1)
 *
 * That is a *rendering* decision and it has exactly one consequence here: the
 * simulation still runs in track space, where the car has a position, a heading
 * and a velocity like anything else. `Renderer` simply always puts the camera
 * on the car and rotates so the car's heading is up.
 *
 * Getting this backwards — simulating in screen space with a world that
 * rotates — is the trap Asteroid Race's own comments warn about, and it makes
 * the physics depend on the aspect ratio.
 */

export type DriveInput = {
  /**
   * How far the phone has been rotated in its own plane since the round
   * started, in radians, from `roll.ts`. **Not a steer**: this is an angle the
   * car's heading matches one for one, so a quarter turn of the wrist is a
   * quarter turn of the car.
   */
  roll: number;
  /** Is the reverse button held? */
  reverse: boolean;
};

export type Bump = 'none' | 'graze' | 'head-on';

/**
 * The heading the car shows when the phone's own roll is zero, i.e. held
 * upright (`roll.ts`'s own "0 is upright"). World heading 0 is +x and grows
 * the same clockwise-on-screen way `TrackCanvas`'s own `heading + PI/2`
 * render does, so `atan2(-1, 0)` — straight up the fixed, north-up map — is
 * `-PI/2`. A **fixed constant, not the track's own starting tangent**: the
 * control is a promise about the PHONE (upright means up, 1:1 from there),
 * and tying it to whatever direction a given track happens to start in broke
 * that promise — the car started pointing along the road instead of wherever
 * the phone said it should, which read as a wrong turn already banked in
 * before the player had touched anything.
 */
export const TILT_UPRIGHT_HEADING = -Math.PI / 2;

export type Drive = {
  /** Position in track space, world units. */
  at: Point;
  /** Where the car points, radians. 0 is +x. */
  heading: number;
  /** `TILT_UPRIGHT_HEADING`, always. `heading` is always `base + roll`, which
   *  is what makes the control 1:1 (spec §2.1) — kept as its own field rather
   *  than inlining the constant because that is the one line `step` and the
   *  tests both read to know what "roll" is even measured from. */
  base: number;
  /** How fast it is going along `heading`, world units per second. */
  speed: number;
  /**
   * Where the car's momentum actually points, which above
   * `TILT_CRUISE_SPEED` lags the heading — that is the skid (spec §2.2).
   */
  drift: number;
  /**
   * How far the rails have turned the car away from where the phone points,
   * radians — `heading` is `base + roll + align` (spec §2.3).
   *
   * Zero whenever the car is free of a wall, and it gets back there fast
   * (`TILT_ALIGN_RELAX_MS`): this is the one thing allowed on top of the 1:1
   * control, and it is a debt, not a second steering input.
   */
  align: number;
  /** Elapsed run time, ms. The speed curve is a function of this. */
  runMs: number;
  /** Arc length round the current lap, and laps completed. */
  s: number;
  lap: number;
  /**
   * Signed arc actually covered since the start line, world units, counting up
   * through the wrap rather than round it. `lap` is derived from this and
   * nothing else.
   *
   * It exists because "did the arc length jump from near the end to near the
   * start?" is not a lap test — it is also what a car sitting ON the start line
   * does, since arc 0 and arc `length` are the same point. A stationary car
   * wobbling a few units across the line was banking a full lap out of a few
   * units of jitter (spec §8).
   */
  travelled: number;
  /** The centreline segment last matched, fed back to `locate` as its hint. */
  index: number;
  /** What happened on the last step, for the renderer's shake and sound. */
  bump: Bump;
};

/**
 * Put a car on the start line. Its heading starts at `TILT_UPRIGHT_HEADING`
 * — up the fixed map, matching a phone held upright — regardless of which
 * way this particular track happens to point there; the very next real
 * sensor reading takes over from `step` (spec §2.1).
 */
export function startDrive(track: Track, startS = 0): Drive {
  const { at } = atArc(track, startS);
  return {
    at: { x: at.x, y: at.y },
    heading: TILT_UPRIGHT_HEADING,
    base: TILT_UPRIGHT_HEADING,
    speed: 0,
    drift: TILT_UPRIGHT_HEADING,
    align: 0,
    runMs: 0,
    s: startS,
    lap: 0,
    travelled: 0,
    index: locate(track, at).index,
    bump: 'none',
  };
}

/** The corner-arc radius of the collision box, world units — `TILT_CAR_CORNER`
 *  of the box's short side (see that constant). */
export const CAR_CORNER_RADIUS = TILT_CAR_WIDTH * TILT_CAR_CORNER;

/** Where the centres of the four corner arcs sit, given a pose. */
const HALF_L = TILT_CAR_LENGTH / 2 - CAR_CORNER_RADIUS;
const HALF_W = TILT_CAR_WIDTH / 2 - CAR_CORNER_RADIUS;

/**
 * The four points a rounded-rectangle body has to be tested at: the centres of
 * its corner arcs. The body is exactly those four discs of
 * `CAR_CORNER_RADIUS` plus their convex hull, so "every corner disc is inside
 * the road" is the same statement as "the body is inside the road".
 *
 * **Four corners is the whole test, not a sample of it.** The road's edge is
 * straight between centreline points, and the furthest-out point of a convex
 * body against a straight edge is always a corner — so an edge cannot be
 * through a rail while all four corners are clear. What a curved rail can do
 * is put two different corners against two different segments, which is why
 * every corner is located separately rather than the deepest one being
 * assumed.
 */
export function carCorners(at: Point, heading: number): Point[] {
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  // Left-hand normal of the heading: the car's own across-axis.
  const sx = -fy;
  const sy = fx;
  const out: Point[] = [];
  for (const alongSign of [1, -1]) {
    for (const acrossSign of [1, -1]) {
      out.push({
        x: at.x + fx * alongSign * HALF_L + sx * acrossSign * HALF_W,
        y: at.y + fy * alongSign * HALF_L + sy * acrossSign * HALF_W,
      });
    }
  }
  return out;
}

export type CarContact = {
  /**
   * How much road is left under the worst corner. Positive is clearance in
   * world units; negative is how far the body is already through a rail.
   */
  clearance: number;
  /** Unit vector from that corner back towards the road's middle. */
  inward: Point;
  /** The rail's own direction there — what the car slides along. */
  tangent: Point;
  /** Where that corner sits against the centreline. */
  found: OnTrack;
};

/**
 * The tightest point of the body against the rails, for a pose.
 *
 * Every corner is located, and the worst one wins: that is the corner that
 * decides both whether the car fits and, when it does not, which rail it is
 * sliding along.
 */
export function carContact(track: Track, at: Point, heading: number, hint?: number): CarContact {
  let worst: CarContact | null = null;
  for (const corner of carCorners(at, heading)) {
    const found = locate(track, corner, hint);
    const clearance = TRACK_HALF_WIDTH - CAR_CORNER_RADIUS - found.offset;
    if (worst !== null && clearance >= worst.clearance) continue;
    // Away from the centreline is out; the car is pushed back the other way.
    const outX = corner.x - found.nearest.x;
    const outY = corner.y - found.nearest.y;
    const len = Math.hypot(outX, outY);
    const inward = len > 1e-9
      ? { x: -outX / len, y: -outY / len }
      // Dead on the centreline there is no "out" to speak of, and no contact
      // either; the rail's own left normal keeps the vector well-defined.
      : { x: -found.tangent.y, y: found.tangent.x };
    worst = { clearance, inward, tangent: found.tangent, found };
  }
  // A track always has at least one segment, so `carCorners` always locates.
  return worst as CarContact;
}

/** Does the whole body fit on the road in this pose? */
export function carFits(track: Track, at: Point, heading: number, hint?: number): boolean {
  return carContact(track, at, heading, hint).clearance >= 0;
}

/**
 * Push a body that is through a rail back onto the road, along the rail's own
 * normal.
 *
 * Iterated rather than solved: a car wedged into a corner is against two rails
 * at once, and clearing the worst one can expose the other. Three passes is
 * enough for that and cheap; a body that still does not fit is left where it
 * was for the caller to decide about.
 */
function settle(track: Track, at: Point, heading: number, hint?: number): Point {
  let p = at;
  for (let i = 0; i < 3; i++) {
    const contact = carContact(track, p, heading, hint);
    if (contact.clearance >= 0) return p;
    const push = -contact.clearance + 1e-6;
    p = { x: p.x + contact.inward.x * push, y: p.y + contact.inward.y * push };
  }
  return p;
}

/** Shortest signed angle from `a` to `b`, in −π..π. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * The skid, as one frame of it: the momentum direction chasing the heading
 * through a first-order lag.
 *
 * Its own function because that is the only way to test what it claims. The
 * property worth pinning is that a wrist turning steadily at `w` settles at a
 * lag of `w × TILT_SKID_TAU_MS`, and measuring that needs a wrist turning
 * through every angle — which a body 70 long cannot do on a road 72 wide
 * without scraping a rail, so driving it through `step` measures the
 * collision instead. Nothing about the lag depends on the track, so nothing
 * about testing it should either.
 */
export function skidToward(drift: number, heading: number, dtMs: number): number {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / TILT_SKID_TAU_MS);
  return drift + angleDelta(drift, heading) * k;
}

/**
 * One step of driving. `dtMs` rather than a clock, so a whole race can be
 * driven deterministically in a test — the same shape `AsteroidRun.step` takes.
 *
 * Order matters and is deliberate:
 *
 * 1. **spool** — the speed the curve says, unless a rail has just scrubbed it;
 * 2. **turn** — the tilt rotates the heading;
 * 3. **skid** — above cruise, the momentum direction lags the heading;
 * 4. **move** along the momentum;
 * 5. **rails** — if that put the car outside the road, undo it and pay.
 *
 * Rails last, because a collision has to be resolved against where the car
 * actually tried to go.
 */
export function step(track: Track, car: Drive, input: DriveInput, dtMs: number): Drive {
  const dt = Math.max(0, dtMs) / 1000;
  const next: Drive = { ...car, at: { ...car.at }, bump: 'none' };
  next.runMs = car.runMs + Math.max(0, dtMs);

  if (input.reverse) {
    // Reverse is a way out of a mistake, not a driving mode: it is slow, it
    // does not spool, and it resets the spool when released (spec §7).
    next.speed = -TILT_REVERSE_SPEED;
    next.runMs = 0;
  } else {
    // The curve is the ceiling, and a scrubbed speed climbs back to it rather
    // than snapping — otherwise a graze costs nothing.
    const ceiling = tiltSpeedAt(next.runMs);
    next.speed = car.speed < 0 ? 0 : Math.min(ceiling, car.speed + ceiling * dt);
  }

  /*
   * The heading IS the phone's rotation, offset by `TILT_UPRIGHT_HEADING`
   * rather than by wherever the track happens to start (spec §2.1). No gain,
   * no rate, no integration — turn the wrist through a half circle and the
   * car points the other way.
   *
   * Nothing here limits how fast that can happen, and it does not need to: the
   * skid below is the physics of a car that cannot change direction instantly,
   * so a violent flick makes it slide rather than teleport. A rate cap on top
   * would only break the one property the control exists for.
   */
  /*
   * ...plus whatever the rails have turned it to, which decays back to nothing
   * as soon as the car is free of them (spec §2.3). Relaxed here, at the top,
   * off LAST frame's contact, so one frame has exactly one heading: the
   * alignment the rail branch below applies is what the car carries into the
   * next step.
   */
  next.align = car.bump === 'none'
    ? car.align * Math.exp(-Math.max(0, dtMs) / TILT_ALIGN_RELAX_MS)
    : car.align;
  next.heading = car.base + input.roll + next.align;

  /*
   * Skid. Below cruise the momentum is the heading exactly — the car goes
   * where it points. Above it, the momentum is a low-passed version,
   * so the car keeps some of its old direction through a turn and the last
   * fifth of the speed range is a cost as well as a gain (spec §2.2).
   *
   * **Except right after a rail hit.** A bump routinely scrubs the car below
   * cruise in the same frame it happens, and an instant, lagless snap to
   * `next.heading` the very next frame throws away the tangent-following
   * direction the collision below just set the car sliding along — if the
   * phone is still aimed roughly at the wall (which it is, moments after
   * causing the hit), the car re-squares itself into the same rail before it
   * has slid anywhere, which reads as stopping dead rather than sliding. So a
   * car that bumped last frame (`car.bump`, set at the bottom of the branch
   * below) keeps the lag regardless of speed, exactly as if it were still
   * above cruise — the same skid time constant, not a new one, because this
   * is the same physical claim: momentum a wheel angle cannot reorient
   * instantly.
   */
  if (Math.abs(next.speed) <= TILT_CRUISE_SPEED && car.bump === 'none') {
    next.drift = next.heading;
  } else {
    next.drift = skidToward(car.drift, next.heading, dtMs);
  }

  const moved = {
    x: car.at.x + Math.cos(next.drift) * next.speed * dt,
    y: car.at.y + Math.sin(next.drift) * next.speed * dt,
  };

  // The whole body, not the point at its centre: the car fits where its four
  // corners fit (`carContact`).
  const contact = carContact(track, moved, next.heading, car.index);
  if (contact.clearance >= 0) {
    settleAt(track, next, car, moved);
    return next;
  }

  /*
   * Against a rail. **The car is not stopped — it is turned.**
   *
   * The momentum is split against the rail: the part running across it is
   * absorbed by the wall, and the part running along it is kept, whole. That
   * one projection is the "based on the collision angle" rule — a graze keeps
   * nearly all of its speed because nearly all of it was already going the
   * rail's way, and a square hit keeps nearly none because none of it was.
   * Nothing else is taken off it on impact.
   */
  const tangent = contact.tangent;
  const into = Math.abs(Math.cos(next.drift) * contact.inward.x + Math.sin(next.drift) * contact.inward.y);
  next.bump = into >= TILT_HEAD_ON ? 'head-on' : 'graze';

  const vx = Math.cos(next.drift) * next.speed;
  const vy = Math.sin(next.drift) * next.speed;
  let along = vx * tangent.x + vy * tangent.y;

  /*
   * Rear-wheel drive. The engine does not care that there is a wall: it keeps
   * pushing along the car's own heading, and the rail turns whatever part of
   * that runs along itself into motion. So a car sitting at an angle against a
   * guardrail crabs forward and squares itself up with the rail rather than
   * sticking where it landed — and one facing squarely into the wall gets
   * nothing, which is exactly when reverse is the answer.
   *
   * The heading is the phone's, 1:1 (spec §2.1), so this moves the car along
   * the rail; it never rotates the body out from under the player's wrist.
   */
  /*
   * ...and the same push, resisted at the corner that is touching, is a
   * TORQUE: it squares the car up with the wall. A rear-wheel-drive car pinned
   * at the front does not keep crabbing at the angle it arrived at — it swings
   * straight and runs along the rail, which is both what a car does and what
   * makes the scrape below cheap.
   *
   * The error is measured against whichever END of the rail's tangent the nose
   * is already nearer, so a car reversing along a wall squares up to it too,
   * and |err| is never past a right angle.
   */
  const railAngle = Math.atan2(tangent.y, tangent.x);
  const ahead = angleDelta(next.heading, railAngle);
  const behind = angleDelta(next.heading, railAngle + Math.PI);
  const err = Math.abs(ahead) <= Math.abs(behind) ? ahead : behind;
  // `sin |err|` is the torque a contact at the nose actually makes: strongest
  // broadside, nothing once the car is running true. Never past the error
  // itself, so it settles rather than ringing.
  const swing = Math.sign(err) * Math.min(Math.abs(err), TILT_RAIL_ALIGN * Math.abs(Math.sin(err)) * dt);
  next.align = Math.max(-TILT_ALIGN_MAX, Math.min(TILT_ALIGN_MAX, next.align + swing));
  next.heading = car.base + input.roll + next.align;

  const push = input.reverse ? -TILT_RAIL_DRIVE : TILT_RAIL_DRIVE;
  along += (Math.cos(next.heading) * tangent.x + Math.sin(next.heading) * tangent.y) * push * dt;

  /*
   * Friction, for as long as contact lasts — and it costs what the ANGLE says,
   * not a flat fee. A car dragged broadside along a wall pays
   * `TILT_SCRAPE_DECEL`; one running true along it is barely touching and pays
   * `TILT_SCRAPE_ALIGNED` of that. Charging both the same is what made every
   * graze read as a crash, and it left the alignment above with nothing to
   * earn.
   *
   * Measured from the freshly-swung heading, so squaring up pays off in the
   * same frame it happens.
   */
  const misalign = Math.abs(Math.sin(angleDelta(next.heading, railAngle)));
  const scrape = TILT_SCRAPE_DECEL * (TILT_SCRAPE_ALIGNED + (1 - TILT_SCRAPE_ALIGNED) * misalign);
  along = Math.sign(along) * Math.max(0, Math.abs(along) - scrape * dt);

  /*
   * ...but never all the way to a standstill while the wheels still have
   * somewhere to push. Friction and drive are both accelerations, so on their
   * own they can only ever run away from each other — one wins and the car
   * either accelerates forever or grinds to nothing. The crawl is the
   * equilibrium the two are missing: the speed the engine can always hold
   * against a scraping wall, scaled by how much of the nose points along it.
   *
   * Nose square into the rail this is zero, and the car really does stop —
   * correctly, since nothing the engine does is pointing anywhere useful. That
   * is the case reverse exists for.
   */
  const noseAlong = Math.cos(next.heading) * tangent.x + Math.sin(next.heading) * tangent.y;
  const crawl = Math.abs(noseAlong) * TILT_RAIL_CRAWL;
  if (crawl > 0 && Math.abs(along) < crawl) along = Math.sign(noseAlong) * (input.reverse ? -crawl : crawl);

  /*
   * Back into the car's own terms. `speed` keeps the sign it had, so a car
   * reversing into a rail is still reversing, and `drift` takes the rail's
   * direction — the wall, not the wheel, decides which way the car is now
   * actually travelling. That is also what the next frame's skid has to lag
   * FROM, which is why `bump` keeps the lag alive through the recovery.
   */
  const sign = next.speed < 0 ? -1 : 1;
  const way = along === 0 ? 0 : Math.sign(along) * sign;
  if (way !== 0) next.drift = Math.atan2(tangent.y * way, tangent.x * way);
  next.speed = sign * Math.abs(along);
  // The spool follows the speed, so the car climbs back up its own curve from
  // wherever the rail left it rather than snapping to the ceiling.
  next.runMs = spoolFor(next.speed);

  const slid = {
    x: car.at.x + tangent.x * along * dt,
    y: car.at.y + tangent.y * along * dt,
  };
  /*
   * Slide, then lift clear of the rail — and take that position whatever it
   * measures, rather than only when the whole body fits.
   *
   * **A body this size cannot always fit.** The car is 70 long on a road 72
   * wide, so past about 53 degrees across it there is no position on the road
   * that holds it: it is touching both rails at once, wedged. Requiring a
   * clean fit before moving froze exactly those cars in place — the thing this
   * change exists to stop. `settle` only ever pushes back toward the middle of
   * the road, so accepting its answer is always the best available place, and
   * a wedged car keeps crabbing along the rail until the player's own wrist
   * brings the nose back round.
   */
  settleAt(track, next, car, settle(track, slid, next.heading, car.index));
  return next;
}

/**
 * Put the car at `to` and bring its arc length, segment and lap count with it.
 *
 * Shared by the free and the scraping path, because a lap counts the same
 * either way — a car that crosses the line while scraping down the outside of
 * the last corner has still finished the lap.
 */
function settleAt(track: Track, next: Drive, car: Drive, to: Point): void {
  const found = locate(track, to, car.index);
  next.at = to;
  next.index = found.index;

  /*
   * Laps come from arc actually COVERED, not from watching the arc length wrap.
   *
   * The wrap test this replaces — "was it past three quarters and is it now
   * inside the first quarter?" — cannot tell a car finishing a lap from a car
   * sitting on the start line, because arc 0 and arc `length` are the same
   * point. Every car starts on exactly that point, so the first few units of
   * jitter banked a whole lap: a one-lap race was over before it began, the
   * phone then claimed a lap's worth of progress, and the referee's own cheat
   * clamp turned that claim into a speed-curve ramp that the progress rail rode
   * for the rest of the race, ignoring the car completely (spec §8).
   *
   * Per frame the car moves a few units at most, so the shortest signed way
   * round is never ambiguous — a genuine crossing reads as the small forward
   * step it is, and jitter cancels itself out instead of accumulating.
   */
  let ds = found.s - car.s;
  if (ds > track.length / 2) ds -= track.length;
  else if (ds < -track.length / 2) ds += track.length;
  next.travelled = car.travelled + ds;
  // Never negative: a car that backs off the line before the flag has not
  // un-run a lap it never ran.
  next.lap = Math.max(0, Math.floor(next.travelled / track.length));
  next.s = found.s;
}

/** How far into the spool a given speed is — the inverse of `tiltSpeedAt`,
 *  so a scrubbed car resumes from the right place on the curve. */
export function spoolFor(speed: number): number {
  if (speed <= 0) return 0;
  if (speed >= TILT_CRUISE_SPEED) {
    // Past cruise the curve is on its second, shallower leg; solving it
    // exactly matters less than not jumping, so this clamps to the join.
    return TILT_SPOOL_MS;
  }
  return (speed / TILT_CRUISE_SPEED) * TILT_SPOOL_MS;
}

/** Total progress, for ranking a field. */
export function progress(track: Track, car: { s: number; lap: number }): number {
  return car.lap * track.length + car.s;
}
