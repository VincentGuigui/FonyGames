/**
 * Physics harness for Sling Puck. Spec: docs/specs/games/sling-puck.md §6, §7
 *
 * The bounce behaviour and the sling are stated requirements, so they get tests
 * rather than a look at the screen (docs/testing.md §2). Everything here is pure
 * arithmetic over normalised board units, so none of it needs a browser.
 */
import {
  BOARD_H,
  GAP_LEFT,
  GAP_RIGHT,
  MAX_PULL,
  MAX_SPEED,
  POST_LEFT,
  POST_RIGHT,
  PUCK_RADIUS,
  RESTITUTION,
  SLING_PUCKS,
  clampPull,
  restingPucks,
  slingVelocity,
  step,
  type Puck,
} from './physics';

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

const MID_Y = BOARD_H / 2;

const puck = (over: Partial<Puck> = {}): Puck => ({
  id: 0,
  x: 0.5,
  y: MID_Y,
  vx: 0,
  vy: 0,
  ...over,
});

/** Run for `seconds` at 60 fps, collecting everything that crosses. */
function run(pucks: Puck[], seconds: number) {
  const crossed = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    crossed.push(...step(pucks, 1 / 60));
  }
  return crossed;
}

const speedOf = (v: { vx: number; vy: number }) => Math.sqrt(v.vx * v.vx + v.vy * v.vy);

/* ---------------------------------------------------------------- */

function walls(): void {
  console.log('\nbounces off all four walls');

  const left = [puck({ x: 0.2, vx: -0.8 })];
  run(left, 0.5);
  check('the left wall turns it around', (left[0]?.vx ?? 0) > 0, left[0]);
  check('and it stays inside', (left[0]?.x ?? 0) >= PUCK_RADIUS - 1e-9, left[0]?.x);

  const right = [puck({ x: 0.8, vx: 0.8 })];
  run(right, 0.5);
  check('the right wall turns it around', (right[0]?.vx ?? 0) < 0, right[0]);
  check('and it stays inside', (right[0]?.x ?? 0) <= 1 - PUCK_RADIUS + 1e-9, right[0]?.x);

  const bottom = [puck({ y: BOARD_H - 0.2, vy: 0.8 })];
  run(bottom, 0.6);
  check('the bottom wall turns it around', (bottom[0]?.vy ?? 0) < 0, bottom[0]);
  check('and it stays inside', (bottom[0]?.y ?? 0) <= BOARD_H - PUCK_RADIUS + 1e-9, bottom[0]?.y);

  // The top wall bounces everywhere except the gap — the whole point. Thrown
  // hard enough that it is still moving after the bounce: friction eats the
  // start speed on the way up, and a puck that merely dies against the wall
  // would pass a `vy > 0` check by accident rather than by bouncing.
  const solidTop = [puck({ x: GAP_LEFT - 0.08, y: 0.5, vy: -1.4 })];
  const out = run(solidTop, 0.6);
  check('the top wall bounces outside the gap', out.length === 0, out);
  check('and turns it around', (solidTop[0]?.vy ?? 0) > 0, solidTop[0]);
}

/**
 * The reason the board has a fixed aspect ratio rather than the phone's shape:
 * one unit means the same distance in both axes, so a puck touches every wall
 * and a bounce does not bend the shot.
 */
function isotropy(): void {
  console.log('\nthe units are the same in both axes');

  // Nudged into each wall and sampled on the frame of contact, so what is
  // measured is where the wall put it rather than where friction left it.
  const side = [puck({ x: 1 - PUCK_RADIUS - 0.001, vx: 0.5 })];
  run(side, 1 / 60);
  const sideGap = 1 - (side[0]?.x ?? 0);

  const top = [puck({ x: GAP_LEFT - 0.08, y: PUCK_RADIUS + 0.001, vy: -0.5 })];
  run(top, 1 / 60);
  const topGap = top[0]?.y ?? 0;

  const bottom = [puck({ y: BOARD_H - PUCK_RADIUS - 0.001, vy: 0.5 })];
  run(bottom, 1 / 60);
  const bottomGap = BOARD_H - (bottom[0]?.y ?? 0);

  check('every wall holds a puck at the same distance',
    Math.abs(sideGap - topGap) < 1e-9 && Math.abs(sideGap - bottomGap) < 1e-9,
    { sideGap, topGap, bottomGap });
  // One radius, plus the fraction of a radius it drifts back in the rest of the
  // frame. What matters is that it is the *same* on every wall and never less
  // than a radius — a puck must not be drawn overlapping the wall it hit.
  check('and it is never inside the wall',
    [sideGap, topGap, bottomGap].every((g) => g >= PUCK_RADIUS - 1e-9 && g < PUCK_RADIUS * 1.2),
    { sideGap, topGap, bottomGap, PUCK_RADIUS });

  // A 45° shot must still look like 45° after a bounce, which only holds if the
  // two axes share a unit.
  const diagonal = [puck({ x: 0.5, y: 0.9, vx: 0.9, vy: -0.9 })];
  run(diagonal, 0.35);
  const d = diagonal[0];
  check('a diagonal stays diagonal', d !== undefined &&
    Math.abs(Math.abs(d.vx) - Math.abs(d.vy)) < 1e-9, d);
}

