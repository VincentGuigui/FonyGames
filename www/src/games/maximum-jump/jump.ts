import {
  MAXJUMP_BEST_ANGLE,
  MAXJUMP_CLAIM_SLACK,
  MAXJUMP_DRAG,
  MAXJUMP_EARLY_ANGLE,
  MAXJUMP_FLAP_RATE,
  MAXJUMP_GRAVITY,
  MAXJUMP_JUMP_STEP,
  MAXJUMP_MAX_SPEED,
  MAXJUMP_PERFECT_BAND,
  MAXJUMP_SPEED_PER_STEP,
  MAXJUMP_STEP_FAST_MS,
  MAXJUMP_STEP_SLOW_MS,
  MAXJUMP_STRIDE,
  MAXJUMP_TAKEOFF_BONUS,
  MAXJUMP_TAP_WINDOW_MS,
  MAXJUMP_TIMING_WINDOW_MS,
} from '../../../../shared/protocol';

/**
 * One long-jump attempt, start to landing.
 * Spec: docs/specs/games/maximum-jump.md §2
 *
 * DOM-free and pure, so the run-up rhythm, the take-off band and the ballistic
 * arc can all be tested without a phone — which matters here more than usual,
 * because every number a player ever sees comes out of this file and the
 * referee is in no position to check any of it (spec §6).
 *
 * Metres and seconds throughout. The canvas scales them at draw time.
 */

export type Leg = 'left' | 'right';

export type AttemptPhase = 'run' | 'flight' | 'landed' | 'foul';

export type Attempt = {
  phase: AttemptPhase;
  /** Attempt clock, ms since the run-up began. */
  t: number;
  /** How far down the track, in steps — continuous, so the take-off line is a
   *  place rather than a press (spec §2.2). */
  atStep: number;
  /** m/s. */
  speed: number;
  /** Which leg took the last step, and when its animation ends on the attempt
   *  clock. Null before the first step, when any leg may open. */
  lastLeg: Leg | null;
  beatAt: number;
  /** The best speed this attempt ever reached — what the wire carries, and
   *  what the scoreboard colours (spec §6). */
  topSpeed: number;
  /** Set at take-off, radians. */
  angle: number;
  /** Where the jumper is relative to the line, metres, once airborne. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Metres, final. 0 until the landing, and 0 forever after a faceplant. */
  distance: number;
};

export function startAttempt(): Attempt {
  return {
    phase: 'run',
    t: 0,
    atStep: 0,
    speed: 0,
    lastLeg: null,
    beatAt: 0,
    topSpeed: 0,
    angle: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    distance: 0,
  };
}

/** How long one leg's animation runs at this speed, ms (spec §2.1). */
export function stepMs(speed: number): number {
  const far = Math.max(0, Math.min(1, speed / MAXJUMP_MAX_SPEED));
  return MAXJUMP_STEP_SLOW_MS + (MAXJUMP_STEP_FAST_MS - MAXJUMP_STEP_SLOW_MS) * far;
}

/** What a press this far off the beat is worth, 0..1 (spec §2.1). */
export function timingGain(errorMs: number): number {
  return Math.max(0, Math.min(1, 1 - Math.abs(errorMs) / MAXJUMP_TIMING_WINDOW_MS));
}

/**
 * The take-off angle for a jump made at `atStep` (spec §2.2).
 *
 * 42° is the one that goes furthest and it belongs to the line itself; 50° is
 * the steep, short, safe jump of somebody who went early. Between the last two
 * steps the two are interpolated, which is what makes the final stride the
 * whole attempt.
 */
export function takeoffAngle(atStep: number): number {
  const line = MAXJUMP_JUMP_STEP;
  if (atStep >= line - MAXJUMP_PERFECT_BAND) return MAXJUMP_BEST_ANGLE;
  if (atStep <= line - 1) return MAXJUMP_EARLY_ANGLE;
  const far = (atStep - (line - 1)) / (1 - MAXJUMP_PERFECT_BAND);
  return MAXJUMP_EARLY_ANGLE + (MAXJUMP_BEST_ANGLE - MAXJUMP_EARLY_ANGLE) * far;
}

/** Did this take-off hit the line exactly? */
export function isPerfect(atStep: number): boolean {
  return atStep >= MAXJUMP_JUMP_STEP - MAXJUMP_PERFECT_BAND && atStep < MAXJUMP_JUMP_STEP;
}

/** Time passing during the run-up: the jumper carries on at whatever speed the
 *  legs have bought, whether or not anybody presses anything. */
export function runFor(a: Attempt, dtMs: number): Attempt {
  if (a.phase !== 'run') return a;
  const dt = Math.max(0, dtMs) / 1000;
  return { ...a, t: a.t + Math.max(0, dtMs), atStep: a.atStep + (a.speed * dt) / MAXJUMP_STRIDE };
}

