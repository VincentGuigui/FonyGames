import { TENT_ARMS, TENT_SUMMIT_M } from './protocol';
import {
  GAP,
  GAPS_FROM,
  GRAVITY,
  HANG_DROP,
  MAX_PULL,
  REACH,
  START_BODY,
  bandPegs,
  bodyOf,
  canGrab,
  dist,
  fits,
  gaps,
  heightOf,
  launchVelocity,
  normaliseTentMode,
  pegById,
  pegsBetween,
  place,
  slingArmed,
  startPegs,
  type Peg,
  type Point,
} from './tentacules';

/** Tentacules' rules and its wall. Spec: docs/specs/games/tentacules.md §2 */

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

function body(): void {
  console.log('\nthe body and its reach (§2.1)');
  const start = startPegs();
  check('five starting pegs, ids −1 to −5', start.length === TENT_ARMS && start.every((p, i) => p.id === -(i + 1)));
  const at = place(start) as Point;
  check('the body rests where its starting star puts it', dist(at, START_BODY) < 1e-9);
  check('every starting peg within reach of it', fits(start) && start.every((p) => dist(p, at) <= REACH + 1e-9));
  const two = place([{ x: 0.3, y: 1 }, { x: 0.7, y: 1 }]) as Point;
  check('on two pegs it sits between them, pulled up above them', Math.abs(two.x - 0.5) < 1e-9 && two.y > 1);
  check('reaching higher lifts the body', (place([{ x: 0.3, y: 1 }, { x: 0.5, y: 1.3 }]) as Point).y > (place([{ x: 0.3, y: 1 }, { x: 0.5, y: 1.1 }]) as Point).y);
  check('one peg: the body dangles just below it', JSON.stringify(place([{ x: 0.3, y: 2 }])) === JSON.stringify({ x: 0.3, y: 2 - HANG_DROP }));
  check('held by nothing, it sits nowhere', place([]) === null);
  check('height counts from the start', heightOf(START_BODY.y) === 0 && Math.abs(heightOf(START_BODY.y + 5) - 5) < 1e-9);

  const pair = [{ x: 0.3, y: 1 }, { x: 0.5, y: 1 }];
  const pb = place(pair) as Point;
  check('a peg within reach of the body can be taken', canGrab(pair, { x: pb.x, y: pb.y + REACH - 0.01 }, null));
  check('one further than REACH cannot', !canGrab(pair, { x: pb.x, y: pb.y + REACH + 0.02 }, null));
  check('pegs no body can hold together do not fit', !fits([{ x: 0, y: 0 }, { x: 2 * REACH + 0.01, y: 0 }]) && fits([{ x: 0, y: 0 }, { x: 2 * REACH - 0.01, y: 0 }]));
  check('nor can a tentacle take a peg that would leave another out of reach', !canGrab([{ x: 0.1, y: 1 }, { x: 0.1, y: 1.2 }], { x: 0.1 + 2 * REACH + 0.05, y: 1.1 }, null));
  check('with nothing held, reach is from wherever the body is', canGrab([], { x: 0.5, y: 2.3 }, { x: 0.5, y: 2 }) && !canGrab([], { x: 0.5, y: 2.5 }, { x: 0.5, y: 2 }));
  check('with nothing held and no body known, nothing', !canGrab([], { x: 0.5, y: 2 }, null));
}

function sling(): void {
  console.log('\nthe slingshot (§2.2)');
  check('two holds wide apart arm it', slingArmed([{ x: 0.3, y: 5 }, { x: 0.7, y: 5 }]));
  check('two close together do not', !slingArmed([{ x: 0.45, y: 5 }, { x: 0.6, y: 5 }]));
  check('nor three', !slingArmed([{ x: 0.2, y: 5 }, { x: 0.8, y: 5 }, { x: 0.5, y: 5.2 }]));
  check('a short pull launches nothing', launchVelocity({ x: 0, y: -0.02 }) === null);
  const v = launchVelocity({ x: 0, y: -MAX_PULL }) as Point;
  check('a full pull down launches straight up', v.x === 0 && v.y > 0);
  check(`and rises ${(v.y * v.y) / (2 * GRAVITY)} — the most a leap can`, Math.abs((v.y * v.y) / (2 * GRAVITY) - 1.5) < 1e-9);
  const over = launchVelocity({ x: 0, y: -1 }) as Point;
  check('pulling further than the limit is the limit', Math.abs(over.y - v.y) < 1e-9);
  const side = launchVelocity({ x: 0.1, y: -0.1 }) as Point;
  check('a pull down-right launches up-left', side.x < 0 && side.y > 0);
}

