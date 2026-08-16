import {
  GHOST_ROAM_DEG,
  GHOST_ROAM_MS,
  RADAR_FOV_DEG,
} from '../../../../shared/protocol';
import { angleBetween, wrapDeg, type Aim } from '../../core/sensors/orientation';

/**
 * The radar's geometry: where a ghost is, and where it lands on the dial.
 * Spec: docs/specs/games/ghost-hunt.md §2, §4
 *
 * Three questions, one file, no DOM — so all of it is testable without a phone,
 * a camera or a canvas:
 *
 * 1. **Where is the ghost now?** `ghostAt` — its home direction plus a slow roam.
 * 2. **Is it on the dial, and where?** `radarSpot` — −1…1 of the radar's radius.
 * 3. **Which way do I turn?** `bearingDeg` — for the triangle on the rim.
 *
 * ## The roam looks random and is not, on purpose
 *
 * A ghost wanders, and the path is a pure function of the target's index, how long
 * the ghost has been on screen for that player, and how many that player has already
 * caught. Nothing is drawn from `Math.random`.
 *
 * That is a fairness requirement, not a stylistic one. Everyone hunts the same
 * ghosts in the same order (spec §2), and a race where one player's ghost happened
 * to sit still while another's bolted is not a race. Deriving the path from the
 * index gives every phone the same work, and deriving it from the ghost's own age
 * rather than from the round clock means a player who finds it late still gets the
 * same path from the same starting point.
 *
 * ## Except that it speeds up, and only for the player who is winning
 *
 * `speed` scales the drift by that player's own catch count (`ghostSpeed` in game.ts).
 * It is the one thing here that is not identical for everyone, and the fairness above
 * survives in the form that matters: two players who have caught the same number get
 * exactly the same path, so nobody is handed a harder ghost than someone who has done
 * as well. What it stops is a hundred-second hunt rewarding a runaway leader twice —
 * once for being ahead and again for still having the easiest ghost on the table.
 *
 * Two sine terms at incommensurable periods, phased by the index: it drifts, turns
 * back on itself somewhere unexpected, and never traces a circle anyone can learn.
 */

const DEG = Math.PI / 180;

/** The second term's period, deliberately not a neat multiple of the first. */
const SECOND_TERM = 0.61;

/**
 * Where the ghost is, `ageMs` after it appeared.
 *
 * `home` is the direction the server chose. The roam is applied in azimuth and
 * elevation separately, and the azimuth term is divided by `cos(elevation)`: a
 * degree of azimuth is a smaller angle the higher you look, so without it a ghost
 * near the top of the band would roam a fraction of the distance one on the horizon
 * does, and the game would be quietly easier up there.
 *
 * `speed` multiplies the drift and nothing else — the excursion stays inside
 * `GHOST_ROAM_DEG` however fast it is going, because a ghost that ranged further as
 * well as quicker would leave the radar in a way no amount of following could fix.
 * Defaults to 1, the pace of a player's first ghost.
 */
export function ghostAt(home: Aim, index: number, ageMs: number, speed = 1): Aim {
  const t = ((ageMs * speed) / GHOST_ROAM_MS) * 2 * Math.PI;
  // The index only sets the phase, so a ghost is never in the same place at the
  // same age twice, and it never starts at the extreme of its own excursion.
  const phase = index * 1.7;

  const u = Math.sin(t + phase);
  const v = Math.sin(t * SECOND_TERM + phase * 2.3);

  // 0.8 and 0.6 rather than 1 and 1: they are the legs of a 3-4-5 triangle, so the
  // two terms at full excursion together reach exactly `GHOST_ROAM_DEG` and never
  // further. The constant means what it says, which is what the radius is compared
  // against.
  const elevation = home.elevation + v * GHOST_ROAM_DEG * 0.6;
  const shrink = Math.max(0.25, Math.cos(elevation * DEG));

  return {
    azimuth: wrapDeg(home.azimuth + (u * GHOST_ROAM_DEG * 0.8) / shrink),
    elevation,
  };
}

/** Degrees off, right and up, from `aim` to `target`. */
export function offsetDeg(aim: Aim, target: Aim): { x: number; y: number } {
  // Scaled at the midpoint elevation rather than at either end: the same distance
  // read from both directions, which a lopsided version would not give.
  const mid = ((aim.elevation + target.elevation) / 2) * DEG;
  return {
    x: wrapDeg(target.azimuth - aim.azimuth) * Math.cos(mid),
    y: target.elevation - aim.elevation,
  };
}

/**
 * Where the ghost sits on the dial, as −1…1 of the radius, or null when it is not
 * on there at all.
 *
 * Containment is decided by `angleBetween` — the true angle on the sphere — and not
 * by the length of the projected offset. The projection is a flat approximation and
 * disagrees with the sphere by a fraction of a degree at the rim; the difference is
 * invisible in the drawing and would be a scoring bug in the test, so the drawing
 * gets the approximation and the rule gets the sphere.
 */
export function radarSpot(aim: Aim, ghost: Aim): { x: number; y: number } | null {
  if (angleBetween(aim, ghost) > RADAR_FOV_DEG) return null;

  const { x, y } = offsetDeg(aim, ghost);
  return { x: x / RADAR_FOV_DEG, y: y / RADAR_FOV_DEG };
}

/**
 * Which way to turn, in degrees clockwise from straight up.
 *
 * This is what the triangle on the rim points at, so it is defined even when the
 * ghost is nowhere near the dial — that is precisely when a player needs it. Null
 * only when there is no aim or no ghost to compare.
 */
export function bearingDeg(aim: Aim, ghost: Aim): number {
  const { x, y } = offsetDeg(aim, ghost);
  // atan2(x, y) rather than the usual (y, x): 0 is up and it grows clockwise,
  // which is how the rim is drawn and how a person describes a direction.
  return Math.atan2(x, y) / DEG;
}