function gap(): void {
  console.log('\nthe gap is the only way through');

  const straight = [puck({ x: 0.5, y: 0.5, vy: -0.8 })];
  const out = run(straight, 1.5);
  check('a puck up the middle goes through', out.length === 1, out);
  check('it is removed from the board', straight.length === 0, straight.length);
  check('the crossing reports where it left',
    (out[0]?.x ?? -1) > GAP_LEFT && (out[0]?.x ?? 1) < GAP_RIGHT, out[0]);
  check('and that it was still moving up', (out[0]?.vy ?? 0) < 0, out[0]);

  // Just inside each edge goes through; just outside does not.
  const inside = [puck({ x: GAP_LEFT + 0.01, y: 0.5, vy: -0.8 })];
  check('just inside the gap edge crosses', run(inside, 1.5).length === 1);
  const outside = [puck({ x: GAP_LEFT - 0.01, y: 0.5, vy: -0.8 })];
  check('just outside it does not', run(outside, 1.5).length === 0);
}

function tunnelling(): void {
  console.log('\nno tunnelling at top speed');

  // The fastest launch the sling can produce, aimed at a solid part of the top
  // wall. Without sub-steps this is exactly the shot that escapes the board.
  const p = [puck({ x: 0.12, y: BOARD_H - 0.1, vy: -MAX_SPEED })];
  const out = run(p, 4);
  check('it never leaves through a wall', out.length === 0, out);
  check('it is still on the board', p.length === 1);
  check('and still inside it',
    (p[0]?.y ?? -1) >= PUCK_RADIUS - 1e-6 && (p[0]?.y ?? BOARD_H + 1) <= BOARD_H, p[0]);

  // Same speed straight across, to catch the side walls too.
  const across = [puck({ vx: MAX_SPEED })];
  run(across, 4);
  check('a fast sideways puck stays inside',
    (across[0]?.x ?? -1) <= 1 - PUCK_RADIUS + 1e-6 && (across[0]?.x ?? -1) >= PUCK_RADIUS - 1e-6,
    across[0]?.x);
}

function friction(): void {
  console.log('\nfriction brings it to a dead stop');

  const p = [puck({ vx: 0.3, vy: 0.1 })];
  run(p, 6);
  check('it stops completely', p[0]?.vx === 0 && p[0]?.vy === 0, p[0]);

  // A bounce must lose energy, or a puck would rattle forever.
  const b = [puck({ y: BOARD_H - 0.3, vy: 0.6 })];
  run(b, 0.6);
  check('a bounce loses energy', Math.abs(b[0]?.vy ?? 0) < 0.6 * RESTITUTION + 0.01, b[0]);
}

function sling(): void {
  console.log('\nthe sling');

  const mid = (POST_LEFT.x + POST_RIGHT.x) / 2;

  // Straight back from the middle fires straight up the board.
  const straight = slingVelocity(mid, POST_LEFT.y + MAX_PULL * 0.8);
  check('pulled from the middle it fires up-board', straight.vy < 0, straight);
  check('and with no sideways drift', Math.abs(straight.vx) < 1e-9, straight);

  // Pull back and LEFT: the right-hand segment is longer, so it wins and the
  // puck goes up and to the RIGHT. This falls out of the model (spec §7).
  const pulledLeft = slingVelocity(mid - 0.25, POST_LEFT.y + MAX_PULL * 0.8);
  check('pulling left fires right', pulledLeft.vx > 0, pulledLeft);
  const pulledRight = slingVelocity(mid + 0.25, POST_LEFT.y + MAX_PULL * 0.8);
  check('pulling right fires left', pulledRight.vx < 0, pulledRight);
  check('and the two are mirror images', Math.abs(pulledLeft.vx + pulledRight.vx) < 1e-9, {
    pulledLeft,
    pulledRight,
  });

  // Further back is faster, all the way to a full pull — the cap must not be
  // clipping the useful range, or half the drag would do nothing.
  const soft = slingVelocity(mid, POST_LEFT.y + MAX_PULL * 0.2);
  const hard = slingVelocity(mid, POST_LEFT.y + MAX_PULL);
  check('a longer pull is faster', speedOf(hard) > speedOf(soft), { soft, hard });
  check('a full pull is not capped', speedOf(hard) < MAX_SPEED - 1e-6, speedOf(hard));
  check('no pull is no launch', speedOf(slingVelocity(mid, POST_LEFT.y)) < 1e-9);

  const capped = slingVelocity(mid, POST_LEFT.y + 5);
  check('but an impossible pull is', speedOf(capped) <= MAX_SPEED + 1e-9, speedOf(capped));

  // A pull cannot be dragged forwards past the band or off the board.
  const c = clampPull(-3, POST_LEFT.y + 0.1);
  check('a pull cannot go off the side', c.x >= PUCK_RADIUS, c);
  check('nor in front of the band', clampPull(mid, 0).y >= POST_LEFT.y, clampPull(mid, 0));
  check('nor through the bottom wall', clampPull(mid, 99).y <= BOARD_H - PUCK_RADIUS,
    clampPull(mid, 99));
}

