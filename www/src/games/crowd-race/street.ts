import {
  CROWD_BICYCLE_RX,
  CROWD_BICYCLE_RY,
  CROWD_BICYCLE_SPEED,
  CROWD_DOWN_STREET_SHARE,
  CROWD_FINISH_Y,
  CROWD_LANES,
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
 * Every row deals one obstacle into each of `CROWD_LANES` bands across the
 * street, so the crowd is six wide and nothing spawns overlapping — and
 * `closeStraightColumns` below then patches whatever straight column the
 * random deal still leaves open, which the lane count and jitter alone do
 * not guarantee (spec §2.2).
 */
export function dealStreet(roundId: number): ObstacleSpawn[] {
  const slots = slotCount();
  const out: ObstacleSpawn[] = [];
  const margin = CROWD_PERSON_RX + 2;
  const walkable = CROWD_STREET_WIDTH - margin * 2;
  const lane = walkable / CROWD_LANES;

  for (let i = 0; i < slots; i++) {
    for (let l = 0; l < CROWD_LANES; l++) {
      // One `hash01` stream per (row, lane) so adding a lane does not reshuffle
      // the rows that were already dealt.
      const seed = i * CROWD_LANES + l;
      // A third of a spacing, not half: enough that a row does not read as a
      // ruled line, little enough that it stays a row.
      const jitterY = (hash01(roundId, seed, 1) - 0.5) * CROWD_OBSTACLE_SPACING * 0.66;
      const y = CROWD_START_CLEAR + (i + 0.5) * CROWD_OBSTACLE_SPACING + jitterY;

      const kindRoll = hash01(roundId, seed, 2);
      const kind: ObstacleKind =
        kindRoll < TREE_SHARE ? 'tree' : kindRoll < TREE_SHARE + BICYCLE_SHARE ? 'bicycle' : 'pedestrian';

      const rx = kind === 'tree' ? CROWD_TREE_R : kind === 'bicycle' ? CROWD_BICYCLE_RX : CROWD_PERSON_RX;
      const ry = kind === 'tree' ? CROWD_TREE_R : kind === 'bicycle' ? CROWD_BICYCLE_RY : CROWD_PERSON_RY;

      // Inside its own lane, with room for the body, so a row never deals two
      // obstacles on top of each other.
      const room = Math.max(0, lane - rx * 2);
      const x = margin + l * lane + rx + hash01(roundId, seed, 3) * room;

      // Majority down-street (toward the player, `-1`) so the crowd comes at
      // you — the issue's own "most of the moving obstacles are going down".
      const dir: 0 | 1 | -1 =
        kind === 'tree' ? 0 : hash01(roundId, seed, 5) < CROWD_DOWN_STREET_SHARE ? -1 : 1;
      const speed = kind === 'tree' ? 0 : kind === 'bicycle' ? CROWD_BICYCLE_SPEED : CROWD_WALK_SPEED;

      out.push({ id: `${roundId}:${i}:${l}`, kind, x, y, dir, speed, rx, ry });
    }
  }

  return [...out, ...closeStraightColumns(out, roundId)];
}

/**
 * How far one obstacle's own body reaches across the street once the
 * player's own half-width is folded in — the actual test a straight vertical
 * run fails at any `x` inside this range (spec §2.2 follow-up).
 */
function blockedRange(o: { x: number; rx: number }): [number, number] {
  return [o.x - o.rx - CROWD_PERSON_RX, o.x + o.rx + CROWD_PERSON_RX];
}

/** Sorted and merged — the union of however many ranges came in. */
function mergeRanges(ranges: readonly [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [lo, hi] of sorted) {
    const last = merged[merged.length - 1];
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  return merged;
}

/** Whatever `covered` leaves open inside `[lo, hi]`. */
function gapsIn(covered: readonly [number, number][], lo: number, hi: number): [number, number][] {
  const gaps: [number, number][] = [];
  let cursor = lo;
  for (const [a, b] of covered) {
    if (a > cursor) gaps.push([cursor, Math.min(a, hi)]);
    cursor = Math.max(cursor, b);
    if (cursor >= hi) break;
  }
  if (cursor < hi) gaps.push([cursor, hi]);
  return gaps.filter(([a, b]) => b > a);
}

/**
 * The actual guarantee: no straight line from the start to the finish
 * survives (spec §2.2 follow-up, "so there should be more obstacles").
 *
 * A straight run at a fixed `x` fails wherever ANY dealt obstacle's own
 * `blockedRange` reaches across it — `y` never enters into it, because the
 * run spans the whole course and every obstacle sits somewhere inside that
 * span regardless of which row dealt it. So "nothing gets all the way up"
 * reduces to one condition on `x` alone: the union of every obstacle's own
 * `blockedRange` has to cover the whole walkable width. `CROWD_LANES` and the
 * jitter above make that likely, not certain — this closes whatever gap is
 * still open, one tree per gap, sized to exactly span it (`rx = width / 2`,
 * centred on it) and never a unit wider, so a patch can never reach into a
 * neighbour's own body and break the "nothing spawns overlapping" rule
 * `street.test.ts` already holds the rest of the deal to.
 */
function closeStraightColumns(spawns: readonly ObstacleSpawn[], roundId: number): ObstacleSpawn[] {
  const lo = CROWD_PERSON_RX;
  const hi = CROWD_STREET_WIDTH - CROWD_PERSON_RX;
  const covered = mergeRanges(spawns.map(blockedRange));
  const gaps = gapsIn(covered, lo, hi);
  const slots = slotCount();

  return gaps.map(([a, b], n) => {
    const x = (a + b) / 2;
    const r = (b - a) / 2;
    // Anywhere in the course — the guarantee above is purely about `x` — but
    // spread across rows by its own hash rather than piled at one `y`, so a
    // patch reads as one more tree in the crowd rather than a wall bolted on
    // after the fact.
    const row = Math.floor(hash01(roundId, 20_000 + n, 0) * slots);
    const jitterY = (hash01(roundId, 20_000 + n, 1) - 0.5) * CROWD_OBSTACLE_SPACING * 0.66;
    const y = CROWD_START_CLEAR + (row + 0.5) * CROWD_OBSTACLE_SPACING + jitterY;
    return { id: `${roundId}:patch:${n}`, kind: 'tree', x, y, dir: 0, speed: 0, rx: r, ry: r };
  });
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
