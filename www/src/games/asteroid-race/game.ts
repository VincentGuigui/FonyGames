import {
  ASTEROID_BOOST_COOLDOWN_MS,
  ASTEROID_BOOST_MS,
  ASTEROID_BOOST_MULTIPLIER,
  ASTEROID_CRUISE_SPEED,
  ASTEROID_LIVES,
  ASTEROID_STUN_MS,
  ASTEROID_TRACK_LENGTH,
} from '../../../../shared/protocol';
import {
  ASTEROID_CORRIDOR_R,
  ASTEROID_R_SMALL,
  ASTEROID_SHIP_R,
  ASTEROID_SPACING,
  formationAt,
  formationIndexAt,
  rockAt,
  splitRock,
  type Rock,
} from './field';

/**
 * Asteroid Race, client side. Spec: docs/specs/games/asteroid-race.md
 *
 * The whole flight lives here, because the whole flight lives on the phone
 * (spec §2.2): the referee never simulates a ship, so there is no second copy
 * of a run to disagree with and nothing here has to match anything but itself.
 * What leaves this file for the room is a distance, a life count and a hit
 * count, once a second.
 *
 * Everything that decides an outcome is a plain function or a method on
 * `AsteroidRun`, with no canvas and no DOM anywhere near it, so `game.test.ts`
 * can fly a whole race in a loop. `AsteroidCanvas.tsx` only ever draws what
 * these return.
 *
 * ## Client-only tuning
 *
 * Every constant below stays out of `shared/protocol.ts` for the reason that
 * file's own Asteroid Race section gives: the referee has no use for a fog
 * distance or a missile cooldown and no need to agree with the phone about
 * either. The ones it DOES need — the track, the speeds, the stun, the lives —
 * are imported from there rather than restated.
 */

export type Vec3 = { x: number; y: number; z: number };

/* ------------------------------- the view ------------------------------- */

/**
 * The camera sits **behind and above** the ship and looks straight down the
 * tube (the issue's own framing, spec §4). Being exactly behind is what keeps
 * the middle of the screen meaning "where I am going": the ship holds the
 * horizontal middle and the corridor slides around it, rather than the ship
 * wandering off toward an edge where its own reticle would follow it.
 */
export const ASTEROID_CAM_BACK = 14;
export const ASTEROID_CAM_UP = 3.4;

/** Focal length, in board widths per unit at unit distance — the field of view.
 *  Wide enough that the tube walls sweep past the edges rather than sitting in
 *  frame, which is most of what sells the speed. */
export const ASTEROID_FOCAL = 2.4;

/** Where the vanishing point sits, as a fraction of board HEIGHT. Everything
 *  else is measured in board WIDTHS from it, so the projection keeps its aspect
 *  on any phone (the same trap Gravity Shooter's aiming missile hit: a height
 *  offset derived from a width is wrong on every non-square board). */
export const ASTEROID_HORIZON = 0.42;

/** Nothing nearer than this is drawn — it is behind or inside the camera. */
export const ASTEROID_NEAR_Z = 1;

/* ------------------------------ the flight ------------------------------ */

/** How fast the ship crosses the tube at full tilt, units/s. Tilt is a
 *  velocity, the same model Neon Fall's own steer uses. */
export const ASTEROID_STEER_SPEED = 14;

/** The missile: how often, how far, and how forgiving its aim (spec §2.3).
 *  Purely local — the referee never sees a missile, so none of this is shared. */
export const ASTEROID_MISSILE_COOLDOWN_MS = 3_000;
export const ASTEROID_MISSILE_RANGE = 400;
/** The beam's own radius around the ship's forward ray. A rock counts as "in
 *  the middle of the screen" when the ray passes within its own radius plus
 *  this — generous, because a reticle you have to thread is not a reticle. */
export const ASTEROID_MISSILE_R = 0.9;
/** How far ahead the reticle is drawn. Cosmetic: the beam is a cylinder, so
 *  the ring is only there to say where it goes. */
