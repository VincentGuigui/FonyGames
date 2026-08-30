import {
  GRAVITY_LIVES,
  GRAVITY_PLANET_R_MAX,
  GRAVITY_PLANET_R_MIN,
  GRAVITY_PLANET_X_MARGIN,
  GRAVITY_PLANET_Y_MAX,
  GRAVITY_PLANET_Y_MIN,
  GRAVITY_SHOT_TIMEOUT_MS,
  type ServerMessage,
} from '../shared/protocol';
import {
  nextDeadline,
  onGravityShot,
  onPlayerGone,
  startGravityShooter,
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
  check(`both start with ${GRAVITY_LIVES} lives`, g?.lives[A] === GRAVITY_LIVES && g?.lives[B] === GRAVITY_LIVES);
  check('the host shoots first', g?.turn === A, g?.turn);
  check('nothing has been shot yet', g?.lastShot === null);
  check('and the round is running', g?.phase === 'running');

  for (const planet of g?.planets ?? []) {
    check('a planet sits in the middle band', planet.y >= GRAVITY_PLANET_Y_MIN && planet.y <= GRAVITY_PLANET_Y_MAX, planet.y);
    check('clear of the side edges', planet.x >= GRAVITY_PLANET_X_MARGIN && planet.x <= 1 - GRAVITY_PLANET_X_MARGIN, planet.x);
    check('and within the stated radius range', planet.r >= GRAVITY_PLANET_R_MIN && planet.r <= GRAVITY_PLANET_R_MAX, planet.r);
  }

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
  check('a shot from the wrong seat is ignored', h.state()?.turn === A, h.state()?.turn);
  check('and says nothing', h.last() === undefined);

  await onGravityShot(h.ctx, A, 1, 0.4, 0.6, false);
  check('a miss costs nothing', h.state()?.lives[B] === GRAVITY_LIVES);
  check('and the turn passes', h.state()?.turn === B, h.state()?.turn);
  check('the shot is recorded for the other phone\'s own replay',
    h.state()?.lastShot?.shooter === A && h.state()?.lastShot?.angle === 0.4 && h.state()?.lastShot?.strength === 0.6);

  await onGravityShot(h.ctx, B, 1, 1.2, 0.9, true);
  check('a hit costs the opponent a life', h.state()?.lives[A] === GRAVITY_LIVES - 1, h.state()?.lives[A]);
  check('and the turn passes back', h.state()?.turn === A, h.state()?.turn);
  check('the match is not over yet', h.state()?.phase === 'running');
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
  check('but the claimed hit is still trusted', h.state()?.lives[B] === GRAVITY_LIVES - 1, h.state()?.lives[B]);

  await onGravityShot(h.ctx, 'nobody', 1, 0.1, 0.1, true);
  check('a stranger changes nothing', h.state()?.turn === B, h.state()?.turn);

  await onGravityShot(h.ctx, B, 99, 0.1, 0.1, true);
  check('a stale round changes nothing', h.state()?.lives[A] === GRAVITY_LIVES);
}

async function timeout(): Promise<void> {
  console.log('\na silent shooter does not stall the match');

  const h = harness();
  await startGravityShooter(h.ctx, 1, [A, B]);
  const firstDeadline = h.state()?.resolvesAt ?? 0;

  h.advance(GRAVITY_SHOT_TIMEOUT_MS - 1);
  await tick(h.ctx);
  check('not a moment early', h.state()?.turn === A, h.state()?.turn);

  h.advance(2);
  await tick(h.ctx);
  check('the turn passes once the deadline is up', h.state()?.turn === B, h.state()?.turn);
  check('resolved as a plain miss', h.state()?.lastShot?.hit === false);
  check('nobody loses a life for it', h.state()?.lives[A] === GRAVITY_LIVES && h.state()?.lives[B] === GRAVITY_LIVES);
  check('and a fresh deadline is set', (h.state()?.resolvesAt ?? 0) > firstDeadline);

  // A shot that arrives at or after its own deadline is too late — the tick
  // already owns that turn's resolution once the clock reaches it.
  h.advance(GRAVITY_SHOT_TIMEOUT_MS + 1);
  await onGravityShot(h.ctx, B, 1, 0.1, 0.1, true);
  check('a shot after its own deadline is ignored', h.state()?.turn === B, h.state()?.turn);
  check('and lives are untouched', h.state()?.lives[A] === GRAVITY_LIVES);
}

async function ending(): Promise<void> {
  console.log('\nfive lives, and it is over');

  const h = harness();
  await startGravityShooter(h.ctx, 1, [A, B]);

  for (let i = 0; i < GRAVITY_LIVES - 1; i++) {
    await onGravityShot(h.ctx, A, 1, 0, 1, true);
    await onGravityShot(h.ctx, B, 1, 0, 1, false);
  }
  check('one life left', h.state()?.lives[B] === 1, h.state()?.lives[B]);
  check('still running', h.state()?.phase === 'running');

  await onGravityShot(h.ctx, A, 1, 0, 1, true);
  check('the fifth hit ends it', h.state()?.phase === 'done', h.state()?.phase);
  check('the shooter wins', h.state()?.winner === A, h.state()?.winner);
  check('the loser is out of lives', h.state()?.lives[B] === 0);

  // Nothing moves after the end.
  await onGravityShot(h.ctx, B, 1, 0, 1, true);
  check('a shot after the end does nothing', h.state()?.lives[A] === GRAVITY_LIVES);
}

async function walkout(): Promise<void> {
  console.log('\nsomebody walks off');

  const h = harness();
  await startGravityShooter(h.ctx, 1, [A, B]);
  await onPlayerGone(h.ctx, B);
  check('the match ends rather than carrying on alone', h.state()?.phase === 'done');
  check('and the one still there wins', h.state()?.winner === A, h.state()?.winner);
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

for (const t of [starting, shooting, garbage, timeout, ending, walkout, deadlines]) {
  await t();
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
