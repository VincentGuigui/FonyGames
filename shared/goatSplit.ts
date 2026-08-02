/**
 * Where the kids go when an adult goat is shooed.
 * Spec: docs/specs/games/goat-siege.md §5
 *
 * Shared by the Worker and the browser for the same reason Spill's geometry is:
 * the split has to look identical on every phone, and the cheapest way to
 * guarantee that is for both sides to run the same pure function over the
 * server's `seed` rather than exchange positions or trust a local random.
 *
 * Must stay DOM-free and dependency-free.
 */

/** Deterministic 0..1 from an integer seed. */
export function seeded(seed: number, salt: number): number {
  const x = Math.sin(seed * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Lanes (0..1 across the patch) for the kids of a goat shooed at `lane`.
 *
 * They scatter *away* from where the adult was, alternating sides, so a shoo
 * visibly makes the problem wider rather than just doubling it in place. Kept
 * inside the patch, because a kid that drifts off-screen cannot be tapped and
 * would be an unavoidable lost cabbage.
 */
export function splitLanes(seed: number, lane: number, count: number): number[] {
  const lanes: number[] = [];
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const spread = 0.18 + seeded(seed, i) * 0.22;
    lanes.push(Math.max(0.05, Math.min(0.95, lane + side * spread)));
  }
  return lanes;
}
