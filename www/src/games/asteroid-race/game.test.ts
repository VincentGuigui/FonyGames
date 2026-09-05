import {
  ASTEROID_BOOST_MS,
  ASTEROID_CRUISE_SPEED,
  ASTEROID_LIVES,
  ASTEROID_STUN_MS,
  ASTEROID_TRACK_LENGTH,
} from '../../../../shared/protocol';
import {
  ASTEROID_CORRIDOR_R,
  ASTEROID_GATE_RING,
  ASTEROID_GATE_RING_R,
  ASTEROID_R_LARGE,
  ASTEROID_R_SMALL,
  ASTEROID_SHIP_R,
  ASTEROID_SPACING,
  formationAt,
  formationZ,
  hash01,
  isGate,
  rockAt,
  splitRock,
  type Rock,
} from './field';
import {
  ASTEROID_BOOST_SPEED,
  ASTEROID_CLEAR_Z,
  ASTEROID_DRAW_Z,
  ASTEROID_MISSILE_COOLDOWN_MS,
  ASTEROID_MISSILE_RANGE,
  ASTEROID_REACH,
  ASTEROID_REACTION_MS,
  AsteroidRun,
  fogAlpha,
  project,
  reticlePick,
  sweptHit,
  type RunEvent,
  warningMs,
} from './game';

/**
 * Asteroid Race's flight — the half of this game the referee never sees.
 * Spec: docs/specs/games/asteroid-race.md §2.1-§2.4, §13
 *
 * Two of these are load-bearing rules rather than behaviour, and are asserted
 * against the shipped constants rather than against a fixture: a gate is
 * genuinely impassable until it is shot (§2.3), and the fog can never hide a
 * rock you still have to dodge (§2.4). If either stops holding, the game is
 * broken in a way no amount of play would reliably surface.
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

/** Can a hull centred at (x, y) pass this formation without touching a rock? */
function passable(rocks: readonly Rock[], x: number, y: number): boolean {
  return rocks.every((rock) => Math.hypot(rock.x - x, rock.y - y) > rock.r + ASTEROID_SHIP_R);
}

/** Sweep the whole tube cross-section on a fine grid. Returns every hull
 *  position that gets through. */
function openings(rocks: readonly Rock[], step = 0.1): { x: number; y: number }[] {
  const found: { x: number; y: number }[] = [];
  for (let x = -ASTEROID_REACH; x <= ASTEROID_REACH + 1e-9; x += step) {
    for (let y = -ASTEROID_REACH; y <= ASTEROID_REACH + 1e-9; y += step) {
      if (Math.hypot(x, y) > ASTEROID_REACH) continue;
      if (passable(rocks, x, y)) found.push({ x, y });
    }
  }
  return found;
}

function theField(): void {
  console.log('\none field, dealt by arithmetic (§2.1)');

  // The whole point: two phones with nothing but a roundId agree completely.
  const a = formationAt(77, 12);
  const b = formationAt(77, 12);
  check('the same round and index deal the identical formation', JSON.stringify(a) === JSON.stringify(b));
  check('a different round deals a different one', JSON.stringify(formationAt(78, 12)) !== JSON.stringify(a));
  check('and so does a different place down the track', JSON.stringify(formationAt(77, 13)) !== JSON.stringify(a));
  check('the hash is a real 0..1', hash01(3, 4, 5) >= 0 && hash01(3, 4, 5) < 1, hash01(3, 4, 5));

  // Every rock is inside the tube it is drawn in, whatever the roll says.
  let checked = 0;
  for (let round = 1; round <= 30; round++) {
    for (let i = 0; i < 70; i++) {
      for (const rock of formationAt(round, i)) {
        checked++;
        if (Math.hypot(rock.x, rock.y) + rock.r > ASTEROID_CORRIDOR_R + 1e-9) {
          check(`round ${round} formation ${i}: a rock sticks out of the tube`, false, rock);
          return;
        }
        if (Math.abs(rock.z - formationZ(i)) > ASTEROID_SPACING) {
          check(`round ${round} formation ${i}: a rock is in the wrong place`, false, rock);
          return;
        }
      }
    }
  }
  check(`every one of ${checked} rocks across 30 rounds sits inside the tube`, checked > 2000, checked);

  // Gates are rare, but they are there — and never in the first two.
  let gates = 0;
  for (let i = 0; i < 700; i++) if (isGate(5, i)) gates++;
  check('gates are dealt at roughly the stated rate', gates > 30 && gates < 75, gates);
  check('but never before a player has seen the field', !isGate(5, 0) && !isGate(5, 1));
}

