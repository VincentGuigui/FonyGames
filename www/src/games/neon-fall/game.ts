import {
  NEON_BOLT_MS,
  NEON_EXPLOSION_MS,
  type NeonFallState,
  type PlayerId,
  type ServerMessage,
} from '../../../../shared/protocol';

/**
 * Neon Fall's client-side state and its pure helpers.
 * Spec: docs/specs/games/neon-fall.md
 *
 * The referee owns every number that matters — lane, fall progress, lives, ammo,
 * bolts. This file holds nothing the server does not already send: `apply` just
 * keeps the latest frame, and everything below it derives a picture from that
 * frame and the shared clock, the same split every other canvas game uses
 * (`goat-siege/game.ts`, `spill/game.ts`).
 */

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export class NeonGame {
  state: NeonFallState | null = null;
  /**
   * Client time the fatal hit was first seen, or null the rest of the time.
   * Stamped once per round, from the shared clock (`identify`) — this is what
   * lets the room hold the death explosion on screen for `NEON_EXPLOSION_MS`
   * before showing results, the same way Pass the Bomb stamps its own
   * `lastBoom.at` the moment a boom frame arrives.
   */
  explodedAt: number | null = null;
  #now: () => number = () => Date.now();

  /** Say whose clock to trust. Separate from the constructor for the same
   *  reason SquashGame's `identify` is: the object exists before the socket. */
  identify(now: () => number): void {
    this.#now = now;
  }

  apply(msg: ServerMessage): void {
    if (msg.t !== 'neon') return;
    if (this.state?.roundId !== msg.d.roundId) this.explodedAt = null;
    if (
      this.explodedAt === null &&
      msg.d.phase === 'done' &&
      msg.d.winner === msg.d.protectorId &&
      msg.d.lives <= 0
    ) {
      this.explodedAt = this.#now();
    }
    this.state = msg.d;
  }

  isGlider(me: PlayerId): boolean {
    return this.state?.gliderId === me;
  }

  isProtector(me: PlayerId): boolean {
    return this.state?.protectorId === me;
  }
}

/**
 * A bolt's telegraph progress: 0 the instant it is fired, 1 as it resolves.
 *
 * Pure function of the clock and the bolt's own `resolvesAt` — the same style
 * Grid Attack's `fuseProgress` and Goat Siege's flight animations use, so a
 * phone that missed a frame still draws the bolt at the right point in its
 * flight rather than restarting its own animation late.
 */
export function boltProgress(resolvesAt: number, now: number): number {
  return clamp(1 - (resolvesAt - now) / NEON_BOLT_MS, 0, 1);
}

/**
 * Is the glider mid-blink right now?
 *
 * A square wave, not a fade — the whole point is "obviously untouchable",
 * which a subtle pulse would undersell. Bounded to only blink while a bounce
 * is actually running (spec §2.3); once `bounceUntil` passes, this reads false
 * even if the caller keeps asking with a stale `now`.
 */
export function blinking(bounceUntil: number, now: number, periodMs = 150): boolean {
  return now < bounceUntil && Math.floor(now / periodMs) % 2 === 0;
}

export type Star = {
  /** 0..1, across the board. */
  x: number;
  /** 0..1, where it currently sits — advanced locally, never synced. */
  y: number;
  /** 0..1, how far "back" it sits — smaller stars drift slower (parallax). */
  depth: number;
};

/**
 * The drifting background stars. Purely decorative and never synced across
 * phones — unlike a goat's sprite variant (illustrations.md §4), nobody but
 * this one player ever looks at their own sky, so there is nothing to agree on.
 */
export function makeStars(count: number, random: () => number = Math.random): Star[] {
  return Array.from({ length: count }, () => ({
    x: random(),
    y: random(),
    depth: 0.3 + random() * 0.7,
  }));
}

/** Advance every star upward by `dt` seconds, wrapping back to the bottom. */
export function stepStars(stars: Star[], dt: number, baseSpeed: number): void {
  for (const s of stars) {
    s.y -= baseSpeed * s.depth * dt;
    if (s.y < 0) s.y += 1;
  }
}

/**
 * The glider's death burst: a fixed ring of shards flying outward from where
 * it was hit. Spec §4, §11.
 *
 * Deterministic on purpose — no `Math.random()` — so the same death always
 * explodes the same way and this is testable without a seed. `angle` is
 * evenly spaced around the ring; `speed` gets a little per-shard variety from
 * the index alone, not chance, so the burst still reads as debris rather than
 * a perfect uniform ring.
 */
const EXPLOSION_SHARD_COUNT = 14;

export type ExplosionShard = { angle: number; speed: number };

export function explosionShards(): ExplosionShard[] {
  return Array.from({ length: EXPLOSION_SHARD_COUNT }, (_, i) => ({
    angle: (i / EXPLOSION_SHARD_COUNT) * Math.PI * 2,
    speed: 0.55 + ((i * 37) % 10) / 20,
  }));
}

/** 0 the instant the glider is hit, 1 once the burst has fully played out. */
export function explosionProgress(explodedAt: number, now: number): number {
  return clamp((now - explodedAt) / NEON_EXPLOSION_MS, 0, 1);
}

