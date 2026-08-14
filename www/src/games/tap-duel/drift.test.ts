/**
 * The armed target's wander. Spec: docs/specs/games/tap-duel.md §4
 *
 * This is here rather than left to the eye because the thing that matters about it is
 * not how it looks: it has to be **the same on every phone**. The server picks the
 * target's position so no player gets a shorter thumb-travel than another, and a random
 * walk would give that back. Determinism is the requirement, so determinism is what is
 * asserted.
 */
import {
  DRIFT_LEG,
  DRIFT_LEG_MS,
  driftAt,
} from './drift';
import {
  driftSpeed,
  DRIFT_SPEED_MAX,
  DRIFT_SPEED_START,
  FIRE_MAX_MS,
  TARGET_MAX_X,
  TARGET_MAX_Y,
  TARGET_MIN_X,
  TARGET_MIN_Y,
  randomTarget,
} from '../../../../shared/protocol';

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

const ORIGIN = { x: 0.5, y: 0.5 };

function deterministic(): void {
  console.log('\nthe same on every phone');

  // The property the whole design turns on.
  for (const t of [0, 120, DRIFT_LEG_MS, 2_345, FIRE_MAX_MS]) {
    const a = driftAt(ORIGIN, 7, t);
    const b = driftAt(ORIGIN, 7, t);
    check(`t=${t} gives one answer`, a.x === b.x && a.y === b.y, [a, b]);
  }

  // Different rounds must not walk the same path, or the drift is learnable.
  const r1 = driftAt(ORIGIN, 1, 3_000);
  const r2 = driftAt(ORIGIN, 2, 3_000);
  check('a different round walks elsewhere', r1.x !== r2.x || r1.y !== r2.y, [r1, r2]);

  // And it starts where the server put it.
  const at0 = driftAt(ORIGIN, 3, 0);
  check('at t=0 it is exactly the origin', at0.x === ORIGIN.x && at0.y === ORIGIN.y, at0);
}