function theGateIsSealed(): void {
  console.log('\na gate has no way through until it is shot (§2.3)');

  // Find a real gate rather than constructing one, so this tests the geometry
  // that actually ships.
  let gate: Rock[] | null = null;
  for (let i = 2; i < 500 && !gate; i++) if (isGate(5, i)) gate = formationAt(5, i);
  check('the field really does deal gates', gate !== null);
  if (!gate) return;

  check('a gate is a ring plus its key', gate.length === ASTEROID_GATE_RING + 1, gate.length);
  const key = gate.find((r) => r.size === 'large');
  check('with one large rock in the middle', !!key && Math.hypot(key.x, key.y) < 1e-9, key);

  const before = openings(gate);
  check('and not one hull position in the whole cross-section gets through', before.length === 0, before.slice(0, 3));

  // Shoot the key. Two halves sitting where their parent was block less than
  // it did, so the middle opens immediately — but only just: a sliver you
  // would have to thread.
  const halves = splitRock(key as Rock, 0);
  const rest = gate.filter((r) => r !== key);
  const instantly = openings([...rest, ...halves]);
  check('shooting it opens the middle at once', instantly.length > 0);
  check('but only a sliver of it', instantly.length < 1000, instantly.length);

  // A beat later the two halves have cleared out and the gap is a real one.
  const drifted = halves.map((h) => rockAt(h, 400));
  const after = openings([...rest, ...drifted]);
  check('a beat later it is a gap worth flying at', after.length > instantly.length * 4, after.length);
  check('and the way through is the middle, where the rock was — never the wall',
    after.every((p) => Math.hypot(p.x, p.y) < ASTEROID_R_LARGE), after.slice(0, 3));
  check('the middle itself is open', passable([...rest, ...drifted], 0, 0));

  // The halves are still rocks: they can take a life on the way past.
  check('the halves are live rocks, not scenery',
    drifted.every((h) => h.r === ASTEROID_R_SMALL && h.size === 'small'));
  check('leaving in opposite directions',
    Math.abs(drifted[0]!.x + drifted[1]!.x) < 1e-9 && Math.abs(drifted[0]!.y + drifted[1]!.y) < 1e-9, drifted);
}

function theFogIsFair(): void {
  console.log('\nthe fog may never hide a rock you still have to dodge (§2.4)');

  // The inequality the spec writes, asserted against the shipped numbers.
  const atBoost = warningMs(ASTEROID_BOOST_SPEED);
  check('a fully-lit rock is visible for at least one reaction, at full boost',
    atBoost >= ASTEROID_REACTION_MS, { atBoost, ASTEROID_REACTION_MS });
  check('and for longer at cruise', warningMs(ASTEROID_CRUISE_SPEED) > atBoost);

  check('a rock at the clear distance is fully lit', fogAlpha(ASTEROID_CLEAR_Z) === 1);
  check('one right on top of you too', fogAlpha(10) === 1);
  check('one at the draw distance is gone', fogAlpha(ASTEROID_DRAW_Z) === 0);
  check('and nothing beyond it is drawn at all', fogAlpha(ASTEROID_DRAW_Z + 500) === 0);
  const mid = fogAlpha((ASTEROID_CLEAR_Z + ASTEROID_DRAW_Z) / 2);
  check('in between it fades rather than pops', mid > 0.4 && mid < 0.6, mid);
}

