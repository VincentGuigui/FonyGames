import {
  DARK_COLS,
  DARK_DIRS,
  DARK_PATH_MAX,
  DARK_PATH_MIN,
  DARK_ROWS,
  cellAt,
  corridorOf,
  isDarkDir,
  key,
  monsterStep,
  pathStepsFor,
  rollMap,
  shortestPath,
  stepIn,
  within,
  type Cell,
  type DarkMap,
} from './darkMap';

/**
 * `shared/darkMap.ts` — the map, and the guarantee.
 * Spec: docs/specs/games/together-in-the-dark.md §2.1, §2.2
 *
 * The spec makes a strong claim about this game that it explicitly does *not*
 * make about Gravity Shooter: the map is not "probably winnable", it is
 * **provably** winnable, because a grid is exact. A guarantee nobody checks is
 * not a guarantee, so it is checked here by brute force — every rolled map, an
 * independent BFS, and the corridor rule that keeps a woken monster from
 * sealing the route.
 *
 * The failure mode is the worst kind: a team spends three minutes arguing about
 * a forest that has no way out, and there is nothing on screen to tell them.
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

function seeded(seed: number): () => number {
  let h = seed >>> 0;
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 4294967296;
  };
}

/** Roll `n` maps for a room of `players`, from consecutive seeds. */
function maps(n: number, players = 2): DarkMap[] {
  const out: DarkMap[] = [];
  for (let seed = 1; out.length < n && seed < n * 40; seed++) {
    const m = rollMap(seeded(seed), players);
    if (m) out.push(m);
  }
  return out;
}

function pathLength(): void {
  console.log('\nthe path shortens with the room (§2.1)');

  check(`one player gets ${DARK_PATH_MAX} steps`, pathStepsFor(1) === DARK_PATH_MAX);
  check('two the same', pathStepsFor(2) === DARK_PATH_MAX);
  check(`eight gets ${DARK_PATH_MIN}`, pathStepsFor(8) === DARK_PATH_MIN);
  check('and more than eight no fewer', pathStepsFor(20) === DARK_PATH_MIN);
  check('five is in between', pathStepsFor(5) > DARK_PATH_MIN && pathStepsFor(5) < DARK_PATH_MAX, pathStepsFor(5));

  // Monotonic: a bigger room never gets a longer round.
  let previous = Infinity;
  for (let players = 1; players <= 8; players++) {
    const steps = pathStepsFor(players);
    if (steps > previous) {
      check(`it never grows with the room (at ${players})`, false, { players, steps, previous });
      return;
    }
    previous = steps;
  }
  check('it never grows with the room', true);
}

function theGuarantee(): void {
  console.log('\nevery rolled map can be finished (§2.1)');

  let rolled = 0;
  let unreachable = 0;
  let tooLong = 0;
  let hazardOnPath = 0;
  let startOrEscapeBlocked = 0;
  let worstExample: unknown = null;

  for (const players of [1, 2, 4, 6, 8]) {
    const steps = pathStepsFor(players);
    for (const map of maps(40, players)) {
      rolled++;

      /*
       * The guarantee, re-derived from the finished map by a BFS that knows
       * nothing about how it was built. This is the whole point of the test:
       * a construction bug cannot hide inside a shared assumption.
       */
      const blocked = new Set<string>();
      for (const cell of [...map.traps, ...map.monsters, ...map.trees]) blocked.add(key(cell));
      const proof = shortestPath(map.start, map.escape, map.cols, map.rows, blocked);
      if (!proof) {
        unreachable++;
        worstExample ??= { start: map.start, escape: map.escape };
        continue;
      }
      if (proof.length - 1 > steps) {
        tooLong++;
        worstExample ??= { players, steps, found: proof.length - 1 };
      }

      // Nothing hazardous may sit on the path the guarantee is about.
      for (const cell of map.path) {
        if (blocked.has(key(cell))) {
          hazardOnPath++;
          worstExample ??= cell;
          break;
        }
      }

      if (blocked.has(key(map.start)) || blocked.has(key(map.escape))) {
        startOrEscapeBlocked++;
        worstExample ??= { start: map.start, escape: map.escape };
      }
    }
  }

  check(`${rolled} maps rolled across five room sizes`, rolled === 200, rolled);
  check('every escape is reachable', unreachable === 0, { unreachable, worstExample });
  check('within the steps its room size allows', tooLong === 0, { tooLong, worstExample });
  check('nothing hazardous sits on the guaranteed path', hazardOnPath === 0, { hazardOnPath, worstExample });
  check('and neither the start nor the escape is blocked', startOrEscapeBlocked === 0, { startOrEscapeBlocked, worstExample });
}

