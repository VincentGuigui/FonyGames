import {
  GRAVITY_LIVES,
  GRAVITY_PLANET_MIN_GAP,
  GRAVITY_PLANET_MIN_SIZE_DIFF_RATIO,
  GRAVITY_PLANET_MIN_Y_DIFF,
  GRAVITY_PLANET_R_MAX,
  GRAVITY_PLANET_R_MIN,
  GRAVITY_PLANET_X_MARGIN,
  GRAVITY_PLANET_Y_MAX,
  GRAVITY_PLANET_Y_MIN,
  GRAVITY_SHOT_TIMEOUT_MS,
  GRAVITY_STAR_R_MAX,
  GRAVITY_STAR_R_MIN,
  gravityStar,
  type GravityPlanet,
  type ServerMessage,
} from '../shared/protocol';
import {
  nextDeadline,
  onGravityShot,
  onPlayerGone,
  rollBoard,
  seatCanReachOpponent,
  startGravityShooter,
  surfaceGap,
  tick,
  type Ctx,
  type Gravity,
} from './gravityShooter';

/**
 * Gravity Shooter's referee.
 * Spec: docs/specs/games/gravity-shooter.md
 *
 * Two rules carry the whole game, and each fails silently if it is wrong:
 *
 * 1. **`hit` is trusted, never re-derived** (spec §8, by direct instruction) — but
 *    everything ELSE (whose turn it is, lives, the planets, a silent shooter's turn
 *    timing out) is the referee's own job, same as any other game here.
 * 2. **A turn always moves forward.** A shooter who never sends `gravity-shot` must
 *    not stall the match — the alarm has to force it, the same lesson Tap Fighter's
 *    own no-lock-in default already carries.
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

const A = 'p-a';
const B = 'p-b';

/** A tiny, fixed PRNG so every run rolls the planets the same way. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 4_294_967_296;
  };
}

function harness(seed = 1) {
  let clock = 5_000_000;
  let seq = 0;
  let stored: Gravity | null = null;
  const sent: ServerMessage[] = [];
  const random = seeded(seed);

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    random,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as Gravity) : null),
    save: async (g) => {
      stored = JSON.parse(JSON.stringify(g)) as Gravity;
    },
    setAlarm: async () => {},
  };

  return {
    ctx,
    sent,
    get now() {
      return clock;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    state: () => stored,
    last: () => [...sent].reverse().find((m) => m.t === 'gravity') as
      | Extract<ServerMessage, { t: 'gravity' }>
      | undefined,
    clear: () => void (sent.length = 0),
  };
}

async function starting(): Promise<void> {
  console.log('\nstarting a match');

  const h = harness();
  check('two players can start', (await startGravityShooter(h.ctx, 1, [A, B])) === true);
  check('one cannot', (await startGravityShooter(harness().ctx, 1, [A])) === false);
  check('nor can three', (await startGravityShooter(harness().ctx, 1, [A, B, 'p-c'])) === false);

  const g = h.state();
  check(`both start with ${GRAVITY_LIVES} lives`, g?.lives[0] === GRAVITY_LIVES && g?.lives[1] === GRAVITY_LIVES);
  check('the host shoots first', g?.turn === 0, g?.turn);
  check('not solo', g?.solo === false);
  check('nothing has been shot yet', g?.lastShot === null);
  check('and the round is running', g?.phase === 'running');

  for (const planet of g?.planets ?? []) {
    check('a planet sits in the middle band', planet.y >= GRAVITY_PLANET_Y_MIN && planet.y <= GRAVITY_PLANET_Y_MAX, planet.y);
    check('clear of the side edges', planet.x >= GRAVITY_PLANET_X_MARGIN && planet.x <= 1 - GRAVITY_PLANET_X_MARGIN, planet.x);
    check('and within the stated radius range', planet.r >= GRAVITY_PLANET_R_MIN && planet.r <= GRAVITY_PLANET_R_MAX, planet.r);
  }

  // Never both left or both right — a board with nothing to curve a shot on
  // one whole side of it.
  const [first, second] = g?.planets ?? [];
  check(
    'the two planets are never on the same side of the screen',
    !!first && !!second && (first.x < 0.5) !== (second.x < 0.5),
    g?.planets,
  );

  // The same seed rolls the same planets — a phone cannot be the fairest source
  // of a board it is also playing, so the referee's own random() decides it once.
  const h2 = harness();
  await startGravityShooter(h2.ctx, 1, [A, B]);
  check('the same seed rolls the same planets', JSON.stringify(h.state()?.planets) === JSON.stringify(h2.state()?.planets));
}

async function shooting(): Promise<void> {
  console.log('\na shot, resolved');

  const h = harness();
  await startGravityShooter(h.ctx, 1, [A, B]);
  h.clear();

  await onGravityShot(h.ctx, B, 1, 0.4, 0.6, true);
  check('a shot from the wrong seat is ignored', h.state()?.turn === 0, h.state()?.turn);
  check('and says nothing', h.last() === undefined);

  await onGravityShot(h.ctx, A, 1, 0.4, 0.6, false);
  check('a miss costs nothing', h.state()?.lives[1] === GRAVITY_LIVES);
  check('and the turn passes', h.state()?.turn === 1, h.state()?.turn);
  check('the shot is recorded for the other phone\'s own replay',
    h.state()?.lastShot?.shooter === 0 && h.state()?.lastShot?.angle === 0.4 && h.state()?.lastShot?.strength === 0.6);

  await onGravityShot(h.ctx, B, 1, 1.2, 0.9, true);
  check('a hit costs the opponent a life', h.state()?.lives[0] === GRAVITY_LIVES - 1, h.state()?.lives[0]);
  check('and the turn passes back', h.state()?.turn === 0, h.state()?.turn);
  check('the match is not over yet', h.state()?.phase === 'running');
}

async function movingPlanets(): Promise<void> {
  console.log('\nthe board moves once both players have shot at it');

  const h = harness();
  await startGravityShooter(h.ctx, 1, [A, B]);
  const first = JSON.stringify(h.state()?.planets);
  check('a fresh match starts with no shots counted', h.state()?.shots === 0, h.state()?.shots);

  await onGravityShot(h.ctx, A, 1, 0.4, 0.6, false);
  check('one shot in, the board is unchanged', JSON.stringify(h.state()?.planets) === first);
  check('but the shot is counted', h.state()?.shots === 1, h.state()?.shots);

  await onGravityShot(h.ctx, B, 1, -0.4, 0.6, false);
  const second = JSON.stringify(h.state()?.planets);
  check('once both have shot, the board is re-rolled', second !== first);
  check('and the count keeps climbing', h.state()?.shots === 2, h.state()?.shots);
  // The re-roll is a whole fresh geometry, so it obeys every placement rule the
  // opening board does — nothing about a mid-match board is second class.
  const [a, b] = h.state()?.planets ?? [];
  const newStar = gravityStar(h.state()?.starRadius ?? 0);
  if (a && b) {
    check('and still keeps its planets apart', surfaceGap(a, b) >= GRAVITY_PLANET_MIN_GAP - 1e-9, surfaceGap(a, b));
    check('and clear of the star', surfaceGap(a, newStar) >= GRAVITY_PLANET_MIN_GAP - 1e-9
      && surfaceGap(b, newStar) >= GRAVITY_PLANET_MIN_GAP - 1e-9);
  }

  await onGravityShot(h.ctx, A, 1, 0.2, 0.5, false);
  check('a third shot leaves it alone again', JSON.stringify(h.state()?.planets) === second);

  // A timed-out turn spent that seat's shot just as surely as a real one, so it
  // has to count — otherwise a silent player quietly freezes the board.
  const t = harness();
  await startGravityShooter(t.ctx, 1, [A, B]);
  const before = JSON.stringify(t.state()?.planets);
  await onGravityShot(t.ctx, A, 1, 0.3, 0.5, false);
  t.advance(GRAVITY_SHOT_TIMEOUT_MS + 1);
  await tick(t.ctx);
  check('a timeout counts as a shot too', t.state()?.shots === 2, t.state()?.shots);
  check('so it can trigger the re-roll on its own', JSON.stringify(t.state()?.planets) !== before);

  // The winning shot must NOT move the board: both phones are still animating
  // that flight and its explosion against the board it was fired on.
  const e = harness();
  await startGravityShooter(e.ctx, 1, [A, B]);
  for (let i = 0; i < GRAVITY_LIVES - 1; i++) {
    await onGravityShot(e.ctx, A, 1, 0, 1, true);
    await onGravityShot(e.ctx, B, 1, 0, 1, false);
  }
  const finalBoard = JSON.stringify(e.state()?.planets);
  await onGravityShot(e.ctx, A, 1, 0, 1, true);
  check('the match-winning shot ends it', e.state()?.phase === 'done' && e.state()?.winner === 0);
  check('and leaves the board it was won on in place', JSON.stringify(e.state()?.planets) === finalBoard);
}

async function garbage(): Promise<void> {
  console.log('\nwhat a crafted client cannot do');

  const h = harness();
  await startGravityShooter(h.ctx, 1, [A, B]);

  await onGravityShot(h.ctx, A, 1, Number.NaN, Number.POSITIVE_INFINITY, true);
  const shot = h.state()?.lastShot;
  check('a non-finite angle is clamped to zero', shot?.angle === 0, shot?.angle);
  check('a non-finite strength is clamped to zero', shot?.strength === 0, shot?.strength);
  // The claimed hit itself is still trusted, by direct instruction (spec §8) —
  // only the numbers a replay would otherwise choke on are sanitised.
  check('but the claimed hit is still trusted', h.state()?.lives[1] === GRAVITY_LIVES - 1, h.state()?.lives[1]);

  await onGravityShot(h.ctx, 'nobody', 1, 0.1, 0.1, true);
  check('a stranger changes nothing', h.state()?.turn === 1, h.state()?.turn);

  await onGravityShot(h.ctx, B, 99, 0.1, 0.1, true);
  check('a stale round changes nothing', h.state()?.lives[0] === GRAVITY_LIVES);
}

async function timeout(): Promise<void> {
  console.log('\na silent shooter does not stall the match');

  const h = harness();
  await startGravityShooter(h.ctx, 1, [A, B]);
  const firstDeadline = h.state()?.resolvesAt ?? 0;

  h.advance(GRAVITY_SHOT_TIMEOUT_MS - 1);
  await tick(h.ctx);
  check('not a moment early', h.state()?.turn === 0, h.state()?.turn);

  h.advance(2);
  await tick(h.ctx);
  check('the turn passes once the deadline is up', h.state()?.turn === 1, h.state()?.turn);
  check('resolved as a plain miss', h.state()?.lastShot?.hit === false);
  check('nobody loses a life for it', h.state()?.lives[0] === GRAVITY_LIVES && h.state()?.lives[1] === GRAVITY_LIVES);
  check('and a fresh deadline is set', (h.state()?.resolvesAt ?? 0) > firstDeadline);

  // A shot that arrives at or after its own deadline is too late — the tick
  // already owns that turn's resolution once the clock reaches it.
  h.advance(GRAVITY_SHOT_TIMEOUT_MS + 1);
  await onGravityShot(h.ctx, B, 1, 0.1, 0.1, true);
  check('a shot after its own deadline is ignored', h.state()?.turn === 1, h.state()?.turn);
  check('and lives are untouched', h.state()?.lives[0] === GRAVITY_LIVES);
}

async function ending(): Promise<void> {
  console.log('\nfive lives, and it is over');

  const h = harness();
  await startGravityShooter(h.ctx, 1, [A, B]);

  for (let i = 0; i < GRAVITY_LIVES - 1; i++) {
    await onGravityShot(h.ctx, A, 1, 0, 1, true);
    await onGravityShot(h.ctx, B, 1, 0, 1, false);
  }
  check('one life left', h.state()?.lives[1] === 1, h.state()?.lives[1]);
  check('still running', h.state()?.phase === 'running');

  await onGravityShot(h.ctx, A, 1, 0, 1, true);
  check('the fifth hit ends it', h.state()?.phase === 'done', h.state()?.phase);
  check('the shooter wins', h.state()?.winner === 0, h.state()?.winner);
  check('the loser is out of lives', h.state()?.lives[1] === 0);

  // Nothing moves after the end.
  await onGravityShot(h.ctx, B, 1, 0, 1, true);
  check('a shot after the end does nothing', h.state()?.lives[0] === GRAVITY_LIVES);
}

async function walkout(): Promise<void> {
  console.log('\nsomebody walks off');

  const h = harness();
  await startGravityShooter(h.ctx, 1, [A, B]);
  await onPlayerGone(h.ctx, B);
  check('the match ends rather than carrying on alone', h.state()?.phase === 'done');
  check('and the one still there wins', h.state()?.winner === 0, h.state()?.winner);
}

async function solo(): Promise<void> {
  console.log('\nsolo: one phone, both seats');

  const h = harness();
  check('a single player can start solo', (await startGravityShooter(h.ctx, 1, [A], true)) === true);
  check('but not without the flag', (await startGravityShooter(harness().ctx, 1, [A], false)) === false);

  const g = h.state();
  check('both seats are the same connected player', g?.seats[0] === A && g?.seats[1] === A, g?.seats);
  check('the state says so', g?.solo === true);
  check('the host still shoots first', g?.turn === 0);

  // The one real player fires for whichever seat is actually on turn — no
  // second identity is needed to tell the referee which ship that is.
  await onGravityShot(h.ctx, A, 1, 0.1, 0.5, false);
  check('seat 0 fired, and the turn passes to seat 1', h.state()?.turn === 1, h.state()?.turn);
  check('attributed to the seat that fired, not just "the player"', h.state()?.lastShot?.shooter === 0);

  await onGravityShot(h.ctx, A, 1, 0.2, 0.5, true);
  check('the same player fires again, now for seat 1', h.state()?.turn === 0, h.state()?.turn);
  check('this shot is seat 1\'s', h.state()?.lastShot?.shooter === 1);
  check('and it cost seat 0 a life', h.state()?.lives[0] === GRAVITY_LIVES - 1, h.state()?.lives[0]);
}

async function deadlines(): Promise<void> {
  console.log('\nwhen the room needs waking');

  const h = harness();
  await startGravityShooter(h.ctx, 1, [A, B]);
  check('while running, at the current shot\'s own deadline',
    nextDeadline(h.state() as Gravity) === h.state()?.resolvesAt, nextDeadline(h.state() as Gravity));

  for (let i = 0; i < GRAVITY_LIVES; i++) {
    await onGravityShot(h.ctx, A, 1, 0, 1, true);
    await onGravityShot(h.ctx, B, 1, 0, 1, false);
  }
  check('done once somebody is out', h.state()?.phase === 'done', h.state()?.phase);
  check('and nothing is left to wait for', nextDeadline(h.state() as Gravity) === Infinity);
}

async function geometry(): Promise<void> {
  console.log('\nthe map is playable, not just legal (issue #16)');

  // Across a run of seeds, not just one — a rule guaranteed by CONSTRUCTION
  // (rollPlanetRadii/rollPlanetYs) rather than by rejection should hold for
  // every one of them, with no exceptions to go looking for.
  for (let seed = 1; seed <= 20; seed++) {
    const board = rollBoard(seeded(seed));
    const [a, b] = board.planets;
    const star = gravityStar(board.starRadius);
    const sizeDiff = Math.abs(a.r - b.r) / Math.max(a.r, b.r);
    check(`seed ${seed}: the planets differ in size by at least the required ratio`,
      sizeDiff >= GRAVITY_PLANET_MIN_SIZE_DIFF_RATIO - 1e-9, sizeDiff);
    check(`seed ${seed}: their surfaces are at least the required gap apart`,
      surfaceGap(a, b) >= GRAVITY_PLANET_MIN_GAP - 1e-9, surfaceGap(a, b));
    check(`seed ${seed}: their centres differ vertically by at least the required amount`,
      Math.abs(a.y - b.y) >= GRAVITY_PLANET_MIN_Y_DIFF - 1e-9, Math.abs(a.y - b.y));
    // The star sits dead centre and is what makes the straight line between
    // the ships a non-shot, so it owes both planets the same clear space they
    // owe each other — otherwise it would just be a planet drawn on top of one.
    check(`seed ${seed}: the star is within its own size range`,
      board.starRadius >= GRAVITY_STAR_R_MIN - 1e-9 && board.starRadius <= GRAVITY_STAR_R_MAX + 1e-9, board.starRadius);
    for (const [label, p] of [['a', a] as const, ['b', b] as const]) {
      check(`seed ${seed}: planet ${label} keeps clear of the star`,
        surfaceGap(p, star) >= GRAVITY_PLANET_MIN_GAP - 1e-9, surfaceGap(p, star));
    }
  }

  // seatCanReachOpponent itself, deterministically: two planets tucked well
  // clear of the straight line between the ships must let a nearly-straight
  // shot through for both of them.
  const clear: [GravityPlanet, GravityPlanet] = [
    { x: 0.2, y: 0.4, r: 0.05, art: 0 },
    { x: 0.8, y: 0.6, r: 0.08, art: 1 },
  ];
  check('a map with room to aim through is winnable from seat 0', seatCanReachOpponent(clear, 0, GRAVITY_STAR_R_MIN));
  check('and from seat 1', seatCanReachOpponent(clear, 1, GRAVITY_STAR_R_MIN));

  // One planet large enough to swallow the shooter's own starting point
  // absorbs every possible shot, from either seat, at the very first step —
  // the one configuration this check exists to catch.
  const blocked: [GravityPlanet, GravityPlanet] = [
    { x: 0.5, y: 0.5, r: 2, art: 0 },
    { x: -10, y: -10, r: 0.01, art: 1 },
  ];
  check('a map with no room at all is correctly read as unwinnable from seat 0', !seatCanReachOpponent(blocked, 0, GRAVITY_STAR_R_MIN));
  check('and from seat 1', !seatCanReachOpponent(blocked, 1, GRAVITY_STAR_R_MIN));
}

for (const t of [starting, shooting, movingPlanets, garbage, timeout, ending, walkout, deadlines, solo, geometry]) {
  await t();
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
