import {
  TILT_ALIGN_MAX,
  TILT_ALIGN_RELAX_MS,
  TILT_CAR_WIDTH,
  TILT_HEAD_ON,
  TILT_RAIL_CRAWL,
  TILT_REAR_TUCK,
  TILT_RAIL_DRIVE,
  TILT_REVERSE_SPEED,
  TILT_SCRAPE_ALIGNED,
  TILT_SCRAPE_DECEL,
  TILT_SKID_TAU_MS,
  TILT_SPOOL_MS,
  TILT_WHEELBASE,
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

/**
 * The radius of each of the car's two points, world units — half the car's
 * width, so the two discs plus the hull between them is a capsule
 * `TILT_CAR_LENGTH` long and `TILT_CAR_WIDTH` wide (`TILT_WHEELBASE`).
 */
export const CAR_END_RADIUS = TILT_CAR_WIDTH / 2;

/** Half the gap between the two points — where each sits from the centre. */
const HALF_WB = TILT_WHEELBASE / 2;

/**
 * The car's two points: nose first, tail second.
 *
 * **This is the whole body.** Every question the physics asks — does it fit,
 * which end is touching, what does the touch cost — is asked of these two
 * points and the discs around them (spec §2.3).
 */
export function carEnds(at: Point, heading: number): [Point, Point] {
  const fx = Math.cos(heading) * HALF_WB;
  const fy = Math.sin(heading) * HALF_WB;
  return [
    { x: at.x + fx, y: at.y + fy },
    { x: at.x - fx, y: at.y - fy },
  ];
}

/** Rebuild a car's centre from one end and a heading — the other end follows. */
function centreFrom(end: Point, heading: number, isFront: boolean): Point {
  const fx = Math.cos(heading) * HALF_WB;
  const fy = Math.sin(heading) * HALF_WB;
  return isFront ? { x: end.x - fx, y: end.y - fy } : { x: end.x + fx, y: end.y + fy };
}

export type EndContact = {
  /** How far this point's disc is through a rail. Zero or less is clear. */
  depth: number;
  /** Unit vector from the point back towards the road's middle. */
  inward: Point;
  /** The rail's own direction there — what the car slides along. */
  tangent: Point;
  /** Where the point sits against the centreline. */
  found: OnTrack;
};

/** One point of the car against the rails. */
export function endContact(track: Track, point: Point, hint?: number): EndContact {
  const found = locate(track, point, hint);
  const depth = found.offset + CAR_END_RADIUS - TRACK_HALF_WIDTH;
  const outX = point.x - found.nearest.x;
  const outY = point.y - found.nearest.y;
  const len = Math.hypot(outX, outY);
  const inward = len > 1e-9
    ? { x: -outX / len, y: -outY / len }
    // Dead on the centreline there is no "out" to speak of, and no contact
    // either; the rail's own left normal keeps the vector well-defined.
    : { x: -found.tangent.y, y: found.tangent.x };
  return { depth, inward, tangent: found.tangent, found };
}

export type CarContact = {
  /** How much road is left under the worse end. Positive is clearance. */
  clearance: number;
  inward: Point;
  tangent: Point;
  found: OnTrack;
};

/** The tighter of the car's two points against the rails, for a pose. */
export function carContact(track: Track, at: Point, heading: number, hint?: number): CarContact {
  const [front, rear] = carEnds(at, heading);
  const a = endContact(track, front, hint);
  const b = endContact(track, rear, hint);
  const worst = a.depth >= b.depth ? a : b;
  return { clearance: -worst.depth, inward: worst.inward, tangent: worst.tangent, found: worst.found };
}

/** Does the whole body fit on the road in this pose? */
export function carFits(track: Track, at: Point, heading: number, hint?: number): boolean {
  return carContact(track, at, heading, hint).clearance >= 0;
}

/**
 * Last-resort depenetration: shove the whole body back onto the road.
 *
 * The rail response below moves ONE POINT and lets the body swing round the
 * other, which is what a car does. This is the fallback for what that cannot
 * reach — a car across a narrow road with both ends through a rail, where
 * turning about either end just buries the other. Iterated, because clearing
 * the worse end can expose the other.
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
 * Turn the car to where a rail has pushed one of its points — as far as the
 * offset from the wrist is allowed to go.
 *
 * `TILT_ALIGN_MAX` is the leash. When the rail wants more than that, the body
 * stops turning and whatever overlap is left is taken out by `settle` moving
 * the whole car instead: bounded rotation, but never a car left inside a wall.
 */
function swingTo(next: Drive, wrist: number, wanted: number): void {
  const offset = angleDelta(wrist, wanted);
  next.align = Math.max(-TILT_ALIGN_MAX, Math.min(TILT_ALIGN_MAX, offset));
  next.heading = wrist + next.align;
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
   * **And the car turns about the end that is not leading.**
   *
   * Steering swings the FRONT of a car, because that is where the steered
   * wheels are: hold the back still, point the front somewhere else. Rotating
   * the body about its middle instead — which is what a single centre point and
   * a heading give you — swings the nose one way and the tail the other, so
   * the whole car crabs sideways out of its lane on every turn of the wrist and
   * the tail sweeps into rails it was nowhere near. That is a car being shoved,
   * not driven (spec §2.3).
   *
   * So the trailing point is the pivot: the rear going forwards, the front in
   * reverse (back a car up and it is the tail that swings). The heading is
   * still the phone's, 1:1 — this only decides where the body ends up hanging
   * off it.
   */
  const pivotIsRear = next.speed >= 0;
  const [oldFront, oldRear] = carEnds(car.at, car.heading);
  next.at = centreFrom(pivotIsRear ? oldRear : oldFront, next.heading, !pivotIsRear);

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
    x: next.at.x + Math.cos(next.drift) * next.speed * dt,
    y: next.at.y + Math.sin(next.drift) * next.speed * dt,
  };

  /*
   * Which end is touching, and which one is LEADING.
   *
   * The leading end is the one the car is being driven onto: the nose going
   * forwards, the tail in reverse. That distinction is the whole of the rule
   * below, so it is drawn once, here.
   */
  let carriedAlong = 0;
  let carriedTangent: Point | null = null;
  const leadIsFront = next.speed >= 0;
  const [movedFront, movedRear] = carEnds(moved, next.heading);
  const leadEnd = leadIsFront ? movedFront : movedRear;
  const trailEnd = leadIsFront ? movedRear : movedFront;
  const lead = endContact(track, leadEnd, car.index);
  const trail = endContact(track, trailEnd, car.index);

  if (lead.depth <= 0 && trail.depth <= 0) {
    settleAt(track, next, car, moved);
    return next;
  }

  /*
   * **A bump on the trailing end is free.**
   *
   * Clipping a wall with the back of the car while driving forwards is not a
   * crash, it is a scrape you barely feel: nothing is being driven into the
   * wall there, so there is no momentum for the wall to take. All that is owed
   * is the overlap — put the tail back on the road and carry on at the same
   * speed, in the same direction (spec §2.3).
   *
   * Putting it back ROTATES the car, because the other end stays where it is.
   * That is the two-point body earning its keep: a tail that clips a wall
   * swings the nose, exactly as it would on tarmac, and the driver feels the
   * car step out rather than stop.
   */
  let centre = moved;
  if (trail.depth > 0) {
    const pushed = {
      x: trailEnd.x + trail.inward.x * (trail.depth + 1e-6),
      y: trailEnd.y + trail.inward.y * (trail.depth + 1e-6),
    };
    // Swung about the leading end, which is the one that stays put.
    const swungHeading = leadIsFront
      ? Math.atan2(leadEnd.y - pushed.y, leadEnd.x - pushed.x)
      : Math.atan2(pushed.y - leadEnd.y, pushed.x - leadEnd.x);
    swingTo(next, car.base + input.roll, swungHeading);
    centre = centreFrom(leadEnd, next.heading, leadIsFront);
  }

  /*
   * The leading end is the one that costs something — and the cost is the
   * angle, as it always was.
   *
   * The momentum is split against the rail: the part running across it is
   * absorbed by the wall, and the part running along it is kept, whole. A
   * graze keeps nearly all its speed because nearly all of it was already
   * going the rail's way; a square hit keeps nearly none because none of it
   * was. Nothing else is taken off on impact.
   */
  if (lead.depth > 0) {
    const tangent = lead.tangent;
    const into = Math.abs(Math.cos(next.drift) * lead.inward.x + Math.sin(next.drift) * lead.inward.y);
    next.bump = into >= TILT_HEAD_ON ? 'head-on' : 'graze';

    const vx = Math.cos(next.drift) * next.speed;
    const vy = Math.sin(next.drift) * next.speed;
    let along = vx * tangent.x + vy * tangent.y;

    /*
     * Lift the touching end clear, then TUCK THE OTHER END IN (issue #42).
     *
     * A rear-wheel-drive car scraping its nose along a wall does not swing the
     * nose away — the wall's reaction at the nose, with the drive pushing from
     * behind, rotates the body the other way and brings the tail in until the
     * car lies flush. Swinging the nose out instead left the car permanently
     * angled off the rail, which is what still read as "not sliding".
     *
     * So the depenetration is a straight shift (no rotation of its own), and
     * the rotation is a separate tuck about the touching end, toward whichever
     * way the rail runs. Its rate comes from the drive, so a car with no
     * thrust does not tidy itself up.
     */
    centre = {
      x: centre.x + lead.inward.x * (lead.depth + 1e-6),
      y: centre.y + lead.inward.y * (lead.depth + 1e-6),
    };
    const railAngle0 = Math.atan2(tangent.y, tangent.x);
    const aheadErr = angleDelta(next.heading, railAngle0);
    const behindErr = angleDelta(next.heading, railAngle0 + Math.PI);
    const tuckErr = Math.abs(aheadErr) <= Math.abs(behindErr) ? aheadErr : behindErr;
    const tuck = Math.sign(tuckErr) * Math.min(Math.abs(tuckErr), TILT_REAR_TUCK * Math.abs(Math.sin(tuckErr)) * dt);
    const pinned = carEnds(centre, next.heading)[leadIsFront ? 0 : 1];
    swingTo(next, car.base + input.roll, next.heading + tuck);
    centre = centreFrom(pinned, next.heading, leadIsFront);

    /*
     * Rear-wheel drive. The engine does not care that there is a wall: it
     * keeps pushing along the car's own heading, and the rail turns whatever
     * part of that runs along itself into motion. So a car sitting at an angle
     * against a guardrail crabs along it rather than sticking where it landed
     * — and one facing squarely into the wall gets nothing, which is exactly
     * when reverse is the answer.
     */
    const push = input.reverse ? -TILT_RAIL_DRIVE : TILT_RAIL_DRIVE;
    along += (Math.cos(next.heading) * tangent.x + Math.sin(next.heading) * tangent.y) * push * dt;

    /*
     * Friction, for as long as contact lasts — and it costs what the ANGLE
     * says, not a flat fee. A car dragged broadside along a wall pays
     * `TILT_SCRAPE_DECEL`; one running true along it is barely touching and
     * pays `TILT_SCRAPE_ALIGNED` of that. Charging both the same is what made
     * every graze read as a crash.
     */
    const misalign = Math.abs(Math.sin(angleDelta(next.heading, railAngle0)));
    const scrape = TILT_SCRAPE_DECEL * (TILT_SCRAPE_ALIGNED + (1 - TILT_SCRAPE_ALIGNED) * misalign);
    along = Math.sign(along) * Math.max(0, Math.abs(along) - scrape * dt);

    /*
     * ...but never all the way to a standstill while the wheels still have
     * somewhere to push. Friction and drive are both accelerations, so on
     * their own they can only run away from each other — one wins and the car
     * either accelerates forever or grinds to nothing. The crawl is the
     * equilibrium they are missing, scaled by how much of the nose points
     * along the rail. Nose square in it is zero and the car really does stop,
     * which is the case reverse exists for.
     */
    const noseAlong = Math.cos(next.heading) * tangent.x + Math.sin(next.heading) * tangent.y;
    const crawl = Math.abs(noseAlong) * TILT_RAIL_CRAWL;
    if (crawl > 0 && Math.abs(along) < crawl) along = Math.sign(noseAlong) * (input.reverse ? -crawl : crawl);

    carriedAlong = along;
    carriedTangent = tangent;
  }

  /*
   * Back into the car's own terms — only if the LEADING end actually hit.
   *
   * A trailing-end bump has already had its say: the tail was put back on the
   * road and the body swung round the nose, and that is all it is owed. The
   * speed, the direction of travel and the spool are untouched, which is the
   * rule this whole branch exists for.
   */
  if (carriedTangent !== null) {
    const tangent = carriedTangent;
    const along = carriedAlong;
    // `speed` keeps the sign it had, so a car reversing into a rail is still
    // reversing, and `drift` takes the rail's direction — the wall, not the
    // wheel, decides which way the car is now actually travelling. That is
    // also what the next frame's skid has to lag FROM, which is why `bump`
    // keeps the lag alive through the recovery.
    const sign = next.speed < 0 ? -1 : 1;
    const way = along === 0 ? 0 : Math.sign(along) * sign;
    if (way !== 0) next.drift = Math.atan2(tangent.y * way, tangent.x * way);
    next.speed = sign * Math.abs(along);
    // The spool follows the speed, so the car climbs back up its own curve
    // from wherever the rail left it rather than snapping to the ceiling.
    next.runMs = spoolFor(next.speed);
    centre = { x: centre.x + tangent.x * along * dt, y: centre.y + tangent.y * along * dt };
  }

  /*
   * Whatever is left, take out of the position — and take that position
   * whatever it measures, rather than only when the whole body fits.
   *
   * Swinging one end clear can bury the other on a road this narrow, and a car
   * turned far enough across it is against both rails at once with no pose
   * that holds it. Requiring a clean fit before moving froze exactly those
   * cars. `settle` only ever pushes back toward the middle of the road, so its
   * answer is always the best place available.
   */
  settleAt(track, next, car, settle(track, centre, next.heading, car.index));
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
