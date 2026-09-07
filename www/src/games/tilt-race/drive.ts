import {
  TILT_HEAD_ON,
  TILT_REVERSE_SPEED,
  TILT_SCRAPE_FRICTION,
  TILT_SKID_TAU_MS,
  TILT_SPOOL_MS,
  TILT_TURN_RATE,
  TILT_CRUISE_SPEED,
  tiltSpeedAt,
} from '../../../../shared/protocol';
import { TRACK_HALF_WIDTH, atArc, locate, type Point, type Track } from '../../../../shared/tiltTrack';

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
  /** Filtered tilt, −1..1, from `core/sensors/steer.ts`. */
  steer: number;
  /** Is the reverse button held? */
  reverse: boolean;
};

export type Bump = 'none' | 'graze' | 'head-on';

export type Drive = {
  /** Position in track space, world units. */
  at: Point;
  /** Where the car points, radians. 0 is +x. */
  heading: number;
  /** How fast it is going along `heading`, world units per second. */
  speed: number;
  /**
   * Where the car's momentum actually points, which above
   * `TILT_CRUISE_SPEED` lags the heading — that is the skid (spec §2.2).
   */
  drift: number;
  /** Elapsed run time, ms. The speed curve is a function of this. */
  runMs: number;
  /** Arc length round the current lap, and laps completed. */
  s: number;
  lap: number;
  /** The centreline segment last matched, fed back to `locate` as its hint. */
  index: number;
  /** What happened on the last step, for the renderer's shake and sound. */
  bump: Bump;
};

/** Put a car on the start line, pointing along the track. */
export function startDrive(track: Track, startS = 0): Drive {
  const { at, tangent } = atArc(track, startS);
  const heading = Math.atan2(tangent.y, tangent.x);
  return {
    at: { x: at.x, y: at.y },
    heading,
    speed: 0,
    drift: heading,
    runMs: 0,
    s: startS,
    lap: 0,
    index: locate(track, at).index,
    bump: 'none',
  };
}

/** Shortest signed angle from `a` to `b`, in −π..π. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
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

  // Tilt rotates the world around the car, which in track space is the car
  // turning (spec §2.1).
  next.heading = car.heading + input.steer * TILT_TURN_RATE * dt;

  /*
   * Skid. Below cruise the momentum is the heading exactly — the world turns
   * as far as the tilt says. Above it, the momentum is a low-passed version,
   * so the car keeps some of its old direction through a turn and the last
   * fifth of the speed range is a cost as well as a gain (spec §2.2).
   */
  if (Math.abs(next.speed) <= TILT_CRUISE_SPEED) {
    next.drift = next.heading;
  } else {
    const k = 1 - Math.exp(-Math.max(0, dtMs) / TILT_SKID_TAU_MS);
    next.drift = car.drift + angleDelta(car.drift, next.heading) * k;
  }

  const moved = {
    x: car.at.x + Math.cos(next.drift) * next.speed * dt,
    y: car.at.y + Math.sin(next.drift) * next.speed * dt,
  };

  const found = locate(track, moved, car.index);
  if (found.offset <= TRACK_HALF_WIDTH) {
    next.at = moved;
    next.index = found.index;
    // A lap completes when the arc length wraps from near the end to near the
    // start — measured on the track's own arc, not on a line crossing, so a car
    // that reverses over the line cannot count a lap twice.
    if (car.s > track.length * 0.75 && found.s < track.length * 0.25) next.lap = car.lap + 1;
    else if (car.s < track.length * 0.25 && found.s > track.length * 0.75 && next.lap > 0) next.lap = car.lap - 1;
    next.s = found.s;
    return next;
  }

  /*
   * Into a rail. The car does not move, and how much it costs depends on how
   * square the hit was: head-on resets the speed to zero, a graze scrubs it by
   * a constant (spec §2, the issue's own rule).
   *
   * "Square" is measured against the RAIL, which runs along the track, so the
   * test is how much of the momentum was across the track rather than along
   * it — the component along the local normal.
   */
  const normal = { x: -found.tangent.y, y: found.tangent.x };
  const into = Math.abs(Math.cos(next.drift) * normal.x + Math.sin(next.drift) * normal.y);
  if (into >= TILT_HEAD_ON) {
    next.speed = 0;
    next.runMs = 0;
    next.bump = 'head-on';
  } else {
    next.speed *= 1 - TILT_SCRAPE_FRICTION;
    // The spool is wound back to match, so a scrub is a real setback rather
    // than a single slow frame.
    next.runMs = spoolFor(next.speed);
    next.bump = 'graze';
  }
  // Slide along the rail rather than sticking to it: a car pinned to a wall at
  // zero speed with no way out is what the reverse button exists for, but a
  // graze should still carry you round the corner.
  const along = Math.cos(next.drift) * found.tangent.x + Math.sin(next.drift) * found.tangent.y;
  const slid = {
    x: car.at.x + found.tangent.x * along * next.speed * dt,
    y: car.at.y + found.tangent.y * along * next.speed * dt,
  };
  const after = locate(track, slid, car.index);
  if (after.offset <= TRACK_HALF_WIDTH) {
    next.at = slid;
    next.index = after.index;
    next.s = after.s;
  }
  return next;
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