function wall(): void {
  console.log('\nthe wall: the same for everyone (§2.4)');
  const a = bandPegs(42, 7);
  check('the same seed and band build the same pegs', JSON.stringify(a) === JSON.stringify(bandPegs(42, 7)));
  check('another seed builds another wall', JSON.stringify(a) !== JSON.stringify(bandPegs(43, 7)));
  check('every peg sits inside the wall and inside its band', a.every((p) => p.x > 0 && p.x < 1 && p.y >= 7 && p.y < 8));
  const ids = pegsBetween(42, 0, 40).map((p) => p.id);
  check('ids are unique all the way up', new Set(ids).size === ids.length);
  check('a peg found by id is the same peg', pegsBetween(42, 0, 40).every((p) => JSON.stringify(pegById(42, p.id)) === JSON.stringify(p)));
  check('starting pegs are found by their own ids', pegById(42, -3)?.id === -3 && pegById(42, -6) === null && pegById(42, 0) === null && pegById(42, 1.5) === null);
  check('the body of a set of holds', JSON.stringify(bodyOf(42, [-1, -2, -3, -4, -5])) === JSON.stringify(place(startPegs())));
  const g = gaps(42, 40);
  check(`no gap below ${GAPS_FROM} m`, g.every((y) => y >= GAPS_FROM));
  check('gaps come more often higher up', g.length >= 6 && (g[1] as number) - (g[0] as number) > (g[g.length - 1] as number) - (g[g.length - 2] as number), g);
  const gapEmpty = g.every((y) => pegsBetween(42, y + 0.07, y + GAP - 0.07).length === 0);
  check('a gap holds no peg', gapEmpty);
  const tooFar = g.every((y) => pegsBetween(42, y - 0.01, y + 0.01).every((low) => pegsBetween(42, y + GAP - 0.01, y + GAP + 0.1).every((high) => dist(low, high) > REACH)));
  check('and no tentacle bridges it', tooFar);
}

/** Where a leap from this pair lands — its catch — or null: a full pull straight down, then the flight. */
function leap(seed: number, pair: readonly [Peg, Peg]): Peg | null {
  const v = launchVelocity({ x: 0, y: -MAX_PULL }) as Point;
  let pos = place(pair) as Point;
  let vy = v.y;
  for (let t = 0; t < 3; t += 1 / 120) {
    pos = { x: pos.x, y: pos.y + vy / 120 };
    vy -= GRAVITY / 120;
    if (vy > 0) continue;
    const reach = pegsBetween(seed, pos.y - REACH, pos.y + REACH).filter((c) => c.id !== pair[0].id && c.id !== pair[1].id && dist(c, pos) <= REACH);
    const caught = reach.sort((u, w) => w.y - u.y)[0];
    if (caught) return caught;
  }
  return null;
}

/**
 * A climber that only makes legal moves — the referee's own `canGrab`, a
 * tentacle let go, a slingshot leap — and plans a few moves ahead the way a
 * player does: it is the proof that the wall is always climbable.
 */
