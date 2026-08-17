import { SPILL_AIM_FRACTION, SPILL_SPEED_MAX, SPILL_SPEED_MIN } from './protocol';

/**
 * Spill's shared coordinate frame. Spec: docs/specs/games/spill.md §2
 *
 * Both the worker (which referees every flick) and the browser (which draws the
 * layout diagram and the aim preview) have to agree on this exactly, so it lives
 * here rather than being written twice. It must stay DOM-free.
 *
 * **The table frame is the view from above**, and it uses the same handedness as
 * a canvas: x right, y down, angles measured *clockwise from up*. Keeping one
 * handedness everywhere is what stops the aiming maths quietly mirroring itself
 * somewhere between the two codebases.
 *
 * Seat `k` of `n` sits at table angle `αₖ = 2πk/n`, so seat 0 is at the top of
 * the diagram. Every phone is laid out with its **top edge pointing at the table
 * centre**, which is the one convention players are asked to follow — so the
 * screen-up direction of seat `k` is the table bearing `αₖ + π`.
 */

/** Where seat `k` sits, on a unit circle around the table centre. */
export function seatPos(k: number, n: number): { x: number; y: number } {
  const a = (2 * Math.PI * k) / n;
  return { x: Math.sin(a), y: -Math.cos(a) };
}

/** Fold any angle into (-π, π]. */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** The table bearing you must travel along to get from seat `k` to seat `j`. */
export function bearingBetween(k: number, j: number, n: number): number {
  const from = seatPos(k, n);
  const to = seatPos(j, n);
  return Math.atan2(to.x - from.x, -(to.y - from.y));
}

/** A flick at screen angle `screenAngle` from seat `k`, as a table bearing. */
export function flickBearing(k: number, screenAngle: number, n: number): number {
  return (2 * Math.PI * k) / n + Math.PI + screenAngle;
}

/**
 * How far off straight ahead a flick may point: 80°, either side.
 *
 * **You throw water away from you, up the table.** Backwards is your own lap and sideways is
 * the floor, and neither is a shot anybody means to take — but a drag is a drag, and a
 * flick that curled back under the thumb used to launch a drop into nothing and cost the
 * thrower the drop, the lock, and the second it took to work out what had happened.
 *
 * 80° is wide, on purpose. Every seat is across the table from every other one, so the
 * furthest a legitimate aim ever needs to point is 90° − 180°/n — 45° with a full table of
 * four — and the two-player bounce game lives out at the edges of the cone, where a shallow
 * angle means more bounces off the side walls. The cone rules out the gesture nobody meant;
 * it is not trying to have an opinion about aim.
 */
export const SPILL_FLICK_CONE = (80 * Math.PI) / 180;

/** Is this a throw up the table, rather than into your own lap? */
export function forwardFlick(screenAngle: number): boolean {
  return Math.abs(wrapAngle(screenAngle)) <= SPILL_FLICK_CONE;
}

/**
 * The same angle, folded back into the cone.
 *
 * The referee's backstop, and only that: the phone refuses a backwards drag outright, so a
 * flick that arrives out of the cone came from a client that made it up. Clamped rather
 * than rejected, in line with how `speed` is handled — the answer to a strange number is
 * the nearest legal one, not a lost turn (spec §9).
 */
export function clampFlick(screenAngle: number): number {
  const a = wrapAngle(screenAngle);
  return Math.max(-SPILL_FLICK_CONE, Math.min(SPILL_FLICK_CONE, a));
}

/**
 * How much of the aim window a flat-out flick gives up.
 *
 * **This is the decision the gesture is for.** Flick speed used to have exactly one
 * consequence — a shorter launch lock — which made throwing as hard as possible
 * strictly better than aiming, four times the throughput for no cost at all. Now a
 * hard throw buys that tempo by narrowing the window it has to fit through, so
 * "how hard do I dare throw this" is a real question with a real answer either way.
 *
 * Scaled **deterministically**, never jittered. A random deviation would be simpler
 * and is wrong twice over: the aim preview could not tell the truth about a throw it
 * cannot predict, and a player who aimed dead centre and missed anyway would be quite
 * right to feel cheated.
 */
export const SPILL_SPREAD = 0.5;

/**
 * Half the angular distance from one target to its nearest neighbouring target, as
 * seen from seat `from` — the widest a window can be before two of them overlap.
 *
 * Derived from the real screen angles rather than assumed to be `π/n`: the seats are
 * evenly spaced around the table, but the *bearings* from any one seat to the others
 * are not evenly spaced, and at four players the seat opposite is √2 further away
 * than the two beside it. `π/n` is the gap between seats; this is the gap between
 * aims, halved.
 *
 * With **two** players there is no neighbouring target to collide with, so the bound
 * is the throwing cone itself. A careful flick reaches almost the whole cone and the
 * skill stays where the bounce path puts it (spec §4a) — *where* on their screen it
 * arrives, not whether it gets there — while a hard one can still be flung past them.
 */
export function halfGap(from: number, n: number): number {
  const angles: number[] = [];
  for (let j = 0; j < n; j++) {
    if (j !== from) angles.push(screenAngleTo(from, j, n));
  }
  if (angles.length < 2) return SPILL_FLICK_CONE;

  angles.sort((a, b) => a - b);
  let gap = Infinity;
  for (let i = 1; i < angles.length; i++) {
    gap = Math.min(gap, (angles[i] as number) - (angles[i - 1] as number));
  }
  return gap / 2;
}