export const ASTEROID_RETICLE_LEAD_Z = 120;
/** How long the tracer stays on screen after a shot. */
export const ASTEROID_TRACER_MS = 150;

/**
 * The two impact GIFs' own durations, in ms, measured off the files rather
 * than estimated (`ffprobe -show_entries stream=nb_frames,duration`) —
 * `impact_missile.gif` is 6 frames at 90ms, `explosion.gif` 16 at 60ms, the
 * same two files Gravity Shooter already reads these exact numbers off in its
 * own `game.ts`. The ship's own destruction plays the missile impact where a
 * rock actually met the hull, then — once that has genuinely finished, not a
 * guessed pause in — the explosion at the ship's own position, held one more
 * second before the results panel can appear (spec §4).
 */
export const ASTEROID_IMPACT_GIF_MS = 540;
export const ASTEROID_EXPLOSION_GIF_MS = 960;
/** How long the explosion is held on screen after it has actually finished
 *  playing, before the results panel is allowed to appear. */
export const ASTEROID_FINALE_HOLD_MS = 1_000;

/* -------------------------------- the fog -------------------------------- */

/**
 * The fog (spec §2.4). Rocks fade up out of black rather than popping in, and
 * that fade is a fairness rule as much as a look: a rock is FULLY lit by
 * `ASTEROID_CLEAR_Z`, and that distance must always be at least
 * `ASTEROID_REACTION_MS` of flying at full boost. `warningMs` below is the
 * inequality, and `game.test.ts` asserts it against these very constants — a
 * field that hides a rock until it is unavoidable is not difficult, it is
 * broken.
 */
export const ASTEROID_CLEAR_Z = 150;
export const ASTEROID_DRAW_Z = 600;
export const ASTEROID_REACTION_MS = 1_200;

/** The red halo: the nearest rock in the ship's own path is inside this. */
export const ASTEROID_WARN_Z = 60;

/** How long a lit rock is visible before it arrives, at `speed` units/s. */
export function warningMs(speed: number): number {
  return (ASTEROID_CLEAR_Z / speed) * 1000;
}

/** Top speed anything ever travels — what §2.4's inequality has to hold at. */
export const ASTEROID_BOOST_SPEED = ASTEROID_CRUISE_SPEED * ASTEROID_BOOST_MULTIPLIER;

/** 0 at `ASTEROID_DRAW_Z`, 1 by `ASTEROID_CLEAR_Z`. */
export function fogAlpha(dz: number): number {
  if (dz <= ASTEROID_CLEAR_Z) return 1;
  if (dz >= ASTEROID_DRAW_Z) return 0;
  return (ASTEROID_DRAW_Z - dz) / (ASTEROID_DRAW_Z - ASTEROID_CLEAR_Z);
}

/** How far a hull may be from the tube's axis before it is through the wall. */
export const ASTEROID_REACH = ASTEROID_CORRIDOR_R - ASTEROID_SHIP_R;

/**
 * A world point, projected. `ox`/`oy` are offsets from the vanishing point in
 * board WIDTHS (positive `oy` is down the screen); `scale` turns a world radius
 * into the same units. Null when the point is level with or behind the camera.
 */
export type Projected = { ox: number; oy: number; scale: number };

export function project(p: Vec3, ship: { x: number; y: number; distance: number }): Projected | null {
  const dz = p.z - (ship.distance - ASTEROID_CAM_BACK);
  if (dz <= ASTEROID_NEAR_Z) return null;
  const scale = ASTEROID_FOCAL / dz;
  return { ox: (p.x - ship.x) * scale, oy: (ship.y + ASTEROID_CAM_UP - p.y) * scale, scale };
}

/**
 * Does a ship moving `from` -> `to` this frame touch `rock`?
 *
 * A ray-sphere sweep rather than a point test at each end: at full boost a
 * frame covers 1.2 units and the smallest rock-plus-hull is 2.5, so a point
 * test is safe at 60 fps and stops being safe the moment a phone drops frames
 * — which is exactly when a player would be told they flew through a rock.
 */
