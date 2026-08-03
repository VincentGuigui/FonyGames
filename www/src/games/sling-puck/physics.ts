/**
 * Sling Puck's board simulation. Spec: docs/specs/games/sling-puck.md §4, §6, §7
 *
 * Lives here and **not** in `shared/` on purpose. Unlike Spill's seat geometry
 * or Goat Siege's split lanes, nothing on the server needs to agree with this:
 * each phone owns its own half of the board, nobody else can see it, and the
 * only thing that crosses the wire is a puck leaving through the gap. There is
 * no second copy of a puck anywhere, so there is nothing to desynchronise.
 *
 * Everything is in **normalised board units**: x and y run 0..1 across and down
 * the board, velocity is in board-heights per second. The two phones are not the
 * same size and the board has to be the same board on both.
 *
 * No trigonometry anywhere — reflections, the sling and puck collisions are all
 * dot products, so this is plain IEEE-754 arithmetic.
 */

/* ---------------------------------------------------------------- */
/* Internal settings. Tuning constants, never player-facing (spec §6). */
/* ---------------------------------------------------------------- */

/** Pucks per player at the start of a round. */
export const SLING_PUCKS = 5;

/** Puck radius, as a fraction of board width. */
export const PUCK_RADIUS = 0.055;

/**
 * Launch speed per unit of band *elongation*.
 *
 * Large because the elongation is small: the band spans nearly the whole width,
 * so pulling it back by a quarter of the board only lengthens the V by about a
 * tenth. That is the real geometry of the toy, not a fudge — the constant simply
 * has to absorb it.
 */
export const ELASTIC_K = 14;

/** Hard cap on launch speed, in board-heights per second. */
export const MAX_SPEED = 1.6;

/** How far back from the band a pull may go, as a fraction of board height. */
export const MAX_PULL = 0.24;

/**
 * Where the band sits when relaxed.
 *
 * High enough up the board to leave `MAX_PULL` of room behind it — with the band
 * any lower there is nowhere to pull to and every shot is feeble.
 */
export const BAND_REST_Y = 0.72;

/** How fast the band whips back once released. Visual only. */
export const BAND_SNAP = 14;

/**
 * Constant deceleration — a puck sliding on wood.
 *
 * Deliberately *not* `v *= 0.98`: linear damping never quite stops and feels
 * like syrup. Subtracting a fixed amount of speed per second is what a disc on a
 * board actually does, and it comes to rest.
 */
export const FRICTION = 0.55;

/** Energy kept in a wall bounce. */
export const RESTITUTION = 0.72;

/** Energy kept in a puck-on-puck hit. */
export const PUCK_RESTITUTION = 0.86;

/** Width of the gap in the top wall, as a fraction of the board. */
export const GAP_FRACTION = 0.34;

/** Below this a puck is treated as stopped. */
export const REST_SPEED = 0.02;

/**
 * Physics sub-steps per rendered frame.
 *
 * This exists so a fast puck cannot tunnel through a wall. At `MAX_SPEED` one
 * 60 fps frame moves a puck ~0.027 — half a radius — and four sub-steps takes
 * that to ~0.007, leaving room for the constants to be tuned upwards without
 * pucks escaping the board.
 */
export const SUB_STEPS = 4;

/** The tap-to-launch fallback fires at this fraction of a full pull (spec §13). */
export const TAP_PULL = 0.62;

export type Puck = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** True once it has left through the gap; the caller reports and removes it. */
  gone?: boolean;
};

/** Where the gap starts and ends along the top wall. */
export const GAP_LEFT = 0.5 - GAP_FRACTION / 2;
export const GAP_RIGHT = 0.5 + GAP_FRACTION / 2;

/** A puck that left through the gap, in the leaver's own frame. */
export type Crossing = { id: number; x: number; vx: number; vy: number };

/**
 * Advance the board by `dt` seconds and return anything that went through the
 * gap. Crossed pucks are removed from `pucks`.
 */
export function step(pucks: Puck[], dt: number): Crossing[] {
  const crossed: Crossing[] = [];
  const h = dt / SUB_STEPS;

  for (let s = 0; s < SUB_STEPS; s++) {
    for (const p of pucks) {
      if (p.gone) continue;
      applyFriction(p, h);
      p.x += p.vx * h;
      p.y += p.vy * h;
      const exit = walls(p);
      if (exit) crossed.push(exit);
    }
    collide(pucks);
  }

  if (crossed.length > 0) {
    for (let i = pucks.length - 1; i >= 0; i--) {
      if (pucks[i]?.gone) pucks.splice(i, 1);
    }
  }
  return crossed;
}

/** Constant deceleration along the direction of travel, down to a dead stop. */
function applyFriction(p: Puck, dt: number): void {
  const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
  if (speed <= REST_SPEED) {
    p.vx = 0;
    p.vy = 0;
    return;
  }
  const drop = FRICTION * dt;
  const scale = speed <= drop ? 0 : (speed - drop) / speed;
  p.vx *= scale;
  p.vy *= scale;
}

/**
 * Bounce off the four walls — except the stretch of the top wall that is the
 * gap, which is how a puck gets to the other player (spec §2).
 */
