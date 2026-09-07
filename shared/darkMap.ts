/**
 * Together in the Dark's map, and the guarantee that it can be finished.
 * Spec: docs/specs/games/together-in-the-dark.md §2.1
 *
 * Shared because the referee rolls it and never sends it — the phone only ever
 * receives the cells that are lit (§6) — but the roller still has to be
 * testable, and a guarantee nobody checks is not a guarantee.
 * Must stay DOM-free: it typechecks under tsconfig.worker.json.
 *
 * ## Why this guarantee is real, unlike Gravity Shooter's
 *
 * Gravity Shooter has to sample a coarse fan of shots and settle for "probably
 * winnable", because its space is continuous. A grid is exact: a breadth-first
 * search either finds a path of at most `pathSteps` cells clear of traps and
 * monsters, or it does not — cheaply, and with certainty.
 *
 * So the map is built to have one and then **verified by an independent BFS**
 * rather than trusted. Construction and verification are separate on purpose:
 * the construction could be subtly wrong, and if it is, the roll is thrown away
 * rather than shipped.
 *
 * ## The two honest limits, restated from the spec
 *
 * 1. **It describes the map at roll time.** Once monsters wake and move they
 *    can block a route that was clear. A monster moving at a third of the
 *    character's speed can only truly seal a corridor one cell wide, so the
 *    guaranteed path is widened to two cells wherever the geometry allows.
 * 2. **`pathSteps` scales down with the player count**, because a 15-step path
 *    plus a light for most steps is ~30 turns, and at 8 players with 6–8 s of
 *    deliberation each that is past the catalogue's round-length target.
 */

export const DARK_COLS = 12;
export const DARK_ROWS = 16;

/** What a lit cell can turn out to hold. */
export type DarkCell = 'floor' | 'trap' | 'monster' | 'escape' | 'tree';

export type Cell = { x: number; y: number };

export type DarkMap = {
  cols: number;
  rows: number;
  start: Cell;
  escape: Cell;
  traps: Cell[];
  /** Where each monster started. The referee moves them from here. */
  monsters: Cell[];
  /** Scenery: blocks a step, hides nothing, and is what makes the dark look
   *  like a forest rather than an empty room. */
  trees: Cell[];
  /** The path the guarantee is about, start to escape inclusive. */
  path: Cell[];
};

/**
 * How long the guaranteed path is, for a room of this size.
 *
 * 15 steps at 1–2 players, shortening toward 9 at 8, so the round length is
 * roughly flat in the size of the room rather than growing with it (spec §2.1).
 */
export const DARK_PATH_MAX = 15;
export const DARK_PATH_MIN = 9;

export function pathStepsFor(players: number): number {
  if (players <= 2) return DARK_PATH_MAX;
  if (players >= 8) return DARK_PATH_MIN;
  // Linear between the two, so five players get 12.
  const span = DARK_PATH_MAX - DARK_PATH_MIN;
  return Math.round(DARK_PATH_MAX - (span * (players - 2)) / 6);
}

/** How much of the grid is hazard. Scaled to the grid so a bigger map is not
 *  automatically emptier. */
export const DARK_TRAP_FRACTION = 0.06;
export const DARK_MONSTER_FRACTION = 0.025;
export const DARK_TREE_FRACTION = 0.1;

const STEPS: readonly Cell[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

export const key = (c: Cell): string => `${c.x},${c.y}`;

function inBounds(c: Cell, cols: number, rows: number): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < cols && c.y < rows;
}

function pick(random: () => number, lo: number, hi: number): number {
  return lo + Math.floor(random() * (hi - lo + 1));
}

/**
 * The shortest path from `from` to `to`, avoiding `blocked`, or null.
 *
 * The **verification** half of this module, and deliberately written without
 * reference to how the map was built: it takes a set of blocked cells and
 * answers the question the spec asks, so a construction bug cannot hide inside
 * a shared assumption.
 */