function theView(): void {
  console.log('\nthe camera, behind and above (§4)');

  const ship = { x: 0, y: 0, distance: 100 };
  const ahead = project({ x: 0, y: 0, z: 200 }, ship);
  check('a rock straight ahead is dead centre horizontally', !!ahead && Math.abs(ahead.ox) < 1e-9);
  check('and below the vanishing point, because the camera is above', !!ahead && ahead.oy > 0, ahead);

  const far = project({ x: 0, y: 0, z: 600 }, ship);
  check('the further it is, the smaller', !!far && !!ahead && far.scale < ahead.scale);
  check('and the nearer the vanishing point it sits', !!far && !!ahead && far.oy < ahead.oy);

  const right = project({ x: 4, y: 0, z: 200 }, ship);
  check('a rock to the right draws to the right', !!right && right.ox > 0);
  check('nothing level with the camera is drawn', project({ x: 0, y: 0, z: 86 }, ship) === null);
  check('nor anything behind it', project({ x: 0, y: 0, z: 0 }, ship) === null);

  // The ship holds the horizontal middle whatever it does, which is what makes
  // "the middle of the screen" mean "where I am going" (§4).
  const drifted = { x: 5, y: -3, distance: 100 };
  const self = project({ x: 5, y: -3, z: 100 }, drifted);
  check('the ship itself never leaves the middle', !!self && Math.abs(self.ox) < 1e-9, self);
}

function collisions(): void {
  console.log('\nwhat counts as clipping a rock');

  const rock: Rock = { id: 'r', x: 0, y: 0, z: 100, r: ASTEROID_R_SMALL, size: 'small', vx: 0, vy: 0, seed: 1 };
  const straightOn = sweptHit({ x: 0, y: 0, z: 90 }, { x: 0, y: 0, z: 110 }, rock);
  check('flying straight into one is a hit', straightOn);

  // Just inside and just outside the hull-plus-rock radius, at the same z.
  const grazing = ASTEROID_R_SMALL + ASTEROID_SHIP_R;
  check('passing just inside its reach clips it',
    sweptHit({ x: grazing * 0.9, y: 0, z: 90 }, { x: grazing * 0.9, y: 0, z: 110 }, rock));
  check('and passing just outside it does not',
    !sweptHit({ x: grazing * 1.1, y: 0, z: 90 }, { x: grazing * 1.1, y: 0, z: 110 }, rock));

  // The sweep is the point: a frame long enough to jump the rock entirely
  // still registers, which a pair of point tests would miss.
  check('a dropped frame cannot tunnel through one',
    sweptHit({ x: 0, y: 0, z: 90 }, { x: 0, y: 0, z: 130 }, rock));
  check('a frame that stops short of it does not hit it',
    !sweptHit({ x: 0, y: 0, z: 50 }, { x: 0, y: 0, z: 90 }, rock));
  check('and one already past it does not hit it again',
    !sweptHit({ x: 0, y: 0, z: 110 }, { x: 0, y: 0, z: 140 }, rock));
}

