/**
 * Spill's aim window. Spec: docs/specs/games/spill.md §2
 *
 * Pure geometry, so it gets arithmetic rather than a look at a screen — and it gets
 * its own file because the thing being pinned here is not a behaviour but an
 * *invariant*, and the bug it guards against was invisible for exactly as long as
 * nobody wrote the invariant down.
 *
 * `aimTolerance` used to return `SPILL_AIM_FRACTION * π / n`, where `π/n` is the gap
 * between **seats**. The window is supposed to be a fraction of the gap between
 * **aims**, halved — 1.40× smaller. So the windows overlapped, `aimSeat` (nearest
 * seat, then a tolerance check it always passed) delivered 95% of every forward flick
 * at a table of four, and there was no such thing as a miss. Players noticed before
 * the code did and stopped aiming, which was the correct response.
 */
import { SPILL_AIM_FRACTION, SPILL_SPEED_MAX, SPILL_SPEED_MIN } from './protocol';
import {
  SPILL_FLICK_CONE,
  SPILL_SPREAD,
  aimSeat,
  aimTolerance,
  halfGap,
  screenAngleTo,
} from './spillGeometry';

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

const deg = (r: number): number => (r * 180) / Math.PI;
const rad = (d: number): number => (d * Math.PI) / 180;
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) < eps;

/** Every seat count the game actually supports, and every seat within it. */
const TABLES = [2, 3, 4];
const SPEEDS = [SPILL_SPEED_MIN, 1, 2, 3.5, 5, SPILL_SPEED_MAX];

/** What share of the legal throwing cone lands on nobody, at this speed. */
function missShare(from: number, n: number, speed: number): number {
  let miss = 0;
  let total = 0;
  for (let d = -80; d <= 80; d += 0.25) {
    total++;
    if (aimSeat(from, rad(d), n, speed) === null) miss++;
  }
  return miss / total;
}

/* ---------------------------------------------------------------- */

function gaps(): void {
  console.log('\nthe half-gap is the gap between aims, halved');

  // Seat 0 of four aims at −45°, 0°, +45°: 45° apart, so 22.5° either side of a target
  // before you are closer to its neighbour. Three seats aim at ∓30°: 60° apart, 30°.
  check('four players: 22.5°', near(deg(halfGap(0, 4)), 22.5), deg(halfGap(0, 4)));
  check('three players: 30°', near(deg(halfGap(0, 3)), 30), deg(halfGap(0, 3)));

  // With two there is no neighbouring target to collide with, so the cone is the bound.
  check('two players: the throwing cone', near(halfGap(0, 2), SPILL_FLICK_CONE));

  // Derived from the real bearings, not assumed to be π/n — which is the gap between
  // SEATS and is twice too big. Every seat must agree, or the game is unfair by chair.
  let same = true;
  for (const n of TABLES) {
    for (let from = 0; from < n; from++) {
      if (!near(halfGap(from, n), halfGap(0, n))) same = false;
    }
  }
  check('and it is the same from every seat', same);
  check('π/n would have been twice that at four', near(deg(Math.PI / 4), 45));
}

function invariant(): void {
  console.log('\nthe window never exceeds the half-gap');

  /*
   * THE regression guard. A window wider than the half-gap means two windows overlap,
   * which means `aimSeat` always finds a seat inside tolerance, which means a forward
   * flick cannot miss and there is nothing to aim at. That is the bug this whole
   * change exists to fix; if someone widens `SPILL_AIM_FRACTION` past 1 this fails.
   */
  let worst = 0;
  let ok = true;
  for (const n of TABLES) {
    for (let from = 0; from < n; from++) {
      for (const v of SPEEDS) {
        const ratio = aimTolerance(from, n, v) / halfGap(from, n);
        worst = Math.max(worst, ratio);
        if (ratio > 1) ok = false;
      }
    }
  }
  check('at every seat count, seat and speed', ok, { worst });
  check('and the widest it ever gets is the fraction itself',
    near(worst, SPILL_AIM_FRACTION), worst);

  // Below 1 there is always a sliver to miss through, at three and four players.
  for (const n of [3, 4]) {
    const share = missShare(0, n, SPILL_SPEED_MIN);
    check(`${n} players: even a careful flick can miss`, share > 0.05, share);
  }
}

