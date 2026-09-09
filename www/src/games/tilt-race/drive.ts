import {
  TILT_HEAD_ON,
  TILT_REVERSE_SPEED,
  TILT_SCRAPE_DECEL,
  TILT_SKID_TAU_MS,
  TILT_SPOOL_MS,
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
  next.heading = car.base + input.roll;

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
   * Into a rail. The car does not move, and what it costs depends on how
   * square the hit was — continuously, not in two buckets.
   *
   * "Square" is measured against the RAIL, which runs along the track, so the
   * test is how much of the momentum was across the track rather than along
   * it: the component along the local normal.
   */
  const normal = { x: -found.tangent.y, y: found.tangent.x };
  const into = Math.abs(Math.cos(next.drift) * normal.x + Math.sin(next.drift) * normal.y);
  const before = next.speed;
  next.speed = before * railKeep(into);
  // Then friction, for as long as the car is still against the rail. This is
  // the part that makes riding a wall round a corner a losing line: the impact
  // is paid once, the scrape is paid every frame of contact.
  const scrubbed = Math.max(0, Math.abs(next.speed) - TILT_SCRAPE_DECEL * dt);
  next.speed = Math.sign(next.speed) * scrubbed;
  // The spool is wound back to match, so a hit is a real setback rather than a
  // single slow frame.
  next.runMs = spoolFor(next.speed);
  next.bump = into >= TILT_HEAD_ON ? 'head-on' : 'graze';

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

  // The wall, not the wheel, decides which way the car is now actually
  // moving: the momentum the rail did not absorb runs along its own tangent,
  // signed the way the car was already travelling (`along`'s own sign) rather
  // than backing up mid-corner. Left as the pre-collision heading instead,
  // the very next frame's skid check (above) would have nothing tangent-ish
  // to lag FROM — this is what that lag is preserving.
  const tangentAngle = Math.atan2(found.tangent.y, found.tangent.x);
  next.drift = along >= 0 ? tangentAngle : tangentAngle + Math.PI;
  return next;
}

/**
 * What fraction of its speed a car keeps when it meets a rail, given `into` —
 * how much of its momentum was pointing across the track rather than along it,
 * as |cos| against the local normal.
 *
 * **Square-on keeps nothing, forty-five degrees keeps half.** Those are the two
 * points the rule was given as, and `1 - into^2` is the curve through them:
 * at 45 degrees to the rail `into` is cos 45, so `into^2` is a half. It is also
 * the honest physical reading rather than a fitted curve — the kinetic energy
 * aimed across the rail is absorbed and the energy running along it is not,
 * which is what `1 - into^2 = along^2` says.
 *
 * A pure graze (momentum along the rail, `into` 0) therefore costs nothing on
 * impact; what it costs is `TILT_SCRAPE_DECEL`, for as long as contact lasts.
 */
export function railKeep(into: number): number {
  const n = Math.min(1, Math.max(0, into));
  return 1 - n * n;
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