function theReticle(): void {
  console.log('\nwhat the missile takes');

  const ship = { x: 0, y: 0, distance: 0 };
  const near: Rock = { id: 'near', x: 0, y: 0, z: 100, r: ASTEROID_R_SMALL, size: 'small', vx: 0, vy: 0, seed: 1 };
  const far: Rock = { id: 'far', x: 0, y: 0, z: 200, r: ASTEROID_R_LARGE, size: 'large', vx: 0, vy: 0, seed: 2 };
  const aside: Rock = { id: 'aside', x: 6, y: 0, z: 50, r: ASTEROID_R_SMALL, size: 'small', vx: 0, vy: 0, seed: 3 };
  const behind: Rock = { id: 'behind', x: 0, y: 0, z: -50, r: ASTEROID_R_SMALL, size: 'small', vx: 0, vy: 0, seed: 4 };
  const beyond: Rock = { id: 'beyond', x: 0, y: 0, z: ASTEROID_MISSILE_RANGE + 50, r: ASTEROID_R_LARGE, size: 'large', vx: 0, vy: 0, seed: 5 };

  check('the nearest rock in the reticle, not the biggest',
    reticlePick([far, near, aside], ship)?.id === 'near');
  check('one off to the side is not in the reticle', reticlePick([aside], ship) === null);
  check('nor is one already behind you', reticlePick([behind], ship) === null);
  check('nor one past the missile\'s own range', reticlePick([beyond], ship) === null);
  check('an empty sky takes nothing', reticlePick([], ship) === null);
  check('and steering changes what is in front of you',
    reticlePick([aside], { x: 6, y: 0, distance: 0 })?.id === 'aside');
}

function flying(): void {
  console.log('\na run, flown');

  const run = new AsteroidRun(1);
  check('it starts on the line', run.distance === 0 && run.lives === ASTEROID_LIVES && run.hits === 0);
  check('with both buttons charged', run.boostCharge === 1 && run.missileCharge === 1);

  // Half a second, dead straight — short enough that the first formation
  // (§2.1 never deals one before z = 35) cannot interfere with the reading.
  for (let i = 0; i < 30; i++) run.step(1000 / 60, 0, 0);
  check('cruising covers ground at exactly the cruise speed',
    Math.abs(run.distance - ASTEROID_CRUISE_SPEED / 2) < 0.5, run.distance);
  check('and nothing has been clipped this early', run.hits === 0);

  // Steering moves the ship and is clamped to the tube, however long it is held.
  for (let i = 0; i < 300; i++) run.step(1000 / 60, 1, 0);
  check('holding a tilt moves the ship across the tube', run.x > 1, run.x);
  check('but never through its wall', Math.hypot(run.x, run.y) <= ASTEROID_REACH + 1e-9, { x: run.x, y: run.y });

  /*
   * Both axes, checked against what the CAMERA does with them rather than
   * against the sign of a field. The vertical one shipped inverted: a climb
   * drove the ship into the floor of the tube, because world y is up-positive
   * (that is `project`'s own convention) and `step` was subtracting. Nothing
   * caught it, because the test above only ever held the x axis.
   */
  const flown = (sx: number, sy: number) => {
    const r = new AsteroidRun(2);
    for (let i = 0; i < 20; i++) r.step(1000 / 60, sx, sy);
    return r;
  };
  const rockAhead = (r: AsteroidRun) => project({ x: 0, y: 0, z: r.distance + 100 }, r)!;
  const level = rockAhead(flown(0, 0));

  const climbed = flown(0, 1);
  check('a climb raises the ship', climbed.y > 0, climbed.y);
  check('and the world drops down the screen to say so', rockAhead(climbed).oy > level.oy);

  const dived = flown(0, -1);
  check('a dive lowers it', dived.y < 0, dived.y);
  check('and the world rises to say so', rockAhead(dived).oy < level.oy);

  const right = flown(1, 0);
  check('steering right moves right', right.x > 0, right.x);
  check('and the world slides left to say so', rockAhead(right).ox < 0);

  const left = flown(-1, 0);
  check('steering left moves left', left.x < 0, left.x);
  check('and the world slides right to say so', rockAhead(left).ox > 0);

  const diagonal = flown(1, 1);
  check('and both axes work at once, not one or the other',
    diagonal.x > 0 && diagonal.y > 0, { x: diagonal.x, y: diagonal.y });

  // Boost: faster while it lasts, then a cooldown before the next one.
  const boosted = new AsteroidRun(2);
  check('the first boost is free', boosted.boost() === true);
  check('a second one is not', boosted.boost() === false);
  check('and the button reads empty while it burns', boosted.boostCharge === 0);
  // The same half-second, measured against the same clear opening stretch.
  for (let i = 0; i < 30; i++) boosted.step(1000 / 60, 0, 0);
  check('boosting covers meaningfully more of it',
    boosted.distance > ASTEROID_CRUISE_SPEED / 2 * 1.5 && boosted.hits === 0, boosted.distance);
  boosted.step(ASTEROID_BOOST_MS, 0, 0);
  check('the burst ends on its own', boosted.boosting === false);
  check('and the next one has to recharge', boosted.boost() === false);
}

