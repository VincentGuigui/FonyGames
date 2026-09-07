/**
 * Tilt Race's circuit, and the geometry the car drives on.
 * Spec: docs/specs/games/tilt-race.md §2, §12 Q5
 *
 * Shared because the referee rolls the track and every phone drives it, and
 * they have to agree about it exactly — the referee clamps a reported arc
 * length against the same lap length the phone measured its progress on.
 * Must stay DOM-free: it typechecks under tsconfig.worker.json.
 *
 * ## Tiles, not a spline (spec §12 Q5)
 *
 * The spec left this open and leaned toward tiles as "far easier to guarantee".
 * That is right, and the method here is stronger than assembling pre-made
 * tiles: the circuit is the **boundary of a polyomino**.
 *
 * Grow a blob of grid cells; its outline is the centreline. That gets three
 * things for free that a spline has to be argued about, and a tile bag has to
 * be hand-checked:
 *
 * 1. **It is closed.** A boundary always is.
 * 2. **It never crosses itself**, provided the blob has no hole and no
 *    diagonal pinch — both of which are cheap to test *before* accepting a
 *    cell (`wouldPinch`, `hasHole`). With those two rules every boundary
 *    vertex has exactly one outgoing edge, so the walk cannot fork.
 * 3. **The rails cannot touch.** Two opposite sides of a one-cell-wide arm are
 *    exactly `TILE` apart, so any road narrower than that leaves a gap — and
 *    `TRACK_HALF_WIDTH` is well under `TILE / 2`.
 *
 * What it does *not* get for free is length: a round blob has a short
 * perimeter, and this game wants roughly 100 s of driving. Hence the growth
 * bias in `roll` toward cells that extend an arm, which makes long snaking
 * circuits instead of potatoes.
 */

/** One grid cell, in world units. The whole track is measured in these. */
export const TILE = 100;

/**
 * Half the drivable width. Comfortably under `TILE / 2`, which is what makes
 * the rails of a one-cell-wide corridor unable to meet (see the header).
 *
 * 0.36 rather than 0.49: at the very edge the two rails of an arm are a hair
 * apart and the corridor reads as a wall with a crack in it. This leaves
 * 28 world units of margin.
 */
export const TRACK_HALF_WIDTH = TILE * 0.36;

/**
 * How much a right-angle corner is rounded off, in world units. A rectilinear
 * corner is undrivable at any speed — the car simply beaches on the outside
 * rail.
 *
 * **This sets the turn rate the game needs, not the other way round.** A
 * snaking circuit has segments as short as one tile, and `roundCorners` caps
 * the radius at a third of the shorter leg, so the tightest corner on a real
 * track is `TILE / 3` ≈ 33 units. Following a corner of radius `r` at speed
 * `v` needs `v / r` radians per second, so at `TILT_TOP_SPEED` that is
 * 120 / 33 ≈ 3.6 rad/s — which is why `TILT_TURN_RATE` is what it is. The two
 * constants cannot be chosen apart, and `drive.test.ts` drives a whole lap to
 * prove the pairing works.
 */
export const CORNER_RADIUS = TILE * 0.42;

/** The tightest corner a rolled circuit can contain, from the cap in
 *  `roundCorners`. Exported so the turn rate can be justified against it. */
export const TIGHTEST_CORNER = TILE / 3;

/** How many points a rounded corner is drawn with. Six is smooth enough at
 *  phone scale and keeps the centreline cheap to search. */
const CORNER_STEPS = 6;

/** The grid the blob grows in. Portrait-ish, since the viewport is. */
export const TRACK_COLS = 11;
export const TRACK_ROWS = 15;

/**
 * How many cells the blob grows to.
 *
 * Chosen from the lap time rather than by taste: at `TILT_TOP_SPEED` the
 * target is ~100 s a lap (spec §1), which is ~12000 world units, which is
 * ~120 tile edges of perimeter.
 *
 * **Measured, and the grid size with it.** A maximal snake in a C×R grid has
 * about `C × R / 2` cells and a perimeter of about `C × R` edges, so the grid
 * caps the lap however many cells are asked for: 9×12 saturated at ~80 s
 * whatever the cell count. Sweeping both together gave
 *
 *     9x12  cells=34  lap  29 …  47 …  53 s
 *     9x12  cells=68  lap  67 …  82 …  92 s   (saturated)
 *     10x14 cells=72  lap  78 …  90 … 105 s
 *     11x15 cells=84  lap  92 … 105 … 118 s   ← this
 *     12x16 cells=96  lap 101 … 119 … 137 s
 *
 * so 11×15 at 84 is the pairing whose median lands on the target with the
 * spread sitting either side of it. `shared/tiltTrack.test.ts` asserts the
 * median stays there, so a change to the growth bias cannot quietly halve the
 * round length.
 */
