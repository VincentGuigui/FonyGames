import { TILT_SMOKE_DRIFT, TILT_SMOKE_LIFE_MS, TILT_SMOKE_PUFFS, TILT_SMOKE_SPREAD } from '../../../../shared/protocol';
import type { Point } from '../../../../shared/tiltTrack';

/**
 * The car's smoke trail. Spec: docs/specs/games/tilt-race.md §4
 *
 * DOM-free, so the recycling can be tested without a canvas.
 *
 * A fixed ring of `TILT_SMOKE_PUFFS` puffs, one re-issued every
 * `TILT_SMOKE_LIFE_MS / TILT_SMOKE_PUFFS`. Fixed rather than a growing list
 * because the trail is a loop: the oldest puff fades out and comes back as the
 * newest, so nothing is ever allocated mid-race.
 */
export type Puff = {
  /** Where the car's tail was when this puff was laid down. */
  at: Point;
  /** The car's heading then — the puff keeps it, so the trail curves with the
   *  line the car actually drove. */
  heading: number;
  /** Which cell of the 3-wide sheet. */
  variant: number;
  bornMs: number;
};

/** How often a puff is re-issued, so the five of them span one lifetime. */
export const SMOKE_EVERY_MS = TILT_SMOKE_LIFE_MS / TILT_SMOKE_PUFFS;

export function newTrail(): Puff[] {
  return [];
}

/**
 * Lay down a puff if one is due. `emitting` is false below the speed the trail
 * is meant to show, and the existing puffs then simply age out.
 */
export function stepSmoke(
  trail: Puff[],
  nowMs: number,
  tail: Point,
  heading: number,
  emitting: boolean,
  random: () => number,
): Puff[] {
  if (!emitting) return trail;
  const newest = trail.length > 0 ? Math.max(...trail.map((p) => p.bornMs)) : -Infinity;
  if (nowMs - newest < SMOKE_EVERY_MS) return trail;

  const puff: Puff = {
    at: { x: tail.x, y: tail.y },
    heading,
    variant: Math.min(2, Math.floor(random() * 3)),
    bornMs: nowMs,
  };
  if (trail.length < TILT_SMOKE_PUFFS) return [...trail, puff];
  // Recycle the oldest rather than growing: the trail is a fixed loop.
  let oldest = 0;
  for (let i = 1; i < trail.length; i++) if (trail[i]!.bornMs < trail[oldest]!.bornMs) oldest = i;
  const out = trail.slice();
  out[oldest] = puff;
  return out;
}

export type PuffPose = {
  x: number;
  y: number;
  heading: number;
  /** 1 when fresh, 0 at the end of its life. */
  alpha: number;
  /** Multiplier on the drawn size — smoke spreads as it hangs. */
  scale: number;
};

/** Where a puff has drifted to, or null once it has faded out. */
export function puffPose(puff: Puff, nowMs: number): PuffPose | null {
  const age = nowMs - puff.bornMs;
  if (age < 0 || age >= TILT_SMOKE_LIFE_MS) return null;
  const t = age / TILT_SMOKE_LIFE_MS;
  // Backwards along the heading it was laid at: the car drives out of its own
  // smoke rather than the smoke chasing it.
  const back = (TILT_SMOKE_DRIFT * age) / 1000;
  return {
    x: puff.at.x - Math.cos(puff.heading) * back,
    y: puff.at.y - Math.sin(puff.heading) * back,
    heading: puff.heading,
    alpha: 1 - t,
    scale: 1 + TILT_SMOKE_SPREAD * t,
  };
}