function launchLandsIt(): void {
  console.log('\na real shot crosses the gap');

  // The whole loop: load in the middle, pull straight back, release, and it
  // should find the gap without any help.
  const mid = (POST_LEFT.x + POST_RIGHT.x) / 2;
  const v = slingVelocity(mid, POST_LEFT.y + MAX_PULL);
  const p = [puck({ x: mid, y: POST_LEFT.y, vx: v.vx, vy: v.vy })];
  check('a good shot goes through', run(p, 4).length === 1, { v });

}

function opening(): void {
  console.log('\nthe opening board');

  const pucks = restingPucks(SLING_PUCKS);
  check('one puck per player count', pucks.length === SLING_PUCKS);
  check('all at rest', pucks.every((p) => p.vx === 0 && p.vy === 0));
  check('all behind the band', pucks.every((p) => p.y > POST_LEFT.y));
  check('all inside the board', pucks.every((p) =>
    p.x >= PUCK_RADIUS && p.x <= 1 - PUCK_RADIUS && p.y <= BOARD_H - PUCK_RADIUS));
  check('ids are unique', new Set(pucks.map((p) => p.id)).size === pucks.length);
  // A resting puck the drag cannot reach behind is a puck you cannot fire.
  check('all reachable by a full pull', pucks.every((p) => clampPull(p.x, p.y).y === p.y), pucks);

  // They must not start overlapping, or the first frame shoves them apart.
  let touching = false;
  for (let i = 0; i < pucks.length; i++) {
    for (let j = i + 1; j < pucks.length; j++) {
      const a = pucks[i]!;
      const b = pucks[j]!;
      if (Math.hypot(b.x - a.x, b.y - a.y) < PUCK_RADIUS * 2) touching = true;
    }
  }
  check('none of them overlap', !touching);

  // Left alone, nothing should move.
  const before = pucks.map((p) => `${p.x},${p.y}`).join('|');
  run(pucks, 1);
  check('and nothing drifts', pucks.map((p) => `${p.x},${p.y}`).join('|') === before);
}

function collisions(): void {
  console.log('\npucks hit each other');

  // Head-on into a stationary puck: equal masses, so the mover should give up
  // most of its speed and the target should take it.
  const a = puck({ id: 1, x: 0.3, vx: 0.8 });
  const b = puck({ id: 2, x: 0.3 + PUCK_RADIUS * 2 + 0.005 });
  run([a, b], 0.3);
  check('the target is knocked along', b.vx > 0.1, { a, b });
  check('the mover gives up most of its speed', a.vx < b.vx, { a: a.vx, b: b.vx });

  // The mechanic that matters: one puck knocking another through the gap.
  const shooter = puck({ id: 3, x: 0.5, y: 0.7, vy: -1.6 });
  const sitting = puck({ id: 4, x: 0.5, y: 0.7 - PUCK_RADIUS * 2 - 0.01 });
  const out = run([shooter, sitting], 4);
  check('a puck can knock another through', out.length >= 1, out);

  // And they must never end up stacked on the same spot.
  const heap = [
    puck({ id: 5, x: 0.5 }),
    puck({ id: 6, x: 0.5, y: MID_Y + 0.001 }),
    puck({ id: 7, x: 0.5 + 0.001 }),
  ];
  run(heap, 1);
  let overlapping = false;
  for (let i = 0; i < heap.length; i++) {
    for (let j = i + 1; j < heap.length; j++) {
      const p = heap[i]!;
      const q = heap[j]!;
      if (Math.hypot(q.x - p.x, q.y - p.y) < PUCK_RADIUS * 2 - 1e-6) overlapping = true;
    }
  }
  check('a heap resolves itself', !overlapping, heap);
}

for (const t of [
  walls,
  isotropy,
  gap,
  tunnelling,
  friction,
  sling,
  launchLandsIt,
  opening,
  collisions,
]) {
  t();
}

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
