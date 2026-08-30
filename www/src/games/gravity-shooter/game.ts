import {
  GRAVITY_MAX_STRENGTH,
  type GravityPlanet,
  type GravityShot,
  type PlayerId,
  type ServerMessage,
  type GravityShooterState,
} from '../../../../shared/protocol';

/**
 * Gravity Shooter, client side. Spec: docs/specs/games/gravity-shooter.md
 *
 * The referee never runs this game's physics (spec §8, by direct
 * instruction) — a shot's own trajectory is computed here, by both the
 * shooter (to decide `hit`) and the receiver (purely for its own cosmetic
 * replay), from nothing but the match's own immutable planets and the two
 * numbers a `gravity-shot` carries. `simulateShot` is that one function,
 * shared by both call sites so the two phones can never draw a different
 * picture of the same shot — only ever disagree, harmlessly, on where the
 * *pixels* land after a float rounds differently.
 *
 * ## Client-only tuning
 *
 * Every constant below stays out of `shared/protocol.ts` for the same
 * reason Sling Puck's own physics does (`www/src/games/sling-puck/physics.ts`):
 * the referee never touches any of it and never needs to agree with it.
 */

export type Vec = { x: number; y: number };

/** Which of the two fixed seats a ship sits at (spec §2.2): 0 at world
 *  `y = 1`, 1 at world `y = 0` — `GravityShooterState.seats` says who is which. */
export type Seat = 0 | 1;

export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

/** How far a ship sits from its own edge of the shared board, in world units. */
export const GRAVITY_SHIP_MARGIN = 0.08;

/** How far back a pull may go, in the shooter's own local view units, before
 *  strength caps at `GRAVITY_MAX_STRENGTH` — mirrors Sling Puck's own `MAX_PULL`. */
export const GRAVITY_MAX_PULL = 0.3;

/** Launch speed at full strength, in world widths per second. */
export const GRAVITY_MAX_LAUNCH_SPEED = 1.1;

/** Fixed-timestep gravity integration (spec §2.3): 1/60s steps, up to 3s of flight. */
export const GRAVITY_STEP_MS = 1000 / 60;
export const GRAVITY_MAX_STEPS = 180;

/** Acceleration from a planet at distance `dist`: `G * planet.r / max(dist²,
 *  planet.r²)` — the planet's own radius doubles as both the softening
 *  distance near its centre and its own missile-absorption radius
 *  (spec §2.3, §12). */
export const GRAVITY_G = 0.03;

/** A missile within this distance of the opponent's ship is a hit (spec §2.3). */
export const GRAVITY_HIT_RADIUS = 0.06;

/**
 * The simulation's own termination bounds — deliberately wider than the
 * visible `[0,1]x[0,1]` board (spec §2.3, §7), so a slingshot shot that
 * loops off-screen and curves back in is never clipped mid-flight. Only
 * this rectangle and `GRAVITY_MAX_STEPS` end a shot early.
 */
export const GRAVITY_SIM_BOUNDS_MIN = -0.5;
export const GRAVITY_SIM_BOUNDS_MAX = 1.5;

/** A ship's own fixed world position — centred, inset from its own edge. */
export function shipPosition(seat: Seat): Vec {
  return { x: 0.5, y: seat === 0 ? 1 - GRAVITY_SHIP_MARGIN : GRAVITY_SHIP_MARGIN };
}

/**
 * The one render-time transform in the whole game (spec §2.2): the seat NOT
 * at world `y = 1` flips every point so its own phone always draws itself at
 * the bottom. Self-inverse — a viewer's own local point maps back to world
 * the same way — so one function does both directions.
 */
export function viewTransform(seat: Seat, p: Vec): Vec {
  return seat === 0 ? p : { x: 1 - p.x, y: 1 - p.y };
}

/**
 * A local aim — angle from straight up (toward the opponent), positive
 * clockwise; strength 0..1 — turned into a world-frame launch velocity.
 * `viewTransform`'s own derivative is a negation (a translation drops out of
 * a direction), so seat 1's shot is just seat 0's, flipped.
 */
