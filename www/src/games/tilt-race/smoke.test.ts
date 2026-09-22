import { TILT_SMOKE_DRIFT, TILT_SMOKE_LIFE_MS, TILT_SMOKE_PUFFS } from '../../../../shared/protocol';
import { SMOKE_EVERY_MS, newTrail, puffPose, stepSmoke, type Puff } from './smoke';

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, detail === undefined ? '' : detail);
  }
}

const fixed = (v: number) => () => v;
const tail = { x: 0, y: 0 };

function laying(): void {
  console.log('\nthe trail is a fixed loop of five puffs (§4)');

  let trail = newTrail();
  let t = 0;
  // Drive in a straight line, laying smoke.
  for (let i = 0; i < 40; i++) {
    trail = stepSmoke(trail, t, { x: t * 0.1, y: 0 }, 0, true, fixed(0.5));
    t += 20;
  }
  check(`it never grows past ${TILT_SMOKE_PUFFS} (${trail.length})`, trail.length === TILT_SMOKE_PUFFS, trail.length);

  const ages = trail.map((p) => t - p.bornMs).sort((a, b) => a - b);
  check(
    `and they are spread across one lifetime (${ages.map((a) => a.toFixed(0)).join(', ')} ms)`,
    Math.max(...ages) < TILT_SMOKE_LIFE_MS + SMOKE_EVERY_MS,
    ages,
  );

  // One puff per interval, not one per frame.
  let dense = newTrail();
  dense = stepSmoke(dense, 0, tail, 0, true, fixed(0.5));
  const after = stepSmoke(dense, SMOKE_EVERY_MS / 2, tail, 0, true, fixed(0.5));
  check('a second frame inside the interval lays nothing', after.length === 1, after.length);
  const later = stepSmoke(dense, SMOKE_EVERY_MS, tail, 0, true, fixed(0.5));
  check('and one at the interval does', later.length === 2, later.length);

  check('below the speed it shows at, nothing is laid', stepSmoke(newTrail(), 0, tail, 0, false, fixed(0.5)).length === 0);
}

function fading(): void {
  console.log('\na puff drifts back, fades, and is recycled (§4)');

  const puff: Puff = { at: { x: 100, y: 0 }, heading: 0, variant: 1, bornMs: 0 };

  const fresh = puffPose(puff, 0);
  check('fresh, it is fully opaque and unmoved', fresh !== null && fresh.alpha === 1 && fresh.x === 100, fresh);

  const half = puffPose(puff, TILT_SMOKE_LIFE_MS / 2);
  check(`halfway it is half faded (${half?.alpha.toFixed(2)})`, Math.abs((half?.alpha ?? 0) - 0.5) < 1e-9, half?.alpha);
  check(
    `and it has drifted backwards, not forwards (${half?.x.toFixed(1)})`,
    (half?.x ?? 0) < 100 && Math.abs((half?.x ?? 0) - (100 - (TILT_SMOKE_DRIFT * TILT_SMOKE_LIFE_MS) / 2000)) < 1e-9,
    half?.x,
  );
  check('and it has spread', (half?.scale ?? 0) > 1, half?.scale);
  check('it keeps the heading the car had, so the trail follows the line driven', half?.heading === 0);

  check('at the end of its life it is gone', puffPose(puff, TILT_SMOKE_LIFE_MS) === null);

  // Recycling: the oldest slot is the one reused.
  let trail: Puff[] = [];
  for (let i = 0; i < TILT_SMOKE_PUFFS; i++) {
    trail = stepSmoke(trail, i * SMOKE_EVERY_MS, { x: i, y: 0 }, 0, true, fixed(0.1));
  }
  const oldestBefore = Math.min(...trail.map((p) => p.bornMs));
  const recycled = stepSmoke(trail, TILT_SMOKE_PUFFS * SMOKE_EVERY_MS, { x: 99, y: 0 }, 0, true, fixed(0.1));
  check(`the oldest slot is reused, not appended (${recycled.length})`, recycled.length === TILT_SMOKE_PUFFS);
  check('and the one that was oldest is gone', !recycled.some((p) => p.bornMs === oldestBefore));
  check('replaced by one at the car', recycled.some((p) => p.at.x === 99));
}

function variants(): void {
  console.log('\nthe sheet is three variants wide (§4)');
  for (const r of [0, 0.34, 0.67, 0.999]) {
    const p = stepSmoke(newTrail(), 0, tail, 0, true, fixed(r))[0]!;
    check(`  random ${r} picks a real cell (${p.variant})`, p.variant >= 0 && p.variant <= 2, p.variant);
  }
}

laying();
fading();
variants();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