function speed(): void {
  console.log('\nthrowing harder narrows it');

  let monotonic = true;
  for (const n of TABLES) {
    for (let i = 1; i < SPEEDS.length; i++) {
      const prev = aimTolerance(0, n, SPEEDS[i - 1] as number);
      const next = aimTolerance(0, n, SPEEDS[i] as number);
      if (next >= prev) monotonic = false;
    }
  }
  check('the window shrinks with every increment of speed', monotonic);

  // The two ends of the scale, which are the numbers the spec quotes.
  const ends = TABLES.map((n) => ({
    n,
    careful: Math.round(deg(aimTolerance(0, n, SPILL_SPEED_MIN))),
    flatOut: Math.round(deg(aimTolerance(0, n, SPILL_SPEED_MAX))),
  }));
  console.log(`       ${ends.map((e) => `${e.n}p ±${e.careful}° → ±${e.flatOut}°`).join(' · ')}`);
  check('four players: ±20° careful, ±10° flat out',
    ends[2]?.careful === 20 && ends[2]?.flatOut === 10, ends[2]);
  check('three players: ±27° careful, ±13° flat out',
    ends[1]?.careful === 27 && ends[1]?.flatOut === 13, ends[1]);
  check('two players: ±72° careful, ±36° flat out',
    ends[0]?.careful === 72 && ends[0]?.flatOut === 36, ends[0]);

  check('a flat-out flick keeps exactly what SPILL_SPREAD leaves it',
    near(aimTolerance(0, 4, SPILL_SPEED_MAX), aimTolerance(0, 4, SPILL_SPEED_MIN) * (1 - SPILL_SPREAD)));

  // Speeds outside the wire's range are clamped, not extrapolated: a crafted client
  // must not be able to ask for an infinitely wide window by claiming to throw slowly.
  check('slower than the minimum is no wider', near(aimTolerance(0, 4, 0), aimTolerance(0, 4, SPILL_SPEED_MIN)));
  check('faster than the maximum is no narrower', near(aimTolerance(0, 4, 99), aimTolerance(0, 4, SPILL_SPEED_MAX)));
}

function aiming(): void {
  console.log('\nthe same angle, thrown two ways');

  /*
   * The decision the gesture is for. 15° off the seat opposite is inside a careful
   * throw's window and outside a flat-out one's — so "how hard do I dare throw this"
   * has a real answer, which is the thing the game was missing.
   */
  check('four players: 15° off lands when thrown carefully',
    aimSeat(0, rad(15), 4, SPILL_SPEED_MIN) === 2);
  check('and misses when thrown flat out',
    aimSeat(0, rad(15), 4, SPILL_SPEED_MAX) === null);

  // Same shape at three, measured off the real bearing rather than a guessed one —
  // the targets sit at ∓30°, so a raw angle is only as far off as the nearest of them.
  const off3 = screenAngleTo(0, 1, 3) + rad(20);
  check('three players: 20° off lands when thrown carefully',
    aimSeat(0, off3, 3, SPILL_SPEED_MIN) === 1, deg(off3));
  check('and misses when thrown flat out',
    aimSeat(0, off3, 3, SPILL_SPEED_MAX) === null, deg(off3));

  /*
   * Dead centre always lands, at any speed. This is what keeps the tap-a-seat fallback
   * (spec §11) playable — it aims exactly, so it can never be beaten by the window
   * closing — and it means a careful player is never punished by geometry they cannot
   * see.
   */
  let centred = true;
  for (const n of TABLES) {
    for (let from = 0; from < n; from++) {
      for (let to = 0; to < n; to++) {
        if (to === from) continue;
        for (const v of SPEEDS) {
          if (aimSeat(from, screenAngleTo(from, to, n), n, v) !== to) centred = false;
        }
      }
    }
  }
  check('a dead-centre aim lands at every speed, seat and head count', centred);

  // Two players: the wide-angle bounce shots (spec §4a) survive, but only gently.
  check('two players: a 60° bounce shot reaches them slowly',
    aimSeat(0, rad(60), 2, SPILL_SPEED_MIN) === 1);
  check('and is flung past them flat out',
    aimSeat(0, rad(60), 2, SPILL_SPEED_MAX) === null);

  // Rushing always costs coverage, never gains it.
  let widerIsBetter = true;
  for (const n of TABLES) {
    if (missShare(0, n, SPILL_SPEED_MAX) <= missShare(0, n, SPILL_SPEED_MIN)) widerIsBetter = false;
  }
  check('at every head count, a rushed throw misses more often', widerIsBetter);
}

for (const t of [gaps, invariant, speed, aiming]) t();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