function clippingARock(): void {
  console.log('\nclipping a rock costs a life and a second');

  // Fly a real field until something is hit, holding a straight line.
  const run = new AsteroidRun(3);
  let hit: Extract<RunEvent, { kind: 'hit' }> | null = null;
  for (let i = 0; i < 60 * 30 && !hit; i++) {
    const events = run.step(1000 / 60, 0, 0);
    hit = (events.find((e) => e.kind === 'hit') as Extract<RunEvent, { kind: 'hit' }> | undefined) ?? null;
  }
  check('a ship flown blind down the middle does eventually clip something', hit !== null);
  check('and it costs a life', run.lives === ASTEROID_LIVES - 1, run.lives);
  check('and counts as a hit', run.hits === 1);
  check('the ship is stopped', run.stunned && run.speed === 0);

  const stoppedAt = run.distance;
  run.step(ASTEROID_STUN_MS / 2, 0, 0);
  check('and stays stopped for its stunned second', Math.abs(run.distance - stoppedAt) < 1e-9, run.distance);
  check('while a second rock cannot take a second life', run.lives === ASTEROID_LIVES - 1);

  run.step(ASTEROID_STUN_MS, 0, 0);
  check('then it flies again', run.stunned === false);
  run.step(1000 / 60, 0, 0);
  check('and moves', run.distance > stoppedAt);

  // The rock that took the life is gone rather than sitting there to take
  // another — asserted on that rock, not on "no hit happened", since a real
  // field can legitimately put a second rock right behind the first.
  const gone = run.rocksNear(run.distance - 60, run.distance + 60).every((r) => r.id !== hit?.rock.id);
  check('the rock it hit is destroyed, not left to take another life', gone, hit?.rock.id);
}

/**
 * The `destroyed` event: fired exactly once, the frame the run's own last
 * life is spent, carrying the SHIP's own position rather than the rock's —
 * the room needs two different burst locations from the same frame (spec §4):
 * `impact_missile.gif` where the flight actually met the rock, and
 * `explosion.gif` on the ship itself.
 */
function beingDestroyed(): void {
  console.log('\nthe ship\'s own destruction is its own event, at its own position');

  const run = new AsteroidRun(3);
  let destroyed: Extract<RunEvent, { kind: 'destroyed' }> | null = null;
  let hitsSeenSoFar = 0;
  for (let i = 0; i < 60 * 60 * 5 && run.lives > 0; i++) {
    const events = run.step(1000 / 60, 0, 0);
    for (const e of events) {
      if (e.kind === 'hit') hitsSeenSoFar += 1;
      if (e.kind === 'destroyed') destroyed = e;
    }
  }

  check('flown long enough, the run does eventually lose its last life', run.lives === 0, run.lives);
  check('and that fires the destroyed event, not silence', destroyed !== null);
  check('exactly on the life-ending hit, not some other one',
    hitsSeenSoFar === ASTEROID_LIVES, hitsSeenSoFar);
  check('at the ship\'s own position, not the rock\'s',
    !!destroyed && destroyed.at.x === run.x && destroyed.at.y === run.y && destroyed.at.z === run.distance,
    destroyed);

  // A run that still has lives left never fires it — the event means "this
  // run is over", not "something was hit".
  const alive = new AsteroidRun(3);
  const events = alive.step(1000 / 60, 0, 0);
  check('a run with lives left never fires it', !events.some((e) => e.kind === 'destroyed'));
}

