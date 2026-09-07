/**
 * Asteroid Race's field: the same rocks for everybody, from nothing.
 * Spec: docs/specs/games/asteroid-race.md §2.1, §2.1c, §2.3
 *
 * Nothing in here crosses the wire. A formation is a pure function of
 * `roundId` — already broadcast, already unique per round — and its own index
 * down the track, so every phone in the room generates identical rocks in
 * identical places without the referee sending a single one of them. Tiles
 * Surfer's `trackForTile` and UFO Hunt's `ufoPositionAt` are the same device;
 * this one just returns more per call.
 *
 * **Why a formation and not one rock at a time.** A gate (§2.3) only means
 * anything as a set — it is a ring that seals the corridor plus the one rock in
 * the middle that opens it — so the unit this deals in is the formation, and a
 * single rock is a slot inside one.
 *
 * Distances are in ship lengths, matching the referee's own units.
 */

import { ASTEROID_TRACK_LENGTH } from '../../../../shared/protocol';

/** How far apart consecutive formations sit — about 0.9 s at cruise. */
export const ASTEROID_SPACING = 35;

/**
 * The corridor is a TUBE, not an open field: the ship flies down the middle of
 * it and cannot leave. That is what makes a gate possible at all — an open
 * field can always be flown around, so a formation that must be shot could not
 * exist in one (§2.3).
 */
export const ASTEROID_CORRIDOR_R = 7;

/** The ship's own collision radius. Steering is clamped so its hull stays
 *  inside the tube: `hypot(x, y) <= ASTEROID_CORRIDOR_R - ASTEROID_SHIP_R`. */
export const ASTEROID_SHIP_R = 0.8;

/**
 * Two size classes, and the difference is the rule: a small rock is gone in one
 * shot, a large one splits into two smalls (§2.3). `ASTEROID_R_SMALL` is what
 * it is because ten of them have to seal the tube (see the gate ring below) —
 * the gate's arithmetic sets the small rock's size, not the other way round.
 */
export const ASTEROID_R_SMALL = 1.7;
export const ASTEROID_R_LARGE = 3;

/**
 * Roughly one formation in this many is a gate — about one every 12 s, so a
 * 60 s race meets four or five of them and each is an event rather than a
 * rhythm. Started at one in seven, and that was too many: flown by the
 * autopilot in `game.test.ts`, gates accounted for nine deaths in ten, and a
 * race whose scatters are a warm-up for a precision test every 4 s is one
 * game pretending to be another. The missile's 3 s cooldown is far inside
 * this, so a gate is always answerable — and a missile spent on a rock you
 * could have dodged is still one you might want back.
 */
export const ASTEROID_GATE_EVERY = 14;

/**
 * The gate ring: ten rocks at this radius, around one large rock at the middle.
 *
 * These two numbers are load-bearing, and `game.test.ts` proves the seal by
 * sweeping the whole cross-section rather than trusting arithmetic in a
 * comment — because the arithmetic is easy to get wrong in exactly one way.
 * Checking gaps *radially* (ring to centre rock, ring to wall) and *between
 * adjacent surfaces* says six rocks at 4.8 seal the tube. They do not: the
 * binding case is the **diagonal corner** out near the wall, between two
 * adjacent ring rocks, where a hull slips past both at once. Six rocks leave a
 * hole there at every ring radius; ten at 5.0 close it with room to spare.
 *
 * Shoot the middle rock and the middle opens — at first only just, because two
 * halves sitting where their parent was block less than it did, and then
 * properly as they drift apart. Early is comfortable, late is a thread.
 */
export const ASTEROID_GATE_RING = 10;
export const ASTEROID_GATE_RING_R = 5;