export const TRACK_CELLS = 84;

export type Point = { x: number; y: number };

export type Track = {
  /**
   * The centreline, closed: the last point joins the first. Rounded at every
   * corner, so consecutive points are not evenly spaced.
   */
  points: Point[];
  /** Cumulative arc length at each point, `cum[0] === 0`. */
  cum: number[];
  /** One lap, in world units. */
  length: number;
  /** The cells the blob ended up as — the renderer draws the grass from these. */
  cells: { x: number; y: number }[];
};

/* ------------------------------------------------------------------ */
/* Growing the blob                                                    */
/* ------------------------------------------------------------------ */

const key = (x: number, y: number): string => `${x},${y}`;

/** The four orthogonal neighbours. */
const NEIGHBOURS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Would adding `(x, y)` create a diagonal pinch — two cells touching only at a
 * corner?
 *
 * A pinch is the one thing that makes a polyomino's boundary touch itself, and
 * a boundary that touches itself is a track that crosses itself. Testing it
 * before accepting a cell is much cheaper than detecting a self-crossing curve
 * afterwards.
 */
function wouldPinch(cells: Set<string>, x: number, y: number): boolean {
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    if (!cells.has(key(x + dx, y + dy))) continue;
    // Diagonal neighbour present: at least one of the two cells sharing an
    // edge with both of us must be present too, or the two only meet at a
    // corner.
    if (!cells.has(key(x + dx, y)) && !cells.has(key(x, y + dy))) return true;
  }
  return false;
}

/**
 * Does the shape enclose a hole?
 *
 * A hole gives the boundary two disjoint cycles, and the walk would then
 * return a track that is only part of the outline. Flood-filled from outside a
 * one-cell margin: anything unreached is enclosed.
 */
function hasHole(cells: Set<string>, cols: number, rows: number): boolean {
  const seen = new Set<string>();
  const stack: [number, number][] = [[-1, -1]];
  while (stack.length > 0) {
    const at = stack.pop();
    if (!at) break;
    const [x, y] = at;
    if (x < -1 || y < -1 || x > cols || y > rows) continue;
    const k = key(x, y);
    if (seen.has(k) || cells.has(k)) continue;
    seen.add(k);
    for (const [dx, dy] of NEIGHBOURS) stack.push([x + dx, y + dy]);
  }
  // Every empty cell inside the padded box has to have been reachable.
  for (let y = -1; y <= rows; y++) {
    for (let x = -1; x <= cols; x++) {
      const k = key(x, y);
      if (!cells.has(k) && !seen.has(k)) return true;
    }
  }
  return false;
}

/** How many of a cell's four neighbours are already in the shape. */
function degree(cells: Set<string>, x: number, y: number): number {
  let n = 0;
  for (const [dx, dy] of NEIGHBOURS) if (cells.has(key(x + dx, y + dy))) n++;
  return n;
}

/**
 * Grow a blob whose outline makes a long, non-self-crossing circuit.
 *
 * **The bias is the whole trick.** Adding a uniformly random frontier cell
 * gives a roughly round blob, and a round blob has a perimeter of about
 * `4 × sqrt(cells)` edges — a twenty-second lap. Preferring cells with exactly
 * one neighbour already in the shape extends arms instead of filling them in,
 * which takes the perimeter to about `2 × cells` and the lap to the ~100 s the
 * spec asks for (see `TRACK_CELLS` for the measured table).
 */