export function shortestPath(
  from: Cell,
  to: Cell,
  cols: number,
  rows: number,
  blocked: ReadonlySet<string>,
): Cell[] | null {
  if (blocked.has(key(from)) || blocked.has(key(to))) return null;
  const cameFrom = new Map<string, string | null>([[key(from), null]]);
  const queue: Cell[] = [from];

  for (let head = 0; head < queue.length; head++) {
    const at = queue[head] as Cell;
    if (at.x === to.x && at.y === to.y) {
      // Walk the parents back, then reverse.
      const out: Cell[] = [];
      let cursor: string | null = key(at);
      while (cursor) {
        const [x, y] = cursor.split(',').map(Number) as [number, number];
        out.push({ x, y });
        cursor = cameFrom.get(cursor) ?? null;
      }
      return out.reverse();
    }
    for (const step of STEPS) {
      const next = { x: at.x + step.x, y: at.y + step.y };
      const k = key(next);
      if (!inBounds(next, cols, rows) || blocked.has(k) || cameFrom.has(k)) continue;
      cameFrom.set(k, key(at));
      queue.push(next);
    }
  }
  return null;
}

/**
 * The path plus its immediate neighbours — the corridor hazards must stay out
 * of.
 *
 * This is the two-cells-wide rule (spec §2.1), and the reason for it is
 * specific: a monster moves one cell every three turns, so it can only truly
 * seal a corridor one cell wide. Widening the guaranteed route means a woken
 * monster standing in it can be walked around rather than waited out.
 *
 * "Wherever the geometry allows" is doing real work — against the grid's edge
 * there is simply nowhere to widen to, and the spec accepts that a run can
 * then be lost by bad play, which is fine in a co-op game.
 */
export function corridorOf(path: readonly Cell[], cols: number, rows: number): Set<string> {
  const out = new Set<string>();
  for (const cell of path) {
    out.add(key(cell));
    for (const step of STEPS) {
      const next = { x: cell.x + step.x, y: cell.y + step.y };
      if (inBounds(next, cols, rows)) out.add(key(next));
    }
  }
  return out;
}

/**
 * Roll a finishable map, or null if this roll could not produce one.
 *
 * The caller retries; `worker/togetherInTheDark.ts` retries and then falls back
 * to a straight-line map, the same shape as Gravity Shooter's committed
 * fallback board.
 */
export function rollMap(
  random: () => number,
  players: number,
  cols = DARK_COLS,
  rows = DARK_ROWS,
): DarkMap | null {
  const steps = pathStepsFor(players);

  // The character starts somewhere in the lower half, so the escape has room
  // above it and the viewport has somewhere to travel.
  const start = { x: pick(random, 1, cols - 2), y: pick(random, rows - 4, rows - 2) };

  /*
   * The escape, at a real distance but no further than the guarantee allows.
   * Manhattan distance is the shortest possible path on an empty grid, so
   * requiring it to be within `steps` is what makes the guarantee reachable at
   * all — and requiring it to be at least two thirds of that stops a
   * three-step round.
   */
  let escape: Cell | null = null;
  for (let tries = 0; tries < 60 && !escape; tries++) {
    const candidate = { x: pick(random, 0, cols - 1), y: pick(random, 0, rows - 1) };
    const distance = Math.abs(candidate.x - start.x) + Math.abs(candidate.y - start.y);
    if (distance <= steps && distance >= Math.ceil(steps * 0.66)) escape = candidate;
  }
  if (!escape) return null;

  const path = shortestPath(start, escape, cols, rows, new Set());
  if (!path || path.length - 1 > steps) return null;

  const corridor = corridorOf(path, cols, rows);

  // Everything else is fair game for a hazard.
  const free: Cell[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!corridor.has(key({ x, y }))) free.push({ x, y });
    }
  }
  // Fisher-Yates on the injected randomness, so the referee's seed decides
  // the whole map.
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = free[i] as Cell;
    const b = free[j] as Cell;
    free[i] = b;
    free[j] = a;
  }

  const cells = cols * rows;
  const wantTraps = Math.round(cells * DARK_TRAP_FRACTION);
  const wantMonsters = Math.max(1, Math.round(cells * DARK_MONSTER_FRACTION));
  const wantTrees = Math.round(cells * DARK_TREE_FRACTION);
  if (free.length < wantTraps + wantMonsters + wantTrees) return null;

  let at = 0;
  const traps = free.slice(at, (at += wantTraps));
  const monsters = free.slice(at, (at += wantMonsters));
  const trees = free.slice(at, (at += wantTrees));

  /*
   * The verification, run against the finished map with a BFS that knows
   * nothing about how it was built. A construction bug fails here rather than
   * reaching a room.
   */
  const blocked = new Set<string>();
  for (const cell of [...traps, ...monsters, ...trees]) blocked.add(key(cell));
  const proof = shortestPath(start, escape, cols, rows, blocked);
  if (!proof || proof.length - 1 > steps) return null;

  return { cols, rows, start, escape, traps, monsters, trees, path: proof };
}