export function sweptHit(from: Vec3, to: Vec3, rock: Rock): boolean {
  const reach = rock.r + ASTEROID_SHIP_R;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const fx = from.x - rock.x;
  const fy = from.y - rock.y;
  const fz = from.z - rock.z;
  const c = fx * fx + fy * fy + fz * fz - reach * reach;
  if (c <= 0) return true; // already overlapping at the start of the frame
  const a = dx * dx + dy * dy + dz * dz;
  if (a <= 0) return false;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1;
}

/** Lateral clearance between the ship's forward ray and a rock — negative
 *  means the ray passes through it. What both the missile and the red halo ask. */
export function rayClearance(ship: { x: number; y: number }, rock: Rock): number {
  return Math.hypot(rock.x - ship.x, rock.y - ship.y) - rock.r;
}

/** What a shot fired now would hit: the nearest rock the forward ray passes
 *  through, in range. Nearest, deliberately — not biggest (spec §13). */
export function reticlePick(rocks: readonly Rock[], ship: { x: number; y: number; distance: number }): Rock | null {
  let best: Rock | null = null;
  let bestZ = Infinity;
  for (const rock of rocks) {
    const dz = rock.z - ship.distance;
    if (dz <= 0 || dz > ASTEROID_MISSILE_RANGE) continue;
    if (rayClearance(ship, rock) > ASTEROID_MISSILE_R) continue;
    if (dz < bestZ) {
      bestZ = dz;
      best = rock;
    }
  }
  return best;
}

export type RunEvent =
  | { kind: 'hit'; rock: Rock; at: Vec3 }
  | { kind: 'shot'; rock: Rock; split: boolean }
  /** The rock just hit was the one that spent this run's last life — the ship
   *  itself is destroyed here, at its own position (not the rock's). Fired
   *  alongside the `hit` event for the same rock, never instead of it. */
  | { kind: 'destroyed'; at: Vec3 }
  | { kind: 'finished' };

type Shard = { rock: Rock; bornAtMs: number };

/**
 * One player's own run down the field: where the ship is, what it has left,
 * and which rocks it has already dealt with.
 *
 * Its own clock is `elapsedMs`, advanced only by `step` — every cooldown and
 * every drift is measured against it rather than against `Date.now()`, so a
 * whole race can be flown deterministically in a test.
 */
export class AsteroidRun {
  readonly roundId: number;
  x = 0;
  y = 0;
  distance = 0;
  lives = ASTEROID_LIVES;
  hits = 0;
  elapsedMs = 0;
  /** Set only once the line is crossed — the run stops flying then. */
  finishedAtMs: number | null = null;

  #boostUntilMs = -1;
  #boostReadyAtMs = 0;
  #missileReadyAtMs = 0;
  #stunUntilMs = -1;
  #shotAtMs = -1;
  /** Rocks this phone has destroyed. The dealt field never changes; this is
   *  what makes a shot rock stay shot. */
  #destroyed = new Set<string>();
  #shards: Shard[] = [];

  constructor(roundId: number) {
    this.roundId = roundId;
  }

  get boosting(): boolean {
    return this.elapsedMs < this.#boostUntilMs;
  }

  get stunned(): boolean {
    return this.elapsedMs < this.#stunUntilMs;
  }

  get done(): boolean {
    return this.finishedAtMs !== null || this.lives <= 0;
  }

  /** 0..1 — how far each button has recharged, for the HUD to fill. */
  get boostCharge(): number {
    if (this.boosting) return 0;
    const left = this.#boostReadyAtMs - this.elapsedMs;
    return left <= 0 ? 1 : Math.max(0, 1 - left / ASTEROID_BOOST_COOLDOWN_MS);
  }

  get missileCharge(): number {
    const left = this.#missileReadyAtMs - this.elapsedMs;
    return left <= 0 ? 1 : Math.max(0, 1 - left / ASTEROID_MISSILE_COOLDOWN_MS);
  }

  /** Where the last shot landed, for the tracer to draw a line to. */
  lastShotAt: Vec3 | null = null;