function shooting(): void {
  console.log('\nthe missile, and what a gate costs');

  // Put the ship on a real gate's approach rather than flying blind at one —
  // this is about the missile, not about surviving the way there.
  let gateIndex = -1;
  for (let i = 2; i < 120; i++) if (isGate(9, i)) { gateIndex = i; break; }
  check('this round deals a gate to fly at', gateIndex > 0, gateIndex);
  if (gateIndex < 0) return;
  const gateZ = formationZ(gateIndex);

  const run = new AsteroidRun(9);
  // Inside the gate's own clear air (§2.1), so nothing else is in the beam.
  run.distance = gateZ - 60;

  // Dead centre, the crosshair is on the key.
  const target = reticlePick(run.rocksNear(run.distance, run.distance + ASTEROID_MISSILE_RANGE), run);
  check('lined up on the middle, the crosshair holds the big one', target?.size === 'large', target?.id);

  const shot = run.fire(0);
  check('and firing takes it', shot !== null && shot.rock.size === 'large');
  check('a large rock splits rather than vanishing', shot?.split === true);
  check('the missile then has to recharge', run.missileCharge < 1);
  check('so a second shot is refused', run.fire(0) === null);

  // The halves are there, the key is not, and a beat later the middle is open.
  run.step(400, 0, 0);
  const now = run.rocksNear(gateZ - 20, gateZ + 20);
  check('the key is gone', !now.some((r) => r.id.endsWith(':key')));
  check('and two halves are in its place', now.filter((r) => r.id.includes('/')).length === 2);
  check('the middle is open where it was',
    now.every((r) => Math.hypot(r.x, r.y) > r.r + ASTEROID_SHIP_R));

  // Off-centre, the same shot takes a RING rock instead — the beam picks the
  // nearest rock it passes through, so a gate answered from the side burns the
  // missile and stays shut. This is the trap the reticle exists to show.
  const off = new AsteroidRun(9);
  off.distance = gateZ - 60;
  off.x = ASTEROID_GATE_RING_R;
  const sideOn = reticlePick(off.rocksNear(off.distance, off.distance + ASTEROID_MISSILE_RANGE), off);
  check('from the side, the crosshair is on a ring rock, not the key',
    sideOn !== null && sideOn.size === 'small', sideOn?.id);
  off.fire(0);
  const stillShut = off.rocksNear(gateZ - 20, gateZ + 20);
  check('so the gate is still shut after it', stillShut.some((r) => r.id.endsWith(':key')));

  const cooled = new AsteroidRun(9);
  cooled.step(ASTEROID_MISSILE_COOLDOWN_MS, 0, 0);
  check('the missile does recharge on its own', cooled.missileCharge === 1);
}

/**
 * A pilot that reads the field perfectly and flies it: aims at the widest hole
 * in the next wall, and when a wall has no hole at all — a gate — lines up the
 * middle and shoots it, but only once the big rock is actually in the
 * crosshair. That last part is not pedantry: the beam takes the NEAREST rock
 * it passes through, so firing at a gate from off-centre destroys a ring rock,
 * burns the cooldown and leaves the gate shut. A player reads that off the
 * reticle; this reads it off `reticlePick`.
 */
