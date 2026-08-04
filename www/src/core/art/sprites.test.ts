/**
 * `bucket()` — the only arithmetic in the sprite loader.
 * Contract: docs/design/illustrations.md §4
 *
 * The rest of `sprites.ts` is `Image` and `<canvas>`, which need a browser and are
 * covered by looking at a real round instead (docs/testing.md §1.2). This is here for
 * the same reason as `physics.test.ts`: bucketing is a *stated requirement*, not a
 * detail. Without it a sprite whose drawn size changes every frame — a goat falling
 * on an arc — allocates a canvas per frame, which is invisible until a phone gets
 * warm.
 */
import { bucket } from './sprites';

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

function buckets(): void {
  console.log('\nsize buckets');

  check('a size becomes device pixels', bucket(40, 2) === 80, bucket(40, 2));
  check('and rounds up, never down', bucket(40.1, 2) >= 80.2, bucket(40.1, 2));

  // The whole point: a continuously changing size must collapse onto few buckets.
  const sizes = new Set<number>();
  for (let r = 10; r < 11; r += 0.01) sizes.add(bucket(r, 2));
  check(
    'a size sweeping 10 -> 11 CSS px hits at most 2 buckets',
    sizes.size <= 2,
    [...sizes],
  );

  // A goat's radius across a whole flight, at dpr 2: still a handful.
  const flight = new Set<number>();
  for (let t = 0; t <= 1; t += 0.002) flight.add(bucket(8 + t * 14, 2));
  check('a full flight (8 -> 22 px) stays within the cache cap of 6', flight.size <= 6, [
    ...flight,
  ]);

  check('never smaller than 8 device px', bucket(0.1, 1) === 8, bucket(0.1, 1));
  check('dpr 1 and dpr 2 differ', bucket(40, 1) !== bucket(40, 2), [
    bucket(40, 1),
    bucket(40, 2),
  ]);
  check('every bucket is a multiple of 8', [1, 7, 13.3, 60, 200].every((w) => bucket(w, 2) % 8 === 0));
}

buckets();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
