import type { GravityPlanet, ServerMessage } from '../../../../shared/protocol';
import {
  GravityGame,
  GRAVITY_HIT_RADIUS,
  GRAVITY_MAX_AIM_DISTANCE,
  GRAVITY_MAX_LAUNCH_SPEED,
  GRAVITY_MIN_LAUNCH_SPEED,
  GRAVITY_OFFSCREEN_LIFETIME_MS,
  GRAVITY_PLANET_TWEEN_MS,
  GRAVITY_PAST_OPPONENT_LIFETIME_MS,
  GRAVITY_SHIP_WIDTH,
  GRAVITY_STEP_MS,
  aimFromFinger,
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

function aiming(): void {
  console.log('\na finger position becomes an angle and a strength');

  check('no finger offset is not a shot', aimFromFinger(0, 0).strength === 0);

  // A finger straight above the ship (negative local y) fires straight up.
  const straight = aimFromFinger(0, -GRAVITY_MAX_AIM_DISTANCE);
  check('a finger at the full aim distance is full strength', straight.strength === 1, straight.strength);
  check('and fires straight up', Math.abs(straight.angle) < 1e-9, straight.angle);

  // A finger to the right fires to the right — a targeting reticle, not a slingshot.
  const sideways = aimFromFinger(GRAVITY_MAX_AIM_DISTANCE, 0);
  check('a finger to the right fires right', sideways.angle > 0, sideways.angle);

  // A finger past the cap is clamped, not amplified.
  const over = aimFromFinger(0, -GRAVITY_MAX_AIM_DISTANCE * 5);
  check('a finger past the cap is clamped to full strength', over.strength === 1, over.strength);
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

/** No pull at all — a planet's own acceleration formula is `G * r² / ...`,
 *  so `r = 0` is the cheapest way to isolate the lifetime-zone logic below
 *  from the gravity integration these other tests already cover. */
const noPlanets: [GravityPlanet, GravityPlanet] = [
  { x: 0.5, y: 0.5, r: 0, art: 0 },
  { x: 0.5, y: 0.5, r: 0, art: 0 },
];

function lifetime(): void {
  console.log("\na shot's own lifetime depends on where it actually is (issue #16)");

  // A near-sideways shot at the weakest possible pull: slow enough to leave
  // the visible board without ever reaching the opponent's own row, and — now
  // that the minimum impulse is half what it was — slow enough that the 7s
  // OFFSCREEN budget runs out before it can reach the far
  // `GRAVITY_SIM_BOUNDS_MAX` wall. So the budget is what ends it, which is
  // what the spec says that budget is for.
  const grazing = simulateShot(noPlanets, 0, 1.5, 0);
  const target1 = shipPosition(1);
  const leftBoard = grazing.path.findIndex((p) => p.x > 1 || p.x < 0 || p.y > 1 || p.y < 0);
  const timeOffscreen = (grazing.path.length - 1 - leftBoard) * GRAVITY_STEP_MS;
  check('it does leave the visible board before ending', leftBoard > 0, leftBoard);
  check('never crosses the opponent\'s own row', !grazing.path.some((p) => p.y < target1.y));
  check('and still ends as a miss', grazing.hit === false);
  check('one offscreen budget after leaving, not a moment more',
    Math.abs(timeOffscreen - GRAVITY_OFFSCREEN_LIFETIME_MS) < GRAVITY_STEP_MS, timeOffscreen);
  const last = grazing.path.at(-1);
  check('and well inside the outer wall, so the budget ended it — not the wall',
    !!last && last.x < 1.5 - 0.05, last);

  // A shot aimed just past the opponent, missing by more than the hit
  // radius: once it flies beyond that row, "past" always wins over
  // "offscreen" (§ the zone-priority rule), so only the much shorter
  // PAST_OPPONENT budget governs from there.
  const passing = simulateShot(noPlanets, 0, 0.3, 0);
  const target0 = shipPosition(1);
  const crossedRow = passing.path.findIndex((p) => p.y < target0.y);
  const passingMs = (passing.path.length - 1) * GRAVITY_STEP_MS;
  const timePast = passingMs - crossedRow * GRAVITY_STEP_MS;
  check('a near-miss that flies past the opponent is not a hit', passing.hit === false);
  check('it does cross the opponent\'s own row', crossedRow > 0, crossedRow);
  check('and ends roughly one past-opponent budget after crossing it',
    Math.abs(timePast - GRAVITY_PAST_OPPONENT_LIFETIME_MS) < GRAVITY_STEP_MS * 2, timePast);
}

/**
 * No pull at all, same fixture `noPlanets` above serves — a clean read of what
 * the speed range alone (no gravity) does to flight time. Both are the ship-to
 * -ship distance minus one hit radius, over the speed for that end of the
 * range: halving the minimum impulse roughly doubled the slow one, and widening
 * the hitbox to the ship's full width shortened both, since the missile now
 * counts as arrived further out.
 */
const GRAVITY_FREE_MIN_IMPULSE_FRAMES = 613;
const GRAVITY_FREE_MAX_IMPULSE_FRAMES = 154;

function impulseRange(): void {
  console.log('\nlaunch speed is capped, floored, and shaped by launch intensity (follow-up after #16)');

  // The finger's own two extremes map to the two ends of the speed range,
  // not from zero: `GRAVITY_MIN_LAUNCH_SPEED` (barely dragged) up to
  // `GRAVITY_MAX_LAUNCH_SPEED` (dragged the full `GRAVITY_MAX_AIM_DISTANCE`).
  const min = localAimToWorldVelocity(0, 0, 0);
  const max = localAimToWorldVelocity(0, 1, 0);
  check('the weakest possible pull still moves, at the speed floor',
    near(Math.hypot(min.x, min.y), GRAVITY_MIN_LAUNCH_SPEED), min);
  check('a full-strength pull moves at the speed ceiling',
    near(Math.hypot(max.x, max.y), GRAVITY_MAX_LAUNCH_SPEED), max);

  // A dead-centre shot with no planets in the way always lands — it travels
  // straight down the centre line onto the opponent's own ship, the same
  // invariant `symmetry()` above exercises for a planet-flanked shot — so
  // its own frame count is a clean, deterministic read of how long each end
  // of the speed range takes to cross the board on its own, with gravity
  // contributing nothing.
  const weakest = simulateShot(noPlanets, 0, 0, 0);
  const strongest = simulateShot(noPlanets, 0, 0, 1);
  check('the weakest pull still reaches the opponent', weakest.hit === true);
  check('taking about 10.2s — the slow end of the display range',
    weakest.path.length - 1 === GRAVITY_FREE_MIN_IMPULSE_FRAMES, weakest.path.length - 1);
  check('a full-strength pull also reaches the opponent', strongest.hit === true);
  check('taking about 2.6s — the fast end of the display range',
    strongest.path.length - 1 === GRAVITY_FREE_MAX_IMPULSE_FRAMES, strongest.path.length - 1);
  check('and the weakest is four times the slowest — the impulse range itself',
    Math.abs(GRAVITY_MAX_LAUNCH_SPEED / GRAVITY_MIN_LAUNCH_SPEED - 4) < 1e-9,
    GRAVITY_MAX_LAUNCH_SPEED / GRAVITY_MIN_LAUNCH_SPEED);

  // The same two shots, now with two real planets in the way — a specific,
  // known gravitational pull, not none. Both still connect (their own pull
  // sits on the centre line the shot already travels, same as `symmetry()`
  // above), and both arrive sooner than the gravity-free baseline just
  // above: doubling `GRAVITY_G` (this follow-up's first change) means the
  // planets' own attraction toward the board's own middle band now measurably
  // shortens the flight at BOTH ends of the strength range, not just a
  // fraction of a step.
  const planets = symmetricPlanets();
  const weakestPulled = simulateShot(planets, 0, 0, 0);
  const strongestPulled = simulateShot(planets, 0, 0, 1);
  check('gravity still lets the weakest pull connect', weakestPulled.hit === true);
  check('arriving sooner than the gravity-free flight did',
    weakestPulled.path.length < weakest.path.length, weakestPulled.path.length - 1);
  check('gravity still lets a full-strength shot connect', strongestPulled.hit === true);
  check('arriving sooner than the gravity-free flight did, too',
    strongestPulled.path.length < strongest.path.length, strongestPulled.path.length - 1);
}

function shipSizedHitbox(): void {
  console.log('\nthe whole ship image is the target, not a dot at its centre');

  // The requirement is "the hitbox is the ship's own width", so the radius has
  // to be half of it — and derived from the same constant `GravityCanvas` draws
  // with, not a second number that happens to agree today.
  check('the hit DIAMETER is exactly the drawn ship width',
    Math.abs(GRAVITY_HIT_RADIUS * 2 - GRAVITY_SHIP_WIDTH) < 1e-9, { GRAVITY_HIT_RADIUS, GRAVITY_SHIP_WIDTH });

  // Fired with no planets, a shot travels dead straight, so the angle that
  // passes a chosen distance to the side of the opponent is pure geometry:
  // `atan(offset / the ship-to-ship distance)`. Checking just inside and just
  // outside the radius proves this measures the hitbox rather than merely
  // finding that everything connects.
  const reach = shipPosition(0).y - shipPosition(1).y;
  const offsetBy = (distance: number) => simulateShot(noPlanets, 0, Math.atan(distance / reach), 1);
  const clipping = offsetBy(GRAVITY_HIT_RADIUS * 0.9);
  const clearing = offsetBy(GRAVITY_HIT_RADIUS * 1.4);
  check('a shot passing inside the sprite\'s own edge connects', clipping.hit === true, clipping.path.at(-1));
  check('and one passing outside it still misses', clearing.hit === false, clearing.path.at(-1));
  // The old 0.06 hitbox would have missed the first of those outright.
  check('which the old dot-sized hitbox would not have caught', GRAVITY_HIT_RADIUS * 0.9 > 0.06);
}

function replayUsesTheBoardTheShotWasFiredOn(): void {
  console.log('\na replayed shot flies on the board it was fired on (moving planets)');

  const fired = symmetricPlanets();
  const rerolled: [GravityPlanet, GravityPlanet] = [
    { x: 0.35, y: 0.62, r: 0.14, art: 2 },
    { x: 0.72, y: 0.31, r: 0.07, art: 0 },
  ];
  const shot = { shooter: 0 as const, angle: 0.35, strength: 0.8, hit: false };
  const frame = (planets: [GravityPlanet, GravityPlanet], lastShot: typeof shot | null): ServerMessage => ({
    t: 'gravity',
    s: 1,
    d: {
      roundId: 7, startsAt: 0, seats: ['a', 'b'], planets, shots: 1,
      lives: [5, 5], turn: 1, resolvesAt: 0, lastShot, winner: null, phase: 'running', solo: false,
    },
  });

  // This phone is the RECEIVER: it never simulated the shot itself, so it
  // builds the replay from the frame. The referee re-rolls the board in the
  // same frame that reports the shot which triggered it, so that frame carries
  // the new planets and a shot fired on the old ones.
  const receiver = new GravityGame();
  receiver.identify('b', () => 0);
  receiver.apply(frame(fired, null));
  receiver.apply(frame(rerolled, shot));

  const onOldBoard = simulateShot(fired, 0, shot.angle, shot.strength);
  const onNewBoard = simulateShot(rerolled, 0, shot.angle, shot.strength);
  check('the two boards really do produce different flights',
    JSON.stringify(onOldBoard.path) !== JSON.stringify(onNewBoard.path));
  check('and the replay follows the board the shot was fired on',
    JSON.stringify(receiver.activeShot?.result.path) === JSON.stringify(onOldBoard.path));
}

function movingBoardIsHeldThenEased(): void {
  console.log('\na re-rolled board waits for the shot, then eases into place');

  const fired = symmetricPlanets();
  // Deliberately slot-swapped relative to `fired` (left planet second), to
  // prove the tween pairs by SIDE rather than by array index — pairing by
  // index would send both planets across each other through the middle.
  const rerolled: [GravityPlanet, GravityPlanet] = [
    { x: 0.74, y: 0.32, r: 0.09, art: 2 },
    { x: 0.26, y: 0.66, r: 0.15, art: 1 },
  ];
  const shot = { shooter: 0 as const, angle: 0.2, strength: 0.9, hit: false };

  let clock = 1_000;
  const game = new GravityGame();
  game.identify('b', () => clock);
  const frame = (planets: [GravityPlanet, GravityPlanet], lastShot: typeof shot | null): ServerMessage => ({
    t: 'gravity',
    s: 1,
    d: {
      roundId: 3, startsAt: 0, seats: ['a', 'b'], planets, shots: 2,
      lives: [5, 5], turn: 1, resolvesAt: 0, lastShot, winner: null, phase: 'running', solo: false,
    },
  });

  game.apply(frame(fired, null));
  check('the opening board is drawn as-is', JSON.stringify(game.displayedPlanets()) === JSON.stringify(fired));

  // The frame that reports the shot also carries the new board.
  game.apply(frame(rerolled, shot));
  check('the referee has already moved on', JSON.stringify(game.state?.planets) === JSON.stringify(rerolled));
  check('but the drawn board stays where the shot was fired', JSON.stringify(game.displayedPlanets()) === JSON.stringify(fired));
  check('because that shot is still in the air', game.activeShot !== null);

  // Mid-flight: still held, however long the flight runs.
  clock += 2_000;
  check('and it is still held mid-flight', JSON.stringify(game.displayedPlanets()) === JSON.stringify(fired));

  // The canvas clears the shot when the flight animation finishes.
  game.clearActiveShot();
  // Position and radius only: the art is the destination's from the first
  // frame of the slide (by design — the movement masks the sprite change), and
  // the pair comes back side-ordered while a tween is running.
  const atStart = game.displayedPlanets();
  const geometry = (board: readonly GravityPlanet[]) =>
    JSON.stringify([...board].sort((p, q) => p.x - q.x).map(({ x, y, r }) => [x, y, r]));
  check('the slide starts from the old board, not a jump', geometry(atStart) === geometry(fired), atStart);

  // The left planet slides 0.2 -> 0.26 and grows 0.05 -> 0.15, so halfway
  // through it must be strictly inside both of those ranges.
  clock += GRAVITY_PLANET_TWEEN_MS / 2;
  const midway = game.displayedPlanets();
  const left = midway[0].x <= midway[1].x ? midway[0] : midway[1];
  check('halfway through, the left planet is between its two positions', left.x > 0.2 && left.x < 0.26, left.x);
  check('and between its two sizes', left.r > 0.05 && left.r < 0.15, left.r);
  check('with one planet still on each half of the board',
    (midway[0].x < 0.5) !== (midway[1].x < 0.5), midway.map((p) => p.x));

  clock += GRAVITY_PLANET_TWEEN_MS;
  const settled = game.displayedPlanets();
  check('once it is over, the drawn board is exactly the referee\'s own',
    JSON.stringify(settled) === JSON.stringify(rerolled), settled);
}

function timedOutTurnIsNotAFlight(): void {
  console.log('\na turn that timed out is not a shot anybody fired');

  const planets = symmetricPlanets();
  const game = new GravityGame();
  game.identify('b', () => 0);
  const frame = (lastShot: { shooter: 0 | 1; angle: number; strength: number; hit: boolean } | null): ServerMessage => ({
    t: 'gravity',
    s: 1,
    d: {
      roundId: 4, startsAt: 0, seats: ['a', 'b'], planets, shots: 1,
      lives: [5, 5], turn: 1, resolvesAt: 0, lastShot, winner: null, phase: 'running', solo: false,
    },
  });
  game.apply(frame(null));

  // The referee marks a timed-out turn with a zero-strength shot (spec §2.4).
  // Since the launch speed has a floor, simulating it would fly a real missile
  // dead up the centre line and — with a ship-sized hitbox — connect, while
  // the referee's own `hit: false` means nothing happens. Nothing should fly.
  game.apply(frame({ shooter: 0, angle: 0, strength: 0, hit: false }));
  check('nothing is animated for it', game.activeShot === null);

  // And a real shot right after it still animates: the guard is about strength
  // zero, not about being the first shot seen.
  game.apply(frame({ shooter: 1, angle: 0.1, strength: 0.5, hit: false }));
  check('a real shot after one still flies', game.activeShot !== null);
}

for (const t of [viewFlip, aiming, velocity, determinism, symmetry, simBoundsWiderThanTheBoard, targets, lifetime, impulseRange, shipSizedHitbox, replayUsesTheBoardTheShotWasFiredOn, movingBoardIsHeldThenEased, timedOutTurnIsNotAFlight]) {
  t();
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