function autopilot(run: AsteroidRun): { gatesShot: number } {
  let gatesShot = 0;
  let frames = 0;
  while (!run.done && frames < 60 * 200) {
    frames++;
    const ahead = run.rocksNear(run.distance + 3, run.distance + 260);
    if (ahead.length === 0) {
      run.boost();
      run.step(1000 / 60, 0, 0);
      continue;
    }

    let nearestZ = Infinity;
    for (const rock of ahead) nearestZ = Math.min(nearestZ, rock.z);
    const wall = ahead.filter((rock) => rock.z < nearestZ + 22);

    // The widest hole in that wall, sampled on a polar grid.
    let bestX = 0;
    let bestY = 0;
    let bestClear = -Infinity;
    let bestScore = -Infinity;
    for (let ring = 0; ring <= 8; ring++) {
      const radius = (ring / 8) * ASTEROID_REACH;
      const steps = ring === 0 ? 1 : 20;
      for (let k = 0; k < steps; k++) {
        const angle = (k / steps) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        let clear = Infinity;
        for (const rock of wall) clear = Math.min(clear, Math.hypot(rock.x - x, rock.y - y) - rock.r - ASTEROID_SHIP_R);
        const score = clear - Math.hypot(x - run.x, y - run.y) * 0.05;
        if (score > bestScore) {
          bestScore = score;
          bestClear = clear;
          bestX = x;
          bestY = y;
        }
      }
    }

    const sealed = bestClear < 0.3;
    if (sealed) {
      const pick = reticlePick(ahead, run);
      if (pick && pick.size === 'large' && run.fire(0)) gatesShot++;
    }
    const targetX = sealed ? 0 : bestX;
    const targetY = sealed ? 0 : bestY;
    // Both steers point AT the target. This read `-(targetY - run.y)` while
    // `step` subtracted its own y — two inversions that cancelled, which is
    // exactly why twelve races finished green over a vertical axis that was
    // upside down for anyone actually holding a phone.
    run.step(
      1000 / 60,
      Math.max(-1, Math.min(1, (targetX - run.x) / 0.4)),
      Math.max(-1, Math.min(1, (targetY - run.y) / 0.4)),
    );
    if (!sealed && bestClear > 3 && nearestZ - run.distance > 120) run.boost();
  }
  return { gatesShot };
}

function winnable(): void {
  console.log('\nevery field this deals can actually be flown (§2.1, §2.3)');

  // The equivalent of Gravity Shooter's own `seatCanReachOpponent`: proof that
  // the field is completable, rather than a hope that it is. Twelve rounds,
  // every one flown to the line — and the pilot still spends lives doing it,
  // so this is not a claim that the game is easy.
  let finished = 0;
  let gates = 0;
  let livesLeft = 0;
  const failures: number[] = [];
  for (let roundId = 1; roundId <= 12; roundId++) {
    const run = new AsteroidRun(roundId);
    const { gatesShot } = autopilot(run);
    gates += gatesShot;
    if (run.finishedAtMs !== null) {
      finished++;
      livesLeft += run.lives;
    } else failures.push(roundId);
  }
  check('a pilot that reads the field finishes every round of it', finished === 12, failures);
  check('having had to shoot gates open along the way', gates >= 12, gates);
  check('and it is not a walkover — lives are spent getting there',
    livesLeft < 12 * ASTEROID_LIVES, livesLeft);
}

function theWholeRace(): void {
  console.log('\nthe race, end to end');

  // One race, flown by the same pilot, so the finish itself can be asserted.
  const run = new AsteroidRun(11);
  const { gatesShot } = autopilot(run);

  check('the autopilot gets to the end of the track', run.finishedAtMs !== null, { distance: run.distance, lives: run.lives });
  check('and it had to shoot its way through gates to do it', gatesShot > 0, gatesShot);
  check('and stops exactly on the line', run.distance === ASTEROID_TRACK_LENGTH, run.distance);
  check('in a plausible time for a boosted run',
    (run.finishedAtMs ?? 0) > 40_000 && (run.finishedAtMs ?? 0) < 70_000, run.finishedAtMs);
  check('a finished run stops flying', (() => {
    const before = run.distance;
    run.step(1000, 0, 0);
    return run.distance === before;
  })());

  // The three numbers that leave the phone, and nothing else.
  check('it has a distance, lives and hits to report',
    Number.isFinite(run.distance) && run.lives >= 0 && run.hits >= 0, { d: run.distance, l: run.lives, h: run.hits });
}

for (const t of [theField, theGateIsSealed, theFogIsFair, theView, collisions, theReticle, flying, clippingARock, beingDestroyed, shooting, winnable, theWholeRace]) {
  t();
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