/** What a given cell holds, for the referee's own reveal. */
export function cellAt(map: DarkMap, at: Cell, monsters: readonly Cell[]): DarkCell {
  if (at.x === map.escape.x && at.y === map.escape.y) return 'escape';
  for (const monster of monsters) if (monster.x === at.x && monster.y === at.y) return 'monster';
  for (const trap of map.traps) if (trap.x === at.x && trap.y === at.y) return 'trap';
  for (const tree of map.trees) if (tree.x === at.x && tree.y === at.y) return 'tree';
  return 'floor';
}

/** The four directions, as the wire names them. */
export const DARK_DIRS = ['N', 'E', 'S', 'W'] as const;
export type DarkDir = typeof DARK_DIRS[number];

export function isDarkDir(value: unknown): value is DarkDir {
  return typeof value === 'string' && (DARK_DIRS as readonly string[]).includes(value);
}

/** One step in a direction. `N` is up the screen, which is `y - 1`. */
export function stepIn(at: Cell, dir: DarkDir): Cell {
  if (dir === 'N') return { x: at.x, y: at.y - 1 };
  if (dir === 'S') return { x: at.x, y: at.y + 1 };
  if (dir === 'E') return { x: at.x + 1, y: at.y };
  return { x: at.x - 1, y: at.y };
}

/** Is this cell on the board? */
export function within(map: { cols: number; rows: number }, at: Cell): boolean {
  return inBounds(at, map.cols, map.rows);
}

/**
 * One step of a monster toward the cell it was woken at.
 *
 * **Toward where it was lit, not where the character is** (spec §2.2): more
 * forgiving, and much more interesting, because it can be baited — light it,
 * walk away, and let it trudge toward where you used to be.
 *
 * Greedy on the larger axis, which is enough for a creature that moves once
 * every three turns and keeps it from needing a pathfinder of its own. Returns
 * the monster's own cell when a tree is in the way, so it can be blocked.
 */
export function monsterStep(from: Cell, toward: Cell, map: DarkMap): Cell {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  if (dx === 0 && dy === 0) return from;
  const order: Cell[] = Math.abs(dx) >= Math.abs(dy)
    ? [{ x: Math.sign(dx), y: 0 }, { x: 0, y: Math.sign(dy) }]
    : [{ x: 0, y: Math.sign(dy) }, { x: Math.sign(dx), y: 0 }];
  for (const step of order) {
    if (step.x === 0 && step.y === 0) continue;
    const next = { x: from.x + step.x, y: from.y + step.y };
    if (!within(map, next)) continue;
    if (map.trees.some((tree) => tree.x === next.x && tree.y === next.y)) continue;
    return next;
  }
  return from;
}