/**
 * How far off a perfect flick may be and still land on a phone.
 *
 * A fraction of the half-gap (never more, or adjacent windows would overlap and a
 * forward flick could not miss), shrinking as the flick gets faster.
 *
 * At `SPILL_AIM_FRACTION` 0.9 and `SPILL_SPREAD` 0.5 that is ±20° careful and ±10°
 * flat out with four players, ±27° and ±13.5° with three, ±72° and ±36° with two.
 */
export function aimTolerance(from: number, n: number, speed: number): number {
  const t = Math.max(
    0,
    Math.min(1, (speed - SPILL_SPEED_MIN) / (SPILL_SPEED_MAX - SPILL_SPEED_MIN)),
  );
  return SPILL_AIM_FRACTION * halfGap(from, n) * (1 - SPILL_SPREAD * t);
}

/**
 * Which seat a flick hits, or null when the water sails off the table.
 *
 * `screenAngle` is radians **clockwise from the top of the thrower's screen** —
 * for a drag of (dx, dy) in canvas pixels that is `Math.atan2(dx, -dy)`.
 *
 * `speed` is in screen heights per second, the same unit that goes on the wire, and
 * it narrows the window (see `SPILL_SPREAD`). The client passes the speed of the drag
 * so far so the preview can say what the release is going to do.
 */
export function aimSeat(
  from: number,
  screenAngle: number,
  n: number,
  speed: number,
): number | null {
  const bearing = flickBearing(from, screenAngle, n);

  let best: number | null = null;
  let bestErr = Infinity;
  for (let j = 0; j < n; j++) {
    if (j === from) continue;
    const err = Math.abs(wrapAngle(bearing - bearingBetween(from, j, n)));
    if (err < bestErr) {
      bestErr = err;
      best = j;
    }
  }

  return bestErr <= aimTolerance(from, n, speed) ? best : null;
}

/**
 * The screen angle that hits seat `j` dead-on. The client uses this for the
 * tap-a-seat fallback and the aim preview — a target drawn at this angle on
 * your screen is a target you can flick straight at.
 */
export function screenAngleTo(from: number, to: number, n: number): number {
  return wrapAngle(bearingBetween(from, to, n) - flickBearing(from, 0, n));
}

/* ---------------------------------------------------------------- */
/* Two players: the bounced flight path (spec §4a)                    */
/* ---------------------------------------------------------------- */

/**
 * Nominal phone shape (width ÷ height) for the two-player bounce path.
 *
 * Fixed rather than each phone's real aspect, and that is the point: both ends
 * have to agree on where a drop crosses the join, and they cannot agree on
 * something only one of them can measure. A drop is a stylised splash of water,
 * so a path computed for a slightly different shape than the screen it is drawn
 * on is invisible — a *disagreement* between the two screens would not be.
 */
export const SPILL_NOMINAL_ASPECT = 0.46;

/** Reflect `v` back and forth into `[0, span]`, however many bounces it takes. */
export function foldInto(v: number, span: number): number {
  const period = span * 2;
  const m = ((v % period) + period) % period;
  return m <= span ? m : period - m;
}

/**
 * The unfolded horizontal position after travelling `dy` screen-heights up the
 * board, for a flick at screen angle `angle`. Straight line; the folding is what
 * turns it into bounces.
 */
function unfoldedX(angle: number, dy: number): number {
  return SPILL_NOMINAL_ASPECT / 2 + Math.tan(angle) * dy;
}

/**
 * With two phones nose to nose, a drop **bounces off the side edges** and keeps
 * going, and crosses the join keeping its direction (spec §4a).
 *
 * There is no ring to aim around with two players: you either hit the one
 * opponent or throw off the table, which makes the aim itself meaningless. Side
 * bounces give the flick something to be good at — where on their screen it
 * arrives, and from which direction, is now yours to choose.
 *
 * Both halves of the journey are one straight line through a strip, reflected.
 * That is why the direction survives the crossing without anything having to
 * preserve it: the receiver's screen is the mirrored continuation of the same
 * line, so `x → A − x` is the whole handoff, exactly as in Sling Puck.
 *
 * `p` runs 0..1 over the leg. Both return **fractions of the screen**.
 */
export function bounceLeaving(angle: number, p: number): { x: number; y: number } {
  const A = SPILL_NOMINAL_ASPECT;
  return {
    x: foldInto(unfoldedX(angle, p * 0.5), A) / A,
    y: 0.5 - p * 0.5,
  };
}

/** The far half of the same line, in the receiver's own (mirrored) frame. */
export function bounceArriving(angle: number, p: number): { x: number; y: number } {
  const A = SPILL_NOMINAL_ASPECT;
  return {
    x: foldInto(A - unfoldedX(angle, 0.5 + p * 0.5), A) / A,
    y: p * 0.5,
  };
}

/**
 * Every seat's position **as the player at `mine` sees the table**, in canvas
 * coordinates on a unit circle: x right, y down, the table centre at (0, 0),
 * and the viewer themselves at (0, 1) — directly below the middle, which is
 * where they are once their top edge points at it.
 *
 * Bearings alone are not enough to draw the diagram: with four players the seat
 * opposite is √2 further away than the two beside you, so plotting everyone at
 * one radius turns a square table into a huddle. Real positions make a square
 * look like a square and a triangle like a triangle.
 */
export function seatLayout(mine: number, n: number): { x: number; y: number }[] {
  // Rotate the table so the viewer's screen-up points at the centre.
  const turn = flickBearing(mine, 0, n);
  return Array.from({ length: n }, (_, j) => {
    const p = seatPos(j, n);
    const bearing = Math.atan2(p.x, -p.y) - turn;
    return { x: Math.sin(bearing), y: -Math.cos(bearing) };
  });
}
