/**
 * Sling Puck's input rules. Spec: docs/specs/games/sling-puck.md §7
 *
 * `physics.test.ts` covers the board. This covers the hand: what grabbing a puck
 * does to it, that it is carried rather than teleported, and where a release
 * fires and where it only puts the puck down.
 */
import { CROSS_ACK_MS, SlingGame } from './game';
import {
  BAND_REST_Y,
  BOARD_H,
  GAP_LEFT,
  GAP_RIGHT,
  MAX_PULL,
  PUCK_RADIUS,
  SLING_PUCKS,
} from './physics';
import type { SlingState } from '../../../../shared/protocol';

const GAP_MID = (GAP_LEFT + GAP_RIGHT) / 2;

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

const ME = 'me';
const THEM = 'them';

/** A game mid-round with a full rack, past the pre-round panel. */
function running(): SlingGame {
  const g = new SlingGame();
  g.identify(ME, () => 10_000);
  const d: SlingState = {
    roundId: 1,
    startsAt: 0,
    players: [ME, THEM],
    pucks: { [ME]: SLING_PUCKS, [THEM]: SLING_PUCKS },
    phase: 'running',
  };
  g.apply({ t: 'sling', s: 1, d });
  return g;
}

function carrying(): void {
  const g = running();
  const p = g.view().pucks[0]!;
  // Snapshot: `p` is the live puck and a drag moves it, so comparing against
  // `p.x` after the fact would be comparing the puck with itself.
  const x0 = p.x;
  const y0 = p.y;

  // Grab off-centre: a finger a third of a radius away from the middle of it.
  const off = PUCK_RADIUS * 0.34;
  check('a grab off-centre still takes the puck', g.grab(x0 + off, y0));

  const held = g.view().drag!;
  check(
    'and the puck does not jump to the finger',
    held.x === x0 && held.y === y0,
    { held, puck: { x: x0, y: y0 } },
  );

  // Move the finger by a known amount; the puck should move by the same amount.
  g.drag(x0 + off + 0.1, y0 - 0.2);
  const moved = g.view().drag!;
  check(
    'it travels with the finger, keeping the offset',
    Math.abs(moved.x - (x0 + 0.1)) < 1e-9 && Math.abs(moved.y - (y0 - 0.2)) < 1e-9,
    moved,
  );

  // Carrying cannot post a puck out through the walls.
  g.drag(-5, -5);
  const corner = g.view().drag!;
  check(
    'and is clamped to the board, not to the pull zone',
    corner.x >= PUCK_RADIUS && corner.y >= PUCK_RADIUS && corner.y < BAND_REST_Y,
    corner,
  );
  g.drag(99, 99);
  const far = g.view().drag!;
  check('at the far corner too', far.x <= 1 - PUCK_RADIUS && far.y <= BOARD_H - PUCK_RADIUS, far);
}

function grabbingInFlight(): void {
  const g = running();
  const p = g.view().pucks[0]!;

  // Fire it, let it travel, then catch it.
  g.grab(p.x, p.y);
  g.drag(p.x, BAND_REST_Y + 0.2);
  g.release();
  check('a released puck is moving', p.vx !== 0 || p.vy !== 0, p);

  g.advance(1 / 60);
  const inFlight = g.view().pucks.find((q) => q.id === p.id)!;
  check('a puck in flight can be grabbed', g.grab(inFlight.x, inFlight.y), inFlight);
  check(
    'and catching it stops it dead',
    inFlight.vx === 0 && inFlight.vy === 0,
    inFlight,
  );
}

function releasing(): void {
  // Above the band there is no band to push, so a release puts the puck down.
  const g = running();
  const p = g.view().pucks[0]!;
  g.grab(p.x, p.y);
  g.drag(0.5, BAND_REST_Y - 0.3);
  const up = g.view().drag!;
  check('a puck can be carried up-board, past the band', up.y < BAND_REST_Y, up);
  g.release();
  const put = g.view().pucks.find((q) => q.id === p.id)!;
  check('releasing there puts it down, it does not fire', put.vx === 0 && put.vy === 0, put);
  check('and it stays where it was carried to', Math.abs(put.y - up.y) < 1e-9, put);

  // In the band's zone it fires up-board, as before.
  const h = running();
  const q = h.view().pucks[0]!;
  h.grab(q.x, q.y);
  h.drag(q.x, BAND_REST_Y + 0.2);
  h.release();
  const shot = h.view().pucks.find((r) => r.id === q.id)!;
  check('releasing at the band fires it', shot.vy < 0, shot);
}

/**
 * A tap is not a shot.
 *
 * Rack pucks rest *inside* the band's zone, so a release with no movement used to
 * count as a stretch and fire. Spam-tapping the rack therefore threw pucks with no
 * aim and faster than any drag — and there was a `tap()` that fired one straight at
 * the gap on purpose, which made it worse.
 */
