import {
  CROWD_BICYCLE_RX,
  CROWD_BICYCLE_RY,
  CROWD_BICYCLE_SPEED,
  CROWD_DOWN_STREET_SHARE,
  CROWD_FINISH_Y,
  CROWD_OBSTACLE_SPACING,
  CROWD_PERSON_RX,
  CROWD_PERSON_RY,
  CROWD_START_CLEAR,
  CROWD_STREET_WIDTH,
  CROWD_TREE_R,
  CROWD_WALK_SPEED,
} from '../../../../shared/protocol';

/**
 * The street: every obstacle's spawn spot, kind and direction, dealt once
 * from `roundId` alone. Spec: docs/specs/games/crowd-race.md §2.2
 *
 * **Fixed, not scrolling — the whole street is one screen.** One
 * arithmetic pass deals every obstacle across the fixed band between
 * `CROWD_START_CLEAR` and `CROWD_FINISH_Y`, the same `formationAt(roundId,
 * index)` pattern Asteroid Race's field uses (that spec's own §2.1) — there
 * is no camera to stream a window around, since the whole course is always
 * on screen at once.
 *
 * **Private, not synced.** Every phone deals the identical spawn plan from
 * `roundId`, but from there each phone's own bounces and cascades are simulated
 * locally and never cross the wire — the same reason nobody else's asteroid
 * field is affected by your missiles (asteroid-race.md §2.2). A bounce is
 * triggered by one player's own collision, which the referee cannot see and
 * has no reason to; keeping the crowd private is what lets `crowd-move`
 * (spec §6) carry a position and nothing else.
 */

export type ObstacleKind = 'tree' | 'pedestrian' | 'bicycle';

export type ObstacleSpawn = {
  id: string;
  kind: ObstacleKind;
  /** Spawn position, world units. A tree never leaves it. */
  x: number;
  y: number;
  /** The sign `game.ts`'s own `y += dir * speed * dt` applies: `+1` is
   *  up-street, the same direction the player walks; `-1` is down-street,
   *  toward the player. 0 for a tree. */
  dir: 0 | 1 | -1;
  /** World units/s. 0 for a tree. */
  speed: number;
  rx: number;
  ry: number;
};

/**
 * A deterministic 0..1 from three integers, all-int32 arithmetic so two
 * phones on different engines deal the identical street rather than a nearly
 * identical one. The same construction as Asteroid Race's own `hash01`
 * (field.ts) — small enough, and specific enough to each game's own salt
 * numbers, that sharing one copy across games would buy nothing but a cross-
 * game import for two dozen lines.
 */
export function hash01(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Share of dealt slots that are each kind. Bicycles last and rarest, per the
 *  issue's own "correspondingly rarer" (crowd-race.md §2.2). */
const TREE_SHARE = 0.22;
const BICYCLE_SHARE = 0.12;

/** How many slots the course holds, before any are dealt. */
export function slotCount(): number {
  const span = Math.max(0, CROWD_FINISH_Y - CROWD_START_CLEAR);
  return Math.floor(span / CROWD_OBSTACLE_SPACING);
}

/**
 * The whole street, dealt from `roundId`. One slot per `CROWD_OBSTACLE_SPACING`
 * of course, each jittered in `y` by up to half a spacing so the street does
 * not read as a grid, and in `x` across the walkable width.
 *
 * A tree's `x` is biased toward one edge or the other — "trees down both
 * sides" (the card's own illustration) — rather than drawn uniformly, which
 * would plant them in the middle of the walkway as often as at its edge.
 */
export function dealStreet(roundId: number): ObstacleSpawn[] {
  const slots = slotCount();
  const out: ObstacleSpawn[] = [];
  const margin = CROWD_PERSON_RX + 2;

  for (let i = 0; i < slots; i++) {
    const jitterY = (hash01(roundId, i, 1) - 0.5) * CROWD_OBSTACLE_SPACING;
    const y = CROWD_START_CLEAR + (i + 0.5) * CROWD_OBSTACLE_SPACING + jitterY;

    const kindRoll = hash01(roundId, i, 2);
    const kind: ObstacleKind = kindRoll < TREE_SHARE ? 'tree' : kindRoll < TREE_SHARE + BICYCLE_SHARE ? 'bicycle' : 'pedestrian';

    let x: number;
    if (kind === 'tree') {
      const side = hash01(roundId, i, 3) < 0.5 ? 0 : 1;
      const band = hash01(roundId, i, 4) * (CROWD_STREET_WIDTH * 0.12);
      x = side === 0 ? margin + band : CROWD_STREET_WIDTH - margin - band;
    } else {
      x = margin + hash01(roundId, i, 3) * (CROWD_STREET_WIDTH - margin * 2);
    }

    // Majority down-street (toward the player, `-1`) so the crowd comes at
    // you — the issue's own "most of the moving obstacles are going down".
    const dir: 0 | 1 | -1 = kind === 'tree' ? 0 : hash01(roundId, i, 5) < CROWD_DOWN_STREET_SHARE ? -1 : 1;
    const speed = kind === 'tree' ? 0 : kind === 'bicycle' ? CROWD_BICYCLE_SPEED : CROWD_WALK_SPEED;
    const rx = kind === 'tree' ? CROWD_TREE_R : kind === 'bicycle' ? CROWD_BICYCLE_RX : CROWD_PERSON_RX;
    const ry = kind === 'tree' ? CROWD_TREE_R : kind === 'bicycle' ? CROWD_BICYCLE_RY : CROWD_PERSON_RY;

    out.push({ id: `${roundId}:${i}`, kind, x, y, dir, speed, rx, ry });
  }

  return out;
}

/**
 * Ellipse-vs-ellipse overlap, by normalised distance rather than exact conic
 * intersection: scale the gap between centres by each axis's own combined
 * half-width, and two bodies touch where that scaled distance is under 1.
 * Exact for two circles, a close and much cheaper stand-in for two ellipses —
 * plenty for a party game's hitboxes, and it keeps "taller than wide" cheap
 * to check at whatever obstacle count a street holds.
 */
export function ellipsesOverlap(
  ax: number, ay: number, arx: number, ary: number,
  bx: number, by: number, brx: number, bry: number,
): boolean {
  const dx = (ax - bx) / (arx + brx);
  const dy = (ay - by) / (ary + bry);
  return dx * dx + dy * dy < 1;
}
