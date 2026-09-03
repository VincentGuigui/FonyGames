import {
  GRAVITY_MAX_STRENGTH,
  GRAVITY_SHIP_MARGIN,
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

/** How far the finger may sit from the ship, in the shooter's own local view
 *  units, before strength caps at `GRAVITY_MAX_STRENGTH`. */
export const GRAVITY_MAX_AIM_DISTANCE = 0.3;

/** Straight-line world distance between the two ships (spec §2.2) — what a
 *  bottom-to-top flight actually covers, used below to turn a target
 *  flight DURATION into a speed rather than picking one by feel. */
const GRAVITY_BOARD_HEIGHT = 1 - 2 * GRAVITY_SHIP_MARGIN;

/**
 * How long a straight, ungravitated shot should take to cross the whole
 * board, weakest pull to strongest — a *display* choice (a second follow-up
 * after #16), not a gravitational one: rather than leaning on `GRAVITY_G` to
 * slow a shot down, the launch speed itself is shaped so a barely-dragged
 * shot still reads as a (slow) missile in flight, and a full-strength one
 * still reads as fast, without either end feeling instant or interminable.
 */
const GRAVITY_MIN_FLIGHT_S = 3;
const GRAVITY_MAX_FLIGHT_S = 6;

/**
 * Launch speed at full strength, in world widths per second — roughly a
 * third of this game's previous value (a second follow-up after #16, on top
 * of the earlier halving): the weaker the missile, the more of its flight
 * gravity gets to shape, so cutting the ceiling further keeps that true even
 * at a full-strength pull. Derived from `GRAVITY_MIN_FLIGHT_S` above rather
 * than hand-picked again, so the "about 3 seconds, full strength" display
 * target is exactly what this constant produces, not a number that
 * quietly drifts away from it the next time either changes.
 */
export const GRAVITY_MAX_LAUNCH_SPEED = GRAVITY_BOARD_HEIGHT / GRAVITY_MIN_FLIGHT_S;

/**
 * Launch speed at the weakest possible pull — a floor, not zero. Strength
 * scales speed BETWEEN this and `GRAVITY_MAX_LAUNCH_SPEED` (see
 * `localAimToWorldVelocity`), so even a shot barely pulled off the ship
 * still reads as a slow missile in flight, capped at `GRAVITY_MAX_FLIGHT_S`,
 * rather than crawling for as long as the lifetime budgets below allow.
 */
export const GRAVITY_MIN_LAUNCH_SPEED = GRAVITY_BOARD_HEIGHT / GRAVITY_MAX_FLIGHT_S;

/** Fixed-timestep gravity integration (spec §2.3): 1/60s steps. */
export const GRAVITY_STEP_MS = 1000 / 60;

/**
 * How long an unresolved shot is kept alive, in ms — not one flat cap, but
 * whichever of these three currently applies to where the missile actually
 * is (issue #16), re-evaluated every step and reset every time the missile
 * moves between them:
 *
 * - `ONSCREEN`: the missile is inside the visible `[0,1]x[0,1]` board.
 * - `OFFSCREEN`: it has left the visible board but not yet flown past the
 *   opponent's own ship — still worth watching loop back in (spec §2.3/§7:
 *   the wider `GRAVITY_SIM_BOUNDS_MIN/MAX` rectangle below is what makes
 *   that possible at all; this is a shorter leash on how long it gets to try).
 * - `PAST_OPPONENT`: it has already flown beyond the opponent's own ship
 *   without hitting — a shot this far past has clearly missed, so it gets
 *   only a token extra second rather than lingering off into space.
 *
 * A budget resets on zone entry rather than accumulating for the whole
 * flight: a shot that leaves the screen, curves back in, and leaves again
 * gets a fresh `OFFSCREEN` allowance each time, the same as the first.
 */
export const GRAVITY_ONSCREEN_LIFETIME_MS = 20_000;
export const GRAVITY_OFFSCREEN_LIFETIME_MS = 7_000;
export const GRAVITY_PAST_OPPONENT_LIFETIME_MS = 1_000;

/** The loop's own outer safety valve — the longest any zone above allows,
 *  so nothing can spin forever regardless of how the zones above change. */
export const GRAVITY_MAX_STEPS = Math.ceil(GRAVITY_ONSCREEN_LIFETIME_MS / GRAVITY_STEP_MS);

/**
 * Acceleration from a planet at distance `dist`: `G * planet.r² / max(dist²,
 * planet.r²)` — mass proportional to the planet's own area, so a bigger
 * planet pulls harder at any given distance, not just asymptotically far
 * from it. The radius doubles as both the softening distance near its
 * centre and its own missile-absorption radius (spec §2.3, §12). Doubled
 * from the original brief once the launch speed above dropped — a slower
 * missile alone still doesn't feel meaningfully pulled unless the pull
 * itself is also stronger — and doubled again after that, so four times the
 * brief's own value. A planet now also physically covers the board's centre
 * (spec §2.1), so every shot has to be curved around something rather than
 * merely nudged.
 */
export const GRAVITY_G = 0.24;

/** A missile within this distance of the opponent's ship is a hit (spec §2.3). */
export const GRAVITY_HIT_RADIUS = 0.06;

/**
 * The simulation's own absolute termination bounds — deliberately wider than
 * the visible `[0,1]x[0,1]` board (spec §2.3, §7), so a shot that loops
 * off-screen and curves back in is never clipped mid-flight; the
 * `GRAVITY_OFFSCREEN_LIFETIME_MS` budget above is the thing that actually
 * ends a shot that leaves the visible board and does not come back, not
 * this rectangle — this is only the unconditional outer wall for a shot
 * that somehow gets flung far enough to leave even that generous margin.
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
 * a direction), so seat 1's shot is just seat 0's, flipped. Speed scales
 * LINEARLY from `GRAVITY_MIN_LAUNCH_SPEED` (strength 0) up to
 * `GRAVITY_MAX_LAUNCH_SPEED` (strength 1) rather than from zero, so the
 * weakest possible pull is still a real, if slow, shot.
 */
export function localAimToWorldVelocity(angle: number, strength: number, seat: Seat): Vec {
  const speed = GRAVITY_MIN_LAUNCH_SPEED + strength * (GRAVITY_MAX_LAUNCH_SPEED - GRAVITY_MIN_LAUNCH_SPEED);
  const local = { x: Math.sin(angle) * speed, y: -Math.cos(angle) * speed };
  return seat === 0 ? local : { x: -local.x, y: -local.y };
}

/**
 * The finger's own position, relative to the ship, turned into an
 * angle/strength pair — the shot fires TOWARD the finger, like a targeting
 * reticle held above the ship, not away from it like a slingshot. `(0, 0)`
 * is "no finger offset yet", not a valid shot.
 */
export function aimFromFinger(dx: number, dy: number): { angle: number; strength: number } {
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { angle: 0, strength: 0 };
  const strength = Math.min(GRAVITY_MAX_STRENGTH, distance / GRAVITY_MAX_AIM_DISTANCE);
  return { angle: Math.atan2(dx, -dy), strength };
}

export type SimResult = {
  /** World-frame points, start to finish — the caller draws these in its own view. */
  path: Vec[];
  hit: boolean;
};

type LifetimeZone = 'onscreen' | 'offscreen' | 'past';

const ZONE_LIFETIME_MS: Record<LifetimeZone, number> = {
  onscreen: GRAVITY_ONSCREEN_LIFETIME_MS,
  offscreen: GRAVITY_OFFSCREEN_LIFETIME_MS,
  past: GRAVITY_PAST_OPPONENT_LIFETIME_MS,
};

/**
 * Which of the three lifetime zones (`GRAVITY_ONSCREEN_LIFETIME_MS` and
 * friends, above) a point currently falls in, relative to a shot's own start
 * and target. `past` outranks `offscreen`: a shot that has already flown
 * beyond its own target's row without hitting has clearly missed, regardless
 * of whether that happens to still be inside `[0,1]x[0,1]` — the opponent's
 * ship sits close to that edge (spec §2.2), so "just past the ship" and
 * "off the visible board" are almost the same place.
 */
function lifetimeZone(p: Vec, start: Vec, target: Vec): LifetimeZone {
  const travelDirection = Math.sign(target.y - start.y);
  if (travelDirection !== 0 && Math.sign(p.y - target.y) === travelDirection) return 'past';
  if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) return 'onscreen';
  return 'offscreen';
}

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

  // Starts `onscreen` by construction — a ship's own position is always
  // inside the visible board. Resets every time the missile crosses into a
  // different zone, rather than accumulating across the whole flight, so a
  // shot that leaves the screen, loops back in, and leaves again gets a
  // fresh budget each time (issue #16).
  let zone: LifetimeZone = 'onscreen';
  let zoneEnteredAtMs = 0;

  for (let i = 0; i < GRAVITY_MAX_STEPS; i++) {
    let ax = 0;
    let ay = 0;
    for (const p of planets) {
      const dx = p.x - x;
      const dy = p.y - y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);
      if (dist <= p.r) return { path, hit: false }; // swallowed by the planet
      const a = (GRAVITY_G * p.r * p.r) / Math.max(distSq, p.r * p.r);
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

    const elapsedMs = (i + 1) * GRAVITY_STEP_MS;
    const nextZone = lifetimeZone({ x, y }, start, target);
    if (nextZone !== zone) {
      zone = nextZone;
      zoneEnteredAtMs = elapsedMs;
    }
    if (elapsedMs - zoneEnteredAtMs >= ZONE_LIFETIME_MS[zone]) return { path, hit: false };
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

  /** The winning seat, or null — a caller wanting a player id back has
   *  `state.seats[winner]`. */
  get winner(): Seat | null {
    return this.#state?.winner ?? null;
  }

  /**
   * Whichever seat is mine to fly right now. Fixed for the whole match in a
   * real two-player game; in solo (`state.solo`) both `seats` are the same
   * connected player, so a player id cannot tell the ships apart — "mine" is
   * instead whichever seat currently holds the turn, which is exactly the
   * seat a hotseat player is meant to be flying this instant.
   */
  get mySeat(): Seat | null {
    const s = this.#state;
    if (!s) return null;
    if (s.solo) return s.turn;
    if (s.seats[0] === this.#me) return 0;
    if (s.seats[1] === this.#me) return 1;
    return null;
  }

  get isMyTurn(): boolean {
    return !!this.#state && this.#state.phase === 'running' && this.mySeat === this.#state.turn;
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
      this.#activeShot = {
        seat: shot.shooter,
        result: simulateShot(msg.d.planets, shot.shooter, shot.angle, shot.strength),
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

  /** Move the finger, clamped to `GRAVITY_MAX_AIM_DISTANCE` from the ship —
   *  that distance is a full-strength shot. */
  updateAim(dx: number, dy: number): void {
    if (!this.#aim) return;
    const distance = Math.hypot(dx, dy);
    const scale = distance > GRAVITY_MAX_AIM_DISTANCE && distance > 0 ? GRAVITY_MAX_AIM_DISTANCE / distance : 1;
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

    const { angle, strength } = aimFromFinger(aim.x, aim.y);
    if (strength <= 0) return null;

    const result = simulateShot(s.planets, seat, angle, strength);
    const shot: GravityShot = { shooter: seat, angle, strength, hit: result.hit };
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
