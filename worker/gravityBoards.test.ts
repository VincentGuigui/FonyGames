import { gravityBodies } from '../shared/protocol';
import { GRAVITY_FALLBACK_BOARD, rollBoard } from './gravityShooter';
import { simulateShot } from '../www/src/games/gravity-shooter/game';

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

/** The referee's own fan, re-run through the client's real physics. Returns
 *  how many of those shots actually land — 0 is the failure this file exists
 *  to catch, and the rest of the distribution says how open a board is. */
const ANGLES_DEG = [
  -84, -77, -70, -63, -56, -49, -42, -35, -28, -21, -14, -7,
  0,
  7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77, 84,
];
const STRENGTHS = [0, 0.15, 0.3, 0.45, 0.6, 0.8, 1];

function realHits(planets: readonly { x: number; y: number; r: number; art: number }[], starRadius: number, seat: 0 | 1): number {
  const bodies = gravityBodies(starRadius, planets);
  let hits = 0;
  for (const deg of ANGLES_DEG) {
    for (const strength of STRENGTHS) {
      if (simulateShot(bodies, seat, (deg * Math.PI) / 180, strength).hit) hits += 1;
    }
  }
  return hits;
}

/** Enough seeds to be a real sample rather than an anecdote, few enough to
 *  stay a couple of seconds: 120 boards is 240 seat-boards, 42 000 flights. */
const SEEDS = 120;

function everyBoardIsWinnableForReal(): void {
  console.log('\nevery board the referee ships has a shot the real simulation lands');

  let worst = Infinity;
  let barest = 0;
  const total = { hits: 0, seats: 0 };

  for (let seed = 1; seed <= SEEDS; seed++) {
    const board = rollBoard(seeded(seed));
    for (const seat of [0, 1] as const) {
      const hits = realHits(board.planets, board.starRadius, seat);
      if (hits === 0) {
        check(`seed ${seed}, seat ${seat}: the real simulation lands at least one sampled shot`, false, board);
      }
      worst = Math.min(worst, hits);
      if (hits <= 2) barest += 1;
      total.hits += hits;
      total.seats += 1;
    }
  }

  check(`all ${total.seats} seat-boards have a real landing shot`, worst >= 1, worst);
  console.log(`       (mean ${(total.hits / total.seats).toFixed(1)} of ${ANGLES_DEG.length * STRENGTHS.length} sampled shots land; ${barest} seat-boards have two or fewer)`);

  // The fallback ships without any runtime check at all, so it gets the same
  // treatment — and it has to pass on the real physics, not the sampler's.
  for (const seat of [0, 1] as const) {
    check(`the fallback board is really winnable from seat ${seat}`,
      realHits(GRAVITY_FALLBACK_BOARD.planets, GRAVITY_FALLBACK_BOARD.starRadius, seat) > 0);
  }
}

everyBoardIsWinnableForReal();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