function walls(p: Puck): Crossing | null {
  const r = PUCK_RADIUS;

  if (p.x < r) {
    p.x = r;
    p.vx = Math.abs(p.vx) * RESTITUTION;
  } else if (p.x > 1 - r) {
    p.x = 1 - r;
    p.vx = -Math.abs(p.vx) * RESTITUTION;
  }

  if (p.y > 1 - r) {
    p.y = 1 - r;
    p.vy = -Math.abs(p.vy) * RESTITUTION;
    return null;
  }

  if (p.y < r) {
    // Through, or off the wall? Decided on the centre, so a puck can never end
    // up parked half in the gap (spec §9).
    if (p.x > GAP_LEFT && p.x < GAP_RIGHT) {
      p.gone = true;
      return { id: p.id, x: p.x, vx: p.vx, vy: p.vy };
    }
    p.y = r;
    p.vy = Math.abs(p.vy) * RESTITUTION;
  }

  return null;
}

/**
 * Equal-mass elastic collisions between pucks.
 *
 * Pairwise, because there are at most ten on a board and anything cleverer
 * would be harder to reason about for no measurable gain. Two pucks knocking a
 * third through the gap is the best thing in the physical game, so this is a
 * mechanic and not a detail.
 */
function collide(pucks: Puck[]): void {
  const d = PUCK_RADIUS * 2;
  for (let i = 0; i < pucks.length; i++) {
    const a = pucks[i];
    if (!a || a.gone) continue;
    for (let j = i + 1; j < pucks.length; j++) {
      const b = pucks[j];
      if (!b || b.gone) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= d * d || distSq === 0) continue;

      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const ny = dy / dist;

      // Push them apart so they cannot settle overlapping and jitter.
      const overlap = (d - dist) / 2;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;

      // Exchange only the component along the normal; the tangential parts are
      // untouched, which is what makes a glancing hit glance.
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel > 0) continue; // already separating
      // Equal masses, restitution e: the impulse is -(1+e)·rel/2. The (1+e) is
      // the part that is easy to drop, and dropping it means a head-on hit
      // leaves the *mover* faster than the puck it just hit — visibly wrong,
      // and it kills the knock-a-puck-through mechanic outright.
      const imp = (-(1 + PUCK_RESTITUTION) * rel) / 2;
      a.vx -= imp * nx;
      a.vy -= imp * ny;
      b.vx += imp * nx;
      b.vy += imp * ny;
    }
  }
}

/* ---------------------------------------------------------------- */
/* The sling (spec §7)                                              */
/* ---------------------------------------------------------------- */

/** The band's two anchor posts, at the bottom corners of the play area. */
export const POST_LEFT = { x: 0.06, y: BAND_REST_Y };
export const POST_RIGHT = { x: 0.94, y: BAND_REST_Y };

/**
 * Where the band actually lies, given the puck held at (px, py) — or null when
 * nothing is loaded. Used by the renderer; the physics does not need it.
 */
export function bandVertex(pull: { x: number; y: number } | null): { x: number; y: number } | null {
  return pull;
}

/**
 * Launch velocity for a puck pulled to (px, py).
 *
 * The band is a V from post to puck to post. Each segment pulls toward its own
 * post, so the launch direction is the sum of the two unit vectors — and that is
 * what gives aiming for free: pull back and to the left and the right-hand
 * segment is the longer one, so it wins and the puck goes up and to the right.
 * Exactly how the real thing behaves, with no special case for it.
 */
export function slingVelocity(px: number, py: number): { vx: number; vy: number } {
  const l1x = POST_LEFT.x - px;
  const l1y = POST_LEFT.y - py;
  const l2x = POST_RIGHT.x - px;
  const l2y = POST_RIGHT.y - py;

  const l1 = Math.sqrt(l1x * l1x + l1y * l1y);
  const l2 = Math.sqrt(l2x * l2x + l2y * l2y);
  if (l1 === 0 || l2 === 0) return { vx: 0, vy: 0 };

  // Sum of the two pulls. Points up-board, away from the stretch.
  let dx = l1x / l1 + l2x / l2;
  let dy = l1y / l1 + l2y / l2;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { vx: 0, vy: 0 };
  dx /= len;
  dy /= len;

  // Speed from the elongation: how much longer the V is than the resting band.
  const rest = POST_RIGHT.x - POST_LEFT.x;
  const stretch = Math.max(0, l1 + l2 - rest);
  const speed = Math.min(MAX_SPEED, ELASTIC_K * stretch);

  return { vx: dx * speed, vy: dy * speed };
}

/** How far back a pull is allowed to go, so the band cannot be over-stretched. */
export function clampPull(px: number, py: number): { x: number; y: number } {
  const x = Math.max(PUCK_RADIUS, Math.min(1 - PUCK_RADIUS, px));
  const back = Math.min(BAND_REST_Y + MAX_PULL, 1 - PUCK_RADIUS);
  const y = Math.max(BAND_REST_Y, Math.min(back, py));
  return { x, y };
}

/** Resting positions for `n` pucks, tucked behind the band. */
export function restingPucks(n: number, nextId = 0): Puck[] {
  const out: Puck[] = [];
  const y = BAND_REST_Y + PUCK_RADIUS * 1.35;
  const span = 1 - PUCK_RADIUS * 2 - 0.04;
  for (let i = 0; i < n; i++) {
    // Spread across the width; with five pucks and this radius they do not
    // overlap, so the collision pass has nothing to resolve on the first frame.
    const t = n === 1 ? 0.5 : i / (n - 1);
    out.push({
      id: nextId + i,
      x: PUCK_RADIUS + 0.02 + t * span,
      y,
      vx: 0,
      vy: 0,
    });
  }
  return out;
}

/** True when a puck is sitting still enough to be loaded onto the band. */
export function isLoadable(p: Puck): boolean {
  return p.vx === 0 && p.vy === 0;
}