function climb(seed: number, top: number, leaping = true): { height: number; moves: number; leaps: number } {
  let holds: Peg[] = startPegs();
  let moves = 0;
  let leaps = 0;
  const key = (hs: readonly Peg[]): string => hs.map((h) => h.id).sort((x, y) => x - y).join();
  for (let stage = 0; stage < 400; stage++) {
    const at = place(holds) as Point;
    if (heightOf(at.y) >= top) break;
    const near = pegsBetween(seed, at.y - 1.2, at.y + 1.2);
    // Breadth first over hold sets: the nearest one that lifts the body 0.25,
    // or holds an armed pair whose leap lands higher.
    type Node = { holds: Peg[]; depth: number };
    const seen = new Set([key(holds)]);
    let frontier: Node[] = [{ holds, depth: 0 }];
    let goal: { holds: Peg[]; depth: number; catch: Peg | null } | null = null;
    for (let n = 0; frontier.length > 0 && !goal && n < 6000; ) {
      const next: Node[] = [];
      for (const node of frontier) {
        const options: Peg[][] = [];
        const hs = node.holds;
        const body = place(hs) as Point;
        const free = near.filter((p) => !hs.some((h) => h.id === p.id) && dist(p, body) <= REACH + 0.3);
        for (let arm = 0; arm < hs.length; arm++) {
          const others = hs.filter((_, i) => i !== arm);
          if (others.length === 0) continue;
          for (const p of free) if (canGrab(others, p, null)) options.push([...others, p]);
          if (hs.length > 2 && fits(others)) options.push(others);
        }
        if (hs.length < TENT_ARMS) for (const p of free) if (canGrab(hs, p, null)) options.push([...hs, p]);
        for (const o of options) {
          const k = key(o);
          if (seen.has(k)) continue;
          seen.add(k);
          n++;
          const y = (place(o) as Point).y;
          if (y >= at.y + 0.25) {
            goal = { holds: o, depth: node.depth + 1, catch: null };
            break;
          }
          if (leaping && o.length === 2 && slingArmed(o)) {
            const c = leap(seed, o as [Peg, Peg]);
            const onward = c !== null && pegsBetween(seed, c.y - 2 * REACH, c.y + REACH).some((p) => p.id !== c.id && canGrab([c], p, null));
            if (c && onward && c.y > at.y + 0.5) {
              goal = { holds: o, depth: node.depth + 1, catch: c };
              break;
            }
          }
          next.push({ holds: o, depth: node.depth + 1 });
        }
        if (goal) break;
      }
      frontier = next;
    }
    if (!goal) break;
    moves += goal.depth;
    if (goal.catch) {
      holds = [goal.catch];
      leaps++;
      moves++;
    } else {
      holds = goal.holds;
    }
  }
  return { height: heightOf((place(holds) as Point).y), moves, leaps };
}

function climbable(): void {
  console.log('\nalways climbable, harder as it rises (§2.4)');
  const results = Array.from({ length: 40 }, (_, i) => ({ seed: i * 7919 + 1, ...climb(i * 7919 + 1, 35) }));
  const stuck = results.filter((r) => r.height < 35);
  check(`40 walls climbed to 35 m by legal moves alone (${stuck.length} stuck)`, stuck.length === 0, stuck.slice(0, 3));
  const walked = results.map((r) => climb(r.seed, GAPS_FROM - 0.5, false).height);
  check(`climbable on foot alone up to the first gap, ${GAPS_FROM} m`, walked.every((h) => h >= GAPS_FROM - 0.5), walked.map((h) => h.toFixed(1)).slice(0, 8));
  check('and no further: the gaps need a leap', results.slice(0, 10).every((r) => climb(r.seed, 30, false).height < 30));
  check('the slingshot is needed higher up', results.every((r) => r.leaps >= 3), results.map((r) => r.leaps).slice(0, 8));
  const perM = results.map((r) => r.moves / 35);
  check(`a climb takes moves, not one (${Math.min(...perM).toFixed(1)}–${Math.max(...perM).toFixed(1)} a metre)`, perM.every((m) => m >= 1));
  check(`the Summit line is ${TENT_SUMMIT_M} m`, TENT_SUMMIT_M === 25);
}

function modes(): void {
  console.log('\nmodes (§3)');
  check('nothing chosen is Time trial', normaliseTentMode(undefined) === 'trial' && normaliseTentMode({ mode: 'x' }) === 'trial');
  check('Summit is Summit', normaliseTentMode({ mode: 'summit' }) === 'summit');
}

body();
sling();
wall();
climbable();
modes();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