/**
 * A leg button. Scored against the end of the *other* leg's animation.
 *
 * Pressing the same leg twice is not a step at all — it costs the time rather
 * than the speed, which is the punishment the issue's "should press
 * alternatively" asks for without inventing a penalty it did not.
 */
export function pressLeg(a: Attempt, leg: Leg): Attempt {
  if (a.phase !== 'run') return a;
  if (a.lastLeg === leg) return a;

  // The first press opens the run-up and has no beat to be measured against,
  // so it is worth a full increment rather than a lucky or unlucky fraction.
  const gain = a.lastLeg === null ? 1 : timingGain(a.t - a.beatAt);
  const speed = Math.min(MAXJUMP_MAX_SPEED, a.speed + gain * MAXJUMP_SPEED_PER_STEP);
  return {
    ...a,
    speed,
    topSpeed: Math.max(a.topSpeed, speed),
    lastLeg: leg,
    beatAt: a.t + stepMs(speed),
  };
}

/**
 * The jump button on the ground: take off, or faceplant.
 *
 * Past the line is a foul and scores nothing — the one hard edge in the game,
 * and the reason the last stride is worth being nervous about.
 */
export function pressJump(a: Attempt): Attempt {
  if (a.phase !== 'run') return a;
  if (a.atStep >= MAXJUMP_JUMP_STEP) return { ...a, phase: 'foul', distance: 0 };

  const bonus = isPerfect(a.atStep) ? MAXJUMP_TAKEOFF_BONUS * MAXJUMP_SPEED_PER_STEP : 0;
  const v = a.speed + bonus;
  const angle = takeoffAngle(a.atStep);
  return {
    ...a,
    phase: 'flight',
    speed: v,
    topSpeed: Math.max(a.topSpeed, v),
    angle,
    x: 0,
    y: 0,
    vx: v * Math.cos(angle),
    vy: v * Math.sin(angle),
  };
}

/**
 * One frame of flight (spec §2.3).
 *
 * Gravity on the vertical, drag on the horizontal, and the drag is the part the
 * player is still playing: at `MAXJUMP_FLAP_RATE` taps a second it is gone and
 * the arc is textbook ballistics, at none of them the jumper stalls.
 */
export function stepFlight(a: Attempt, dtMs: number, tapsPerSecond: number): Attempt {
  if (a.phase !== 'flight') return a;
  const dt = Math.max(0, Math.min(0.05, dtMs / 1000));

  const held = Math.max(0, Math.min(1, tapsPerSecond / MAXJUMP_FLAP_RATE));
  const drag = MAXJUMP_DRAG * (1 - held);
  const vx = a.vx - drag * a.vx * dt;
  const vy = a.vy - MAXJUMP_GRAVITY * dt;
  const x = a.x + vx * dt;
  // The exact constant-acceleration step, not `vy * dt`: plain Euler loses a
  // tenth of a metre over a jump and makes the distance depend on the frame
  // rate, which would mean a slower phone jumped shorter.
  const y = a.y + a.vy * dt - 0.5 * MAXJUMP_GRAVITY * dt * dt;

  if (y <= 0 && a.y > 0) {
    // Land on the ground, not below it: interpolate the last fraction of the
    // frame so the distance does not depend on the frame rate.
    const share = a.y / (a.y - y);
    return { ...a, phase: 'landed', vx, vy, x: a.x + (x - a.x) * share, y: 0, distance: a.x + (x - a.x) * share };
  }
  return { ...a, t: a.t + Math.max(0, dtMs), vx, vy, x, y };
}

/**
 * Taps a second over the rolling window, from the timestamps of the taps so far
 * (spec §2.3). Rate rather than a count, so the number means the same thing at
 * the start of a jump as in the middle of one.
 */
export function tapRate(taps: readonly number[], now: number): number {
  const from = now - MAXJUMP_TAP_WINDOW_MS;
  let n = 0;
  for (const at of taps) if (at > from) n++;
  return (n * 1000) / MAXJUMP_TAP_WINDOW_MS;
}

/**
 * The longest jump this game's own physics can produce (spec §8).
 *
 * The best case is everything at once: top speed, the take-off bonus, no drag
 * at all, and — generously — the 45° that maximises range rather than the 42°
 * the game actually gives. Anything past it is a phone making numbers up.
 */
export function bestPossible(): number {
  const v = MAXJUMP_MAX_SPEED + MAXJUMP_TAKEOFF_BONUS * MAXJUMP_SPEED_PER_STEP;
  return (v * v) / MAXJUMP_GRAVITY + MAXJUMP_CLAIM_SLACK;
}