export function localAimToWorldVelocity(angle: number, strength: number, seat: Seat): Vec {
  const speed = strength * GRAVITY_MAX_LAUNCH_SPEED;
  const local = { x: Math.sin(angle) * speed, y: -Math.cos(angle) * speed };
  return seat === 0 ? local : { x: -local.x, y: -local.y };
}

/**
 * A pull away from the ship's own anchor, turned into an angle/strength pair
 * — the shot fires opposite the pull, the same idiom as Sling Puck's own
 * band (spec §2). `(0, 0)` is "nothing pulled", not a valid shot.
 */
export function aimFromPull(dx: number, dy: number): { angle: number; strength: number } {
  const pull = Math.hypot(dx, dy);
  if (pull === 0) return { angle: 0, strength: 0 };
  const strength = Math.min(GRAVITY_MAX_STRENGTH, pull / GRAVITY_MAX_PULL);
  const sx = -dx / pull;
  const sy = -dy / pull;
  return { angle: Math.atan2(sx, -sy), strength };
}

export type SimResult = {
  /** World-frame points, start to finish — the caller draws these in its own view. */
  path: Vec[];
  hit: boolean;
};

/**
 * The whole flight of one shot — a pure function of the match's own
 * immutable planets and the two numbers that cross the wire, so the shooter
 * (deciding `hit`) and the receiver (drawing a cosmetic replay, spec §2.3)
 * always draw the same picture.
 */
export function simulateShot(
  planets: readonly [GravityPlanet, GravityPlanet],
  shooterSeat: Seat,
  angle: number,
  strength: number,
): SimResult {
  const start = shipPosition(shooterSeat);
  const target = shipPosition(otherSeat(shooterSeat));
  const v = localAimToWorldVelocity(angle, strength, shooterSeat);

  let x = start.x;
  let y = start.y;
  let vx = v.x;
  let vy = v.y;
  const path: Vec[] = [{ x, y }];
  const dt = GRAVITY_STEP_MS / 1000;

  for (let i = 0; i < GRAVITY_MAX_STEPS; i++) {
    let ax = 0;
    let ay = 0;
    for (const p of planets) {
      const dx = p.x - x;
      const dy = p.y - y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);
      if (dist <= p.r) return { path, hit: false }; // swallowed by the planet
      const a = (GRAVITY_G * p.r) / Math.max(distSq, p.r * p.r);
      ax += (a * dx) / dist;
      ay += (a * dy) / dist;
    }
    vx += ax * dt;
    vy += ay * dt;
    x += vx * dt;
    y += vy * dt;
    path.push({ x, y });

    if (Math.hypot(x - target.x, y - target.y) <= GRAVITY_HIT_RADIUS) return { path, hit: true };
    if (x < GRAVITY_SIM_BOUNDS_MIN || x > GRAVITY_SIM_BOUNDS_MAX || y < GRAVITY_SIM_BOUNDS_MIN || y > GRAVITY_SIM_BOUNDS_MAX) {
      return { path, hit: false };
    }
  }
  return { path, hit: false };
}

/** A shot in flight (or just resolved), for the canvas to animate. */
export type ActiveShot = {
  seat: Seat;
  result: SimResult;
  /** Local clock time the flight started, so progress can be read at any frame. */
  startedAt: number;
};

function sameShot(a: GravityShot | null, b: GravityShot): boolean {
  return !!a && a.shooter === b.shooter && a.angle === b.angle && a.strength === b.strength && a.hit === b.hit;
}

/**
 * The room's own view of the match: the shared state, plus the two bits of
 * purely-local business the referee has no opinion on — the aim currently
 * being dragged, and the shot currently animating.
 */
