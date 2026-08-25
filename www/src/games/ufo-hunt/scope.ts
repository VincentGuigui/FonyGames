import { UFOHUNT_SCOPE_DEG, ufoPositionAt, type UfoWave } from '../../../../shared/protocol';
import { angleBetween, wrapDeg, type Aim } from '../../core/sensors/orientation';

/**
 * Screen geometry for the saucer. Spec: docs/specs/games/ufo-hunt.md §4
 *
 * The full-screen version of what Ghost Hunt's own `radar.ts` does for a small
 * dial: turn an aim and the saucer's true position into a place on screen, or a
 * direction to turn when it is off screen entirely.
 *
 * `ufoPositionAt` — the roam itself — lives in `shared/protocol.ts` rather than
 * being duplicated here, because this game needs the referee and every phone to
 * agree on exactly where the saucer is (spec §8): the client renders this position,
 * and the referee scores a shot against this same position. `angleBetween`/
 * `wrapDeg` come from `core/sensors/orientation.ts` instead of `shared/protocol.ts`'s
 * own worker-side copies — this file runs in the browser, so there is no DOM-free
 * constraint stopping it reusing the tested client implementation directly.
 */

const DEG = Math.PI / 180;

/**
 * How wide the camera's own view reads for placing the saucer on screen.
 *
 * Wider than `UFOHUNT_SCOPE_DEG`, the crosshair's own scoring radius — the saucer
 * has to be visible well before a shot at it would land, or a player could never
 * see it coming. Rendering only: never sent, never scored.
 */
export const VIEW_FOV_DEG = 55;

/** The saucer's true position right now, `now` and `wave.spawnedAt` in the same clock. */
export function saucerAt(wave: UfoWave, now: number): Aim {
  return ufoPositionAt(wave.homeAz, wave.homeEl, wave.index, Math.max(0, now - wave.spawnedAt));
}

/** Degrees off, right and up, from `aim` to `target` — same construction as `radar.ts`'s own `offsetDeg`. */
export function offsetDeg(aim: Aim, target: Aim): { x: number; y: number } {
  // Scaled at the midpoint elevation, same reasoning as Ghost Hunt's own version:
  // the same distance read from both directions, which a lopsided version would not give.
  const mid = ((aim.elevation + target.elevation) / 2) * DEG;
  return {
    x: wrapDeg(target.azimuth - aim.azimuth) * Math.cos(mid),
    y: target.elevation - aim.elevation,
  };
}

/** Where the saucer sits on screen, −1…1 of each axis, or null when it is outside the camera's own view. */
export function screenSpot(aim: Aim, saucer: Aim): { x: number; y: number } | null {
  if (angleBetween(aim, saucer) > VIEW_FOV_DEG) return null;
  const { x, y } = offsetDeg(aim, saucer);
  return { x: x / VIEW_FOV_DEG, y: y / VIEW_FOV_DEG };
}

/**
 * Which way to turn to bring the saucer into view, degrees clockwise from up.
 *
 * Defined even when the saucer is off screen — that is exactly when a player needs
 * it, the same "which way to turn" triangle Ghost Hunt's own radar rim draws.
 */
export function bearingDeg(aim: Aim, saucer: Aim): number {
  const { x, y } = offsetDeg(aim, saucer);
  return Math.atan2(x, y) / DEG;
}

/**
 * How close the crosshair is to the saucer, 0…1, for the reticle's own visual
 * feedback — full at dead centre, nothing at the edge of the scope. Cosmetic only;
 * `ufoImpact` in `shared/protocol.ts` is what the referee actually scores a shot on.
 */
export function scopeHeat(aim: Aim, saucer: Aim, scopeDeg: number = UFOHUNT_SCOPE_DEG): number {
  const error = angleBetween(aim, saucer);
  return Math.max(0, Math.min(1, 1 - error / scopeDeg));
}