function grow(random: () => number, cols: number, rows: number, target: number): Set<string> {
  const cells = new Set<string>();
  const start = { x: Math.floor(cols / 2), y: Math.floor(rows / 2) };
  cells.add(key(start.x, start.y));

  while (cells.size < target) {
    // The frontier: every empty in-bounds cell touching the shape.
    const frontier: { x: number; y: number; deg: number }[] = [];
    for (const k of cells) {
      const [cx, cy] = k.split(',').map(Number) as [number, number];
      for (const [dx, dy] of NEIGHBOURS) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        if (cells.has(key(x, y))) continue;
        if (frontier.some((c) => c.x === x && c.y === y)) continue;
        frontier.push({ x, y, deg: degree(cells, x, y) });
      }
    }

    // Legal candidates only: no pinch, no hole.
    const legal = frontier.filter((c) => {
      if (wouldPinch(cells, c.x, c.y)) return false;
      cells.add(key(c.x, c.y));
      const holed = hasHole(cells, cols, rows);
      cells.delete(key(c.x, c.y));
      return !holed;
    });
    if (legal.length === 0) break;

    // Weight steeply toward degree 1 — see this function's own comment.
    const weighted: { x: number; y: number }[] = [];
    for (const c of legal) {
      const weight = c.deg === 1 ? 8 : c.deg === 2 ? 2 : 1;
      for (let i = 0; i < weight; i++) weighted.push({ x: c.x, y: c.y });
    }
    const chosen = weighted[Math.min(weighted.length - 1, Math.floor(random() * weighted.length))];
    if (!chosen) break;
    cells.add(key(chosen.x, chosen.y));
  }

  return cells;
}

/* ------------------------------------------------------------------ */
/* The outline                                                         */
/* ------------------------------------------------------------------ */

type Edge = { from: Point; to: Point };

/**
 * The shape's boundary, as one closed chain of grid-aligned segments.
 *
 * Every cell contributes the sides whose neighbour is missing, oriented so the
 * chain runs consistently round the shape. With no pinch and no hole, each
 * vertex has exactly one outgoing edge, so following `to` → `from` visits the
 * whole boundary once and returns to the start.
 */
function outline(cells: Set<string>): Point[] {
  const edges = new Map<string, Edge>();
  const add = (from: Point, to: Point): void => {
    edges.set(key(from.x, from.y), { from, to });
  };

  for (const k of cells) {
    const [cx, cy] = k.split(',').map(Number) as [number, number];
    // Orientation is what makes the chain consistent: each missing side is
    // emitted in the direction that keeps the shape on one hand.
    if (!cells.has(key(cx, cy - 1))) add({ x: cx + 1, y: cy }, { x: cx, y: cy });
    if (!cells.has(key(cx - 1, cy))) add({ x: cx, y: cy }, { x: cx, y: cy + 1 });
    if (!cells.has(key(cx, cy + 1))) add({ x: cx, y: cy + 1 }, { x: cx + 1, y: cy + 1 });
    if (!cells.has(key(cx + 1, cy))) add({ x: cx + 1, y: cy + 1 }, { x: cx + 1, y: cy });
  }

  const first = edges.values().next().value;
  if (!first) return [];
  const path: Point[] = [first.from];
  let at = first.to;
  // Bounded by the edge count: a fork would be a pinch, which growth refuses.
  for (let guard = 0; guard <= edges.size; guard++) {
    if (at.x === first.from.x && at.y === first.from.y) break;
    path.push(at);
    const next = edges.get(key(at.x, at.y));
    if (!next) return [];
    at = next.to;
  }
  return path;
}

/** Drop the middle of any three collinear points, so a straight is one segment
 *  rather than a run of tile-length ones. */
function simplify(path: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < path.length; i++) {
    const prev = path[(i - 1 + path.length) % path.length] as Point;
    const cur = path[i] as Point;
    const next = path[(i + 1) % path.length] as Point;
    const straight = (cur.x - prev.x) * (next.y - cur.y) === (cur.y - prev.y) * (next.x - cur.x);
    if (!straight) out.push(cur);
  }
  return out;
}

/**
 * Replace each right-angle corner with a short arc.
 *
 * A rectilinear circuit cannot be driven at speed — the car meets the outside
 * rail head-on at every corner and the round becomes a series of full stops.
 * The arc is cut back from the corner by `CORNER_RADIUS` along both legs, and
 * never by more than a third of the shorter leg, so two corners at the ends of
 * one short segment cannot eat each other.
 */
function roundCorners(corners: Point[]): Point[] {
  const n = corners.length;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = corners[(i - 1 + n) % n] as Point;
    const cur = corners[i] as Point;
    const next = corners[(i + 1) % n] as Point;

    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(CORNER_RADIUS, inLen / 3, outLen / 3);

    const inDir = { x: (cur.x - prev.x) / inLen, y: (cur.y - prev.y) / inLen };
    const outDir = { x: (next.x - cur.x) / outLen, y: (next.y - cur.y) / outLen };
    const a = { x: cur.x - inDir.x * r, y: cur.y - inDir.y * r };
    const b = { x: cur.x + outDir.x * r, y: cur.y + outDir.y * r };

    // Quadratic through the corner: cheap, and indistinguishable from a true
    // arc at this radius.
    for (let s = 0; s <= CORNER_STEPS; s++) {
      const t = s / CORNER_STEPS;
      const u = 1 - t;
      out.push({
        x: u * u * a.x + 2 * u * t * cur.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * cur.y + t * t * b.y,
      });
    }
  }
  return out;
}

