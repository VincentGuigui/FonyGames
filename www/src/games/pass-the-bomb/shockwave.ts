/**
 * The explosion: a bomb taken apart pixel by pixel.
 * Spec: docs/specs/games/pass-the-bomb.md §4
 *
 * The bomb is drawn once into a canvas, sampled into particles, and then a shockwave
 * from the middle of it gives every particle a push outwards. After that it is ballistic
 * — nothing is scripted, nothing tweens to a target, and the shape comes apart because
 * each piece is carrying its own momentum.
 *
 * Named `shockwave.ts` and not `blast.ts` beside `Blast.tsx`: two files whose names differ
 * only in case resolve to whichever one a case-insensitive filesystem hands over first,
 * and the bundler picks the component when the test asks for the physics.
 *
 * **No DOM in this file.** The sampling takes a raw RGBA buffer and the stepping takes an
 * array of numbers, so all of it is testable without a canvas, a phone or a round — which
 * matters, because "does the explosion look right" is otherwise only answerable by
 * losing a game of Pass the Bomb.
 */

/**
 * How long the explosion holds the screen.
 *
 * Longer than the animation in `Blast.tsx` (1600 ms), so the pieces are gone before the
 * screen changes rather than being cut off mid-flight.
 *
 * It lives here rather than in either screen because **both** need it and they need the
 * same number: `BombScreen` decides how long a mid-round boom is fresh for, and
 * `BombRoom` decides how long to keep showing the round after it has ended. When only
 * the first of those existed, a round-ending explosion was never drawn at all — the room
 * dropped to the lobby the instant the phase changed, which in a solo round is the only
 * explosion there is.
 */
export const BOOM_MS = 2200;

export type Particle = {
  /** Where it is now, in canvas pixels. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Where it started. The blast is measured from here, not from the live position. */
  ox: number;
  oy: number;
  r: number;
  g: number;
  b: number;
};

/** Alpha below which a source pixel is not part of the bomb. */
const OPAQUE_ENOUGH = 24;

/**
 * Turn an RGBA buffer into particles, one per `step`×`step` block.
 *
 * `step` is the lever between "a cloud of dust" and "a phone that drops frames": at 1 it
 * is every pixel of a 300px image, which is 90 000 particles and hopeless on a mid-range
 * phone. Transparent pixels are skipped, so the count follows the ink rather than the
 * canvas, and a bomb on a big empty square costs no more than a bomb on a tight one.
 */
export function sample(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  step: number,
): Particle[] {
  const out: Particle[] = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if ((data[i + 3] as number) < OPAQUE_ENOUGH) continue;
      out.push({
        x,
        y,
        vx: 0,
        vy: 0,
        ox: x,
        oy: y,
        r: data[i] as number,
        g: data[i + 1] as number,
        b: data[i + 2] as number,
      });
    }
  }
  return out;
}

/**
 * The shockwave. One impulse, from `(bx, by)`, outwards.
 *
 * Measured from each particle's ORIGIN rather than its live position, so the whole wave
 * is decided by the shape the bomb had when it went off. Applied to velocity, not to
 * position: the pieces are thrown, and where they end up is then a matter of how long
 * they have been flying.
 *
 * `radius` should cover the whole image or the corners never move — the shape would blow
 * its middle out and leave a ring standing, which reads as a rendering fault rather than
 * as an explosion. `blastRadiusFor` below is the safe value.
 */
export function impulse(
  particles: Particle[],
  bx: number,
  by: number,
  radius: number,
  force: number,
): void {
  for (const p of particles) {
    const dx = p.ox - bx;
    const dy = p.oy - by;
    const dist = Math.hypot(dx, dy);
    // A particle exactly on the blast point has no direction to be thrown in, and
    // dividing by that zero would put it at NaN for the rest of the animation — where it
    // is neither drawn nor gone, because every comparison against NaN is false.
    if (dist >= radius || dist === 0) continue;
    const strength = (1 - dist / radius) * force;
    p.vx += (dx / dist) * strength;
    p.vy += (dy / dist) * strength;
  }
}

/**
 * The blast radius for a `w`×`h` image, from its middle.
 *
 * Half the diagonal **and then some**. Exactly half the diagonal puts the corners on the
 * rim, where the falloff is zero by construction — so the corner pixels get no push at
 * all and the bomb blows its middle out while its four corners sit there. The overshoot
 * leaves the weakest particle with about a third of the force, which is slow but is
 * unmistakably moving.
 */
export function blastRadiusFor(w: number, h: number): number {
  return (Math.hypot(w, h) / 2) * 1.6;
}

/**
 * One frame of flight.
 *
 * `dt` is in frames-at-60Hz rather than seconds, so the numbers in the caller read as
 * "pixels per frame" — and a phone running at 120 Hz gets the same explosion at twice the
 * smoothness instead of one that is over in half the time.
 */
export function advance(particles: Particle[], dt: number, gravity: number, drag: number): void {
  // Per-frame drag compounded over `dt` frames, so slowing down does not depend on how
  // often this is called.
  const damp = Math.pow(drag, dt);
  for (const p of particles) {
    p.vx *= damp;
    p.vy = p.vy * damp + gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}