export class GravityGame {
  #me: PlayerId = '';
  #now: () => number = () => Date.now();
  #state: GravityShooterState | null = null;
  #aim: Vec | null = null;
  #activeShot: ActiveShot | null = null;
  /** The last shot this phone has already started an animation for — so an
   *  echo of a shot fired optimistically (spec §2.3) never restarts it. */
  #animatedShot: GravityShot | null = null;

  identify(me: PlayerId, now: () => number): void {
    this.#me = me;
    this.#now = now;
  }

  get state(): GravityShooterState | null {
    return this.#state;
  }

  get winner(): PlayerId | null {
    return this.#state?.winner ?? null;
  }

  /** My own fixed seat for the whole match, or null before a round exists. */
  get mySeat(): Seat | null {
    const s = this.#state;
    if (!s) return null;
    if (s.seats[0] === this.#me) return 0;
    if (s.seats[1] === this.#me) return 1;
    return null;
  }

  get isMyTurn(): boolean {
    return !!this.#state && this.#state.phase === 'running' && this.#state.turn === this.#me;
  }

  /** Aiming is only ever mine to do, and only between my own shots. */
  get canAim(): boolean {
    return this.isMyTurn && !this.#activeShot;
  }

  get aim(): Vec | null {
    return this.#aim;
  }

  get activeShot(): ActiveShot | null {
    return this.#activeShot;
  }

  apply(msg: ServerMessage): void {
    if (msg.t !== 'gravity') return;
    const fresh = !this.#state || this.#state.roundId !== msg.d.roundId;
    this.#state = msg.d;
    if (fresh) {
      this.#activeShot = null;
      this.#animatedShot = null;
      this.#aim = null;
      return;
    }

    const shot = msg.d.lastShot;
    if (shot && !sameShot(this.#animatedShot, shot)) {
      this.#animatedShot = shot;
      const seat: Seat = msg.d.seats[0] === shot.shooter ? 0 : 1;
      this.#activeShot = {
        seat,
        result: simulateShot(msg.d.planets, seat, shot.angle, shot.strength),
        startedAt: this.#now(),
      };
    }
  }

  /* ------------------------- input ------------------------- */

  beginAim(): boolean {
    if (!this.canAim) return false;
    this.#aim = { x: 0, y: 0 };
    return true;
  }

  /** Move the pull, clamped to `GRAVITY_MAX_PULL` — a full pull is a full-strength shot. */
  updateAim(dx: number, dy: number): void {
    if (!this.#aim) return;
    const pull = Math.hypot(dx, dy);
    const scale = pull > GRAVITY_MAX_PULL && pull > 0 ? GRAVITY_MAX_PULL / pull : 1;
    this.#aim = { x: dx * scale, y: dy * scale };
  }

  cancelAim(): void {
    this.#aim = null;
  }

  /**
   * Let go. Runs the shot's own simulation right here, on the shooter's own
   * phone (spec §2.3, §8) — the caller sends the returned payload over the
   * wire as-is. Returns null when nothing was pulled far enough to be a shot.
   */
  releaseAim(): { roundId: number; angle: number; strength: number; hit: boolean } | null {
    const aim = this.#aim;
    this.#aim = null;
    const s = this.#state;
    const seat = this.mySeat;
    if (!aim || !s || seat === null) return null;

    const { angle, strength } = aimFromPull(aim.x, aim.y);
    if (strength <= 0) return null;

    const result = simulateShot(s.planets, seat, angle, strength);
    const shot: GravityShot = { shooter: this.#me, angle, strength, hit: result.hit };
    this.#animatedShot = shot;
    this.#activeShot = { seat, result, startedAt: this.#now() };
    return { roundId: s.roundId, angle, strength, hit: result.hit };
  }

  /** How far into its own flight the active shot is, in ms — for the canvas
   *  to pick a point off `result.path`. Null once nothing is animating. */
  shotElapsedMs(): number | null {
    const shot = this.#activeShot;
    return shot ? this.#now() - shot.startedAt : null;
  }

  /** The canvas is done showing this shot (its flight, then any impact GIF). */
  clearActiveShot(): void {
    this.#activeShot = null;
  }
}
