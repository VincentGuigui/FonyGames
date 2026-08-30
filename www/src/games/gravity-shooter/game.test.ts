import type { GravityPlanet } from '../../../../shared/protocol';
import {
  GRAVITY_MAX_PULL,
  aimFromPull,
  localAimToWorldVelocity,
  shipPosition,
  simulateShot,
  viewTransform,
} from './game';

/**
 * Gravity Shooter's client-side physics.
 * Spec: docs/specs/games/gravity-shooter.md §2.1-§2.3
 *
 * Everything here is a pure function of its own inputs, by design (spec §8):
 * the shooter and the receiver must always draw the identical picture of the
 * same shot, so `simulateShot` cannot depend on anything but the planets and
 * the two numbers that cross the wire.
 */

let failures = 0;
let checks = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  checks++;
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

function symmetricPlanets(): [GravityPlanet, GravityPlanet] {
  return [
    { x: 0.2, y: 0.5, r: 0.05, art: 0 },
    { x: 0.8, y: 0.5, r: 0.05, art: 1 },
  ];
}

function farPlanets(): [GravityPlanet, GravityPlanet] {
  return [
    { x: 0.1, y: 0.5, r: 0.02, art: 0 },
    { x: 0.9, y: 0.5, r: 0.02, art: 1 },
  ];
}

const EPS = 1e-9;
const near = (a: number, b: number): boolean => Math.abs(a - b) < EPS;

function viewFlip(): void {
  console.log('\nthe one render-time transform');

  const p = { x: 0.3, y: 0.7 };
  check('seat 0 is drawn as-is', viewTransform(0, p).x === p.x && viewTransform(0, p).y === p.y);
  const flipped = viewTransform(1, p);
  check('seat 1 flips both axes', near(flipped.x, 0.7) && near(flipped.y, 0.3), flipped);
  const back = viewTransform(1, flipped);
  check('and flipping twice is the identity', near(back.x, p.x) && near(back.y, p.y), back);
}

function pull(): void {
  console.log('\na pull becomes an angle and a strength');

  check('nothing pulled is not a shot', aimFromPull(0, 0).strength === 0);

  // Pulled straight back (down, away from the opponent) fires straight up.
  const straight = aimFromPull(0, GRAVITY_MAX_PULL);
  check('a full pull straight back is full strength', straight.strength === 1, straight.strength);
  check('and fires straight up', Math.abs(straight.angle) < 1e-9, straight.angle);

  // Pulled to the right fires to the left — a slingshot, not a shove.
  const sideways = aimFromPull(GRAVITY_MAX_PULL, 0);
  check('pulling right fires left', sideways.angle < 0, sideways.angle);

  // A pull past the cap is clamped, not amplified.
  const over = aimFromPull(0, GRAVITY_MAX_PULL * 5);
  check('an over-pull is clamped to full strength', over.strength === 1, over.strength);
}

function velocity(): void {
  console.log('\nthe same local aim, mirrored per seat');

  const seat0 = localAimToWorldVelocity(0, 1, 0);
  const seat1 = localAimToWorldVelocity(0, 1, 1);
  check('seat 0 fires toward decreasing world y', seat0.y < 0, seat0.y);
  check('seat 1 fires toward increasing world y', seat1.y > 0, seat1.y);
  check('exactly mirrored, not independently tuned', seat0.x === -seat1.x && seat0.y === -seat1.y);
}

function determinism(): void {
  console.log('\nthe same shot always flies the same way');

  const planets = symmetricPlanets();
  const a = simulateShot(planets, 0, 0.3, 0.7);
  const b = simulateShot(planets, 0, 0.3, 0.7);
  check('identical inputs produce an identical path', JSON.stringify(a) === JSON.stringify(b));
  check('the path is more than just the start', a.path.length > 1, a.path.length);
}

function symmetry(): void {
  console.log('\na dead-centre shot between two mirrored planets');

  const planets = symmetricPlanets();
  const result = simulateShot(planets, 0, 0, 1);
  const drift = Math.max(...result.path.map((p) => Math.abs(p.x - 0.5)));
  check('never drifts off the centre line', drift < 1e-6, drift);
}

function simBoundsWiderThanTheBoard(): void {
  console.log('\nthe simulation is not clipped at the visible board edge');

  // A hard sideways shot, planets far enough off to barely curve it — the
  // point is to leave the visible [0,1] board without the flight ending
  // there, which is exactly the bug spec §2.3/§7 calls out.
  const result = simulateShot(farPlanets(), 0, Math.PI / 2, 1);
  const exitedTheVisibleBoard = result.path.some((p) => p.x > 1 || p.x < 0);
  check('the path is allowed to leave the visible board', exitedTheVisibleBoard, result.path.at(-1));
}

function targets(): void {
  console.log('\nwhere a ship actually sits');

  const seat0 = shipPosition(0);
  const seat1 = shipPosition(1);
  check('seat 0 sits near world y = 1', seat0.y > 0.5, seat0.y);
  check('seat 1 sits near world y = 0', seat1.y < 0.5, seat1.y);
  check('both centred on x', seat0.x === 0.5 && seat1.x === 0.5);
}

for (const t of [viewFlip, pull, velocity, determinism, symmetry, simBoundsWiderThanTheBoard, targets]) {
  t();
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
