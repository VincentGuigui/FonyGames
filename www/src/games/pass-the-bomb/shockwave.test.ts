import { advance, blastRadiusFor, impulse, sample, type Particle } from './shockwave';

/**
 * The explosion's physics.
 * Module: pass-the-bomb/shockwave.ts · spec: docs/specs/games/pass-the-bomb.md §4
 *
 * All of it is arithmetic over a buffer, which is the whole reason it lives apart from the
 * canvas: "does the bomb come apart" is otherwise only answerable by losing a round and
 * watching. The three things worth pinning are the ones that do not look wrong so much as
 * look broken — pieces flying *inwards*, a hole in the middle where a particle went NaN,
 * and a ring of pixels left standing because the blast could not reach the corners.
 */

let failures = 0;
let checks = 0;

function check(what: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${what}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${what}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

/** An RGBA buffer with a filled rectangle in it, for sampling. */
function buffer(w: number, h: number, box: { x: number; y: number; w: number; h: number }) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const i = (y * w + x) * 4;
      data[i] = 200;
      data[i + 1] = 100;
      data[i + 2] = 50;
      data[i + 3] = 255;
    }
  }
  return data;
}

console.log('\nsampling the bomb');

{
  const data = buffer(20, 20, { x: 4, y: 4, w: 8, h: 8 });
  const every = sample(data, 20, 20, 1);
  check('every opaque pixel becomes a particle', every.length === 64, every.length);
  check('and nothing transparent does', every.every((p) => p.x >= 4 && p.x < 12));
  check('the colour comes with it', every[0]?.r === 200 && every[0]?.g === 100 && every[0]?.b === 50);
  check('and it starts still', every.every((p) => p.vx === 0 && p.vy === 0));
  check('remembering where it came from', every.every((p) => p.ox === p.x && p.oy === p.y));

  // The lever between a dust cloud and a phone that drops frames.
  const coarse = sample(data, 20, 20, 2);
  check('a bigger step is fewer particles', coarse.length === 16, coarse.length);
  check('but the same shape', coarse.every((p) => p.x >= 4 && p.x < 12 && p.y >= 4 && p.y < 12));

  // The count follows the ink, not the canvas: a bomb on a big empty square costs the
  // same as one on a tight square.
  const empty = sample(new Uint8ClampedArray(20 * 20 * 4), 20, 20, 1);
  check('an empty image makes no particles', empty.length === 0);

  // Anti-aliased edges are almost transparent; drawing them as solid blocks would give
  // the bomb a halo of grey squares.
  const faint = new Uint8ClampedArray(4 * 4);
  faint[3] = 8;
  check('a nearly transparent pixel is not part of the bomb', sample(faint, 1, 1, 1).length === 0);
}

console.log('\nthe shockwave pushes outwards');

const at = (x: number, y: number): Particle => ({ x, y, vx: 0, vy: 0, ox: x, oy: y, r: 0, g: 0, b: 0 });

{
  const right = at(60, 50);
  const left = at(40, 50);
  const below = at(50, 60);
  const above = at(50, 40);
  const ps = [right, left, below, above];
  impulse(ps, 50, 50, 100, 20);

  // Away from the blast on every side. A sign error here is an implosion, which reads as
  // the bomb being sucked in rather than going off.
  check('a piece to the right goes right', right.vx > 0, right.vx);
  check('a piece to the left goes left', left.vx < 0, left.vx);
  check('a piece below goes down', below.vy > 0, below.vy);
  check('a piece above goes up', above.vy < 0, above.vy);
  check('and none of them picks up a sideways drift', right.vy === 0 && left.vy === 0);
  check('symmetrically', Math.abs(right.vx + left.vx) < 1e-9);
}

{
  // Nearer the middle is harder, which is what makes it look like a blast rather than a
  // uniform scatter.
  const near = at(60, 50);
  const far = at(90, 50);
  impulse([near, far], 50, 50, 100, 20);
  check('nearer the middle is thrown harder', near.vx > far.vx, { near: near.vx, far: far.vx });
  check('and the hardest is the full force', near.vx < 20 && near.vx > 0, near.vx);
}

{
  // THE guard. `dist === 0` at the exact blast point: dividing by it makes NaN, and a NaN
  // particle is never drawn and never leaves — a permanent hole in the middle of the
  // explosion, on the one pixel a bomb is most likely to have.
  const centre = at(50, 50);
  impulse([centre], 50, 50, 100, 20);
  check('a piece exactly on the blast point is left alone', centre.vx === 0 && centre.vy === 0);
  check('rather than sent to NaN', Number.isFinite(centre.vx) && Number.isFinite(centre.vy));
}

{
  // Beyond the radius nothing moves — which is why the radius has to cover the image.
  const outside = at(200, 50);
  impulse([outside], 50, 50, 100, 20);
  check('a piece beyond the blast is untouched', outside.vx === 0);

  /*
   * THE reason the radius overshoots the image. At exactly half the diagonal the corners
   * sit ON the rim, where the falloff is zero — so they are the one part of the bomb that
   * does not move, and it blows its middle out leaving four corners standing.
   */
  const r = blastRadiusFor(300, 300);
  const corner = at(0, 0);
  impulse([corner], 150, 150, r, 20);
  check('the corners are thrown too', corner.vx < 0 && corner.vy < 0, { r, corner });
  check(
    'and hard enough to be seen going',
    Math.hypot(corner.vx, corner.vy) > 20 * 0.2,
    Math.hypot(corner.vx, corner.vy),
  );
  const edge = at(150, 0);
  impulse([edge], 150, 150, r, 20);
  check('while the edges still get more than the corners', Math.abs(edge.vy) > Math.hypot(corner.vx, corner.vy));
}

console.log('\nand then they fly');

{
  const p = at(50, 50);
  p.vx = 10;
  p.vy = -10;
  advance([p], 1, 0.5, 1);
  check('a piece moves by its velocity', p.x === 60, p.x);
  check('and gravity pulls it down', p.vy === -9.5, p.vy);

  // dt is in frames, so two frames of one is one frame of two — otherwise a 120Hz phone
  // gets an explosion that is over in half the time.
  const one = at(0, 0);
  one.vx = 10;
  advance([one], 2, 0, 1);
  const two = at(0, 0);
  two.vx = 10;
  advance([two], 1, 0, 1);
  advance([two], 1, 0, 1);
  check('two frames or one double frame land in the same place', one.x === two.x, { one: one.x, two: two.x });
}

{
  // Drag has to compound over dt for the same reason, or the pieces slow down at whatever
  // rate the display happens to refresh at.
  const slow = at(0, 0);
  slow.vx = 100;
  advance([slow], 2, 0, 0.9);
  check('drag compounds over the step', Math.abs(slow.vx - 81) < 1e-9, slow.vx);
  check('and it does slow down', slow.vx < 100);
}

{
  // A backgrounded tab comes back with a gap of seconds. The caller clamps dt; this checks
  // the maths does not blow up when it is large.
  const p = at(0, 0);
  p.vx = 20;
  advance([p], 3, 0.55, 0.985);
  check('a long step stays finite', Number.isFinite(p.x) && Number.isFinite(p.vx), p);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