/**
 * The finish line is not a stripe in the HUD's own progress bar — it is a wall
 * across the tube, built the same way a gate is (§2.3), that must be shot open
 * before the ship can fly the last stretch to `ASTEROID_TRACK_LENGTH`. Reusing
 * `gate()`'s own shape means the rendering and collision code that already
 * knows how to draw and clip a ring need not know this wall is special at all.
 *
 * `ASTEROID_FINISH_STRETCH` is the "fly through for 2 s" the wall exists to
 * produce: 80 units at `ASTEROID_CRUISE_SPEED` (40 units/s, §2) is 2 s of
 * cruising with nothing left to dodge — a victory lap, not a coast.
 */
export const ASTEROID_FINISH_STRETCH = 80;
export const ASTEROID_FINISH_WALL_Z = ASTEROID_TRACK_LENGTH - ASTEROID_FINISH_STRETCH;

/** Sentinel formation index for the finish wall — never a real formation's
 *  own index, so its rock ids never collide with a dealt formation's. */
const FINISH_WALL_INDEX = -1;

/** How fast each half of a split rock leaves the other (§2.3). */
export const ASTEROID_SPLIT_DRIFT = 18;

export type RockSize = 'small' | 'large';

export type Rock = {
  /** Stable within a round: `${formation}:${slot}` for a dealt rock, and
   *  `${parentId}/${0|1}` for a shard. What a destroyed-set holds. */
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;
  size: RockSize;
  /** Lateral drift, units/s — nonzero only for the two halves of a split rock,
   *  which is what clears the middle of a gate. */
  vx: number;
  vy: number;
  /** Its own silhouette seed, so every phone draws the same rock (§13). */
  seed: number;
};

/**
 * A deterministic 0..1 from three integers. All-int32 arithmetic, so two
 * phones on different engines get bit-identical rocks rather than nearly
 * identical ones.
 */