/**
 * Roll a circuit. Deterministic in `random`, so the referee's seed is the
 * whole description of the track (spec §6).
 *
 * Returns null only if growth could not reach a shape with an outline at all,
 * which the caller retries — `worker/tiltRace.ts` has a committed fallback for
 * the case where it never does, the same shape as Gravity Shooter's.
 */
export function rollTrack(
  random: () => number,
  cols = TRACK_COLS,
  rows = TRACK_ROWS,
  target = TRACK_CELLS,
): Track | null {
  const cells = grow(random, cols, rows, target);
  const path = outline(cells);
  if (path.length < 4) return null;

  const corners = simplify(path);
  if (corners.length < 4) return null;

  // Grid units to world units, then rounded.
  const scaled = corners.map((p) => ({ x: p.x * TILE, y: p.y * TILE }));
  const points = roundCorners(scaled);

  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    cum.push((cum[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const last = points[points.length - 1] as Point;
  const firstPoint = points[0] as Point;
  const length = (cum[cum.length - 1] as number) + Math.hypot(firstPoint.x - last.x, firstPoint.y - last.y);

  return {
    points,
    cum,
    length,
    cells: [...cells].map((k) => {
      const [x, y] = k.split(',').map(Number) as [number, number];
      return { x, y };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Driving on it                                                       */
/* ------------------------------------------------------------------ */

export type OnTrack = {
  /** Distance from the centreline, in world units. Beyond `TRACK_HALF_WIDTH`
   *  the car is into a rail. */
  offset: number;
  /** The closest point ON the centreline. Needed to work out which SIDE of the
   *  track something is, which `offset` alone cannot say. */
  nearest: Point;
  /** Arc length along the lap, 0..`length`. */
  s: number;
  /** The centreline's own direction there, as a unit vector. */
  tangent: Point;
  /** Which centreline segment it was on — pass back as `hint` next frame. */
  index: number;
};

/**
 * Where a point sits relative to the track.
 *
 * `hint` is the previous frame's `index`, and it is what keeps this cheap: a
 * car moves a few world units per frame, so searching a window around where it
 * was last is both faster and *more correct* than a global search — on a
 * circuit that doubles back, the globally nearest centreline point can be on
 * the other side of a rail.
 */
export function locate(track: Track, at: Point, hint?: number, window = 12): OnTrack {
  const n = track.points.length;
  const from = hint === undefined ? 0 : hint - window;
  const to = hint === undefined ? n : hint + window;

  let best: OnTrack = { offset: Infinity, nearest: at, s: 0, tangent: { x: 1, y: 0 }, index: 0 };
  for (let k = from; k < to; k++) {
    const i = ((k % n) + n) % n;
    const a = track.points[i] as Point;
    const b = track.points[(i + 1) % n] as Point;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen === 0) continue;
    // Projection of `at` onto the segment, clamped to it.
    const t = Math.min(1, Math.max(0, ((at.x - a.x) * dx + (at.y - a.y) * dy) / (segLen * segLen)));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const offset = Math.hypot(at.x - px, at.y - py);
    if (offset < best.offset) {
      best = {
        offset,
        nearest: { x: px, y: py },
        s: ((track.cum[i] as number) + segLen * t) % track.length,
        tangent: { x: dx / segLen, y: dy / segLen },
        index: i,
      };
    }
  }
  return best;
}

/** A point on the centreline at arc length `s`, with its direction. Used for
 *  the start line and for drawing another player's dot on the progress rail. */
export function atArc(track: Track, s: number): { at: Point; tangent: Point } {
  const n = track.points.length;
  const target = ((s % track.length) + track.length) % track.length;
  for (let i = 0; i < n; i++) {
    const next = i + 1 < n ? (track.cum[i + 1] as number) : track.length;
    if (target > next && i + 1 < n) continue;
    const a = track.points[i] as Point;
    const b = track.points[(i + 1) % n] as Point;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = Math.min(1, Math.max(0, (target - (track.cum[i] as number)) / segLen));
    return {
      at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
      tangent: { x: (b.x - a.x) / segLen, y: (b.y - a.y) / segLen },
    };
  }
  const a = track.points[0] as Point;
  return { at: a, tangent: { x: 1, y: 0 } };
}
