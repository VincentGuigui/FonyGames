/**
 * `shared/tiltTrack.ts` — the circuit, and the geometry the car drives on.
 * Spec: docs/specs/games/tilt-race.md §2, §12 Q5
 *
 * Every assertion here guards something that would reach a player as "the
 * track is broken" with no clue why:
 *
 * - **a circuit that crosses itself** puts two bits of road on top of each
 *   other, and a car that drives into the junction is suddenly on the wrong
 *   lap. This is the failure the polyomino construction exists to prevent, so
 *   it is checked by brute force — every segment pair, on 200 rolled tracks.
 * - **rails that touch** make a corridor with no way through.
 * - **a lap the wrong length** is a round that lasts twenty seconds or five
 *   minutes rather than the ~100 s the spec promises.
 * - **`locate` picking the far side of a doubled-back circuit** teleports the
 *   car's progress, which is exactly what the `hint` window is for.
 */
import {
  CORNER_RADIUS,
  TILE,
  TRACK_CELLS,
  TRACK_COLS,
  TRACK_HALF_WIDTH,
  TRACK_ROWS,
  atArc,
  locate,
  rollTrack,
  type Point,
  type Track,
} from './tiltTrack';
import { TILT_TOP_SPEED, TILT_TARGET_LAP_MS } from './protocol';

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

/** A deterministic 0..1 source, so a "random" track is a fixed one here. */
function seeded(seed: number): () => number {
  let h = seed >>> 0;
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 4294967296;
  };
}

/** Roll `n` tracks from consecutive seeds. */
function tracks(n: number): Track[] {
  const out: Track[] = [];
  for (let seed = 1; out.length < n && seed < n * 20; seed++) {
    const t = rollTrack(seeded(seed));
    if (t) out.push(t);
  }
  return out;
}