function tappingIsNotThrowing(): void {
  const g = running();
  const p = g.view().pucks[0]!;
  const x0 = p.x;
  const y0 = p.y;
  check('a rack puck rests inside the band zone', y0 >= BAND_REST_Y, y0);

  // Down and straight back up, exactly as a tap does.
  g.grab(x0, y0);
  g.release();
  check('tapping it does not fire it', p.vx === 0 && p.vy === 0, p);
  check('and does not move it', p.x === x0 && p.y === y0, p);

  // Ten taps in a row, the reported case.
  for (let i = 0; i < 10; i++) {
    g.grab(x0, y0);
    g.release();
  }
  check('spamming taps still fires nothing', p.vx === 0 && p.vy === 0, p);
  let crossed = 0;
  for (let i = 0; i < 120; i++) crossed += g.advance(1 / 60).length;
  check('so nothing crosses the gap', crossed === 0, crossed);
  check('and the rack is untouched', g.view().pucks.length === SLING_PUCKS);

  // A jitter under a still finger is a tap too, not a feeble shot.
  g.grab(x0, y0);
  g.drag(x0 + PUCK_RADIUS * 0.2, y0);
  g.release();
  check('a wobble below the slop does not fire either', p.vx === 0 && p.vy === 0, p);

  // A real pull still fires.
  g.grab(p.x, p.y);
  g.drag(p.x, BAND_REST_Y + MAX_PULL);
  g.release();
  check('a real pull does fire', p.vy < 0, p);
}

/** Carrying a puck past the pull limit must not buy a stronger shot. */
function pullDepth(): void {
  const g = running();
  const p = g.view().pucks[0]!;
  g.grab(p.x, p.y);
  g.drag(p.x, BOARD_H);
  const deep = g.view().drag!;
  check(
    'a carry cannot over-stretch the band',
    deep.y <= BAND_REST_Y + MAX_PULL + 1e-9,
    deep,
  );
}

function oneAtATime(): void {
  const g = running();
  const a = g.view().pucks[0]!;
  const b = g.view().pucks[1]!;
  check('the first grab takes', g.grab(a.x, a.y));
  check('a second grab is refused while one is held', !g.grab(b.x, b.y));
  g.cancel();
  check('and allowed again once let go', g.grab(b.x, b.y));
}

/**
 * The count and the board must not be able to disagree for long.
 *
 * The reported bug: "1 in yours, 0 visible". A crossing removes the puck locally
 * and only then goes on the wire, so any crossing the server never accepts — one
 * it refuses, or one sent while the socket was reconnecting — left the board a
 * puck short of its own count for the rest of the round.
 */
function healing(): void {
  let clock = 10_000;
  const g = new SlingGame();
  g.identify(ME, () => clock);
  const base: SlingState = {
    roundId: 1,
    startsAt: 0,
    players: [ME, THEM],
    pucks: { [ME]: SLING_PUCKS, [THEM]: SLING_PUCKS },
    phase: 'running',
  };
  g.apply({ t: 'sling', s: 1, d: base });

  // Fire one through the gap, and never tell the server about it.
  const p = g.view().pucks[0]!;
  g.grab(p.x, p.y);
  g.drag(GAP_MID, BAND_REST_Y + MAX_PULL);
  g.release();
  let crossed = 0;
  for (let i = 0; i < 240 && crossed === 0; i++) crossed += g.advance(1 / 60).length;
  check('the shot crossed the gap', crossed === 1, crossed);
  check('and left the local board', g.view().pucks.length === SLING_PUCKS - 1);
  check('while the count still says otherwise', g.view().mine === SLING_PUCKS);

  // In transit, the difference is not real yet, so nothing must be invented.
  g.advance(1 / 60);
  check(
    'a crossing in transit is not reconciled away',
    g.view().pucks.length === SLING_PUCKS - 1,
    g.view().pucks.length,
  );

  // Past the acknowledgement window it is presumed lost, and the server wins.
  clock += CROSS_ACK_MS + 1;
  g.advance(1 / 60);
  check(
    'a lost crossing heals: the board catches up to the count',
    g.view().pucks.length === g.view().mine,
    { pucks: g.view().pucks.length, mine: g.view().mine },
  );
}

console.log('\ncarrying a puck');
carrying();
console.log('\ngrabbing one in flight');
grabbingInFlight();
console.log('\nthe count and the board');
healing();
console.log('\nreleasing');
releasing();
console.log('\na tap is not a shot');
tappingIsNotThrowing();
console.log('\nthe pull limit');
pullDepth();
console.log('\none puck at a time');
oneAtATime();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
