import { GRAVITY_MAX_AIM_DISTANCE, GRAVITY_MIN_AIM_DISTANCE, GRAVITY_MIN_LANDING_SHOTS, gravityBodies } from '../shared/protocol';
import { GRAVITY_FALLBACK_BOARD, rollBoard } from './gravityShooter';
import { aimFromFinger, simulateShot } from '../www/src/games/gravity-shooter/game';

/**
 * The one test that spans both sides of Gravity Shooter's physics: the
 * referee's board roller, and the client simulation that actually flies the
 * shots on it. Spec: docs/specs/games/gravity-shooter.md §2.1
 *
 * Every other test here stays on one side of that line on purpose — the
 * referee never runs the game's physics (spec §8) and keeps its own coarse
 * copy for one job only, checking a fresh board is winnable. But "coarse copy"
 * is exactly the kind of claim that rots silently: it can drift from the real
 * model and go on reporting success, and the board it green-lights is the
 * board two people then fail to win on.
 *
 * So this file asserts the thing the maintainer actually asked for, in the
 * only terms that mean anything — **every board the referee ships has a shot
 * that the REAL simulation lands, for both seats.** It found a genuine bug the
 * first time it ran: the sampler ignored the real flight's `past the opponent`
 * budget, so 5 of 600 seat-boards shipped with a "guaranteed" trajectory that
 * the real missile never completes.
 */

let checks = 0;
let failures = 0;

function check(label: string, cond: boolean, extra?: unknown): void {
  checks += 1;
  if (cond) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${extra === undefined ? '' : ` ${JSON.stringify(extra)}`}`);
}

/** xorshift32, the same shape the other referee tests seed with. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * The referee's own fan, re-run through the client's REAL physics — the same
 * 25 directions x 7 distances over the aim disc, in the same finger space.
 * Returns how many land: 0 is the failure this file exists to catch, and
 * anything under `GRAVITY_MIN_LANDING_SHOTS` means the board shipped with less
 * room to aim than the referee believed it had.
 */
const DIRECTIONS_DEG = [
  -84, -77, -70, -63, -56, -49, -42, -35, -28, -21, -14, -7,
  0,
  7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77, 84,
];
const DISTANCE_STEPS = 6;

function realLandingShots(
  planets: readonly { x: number; y: number; r: number; art: number }[],
  starRadius: number,
  seat: 0 | 1,
): number {
  const bodies = gravityBodies(starRadius, planets);
  const span = GRAVITY_MAX_AIM_DISTANCE - GRAVITY_MIN_AIM_DISTANCE;
  let landed = 0;
  for (const deg of DIRECTIONS_DEG) {
    for (let step = 0; step <= DISTANCE_STEPS; step++) {
      const distance = GRAVITY_MIN_AIM_DISTANCE + (span * step) / DISTANCE_STEPS;
      const a = (deg * Math.PI) / 180;
      const aim = aimFromFinger(Math.sin(a) * distance, -Math.cos(a) * distance);
      if (simulateShot(bodies, seat, aim.angle, aim.strength).hit) landed += 1;
    }
  }
  return landed;
}

/** Enough seeds to be a real sample rather than an anecdote, few enough to
 *  stay a couple of seconds. */
const SEEDS = 80;

function everyBoardLeavesRoomToAim(): void {
  console.log('\nevery board the referee ships leaves both seats room to aim, in the real physics');

  let worst = Infinity;
  const total = { hits: 0, seats: 0 };

  for (let seed = 1; seed <= SEEDS; seed++) {
    const board = rollBoard(seeded(seed));
    for (const seat of [0, 1] as const) {
      const hits = realLandingShots(board.planets, board.starRadius, seat);
      if (hits < GRAVITY_MIN_LANDING_SHOTS) {
        check(`seed ${seed}, seat ${seat}: the real simulation lands the promised ${GRAVITY_MIN_LANDING_SHOTS} shots`, false, { hits, board });
      }
      worst = Math.min(worst, hits);
      total.hits += hits;
      total.seats += 1;
    }
  }

  check(`all ${total.seats} seat-boards clear the bar of ${GRAVITY_MIN_LANDING_SHOTS} under the real physics`,
    worst >= GRAVITY_MIN_LANDING_SHOTS, worst);
  console.log(`       (mean ${(total.hits / total.seats).toFixed(1)} of ${DIRECTIONS_DEG.length * (DISTANCE_STEPS + 1)} sampled shots land; worst board ${worst})`);

  // The fallback ships without any runtime check at all, so it gets the same
  // treatment — and it has to pass on the real physics, not the sampler's.
  for (const seat of [0, 1] as const) {
    const hits = realLandingShots(GRAVITY_FALLBACK_BOARD.planets, GRAVITY_FALLBACK_BOARD.starRadius, seat);
    check(`the fallback board really leaves seat ${seat} room to aim`, hits >= GRAVITY_MIN_LANDING_SHOTS * 2, hits);
  }
}

everyBoardLeavesRoomToAim();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