function continuous(): void {
  console.log('\ncontinuous, not a jump every leg');

  // No frame-to-frame step may be big enough to read as teleporting. At 60 fps a
  // 16 ms step is about 1/44th of a leg.
  let worst = 0;
  let prev = driftAt(ORIGIN, 11, 0);
  for (let t = 16; t <= FIRE_MAX_MS; t += 16) {
    const p = driftAt(ORIGIN, 11, t);
    worst = Math.max(worst, Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = p;
  }
  const perFrame = (DRIFT_LEG * 16) / DRIFT_LEG_MS;
  check(
    'every 16 ms step is one frame of travel, including across a leg boundary',
    worst < perFrame * 1.6,
    { worst, perFrame },
  );

  // It must actually move — a drift that stays put is not a drift.
  const moved = Math.hypot(
    driftAt(ORIGIN, 5, DRIFT_LEG_MS).x - ORIGIN.x,
    driftAt(ORIGIN, 5, DRIFT_LEG_MS).y - ORIGIN.y,
  );
  check('a full leg goes somewhere', moved > DRIFT_LEG * 0.3, moved);
}

function staysOnScreen(): void {
  console.log('\nnever leaves the box the server aims into');

  // Bounded for any origin the server can pick, any round, and well past the longest
  // armed window — the target must never drift under the HUD or off the screen.
  let out = 0;
  for (let seed = 0; seed < 40; seed++) {
    const origin = randomTarget();
    for (let t = 0; t <= FIRE_MAX_MS * 3; t += 97) {
      const p = driftAt(origin, seed, t);
      if (
        p.x < TARGET_MIN_X - 1e-9 ||
        p.x > TARGET_MAX_X + 1e-9 ||
        p.y < TARGET_MIN_Y - 1e-9 ||
        p.y > TARGET_MAX_Y + 1e-9
      ) {
        out++;
      }
    }
  }
  check('40 rounds x 18 s never step outside', out === 0, out);

  // A leg covers most of the box's width, so hitting a wall is ordinary rather than
  // a rare edge. Worth pinning down, because it is why `fold` reflects instead of
  // clamping: clamping would park the target against an edge and leave it there.
  const boxW = TARGET_MAX_X - TARGET_MIN_X;
  check(
    'a leg is over half the box wide, so bouncing is ordinary',
    DRIFT_LEG > boxW * 0.5 && DRIFT_LEG < boxW,
    { leg: DRIFT_LEG, box: boxW, ratio: DRIFT_LEG / boxW },
  );

  // Prove the reflection actually fires, rather than trusting the ratio above: from
  // a corner of the box, a leg aimed outward has to come back in.
  let bounced = 0;
  for (let seed = 0; seed < 60; seed++) {
    const p = driftAt({ x: TARGET_MIN_X, y: TARGET_MIN_Y }, seed, DRIFT_LEG_MS);
    if (p.x > TARGET_MIN_X + 1e-9 || p.y > TARGET_MIN_Y + 1e-9) bounced++;
  }
  check('from the corner, every direction still ends up inside', bounced === 60, bounced);
}

function absurdClocks(): void {
  console.log('\na clock that has gone wrong');

  // `elapsed` comes from a corrected clock; a phone waking from sleep can produce
  // nonsense. None of it may hang a frame or return NaN.
  for (const t of [-5_000, 0, 1e9, Number.MAX_SAFE_INTEGER]) {
    const p = driftAt(ORIGIN, 4, t);
    check(`t=${t} stays finite and in the box`,
      Number.isFinite(p.x) && Number.isFinite(p.y) &&
      p.x >= TARGET_MIN_X - 1e-9 && p.x <= TARGET_MAX_X + 1e-9 &&
      p.y >= TARGET_MIN_Y - 1e-9 && p.y <= TARGET_MAX_Y + 1e-9, p);
  }
  check('a negative elapsed is simply the origin',
    driftAt(ORIGIN, 4, -1).x === ORIGIN.x && driftAt(ORIGIN, 4, -1).y === ORIGIN.y);
}

/**
 * The ramp: slow at the start of a match, faster with every point scored.
 *
 * The speed scales the CLOCK, so "faster" means the same path covered sooner — which is
 * both the cheap implementation and the thing that has to be true for every phone to agree
 * on where the target is. The server sends the number precisely so nobody derives a
 * different one.
 */
function speedsUp(): void {
  console.log('\nthe target speeds up through a match');

  check('the first duel of a match is the slowest', driftSpeed(0) === DRIFT_SPEED_START);
  check('and every point makes the next one faster', driftSpeed(1) > driftSpeed(0));
  check('monotonically', driftSpeed(5) > driftSpeed(4) && driftSpeed(9) > driftSpeed(5));
  // Legs are a fixed length, so past a point the target changes direction faster than a
  // hand can react — which is not harder, it is arbitrary.
  check('but it is capped', driftSpeed(500) === DRIFT_SPEED_MAX);
  check('and the last duel of a match is inside the cap', driftSpeed(9) <= DRIFT_SPEED_MAX);
  // The first round of a match must be slower than the old fixed speed, or "slow at first"
  // is not true of the only round every player definitely sees.
  check('the opening target is slower than a plain one', driftSpeed(0) < 1);
  check('nonsense is not a speed', driftSpeed(Number.NaN) === DRIFT_SPEED_START);
  check('nor is a negative one', driftSpeed(-4) === DRIFT_SPEED_START);

  // Scaling the clock: twice the speed reaches the same place in half the time.
  const fast = driftAt(ORIGIN, 5, 1_000, 2);
  const slow = driftAt(ORIGIN, 5, 2_000, 1);
  check('double speed is the same path at double rate',
    Math.abs(fast.x - slow.x) < 1e-9 && Math.abs(fast.y - slow.y) < 1e-9, { fast, slow });

  /*
   * And it covers more ground in the same time, which is the whole point.
   *
   * Measured as PATH LENGTH, not as distance from the origin: the walk folds off the edges
   * of its box, so a faster target can easily have bounced back nearer the start. The first
   * version of this check compared distance-from-origin and failed against a perfectly
   * working ramp.
   */
  const walked = (speed: number): number => {
    let total = 0;
    let prev = driftAt(ORIGIN, 6, 0, speed);
    for (let t = 16; t <= 3_000; t += 16) {
      const q = driftAt(ORIGIN, 6, t, speed);
      total += Math.hypot(q.x - prev.x, q.y - prev.y);
      prev = q;
    }
    return total;
  };
  const early = walked(driftSpeed(0));
  const late = walked(driftSpeed(9));
  check('a late-match target covers more ground in the same time', late > early * 2, { early, late });

  check('omitting the speed is the old behaviour',
    driftAt(ORIGIN, 8, 1_234, 1).x === driftAt(ORIGIN, 8, 1_234).x);

  // The box still holds at speed: a fast target that could leave the screen would be
  // unhittable rather than hard.
  for (const sp of [DRIFT_SPEED_START, 1, DRIFT_SPEED_MAX, 99]) {
    for (const t of [0, 800, 6_000, 1e9]) {
      const q = driftAt(ORIGIN, 9, t, sp);
      check(`speed ${sp} at t=${t} stays in the box`,
        q.x >= TARGET_MIN_X - 1e-9 && q.x <= TARGET_MAX_X + 1e-9 &&
        q.y >= TARGET_MIN_Y - 1e-9 && q.y <= TARGET_MAX_Y + 1e-9, q);
    }
  }
}

for (const t of [deterministic, continuous, staysOnScreen, absurdClocks, speedsUp]) {
  t();
}

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