/** Do segments `p1→p2` and `p3→p4` cross, other than by sharing an endpoint? */
function crosses(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  // Strictly inside both, so consecutive segments meeting at a shared point
  // are not a crossing.
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

/** The closest approach between two non-adjacent stretches of the centreline.
 *  If this is under `2 × TRACK_HALF_WIDTH` the rails meet. */
function narrowestGap(track: Track): number {
  const n = track.points.length;
  let worst = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Skip stretches that are near each other *along* the track: a rounded
      // corner is legitimately close to itself.
      const along = Math.min(Math.abs(j - i), n - Math.abs(j - i));
      if (along < 12) continue;
      const a = track.points[i] as Point;
      const b = track.points[j] as Point;
      worst = Math.min(worst, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return worst;
}

function rolls(): void {
  console.log('\nevery rolled circuit is a circuit (§12 Q5)');

  const all = tracks(200);
  check(`200 rolls all produced a track (${all.length})`, all.length === 200);

  let notClosed = 0;
  let selfCrossing = 0;
  let outOfBounds = 0;
  let tooFewCorners = 0;
  let worstExample: unknown = null;

  for (const t of all) {
    /*
     * Closed, tested through the arc length rather than the point gap.
     *
     * The first version compared the last point to the first and allowed a
     * tile and a half between them — wrong, and it failed on a quarter of the
     * rolls: the path is rounded, so the last point is the end of the last
     * corner's arc and the first is the start of the first one's, and the
     * straight between them is a legitimate track straight of any length.
     * What "closed" actually means is that `length` accounts for that closing
     * segment, so arc length 0 and arc length `length` are the same place.
     */
    const zero = atArc(t, 0).at;
    const wrapped = atArc(t, t.length).at;
    if (Math.hypot(zero.x - wrapped.x, zero.y - wrapped.y) > 1) {
      notClosed++;
      worstExample ??= { zero, wrapped };
    }
    const summed = (t.cum[t.cum.length - 1] as number)
      + Math.hypot((t.points[0] as Point).x - (t.points[t.points.length - 1] as Point).x, (t.points[0] as Point).y - (t.points[t.points.length - 1] as Point).y);
    if (Math.abs(summed - t.length) > 1e-6) {
      notClosed++;
      worstExample ??= { summed, length: t.length };
    }

    const n = t.points.length;
    if (n < 12) tooFewCorners++;

    for (const p of t.points) {
      if (p.x < -1 || p.y < -1 || p.x > (TRACK_COLS + 1) * TILE || p.y > (TRACK_ROWS + 1) * TILE) {
        outOfBounds++;
        worstExample ??= p;
      }
    }

    // The headline guarantee, by brute force.
    let crossed = false;
    for (let i = 0; i < n && !crossed; i++) {
      const a = t.points[i] as Point;
      const b = t.points[(i + 1) % n] as Point;
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue; // the closing segment shares a point
        const c = t.points[j] as Point;
        const d = t.points[(j + 1) % n] as Point;
        if (crosses(a, b, c, d)) {
          crossed = true;
          worstExample ??= { i, j, a, b, c, d };
          break;
        }
      }
    }
    if (crossed) selfCrossing++;
  }

  check('every circuit closes, and its lap length says so', notClosed === 0, { notClosed, worstExample });
  check('no circuit crosses itself', selfCrossing === 0, { selfCrossing, worstExample });
  check('every point is inside the grid', outOfBounds === 0, { outOfBounds, worstExample });
  check('every circuit has corners to take', tooFewCorners === 0, tooFewCorners);
}

function railsCannotTouch(): void {
  console.log('\nthe rails leave a gap (§2)');

  check('the road is narrower than a cell', TRACK_HALF_WIDTH * 2 < TILE, { width: TRACK_HALF_WIDTH * 2, TILE });
  check('and the corner radius fits inside it', CORNER_RADIUS < TILE, CORNER_RADIUS);

  const all = tracks(60);
  let tight = 0;
  let worst = Infinity;
  for (const t of all) {
    const gap = narrowestGap(t);
    worst = Math.min(worst, gap);
    if (gap < TRACK_HALF_WIDTH * 2) tight++;
  }
  check(
    `the tightest corridor across 60 tracks is ${worst.toFixed(0)} units, road is ${(TRACK_HALF_WIDTH * 2).toFixed(0)}`,
    tight === 0,
    { tight, worst },
  );
}

function lapLength(): void {
  console.log('\na lap is about as long as the spec promises (§1)');

  const all = tracks(120);
  const laps = all.map((t) => t.length).sort((a, b) => a - b);
  const secs = laps.map((l) => l / TILT_TOP_SPEED);
  const median = secs[Math.floor(secs.length / 2)] as number;
  const shortest = secs[0] as number;
  const longest = secs[secs.length - 1] as number;
  const target = TILT_TARGET_LAP_MS / 1000;

  console.log(`       lap at top speed: ${shortest.toFixed(0)}s … ${median.toFixed(0)}s … ${longest.toFixed(0)}s (target ${target}s)`);
  // Wide bands on purpose: this is a random circuit, and a race that varies
  // between rolls is a feature. What must not happen is a 20-second lap or a
  // five-minute one.
  check(`the median lap is within half the target of ${target}s`, Math.abs(median - target) < target * 0.5, median);
  check('the shortest is not a sprint', shortest > target * 0.35, shortest);
  check('the longest is not an endurance event', longest < target * 2, longest);
  check(`${TRACK_CELLS} cells is what produces that`, TRACK_CELLS > 8);
}

function deterministic(): void {
  console.log('\nthe seed is the whole description (§6)');

  const a = rollTrack(seeded(4242));
  const b = rollTrack(seeded(4242));
  check('the same seed gives the same circuit', !!a && !!b && JSON.stringify(a.points) === JSON.stringify(b.points));
  const c = rollTrack(seeded(9999));
  check('a different seed gives a different one', !!a && !!c && JSON.stringify(a.points) !== JSON.stringify(c.points));
  check('and a different length', !!a && !!c && a.length !== c.length);
}

function locating(): void {
  console.log('\nfinding the car on the track');

  const t = rollTrack(seeded(7));
  if (!t) {
    check('a track to test with', false);
    return;
  }

  // A point exactly on the centreline is at zero offset, and its arc length
  // round-trips through `atArc`.
  let worstOffset = 0;
  let worstArc = 0;
  for (let k = 0; k < 200; k++) {
    const s = (t.length * k) / 200;
    const { at } = atArc(t, s);
    const found = locate(t, at);
    worstOffset = Math.max(worstOffset, found.offset);
    // Arc can differ by a lap at the wrap point, so compare the short way round.
    const d = Math.abs(found.s - s);
    worstArc = Math.max(worstArc, Math.min(d, t.length - d));
  }
  check(`a point on the centreline reads as on it (worst ${worstOffset.toFixed(2)} units)`, worstOffset < 0.5, worstOffset);
  check(`and at the arc length it was placed at (worst ${worstArc.toFixed(2)} units)`, worstArc < 1, worstArc);

  // Offset to one side reads as that far off the centre.
  const { at, tangent } = atArc(t, t.length * 0.3);
  const normal = { x: -tangent.y, y: tangent.x };
  const pushed = { x: at.x + normal.x * 20, y: at.y + normal.y * 20 };
  check('a point 20 units off centre reads as 20 off', Math.abs(locate(t, pushed).offset - 20) < 0.5);

  const wall = { x: at.x + normal.x * (TRACK_HALF_WIDTH + 5), y: at.y + normal.y * (TRACK_HALF_WIDTH + 5) };
  check('and past the rail reads as past it', locate(t, wall).offset > TRACK_HALF_WIDTH);

  /*
   * The hint window. On a circuit that doubles back, the globally nearest
   * centreline point can be on the far side of a rail — so a car creeping
   * along must not have its progress teleported to the other stretch.
   */
  let jumps = 0;
  let index = locate(t, atArc(t, 0).at).index;
  let previous = 0;
  for (let k = 1; k <= 400; k++) {
    const s = (t.length * k) / 400;
    const found = locate(t, atArc(t, s).at, index);
    index = found.index;
    const step = found.s - previous;
    // One step is a 400th of a lap; anything much bigger is a teleport.
    if (step < 0 ? step + t.length > t.length / 4 : step > t.length / 4) jumps++;
    previous = found.s;
  }
  check('driving a whole lap never teleports the progress', jumps === 0, jumps);
}

rolls();
railsCannotTouch();
lapLength();
deterministic();
locating();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
