import {
  UFOHUNT_BASE_HEALTH,
  UFOHUNT_ELEVATION_MAX_DEG,
  UFOHUNT_ELEVATION_MIN_DEG,
  UFOHUNT_HEALTH_STEP,
  UFOHUNT_ROUND_CAP_MS,
  UFOHUNT_SCOPE_DEG,
  UFOHUNT_SHOT_COOLDOWN_MS,
  UFOHUNT_TICK_MS,
  ufoAngleBetween,
  ufoImpact,
  ufoPositionAt,
  type ServerMessage,
} from '../shared/protocol';
import { nextDeadline, onUfoShoot, startUfoHunt, tick, type Ctx, type UfoHunt } from './ufoHunt';

/**
 * UFO Hunt's referee.
 * Spec: docs/specs/games/ufo-hunt.md
 *
 * Unlike Ghost Hunt's own referee, this one DOES see an aim — the whole game is a
 * continuous accuracy score — so what is worth asserting here is the damage formula
 * itself (dead-centre, the edge of the scope, and beyond it), the cooldown that stands
 * in for verifying a phone's real sensor reading, and the escalating waves.
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
const C = 'p-c';

function harness(at = 1_000_000, rolls = [0.1, 0.9, 0.5, 0.2, 0.8, 0.35]) {
  let now = at;
  let seq = 0;
  let r = 0;
  let stored: UfoHunt | null = null;
  const sent: ServerMessage[] = [];
  let alarm = 0;

  const ctx: Ctx = {
    now: () => now,
    nextSeq: () => ++seq,
    random: () => rolls[r++ % rolls.length] as number,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as UfoHunt) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as UfoHunt;
    },
    setAlarm: async (a) => {
      alarm = a;
    },
  };

  return {
    ctx,
    sent,
    get state() {
      return stored;
    },
    get alarm() {
      return alarm;
    },
    advance: (ms: number) => {
      now += ms;
    },
    get now() {
      return now;
    },
    last: (t: string) => [...sent].reverse().find((m) => m.t === t),
    count: (t: string) => sent.filter((m) => m.t === t).length,
  };
}

console.log('\nstarting a hunt');

{
  const h = harness();
  const ok = await startUfoHunt(h.ctx, 1, [A, B, C]);
  check('three players is a hunt', ok === true);
  check('the first saucer starts at the base health', h.state?.wave.health === UFOHUNT_BASE_HEALTH);
  check('full health', h.state?.wave.maxHealth === UFOHUNT_BASE_HEALTH);
  check('wave zero', h.state?.wave.index === 0);
  check('everyone starts scoreless', h.state?.scores[A] === 0 && h.state?.scores[B] === 0);
  check('the round is the safety cap', h.state?.endsAt === h.now + UFOHUNT_ROUND_CAP_MS);
  check('a state frame went out', h.count('ufo-hunt') === 1);
  check('and the alarm is the tick', h.alarm === h.now + UFOHUNT_TICK_MS);

  const first = h.last('ufo-hunt');
  check('carrying the wave', first?.t === 'ufo-hunt' && first.d.wave.index === 0);
  check('with a real home direction', first?.t === 'ufo-hunt' && Number.isFinite(first.d.wave.homeAz));

  const solo = harness();
  check('one player is not a hunt', (await startUfoHunt(solo.ctx, 1, [A])) === false);
}

console.log('\nwhere the saucer roams');

{
  // A thousand ages, none of them ever outside the safe elevation band or roam radius.
  let outOfBand = 0;
  let tooFar = 0;
  const home = { azimuth: 10, elevation: 20 };
  for (let age = 0; age < 100_000; age += 100) {
    const pos = ufoPositionAt(home.azimuth, home.elevation, 0, age);
    if (pos.elevation < UFOHUNT_ELEVATION_MIN_DEG - 30 || pos.elevation > UFOHUNT_ELEVATION_MAX_DEG + 30) outOfBand++;
    if (ufoAngleBetween(home, pos) > 40) tooFar++;
  }
  check('the roam never drifts wildly off its own home', outOfBand === 0, outOfBand);
  check('and stays within a sane radius of home', tooFar === 0, tooFar);

  check('the same age and index always gives the same spot',
    JSON.stringify(ufoPositionAt(10, 20, 3, 4_000)) === JSON.stringify(ufoPositionAt(10, 20, 3, 4_000)));
  check('a different wave index roams differently at the same age',
    JSON.stringify(ufoPositionAt(10, 20, 0, 4_000)) !== JSON.stringify(ufoPositionAt(10, 20, 1, 4_000)));
}

console.log('\nthe impact formula: 10 to 0, linear in between');

{
  check('dead centre removes exactly 10', ufoImpact(0) === 10);
  check('at the edge of the scope, nothing', ufoImpact(UFOHUNT_SCOPE_DEG) === 0);
  check('beyond the scope, still nothing', ufoImpact(UFOHUNT_SCOPE_DEG * 3) === 0);
  check('never negative', ufoImpact(UFOHUNT_SCOPE_DEG * 10) === 0);
  check('halfway to the edge is half the damage',
    Math.abs(ufoImpact(UFOHUNT_SCOPE_DEG / 2) - 5) < 1e-9, ufoImpact(UFOHUNT_SCOPE_DEG / 2));
}

console.log('\nfiring a shot');

{
  const h = harness();
  await startUfoHunt(h.ctx, 1, [A, B]);
  const wave = h.state?.wave;
  const target = ufoPositionAt(wave!.homeAz, wave!.homeEl, wave!.index, 0);

  await onUfoShoot(h.ctx, A, 1, target.azimuth, target.elevation);
  check('a dead-centre shot removes 10 health', h.state?.wave.health === UFOHUNT_BASE_HEALTH - 10, h.state?.wave.health);
  check('and credits the shooter 10', h.state?.scores[A] === 10, h.state?.scores[A]);
  check('nobody else scored', h.state?.scores[B] === 0);

  const wild = { azimuth: target.azimuth + 180, elevation: target.elevation };
  h.advance(UFOHUNT_SHOT_COOLDOWN_MS);
  await onUfoShoot(h.ctx, A, 1, wild.azimuth, wild.elevation);
  check('a wildly off shot removes nothing', h.state?.wave.health === UFOHUNT_BASE_HEALTH - 10);
  check('and scores nothing', h.state?.scores[A] === 10);
}

console.log('\nthe blaster recharges');

{
  const h = harness();
  await startUfoHunt(h.ctx, 1, [A, B]);
  const wave = h.state?.wave;
  const target = ufoPositionAt(wave!.homeAz, wave!.homeEl, wave!.index, 0);

  await onUfoShoot(h.ctx, A, 1, target.azimuth, target.elevation);
  check('the first shot lands', h.state?.scores[A] === 10);

  await onUfoShoot(h.ctx, A, 1, target.azimuth, target.elevation);
  check('a second shot inside the cooldown is ignored', h.state?.scores[A] === 10);
  check('health is untouched too', h.state?.wave.health === UFOHUNT_BASE_HEALTH - 10);

  h.advance(UFOHUNT_SHOT_COOLDOWN_MS - 1);
  await onUfoShoot(h.ctx, A, 1, target.azimuth, target.elevation);
  check('still inside the window, still ignored', h.state?.scores[A] === 10);

  h.advance(1);
  const wave2 = h.state?.wave;
  const target2 = ufoPositionAt(wave2!.homeAz, wave2!.homeEl, wave2!.index, h.now - wave2!.spawnedAt);
  await onUfoShoot(h.ctx, A, 1, target2.azimuth, target2.elevation);
  check('once the cooldown has fully elapsed, it fires again', h.state?.scores[A] === 20, h.state?.scores[A]);
}

console.log('\nco-op damage, competitive score');

{
  const h = harness();
  await startUfoHunt(h.ctx, 1, [A, B, C]);
  const wave = h.state?.wave;
  const target = ufoPositionAt(wave!.homeAz, wave!.homeEl, wave!.index, 0);

  await onUfoShoot(h.ctx, A, 1, target.azimuth, target.elevation);
  await onUfoShoot(h.ctx, B, 1, target.azimuth, target.elevation);
  check('both shots come off the SAME shared health bar',
    h.state?.wave.health === UFOHUNT_BASE_HEALTH - 20, h.state?.wave.health);
  check('but each shooter keeps their own score', h.state?.scores[A] === 10 && h.state?.scores[B] === 10);
  check('a player who never fired has nothing', h.state?.scores[C] === 0);
}

console.log('\nthe saucer explodes, and a tougher one takes its place');

{
  const h = harness();
  await startUfoHunt(h.ctx, 1, [A, B]);

  for (let i = 0; i < 5; i++) {
    const w = h.state?.wave;
    const t = ufoPositionAt(w!.homeAz, w!.homeEl, w!.index, h.now - w!.spawnedAt);
    await onUfoShoot(h.ctx, A, 1, t.azimuth, t.elevation);
    h.advance(UFOHUNT_SHOT_COOLDOWN_MS);
  }

  check('five dead-centre shots kill the first saucer (50 health, 10 each)',
    h.state?.wave.index === 1, h.state?.wave);
  check('the next one is tougher by the health step',
    h.state?.wave.maxHealth === UFOHUNT_BASE_HEALTH + UFOHUNT_HEALTH_STEP, h.state?.wave.maxHealth);
  check('and starts at full health', h.state?.wave.health === h.state?.wave.maxHealth);
  check('the kill did not cost the round', h.state?.phase === 'running');
  check('scores survive across waves', h.state?.scores[A] === 50, h.state?.scores[A]);
}

console.log('\nrejections');

{
  const h = harness();
  await startUfoHunt(h.ctx, 1, [A, B]);
  const wave = h.state?.wave;
  const target = ufoPositionAt(wave!.homeAz, wave!.homeEl, wave!.index, 0);

  await onUfoShoot(h.ctx, A, 7, target.azimuth, target.elevation);
  check('a shot for another round changes nothing', h.state?.scores[A] === 0);

  await onUfoShoot(h.ctx, 'nobody', 1, target.azimuth, target.elevation);
  check('an unseated player changes nothing', Object.keys(h.state?.scores ?? {}).length === 2);

  await onUfoShoot(h.ctx, A, 1, Number.NaN, target.elevation);
  check('a non-finite aim is refused', h.state?.scores[A] === 0);
}

console.log('\nthe round ends at the safety cap');

{
  const h = harness();
  await startUfoHunt(h.ctx, 1, [A, B, C]);
  const w = h.state?.wave;
  const t = ufoPositionAt(w!.homeAz, w!.homeEl, w!.index, 0);
  // A fires dead centre; B fires the same instant but wildly off. Same instant so
  // the roam has not moved the true target between the two — a clean A > B > C.
  await onUfoShoot(h.ctx, A, 1, t.azimuth, t.elevation);
  const wild = { azimuth: t.azimuth + 180, elevation: t.elevation };
  await onUfoShoot(h.ctx, B, 1, wild.azimuth, wild.elevation);

  h.advance(UFOHUNT_ROUND_CAP_MS);
  const over = await tick(h.ctx);
  check('the cap ends it', over === true);
  check('A leads on score', h.state?.winner === A, h.state?.scores);
  check('C, who never fired, is not the winner', h.state?.winner !== C);
  check('the room was told', h.last('ufo-hunt')?.t === 'ufo-hunt');

  h.advance(1_000);
  await onUfoShoot(h.ctx, A, 1, t.azimuth, t.elevation);
  check('a shot after the end scores nothing more', h.state?.scores[A] === 10);
}

console.log('\na tie at the cap is nobody\'s win');

{
  const h = harness();
  await startUfoHunt(h.ctx, 1, [A, B]);
  const w = h.state?.wave;
  const t = ufoPositionAt(w!.homeAz, w!.homeEl, w!.index, 0);

  // Both fire at the same instant — the true target has not moved between them,
  // so both are equally dead-centre and the scores tie exactly.
  await onUfoShoot(h.ctx, A, 1, t.azimuth, t.elevation);
  await onUfoShoot(h.ctx, B, 1, t.azimuth, t.elevation);

  h.advance(UFOHUNT_ROUND_CAP_MS);
  await tick(h.ctx);
  check('an equal score is not ranked', h.state?.winner === null, h.state?.scores);
}

console.log('\nthe deadline is a moment, and it comes round');

{
  const h = harness();
  await startUfoHunt(h.ctx, 1, [A, B]);
  const s = h.state as UfoHunt;

  check('it is a tick away, not a tick long', nextDeadline(s) === h.now + UFOHUNT_TICK_MS);
  check('so it is not due yet', !(h.now >= nextDeadline(s)));
  check('and it is what the alarm was set to', h.alarm === nextDeadline(s));

  for (let i = 0; i < 3; i++) {
    h.advance(UFOHUNT_TICK_MS);
    check(`tick ${i + 1} is due`, h.now >= nextDeadline(h.state as UfoHunt));
    await tick(h.ctx);
    check(`tick ${i + 1} armed the next one`, h.alarm === h.now + UFOHUNT_TICK_MS);
  }
  check('and every one of them broadcast the room', h.count('ufo-hunt') === 4);
  check('the deadline is clamped to the end',
    nextDeadline({ ...(h.state as UfoHunt), tickAt: (h.state as UfoHunt).endsAt + 10 }) === (h.state as UfoHunt).endsAt);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