  /** What a shot fired right now would take — what the reticle locks onto, and
   *  what the canvas brackets so a player can see whether they are about to
   *  spend a missile on the wrong rock (spec §2.3). */
  lockedTarget(): Rock | null {
    if (this.done) return null;
    return reticlePick(this.rocksNear(this.distance, this.distance + ASTEROID_MISSILE_RANGE), this);
  }

  /** How long ago the last shot was fired, for the tracer — null once it is
   *  older than `ASTEROID_TRACER_MS`. */
  get tracerAgeMs(): number | null {
    if (this.#shotAtMs < 0) return null;
    const age = this.elapsedMs - this.#shotAtMs;
    return age <= ASTEROID_TRACER_MS ? age : null;
  }

  /** Forward speed right now: cruising, boosting, or standing still because a
   *  rock just took a life (spec §2). */
  get speed(): number {
    if (this.stunned || this.done) return 0;
    return this.boosting ? ASTEROID_BOOST_SPEED : ASTEROID_CRUISE_SPEED;
  }

  /** Every rock currently alive between two distances — the dealt field minus
   *  what this phone has shot, plus the halves of anything it split. */
  rocksNear(zFrom: number, zTo: number): Rock[] {
    const rocks: Rock[] = [];
    const first = formationIndexAt(zFrom);
    const last = Math.ceil(zTo / ASTEROID_SPACING) + 1;
    for (let i = first; i <= last; i++) {
      for (const rock of formationAt(this.roundId, i)) {
        if (this.#destroyed.has(rock.id)) continue;
        if (rock.z < zFrom || rock.z > zTo) continue;
        rocks.push(rock);
      }
    }
    for (const shard of this.#shards) {
      if (this.#destroyed.has(shard.rock.id)) continue;
      if (shard.rock.z < zFrom || shard.rock.z > zTo) continue;
      rocks.push(rockAt(shard.rock, this.elapsedMs - shard.bornAtMs));
    }
    return rocks;
  }

  /** The nearest rock the ship is actually pointed into, and how far ahead it
   *  is — what turns the halo red (spec §4). Null when the path is clear. */
  nearestThreat(): { rock: Rock; dz: number } | null {
    let best: { rock: Rock; dz: number } | null = null;
    for (const rock of this.rocksNear(this.distance, this.distance + ASTEROID_WARN_Z)) {
      // A threat is a rock the ship would actually hit if it held its line —
      // measured against the hull, not against the missile's own wider beam.
      if (Math.hypot(rock.x - this.x, rock.y - this.y) > rock.r + ASTEROID_SHIP_R) continue;
      const dz = rock.z - this.distance;
      if (dz < 0) continue;
      if (!best || dz < best.dz) best = { rock, dz };
    }
    return best;
  }

  /** Hold the boost button. Returns false when it has not recharged. */
  boost(): boolean {
    if (this.done || this.stunned || this.boosting) return false;
    if (this.elapsedMs < this.#boostReadyAtMs) return false;
    this.#boostUntilMs = this.elapsedMs + ASTEROID_BOOST_MS;
    // The cooldown runs from the END of the burst, so a boost is never
    // immediately followed by another.
    this.#boostReadyAtMs = this.#boostUntilMs + ASTEROID_BOOST_COOLDOWN_MS;
    return true;
  }

  /**
   * Fire. Hit-scans the forward ray: a small rock is gone, a large one becomes
   * two smalls leaving in opposite directions (spec §2.3). Returns the event,
   * or null when there was nothing in the reticle or nothing to fire.
   */
  fire(splitAngle = Math.random() * Math.PI * 2): Extract<RunEvent, { kind: 'shot' }> | null {
    if (this.done || this.elapsedMs < this.#missileReadyAtMs) return null;
    const target = reticlePick(this.rocksNear(this.distance, this.distance + ASTEROID_MISSILE_RANGE), this);
    if (!target) return null;

    this.#missileReadyAtMs = this.elapsedMs + ASTEROID_MISSILE_COOLDOWN_MS;
    this.#shotAtMs = this.elapsedMs;
    this.lastShotAt = { x: target.x, y: target.y, z: target.z };
    this.#destroyed.add(target.id);

    if (target.size === 'large') {
      // The drift axis is random, so a gate never opens the same way twice —
      // and both halves stay live, which is what keeps shooting it a decision.
      for (const half of splitRock(target, splitAngle)) {
        this.#shards.push({ rock: half, bornAtMs: this.elapsedMs });
      }
      return { kind: 'shot', rock: target, split: true };
    }
    return { kind: 'shot', rock: target, split: false };
  }

  /**
   * Advance the run by one frame. `steerX`/`steerY` are −1..1 (tilt, or the
   * fallback stick); the ship moves at `ASTEROID_STEER_SPEED` toward them and
   * is clamped inside the tube.
   *
   * Steering is read even while stunned, so a player is not flying blind for
   * their stunned second — the same call Neon Fall makes for its own bounce.
   */
  step(dtMs: number, steerX: number, steerY: number): RunEvent[] {
    const events: RunEvent[] = [];
    if (this.done) {
      this.elapsedMs += dtMs;
      return events;
    }

    // A tab that was backgrounded comes back with an enormous dt. Clamping it
    // means the run simply did not happen while nobody was looking, which is
    // what the referee's own claim window assumes anyway (spec §7, §8).
    const dt = Math.min(Math.max(0, dtMs), 100) / 1000;
    this.elapsedMs += dtMs;

    const from: Vec3 = { x: this.x, y: this.y, z: this.distance };

    // **World y is up-positive**, which is the projection's own convention
    // (`project` measures a point DOWN from a camera sitting at `y + CAM_UP`),
    // so a positive steer climbs. This read `-=` when it was written, which
    // silently drove the ship into the floor of the tube whenever the player
    // asked it to climb; the flight test only ever exercised the x axis, so
    // nothing caught it. Both directions are pinned against the projection now.
    const sx = clamp(steerX, -1, 1);
    const sy = clamp(steerY, -1, 1);
    this.x += sx * ASTEROID_STEER_SPEED * dt;
    this.y += sy * ASTEROID_STEER_SPEED * dt;
    // Clamped to the tube as a circle, not a box: the corridor is round, and a
    // box would let a hull corner sit outside the wall it is drawn against.
    const reach = Math.hypot(this.x, this.y);
    if (reach > ASTEROID_REACH) {
      this.x = (this.x / reach) * ASTEROID_REACH;
      this.y = (this.y / reach) * ASTEROID_REACH;
    }

    this.distance += this.speed * dt;
    const to: Vec3 = { x: this.x, y: this.y, z: this.distance };

    if (!this.stunned) {
      // Only rocks in the slab this frame crossed, widened by the largest
      // possible rock so one straddling the edge is not missed.
      const pad = 2 * (ASTEROID_R_SMALL + ASTEROID_SHIP_R) + 6;
      for (const rock of this.rocksNear(from.z - pad, to.z + pad)) {
        if (!sweptHit(from, to, rock)) continue;
        this.#destroyed.add(rock.id);
        this.hits += 1;
        this.lives = Math.max(0, this.lives - 1);
        this.#stunUntilMs = this.elapsedMs + ASTEROID_STUN_MS;
        // A boost does not survive the rock that ended it.
        this.#boostUntilMs = -1;
        events.push({ kind: 'hit', rock, at: { x: rock.x, y: rock.y, z: rock.z } });
        break; // one rock per frame: a cluster costs one life, not five
      }
    }

    if (this.lives <= 0) {
      // The ship's own position, not the rock's — the rock's `hit` burst and
      // the ship's own `destroyed` explosion land in two different places.
      events.push({ kind: 'destroyed', at: { x: this.x, y: this.y, z: this.distance } });
      return events;
    }

    if (this.distance >= ASTEROID_TRACK_LENGTH) {
      this.distance = ASTEROID_TRACK_LENGTH;
      this.finishedAtMs = this.elapsedMs;
      events.push({ kind: 'finished' });
    }
    return events;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
