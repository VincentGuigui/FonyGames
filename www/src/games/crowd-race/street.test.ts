import {
  CROWD_DOWN_STREET_SHARE,
  CROWD_FINISH_Y,
  CROWD_START_CLEAR,
  CROWD_STREET_WIDTH,
} from '../../../../shared/protocol';
import { dealStreet, ellipsesOverlap, slotCount } from './street';

/**
 * The street: dealt from `roundId` alone, and the ellipse overlap test both
 * player movement and the referee's own placings never touch directly.
 * Spec: docs/specs/games/crowd-race.md §2.2
 */

let failures = 0;
let checks = 0;
function check(what: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${what}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${what}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

function dealing(): void {
  console.log('\nthe street is dealt from roundId alone (§2.2)');

  const a = dealStreet(101);
  const aAgain = dealStreet(101);
  const b = dealStreet(202);

  check('the same round deals the same street', JSON.stringify(a) === JSON.stringify(aAgain));
  check('a different round deals a different one', JSON.stringify(a) !== JSON.stringify(b));
  check('there is at least one slot', a.length === slotCount() && a.length > 0, a.length);

  check('nothing is dealt in the cleared start zone', a.every((o) => o.y >= CROWD_START_CLEAR), a.filter((o) => o.y < CROWD_START_CLEAR));
  check('nothing is dealt past the finish', a.every((o) => o.y < CROWD_FINISH_Y), a.filter((o) => o.y >= CROWD_FINISH_Y));
  check('every obstacle stays inside the street width', a.every((o) => o.x - o.rx >= 0 && o.x + o.rx <= CROWD_STREET_WIDTH));

  const trees = a.filter((o) => o.kind === 'tree');
  const bicycles = a.filter((o) => o.kind === 'bicycle');
  const pedestrians = a.filter((o) => o.kind === 'pedestrian');
  check('all three kinds actually appear', trees.length > 0 && bicycles.length > 0 && pedestrians.length > 0, {
    trees: trees.length, bicycles: bicycles.length, pedestrians: pedestrians.length,
  });
  check('bicycles are the rarest kind', bicycles.length < trees.length && bicycles.length < pedestrians.length);
  check('every tree is fixed', trees.every((o) => o.dir === 0 && o.speed === 0));
  check('every mover has a direction and a speed', [...bicycles, ...pedestrians].every((o) => o.dir !== 0 && o.speed > 0));

  // Pooled across many rounds so one unlucky roll cannot fail the share — a
  // fixed screen holds only a handful of slots per round, far fewer
  // than the long scrolling course this test was first written against, so
  // it takes many more rounds pooled to reach the same sample size.
  const seeds = Array.from({ length: 80 }, (_, i) => 1000 + i);
  const movers = seeds.flatMap((seed) => dealStreet(seed).filter((o) => o.kind !== 'tree'));
  const downStreet = movers.filter((o) => o.dir === -1).length;
  const share = downStreet / movers.length;
  check(`about ${Math.round(CROWD_DOWN_STREET_SHARE * 100)}% walk down-street (${(share * 100).toFixed(0)}%)`, Math.abs(share - CROWD_DOWN_STREET_SHARE) < 0.08, share);
}

function overlap(): void {
  console.log('\nellipse-vs-ellipse (used by both game.ts and the referee)');

  check('concentric ellipses overlap', ellipsesOverlap(0, 0, 10, 10, 0, 0, 10, 10));
  check('far apart, no overlap', !ellipsesOverlap(0, 0, 10, 10, 1000, 1000, 10, 10));
  check('just touching along x is not yet an overlap', !ellipsesOverlap(0, 0, 10, 10, 20.01, 0, 10, 10));
  check('a hair inside touching is an overlap', ellipsesOverlap(0, 0, 10, 10, 19.9, 0, 10, 10));
  check('a tall ellipse overlaps along y further than along x', ellipsesOverlap(0, 0, 5, 20, 0, 35, 5, 20) && !ellipsesOverlap(0, 0, 5, 20, 35, 0, 5, 20));
}

dealing();
overlap();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