export function hash01(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Whether formation `i` of this round is a gate. */
export function isGate(roundId: number, i: number): boolean {
  // Never the first two: a race that opens on a wall the player has not been
  // taught to shoot yet is a race that opens on a lost life.
  if (i < 2) return false;
  return hash01(roundId, i, 1) < 1 / ASTEROID_GATE_EVERY;
}

/** How far down the track formation `i` sits. */
export function formationZ(i: number): number {
  return (i + 1) * ASTEROID_SPACING;
}

/** The formation index nearest a given distance — the two together are how the
 *  flight asks for "everything I can see from here". */
export function formationIndexAt(z: number): number {
  return Math.max(0, Math.floor(z / ASTEROID_SPACING) - 1);
}

/**
 * Every rock in formation `i`. A gate is a sealed ring plus its one key; a
 * scatter is one to three rocks placed anywhere in the tube, mostly small.
 */
export function formationAt(roundId: number, i: number): Rock[] {
  const z = formationZ(i);

  // The finish wall owns this whole stretch: two formations' worth of clear
  // air on the approach (same margin a gate gets), the wall's own z, and the
  // victory lap after it, all the way to the true finish line. A regular
  // scatter or probabilistic gate landing in the last few seconds of the race
  // would turn "fly through for 2 s" back into "dodge for 2 s".
  if (z >= ASTEROID_FINISH_WALL_Z - 2 * ASTEROID_SPACING) return [];

  if (isGate(roundId, i)) return gate(roundId, i, z);

  // **A gate gets clear air.** The two formations before one are empty, and so
  // is the one after. Without it the corridor is still delivering rocks to
  // dodge while the gate is asking for the two things a gate asks — be lined
  // up on the middle, and have shot it early enough for the halves to be out
  // of the way — and the answer to a gate becomes luck rather than nerve.
  //
  // It reads well, too: the tube empties, and then there is a wall.
  if (isGate(roundId, i + 1) || isGate(roundId, i + 2) || isGate(roundId, i - 1)) return [];

  const count = 1 + Math.floor(hash01(roundId, i, 2) * 2);
  const rocks: Rock[] = [];
  for (let slot = 0; slot < count; slot++) {
    // Polar placement, square-rooted so rocks do not bunch at the middle of
    // the tube the way a flat radius roll would put them.
    const angle = hash01(roundId, i, 10 + slot) * Math.PI * 2;
    const large = hash01(roundId, i, 40 + slot) < 0.2;
    const r = large ? ASTEROID_R_LARGE : ASTEROID_R_SMALL;
    const reach = Math.max(0, ASTEROID_CORRIDOR_R - r);
    const radius = Math.sqrt(hash01(roundId, i, 20 + slot)) * reach;
    rocks.push({
      id: `${i}:${slot}`,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      // Spread within the formation, so a scatter reads as depth rather than
      // as a flat card of rocks all arriving together.
      z: z + (hash01(roundId, i, 30 + slot) - 0.5) * ASTEROID_SPACING * 0.4,
      r,
      size: large ? 'large' : 'small',
      vx: 0,
      vy: 0,
      seed: Math.floor(hash01(roundId, i, 50 + slot) * 1e6),
    });
  }
  return rocks;
}

/** The finish wall: the same shape as a gate, at the one fixed `z` every
 *  player in the round shares, sealing the tube until its key rock is shot. */
export function finishWallAt(roundId: number): Rock[] {
  return gate(roundId, FINISH_WALL_INDEX, ASTEROID_FINISH_WALL_Z);
}

/** A gate: one large rock in the middle, and a ring that seals everything else. */
function gate(roundId: number, i: number, z: number): Rock[] {
  // The whole ring is rotated by a per-gate angle, so gates do not all look
  // like the same stamped shape.
  const spin = hash01(roundId, i, 3) * Math.PI * 2;
  const rocks: Rock[] = [{
    id: `${i}:key`,
    x: 0,
    y: 0,
    z,
    r: ASTEROID_R_LARGE,
    size: 'large',
    vx: 0,
    vy: 0,
    seed: Math.floor(hash01(roundId, i, 4) * 1e6),
  }];

  for (let slot = 0; slot < ASTEROID_GATE_RING; slot++) {
    const angle = spin + (slot / ASTEROID_GATE_RING) * Math.PI * 2;
    rocks.push({
      id: `${i}:${slot}`,
      x: Math.cos(angle) * ASTEROID_GATE_RING_R,
      y: Math.sin(angle) * ASTEROID_GATE_RING_R,
      z,
      r: ASTEROID_R_SMALL,
      size: 'small',
      vx: 0,
      vy: 0,
      seed: Math.floor(hash01(roundId, i, 60 + slot) * 1e6),
    });
  }
  return rocks;
}

/**
 * A large rock, shot: two small ones leaving in opposite directions (§2.3).
 *
 * They stay live — two moving rocks that can still take a life — which is what
 * keeps shooting a gate a decision rather than a free pass. Blast it early and
 * you fly through a widening gap; blast it late and you fly through two rocks
 * that are still leaving.
 */
export function splitRock(rock: Rock, angle: number): [Rock, Rock] {
  const dx = Math.cos(angle) * ASTEROID_SPLIT_DRIFT;
  const dy = Math.sin(angle) * ASTEROID_SPLIT_DRIFT;
  const half = (n: 0 | 1): Rock => ({
    id: `${rock.id}/${n}`,
    x: rock.x,
    y: rock.y,
    z: rock.z,
    r: ASTEROID_R_SMALL,
    size: 'small',
    vx: n === 0 ? dx : -dx,
    vy: n === 0 ? dy : -dy,
    seed: rock.seed + n + 1,
  });
  return [half(0), half(1)];
}

/** Where a rock is after `ms` of its own drift. Dealt rocks never move, so this
 *  is the identity for all but the two halves of something that was shot. */
export function rockAt(rock: Rock, driftMs: number): Rock {
  if (rock.vx === 0 && rock.vy === 0) return rock;
  const t = Math.max(0, driftMs) / 1000;
  return { ...rock, x: rock.x + rock.vx * t, y: rock.y + rock.vy * t };
}