function theCorridor(): void {
  console.log('\nthe route is two cells wide where it can be (§2.1)');

  /*
   * The reason this rule exists: a monster moves one cell every three turns, so
   * it can only truly seal a corridor one cell wide. A widened route means a
   * woken monster standing in it can be walked around rather than waited out.
   */
  const straight: Cell[] = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }];
  const corridor = corridorOf(straight, 12, 16);
  check('the path itself is in the corridor', straight.every((c) => corridor.has(key(c))));
  check('and so is everything beside it', corridor.has(key({ x: 4, y: 6 })) && corridor.has(key({ x: 6, y: 6 })));
  check('but not two cells away', !corridor.has(key({ x: 3, y: 6 })));

  // Against the grid's edge there is simply nowhere to widen to, and the spec
  // accepts that rather than pretending.
  const edge = corridorOf([{ x: 0, y: 0 }], 12, 16);
  check('a cell on the edge widens only inward', edge.has(key({ x: 1, y: 0 })) && edge.has(key({ x: 0, y: 1 })));
  check('and never off the board', ![...edge].some((k) => k.startsWith('-') || k.includes(',-')));

  let narrow = 0;
  let inspected = 0;
  for (const map of maps(40, 2)) {
    const blocked = new Set<string>();
    for (const cell of [...map.traps, ...map.monsters, ...map.trees]) blocked.add(key(cell));
    for (const cell of map.path) {
      inspected++;
      // How many of the four neighbours are on the board and clear? A cell in
      // open ground should have at least two.
      let clear = 0;
      for (const dir of DARK_DIRS) {
        const next = stepIn(cell, dir);
        if (within(map, next) && !blocked.has(key(next))) clear++;
      }
      const onEdge = cell.x === 0 || cell.y === 0 || cell.x === map.cols - 1 || cell.y === map.rows - 1;
      if (clear < 2 && !onEdge) narrow++;
    }
  }
  check(`no interior path cell is a dead end (${inspected} inspected, ${narrow} narrow)`, narrow === 0, narrow);
}

function bfs(): void {
  console.log('\nthe search itself');

  const empty = new Set<string>();
  const straight = shortestPath({ x: 0, y: 0 }, { x: 3, y: 0 }, 6, 6, empty);
  check('a straight line is found', straight?.length === 4, straight?.length);
  check('and it starts and ends where asked', straight?.[0]?.x === 0 && straight?.[3]?.x === 3);

  const around = shortestPath({ x: 0, y: 0 }, { x: 2, y: 0 }, 6, 6, new Set(['1,0']));
  check('a wall is walked around', around !== null && around.length === 5, around?.length);

  const walled = new Set(['1,0', '1,1', '1,2', '1,3', '1,4', '1,5']);
  check('a full wall has no way through', shortestPath({ x: 0, y: 0 }, { x: 2, y: 0 }, 6, 6, walled) === null);

  check('a blocked start is no path', shortestPath({ x: 0, y: 0 }, { x: 2, y: 0 }, 6, 6, new Set(['0,0'])) === null);
  check('a blocked destination too', shortestPath({ x: 0, y: 0 }, { x: 2, y: 0 }, 6, 6, new Set(['2,0'])) === null);
  check('the same cell is a path of one', shortestPath({ x: 1, y: 1 }, { x: 1, y: 1 }, 6, 6, empty)?.length === 1);

  // It really is shortest, not merely a path.
  const diagonal = shortestPath({ x: 0, y: 0 }, { x: 3, y: 3 }, 8, 8, empty);
  check('a diagonal takes the Manhattan distance', diagonal?.length === 7, diagonal?.length);
}

function determinism(): void {
  console.log('\nthe seed is the whole map (§4)');

  const a = rollMap(seeded(1234), 4);
  const b = rollMap(seeded(1234), 4);
  check('the same seed gives the same map', JSON.stringify(a) === JSON.stringify(b));
  const c = rollMap(seeded(4321), 4);
  check('a different seed gives a different one', JSON.stringify(a) !== JSON.stringify(c));

  // The grid is what the constants say, so the client's viewport maths and the
  // referee's bounds cannot disagree.
  check(`the grid is ${DARK_COLS}x${DARK_ROWS}`, a?.cols === DARK_COLS && a?.rows === DARK_ROWS);
}

