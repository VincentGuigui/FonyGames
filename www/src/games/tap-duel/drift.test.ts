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

for (const t of [deterministic, continuous, staysOnScreen, absurdClocks]) {
  t();
}

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
