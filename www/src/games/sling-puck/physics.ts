/**
 * Sling Puck's board simulation. Spec: docs/specs/games/sling-puck.md §4, §6, §7
 *
 * Lives here and **not** in `shared/` on purpose. Unlike Spill's seat geometry
 * or Goat Siege's split lanes, nothing on the server needs to agree with this:
 * each phone owns its own half of the board, nobody else can see it, and the
 * only thing that crosses the wire is a puck leaving through the gap. There is
 * no second copy of a puck anywhere, so there is nothing to desynchronise.
 *
 * ## Units
 *
 * One unit is **one board width**, in *both* axes. So `x` runs 0..1 across the
 * board and `y` runs 0..`BOARD_H` down it, and a radius means the same distance
 * whichever way it is pointing.
 *
 * That isotropy is the whole reason the board has a fixed aspect ratio rather
 * than being the shape of whatever phone it is on. Normalising `x` by the width
 * and `y` by the height would be tidier to write and visibly wrong to play: a
 * puck would stop short of the top wall but touch the side ones, and a bounce
 * off a side wall would change the shot's apparent angle. Sizes differ between
 * the two phones; the board must not.
 *
 * No trigonometry anywhere — reflections, the sling and puck collisions are all
 * dot products, so this is plain IEEE-754 arithmetic.
 */

/* ---------------------------------------------------------------- */
/* Internal settings. Tuning constants, never player-facing (spec §6). */
/* ---------------------------------------------------------------- */

/** Pucks per player at the start of a round. */
export const SLING_PUCKS = 5;

/**
 * The board's shape: width ÷ height, for **one player's half**.
 *
 * Taller than it is wide, because two phones nose to nose in portrait make a
 * long thin table and each player owns half of it. Letterboxed on screen rather
 * than stretched to fit, so both phones simulate the same board.
 */
export const BOARD_ASPECT = 0.62;

/** Board height, in board widths. Every `y` in this module runs 0..this. */
export const BOARD_H = 1 / BOARD_ASPECT;

/** Puck radius, in board widths — the same distance in both axes. */
export const PUCK_RADIUS = 0.055;

/**
 * Launch speed per unit of band *elongation*, in board widths per second.
 *
 * Large because the elongation is small: the band spans nearly the whole width,
 * so pulling it back by a third of a width only lengthens the V by about a
 * quarter. That is the real geometry of the toy, not a fudge — the constant
 * simply has to absorb it.
 */
export const ELASTIC_K = 8;

/**
 * Hard cap on launch speed, in board widths per second.
 *
 * Above the fastest a full pull produces, so in normal play it never bites. It
 * is a safety net for a forged or bugged pull, not part of the feel.
 */
export const MAX_SPEED = 2.6;

/** How far back from the band a pull may go, in board widths. */
export const MAX_PULL = 0.24 * BOARD_H;

/**
 * Where the band sits when relaxed, as a fraction of the board height.
 *
 * High enough up the board to leave `MAX_PULL` of room behind it: `0.72 + 0.24`
 * puts a full pull at `0.96`, just inside the bottom wall. With the band any
 * lower there is nowhere to pull to and every shot is feeble.
 */
export const BAND_REST_FRACTION = 0.72;
export const BAND_REST_Y = BAND_REST_FRACTION * BOARD_H;

/** How fast the band whips back once released. Visual only. */
export const BAND_SNAP = 14;

/**
 * Constant deceleration — a puck sliding on wood.
 *
 * Deliberately *not* `v *= 0.98`: linear damping never quite stops and feels
 * like syrup. Subtracting a fixed amount of speed per second is what a disc on a
 * board actually does, and it comes to rest.
 */
export const FRICTION = 0.6;

/** Energy kept in a wall bounce. */
export const RESTITUTION = 0.72;

/** Energy kept in a puck-on-puck hit. */
export const PUCK_RESTITUTION = 0.86;

/** Width of the gap in the top wall, as a fraction of the board width. */
export const GAP_FRACTION = 0.34;

/** Below this a puck is treated as stopped. */
export const REST_SPEED = 0.03;

/**
 * Physics sub-steps per rendered frame.
 *
 * This exists so a fast puck cannot tunnel through a wall. At `MAX_SPEED` one
 * 60 fps frame moves a puck ~0.043 — most of a radius — and four sub-steps takes
 * that to ~0.011, leaving room for the constants to be tuned upwards without
 * pucks escaping the board.
 */
export const SUB_STEPS = 4;

/**
 * Launch speed for the tap-to-launch fallback (spec §13).
 *
 * Comfortably under what a full pull produces, but enough to carry a puck to the
 * gap from anywhere on the rack — a fallback that cannot score is not a fallback.
 */
export const TAP_SPEED = 1.7;

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

  if (p.y > BOARD_H - r) {
    p.y = BOARD_H - r;
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

/** The band's two anchor posts, near the side walls. */
export const POST_LEFT = { x: 0.06, y: BAND_REST_Y };
export const POST_RIGHT = { x: 0.94, y: BAND_REST_Y };

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
  const back = Math.min(BAND_REST_Y + MAX_PULL, BOARD_H - PUCK_RADIUS);
  const y = Math.max(BAND_REST_Y, Math.min(back, py));
  return { x, y };
}

/**
 * Launch velocity for the tap-to-launch fallback (spec §13): straight at the
 * middle of the gap, at a fixed modest speed.
 *
 * It deliberately does **not** go through the sling. The obvious implementation —
 * pull the puck straight back a fixed distance and let the band fire it — cannot
 * work, and the reason is the band model itself: a puck near the left edge sits
 * in a lopsided V, so the long right-hand segment wins and the shot goes up and
 * hard to the right, into the wall. Three of the five pucks in the opening rack
 * could not reach the gap that way, which is a fallback that does not fall back.
 *
 * So the tap aims. What it gives up in exchange is everything else: it cannot
 * choose power, cannot bank off a side wall, and cannot line up on another puck
 * to knock it through. It only ever plays the plainest shot on the board.
 */
export function tapVelocity(px: number, py: number): { vx: number; vy: number } {
  const dx = 0.5 - px;
  const dy = PUCK_RADIUS - py;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { vx: 0, vy: -TAP_SPEED };
  return { vx: (dx / len) * TAP_SPEED, vy: (dy / len) * TAP_SPEED };
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