function directions(): void {
  console.log('\nsteps and bounds');

  check('N is up the screen', stepIn({ x: 3, y: 3 }, 'N').y === 2);
  check('S is down', stepIn({ x: 3, y: 3 }, 'S').y === 4);
  check('E is right', stepIn({ x: 3, y: 3 }, 'E').x === 4);
  check('W is left', stepIn({ x: 3, y: 3 }, 'W').x === 2);
  check('and each reaches exactly one cell', DARK_DIRS.every((d) => {
    const next = stepIn({ x: 3, y: 3 }, d);
    return Math.abs(next.x - 3) + Math.abs(next.y - 3) === 1;
  }));

  check('a known direction is recognised', isDarkDir('N'));
  check('an unknown one is not', !isDarkDir('NE'));
  check('and neither is a number', !isDarkDir(2));

  const map = rollMap(seeded(9), 2) as DarkMap;
  check('inside the board is inside', within(map, { x: 0, y: 0 }) && within(map, { x: map.cols - 1, y: map.rows - 1 }));
  check('outside is outside', !within(map, { x: -1, y: 0 }) && !within(map, { x: map.cols, y: 0 }));
}

function whatACellHolds(): void {
  console.log('\nwhat a lit cell turns out to hold (§2)');

  const map = rollMap(seeded(21), 2) as DarkMap;
  check('the escape reads as the escape', cellAt(map, map.escape, map.monsters) === 'escape');
  const trap = map.traps[0] as Cell;
  check('a trap reads as a trap', cellAt(map, trap, map.monsters) === 'trap');
  const monster = map.monsters[0] as Cell;
  check('a monster reads as a monster', cellAt(map, monster, map.monsters) === 'monster');
  const tree = map.trees[0] as Cell;
  check('a tree reads as a tree', cellAt(map, tree, map.monsters) === 'tree');
  check('the start is plain floor', cellAt(map, map.start, map.monsters) === 'floor');

  // A monster standing on a trap reads as the monster: it is the thing that
  // will hurt you first, and the thing the turn log has to announce.
  check('a monster on a trap reads as the monster', cellAt(map, trap, [trap]) === 'monster');

  // And a monster that has walked off its starting cell is no longer there —
  // `cellAt` reads the LIVE monster list, not the map's own record.
  check('a monster that moved is no longer at its start', cellAt(map, monster, []) !== 'monster');
}

function monsters(): void {
  console.log('\nhow a monster moves (§2.2)');

  const map = rollMap(seeded(33), 2) as DarkMap;
  const clear: DarkMap = { ...map, trees: [] };

  // Toward where it was lit, one cell, on the larger axis first.
  check('it closes on the x axis when that is further', monsterStep({ x: 2, y: 5 }, { x: 8, y: 6 }, clear).x === 3);
  check('and on the y axis when that is', monsterStep({ x: 2, y: 5 }, { x: 3, y: 11 }, clear).y === 6);
  check('one cell at a time, never two', (() => {
    const next = monsterStep({ x: 2, y: 5 }, { x: 9, y: 9 }, clear);
    return Math.abs(next.x - 2) + Math.abs(next.y - 5) === 1;
  })());
  check('arriving, it stops', (() => {
    const next = monsterStep({ x: 4, y: 4 }, { x: 4, y: 4 }, clear);
    return next.x === 4 && next.y === 4;
  })());

  // A tree blocks it, which is what stops one walking through the scenery.
  const walled: DarkMap = { ...map, trees: [{ x: 3, y: 5 }, { x: 2, y: 6 }] };
  const stuck = monsterStep({ x: 2, y: 5 }, { x: 9, y: 9 }, walled);
  check('a tree in the way blocks it', stuck.x === 2 && stuck.y === 5, stuck);

  // The board's edge blocks it too, rather than letting it walk off.
  const corner = monsterStep({ x: 0, y: 0 }, { x: -5, y: -5 }, clear);
  check('and so does the edge of the board', within(clear, corner), corner);
}

pathLength();
theGuarantee();
theCorridor();
bfs();
determinism();
directions();
whatACellHolds();
monsters();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
