import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { advance, blastRadiusFor, impulse, sample, type Particle } from './shockwave';

/**
 * The bomb, and the shockwave that takes it apart.
 * Spec: docs/specs/games/pass-the-bomb.md §4 · physics: `shockwave.ts`
 *
 * The bomb is drawn once, sampled into particles, given one impulse from its middle and
 * then left to fly. This component owns the canvas and the frame loop; every number that
 * decides how it looks is in `shockwave.ts`, where it can be tested without a browser.
 *
 * ## Why a canvas and not a CSS animation
 *
 * A transform can throw the *whole* bomb somewhere. It cannot take it apart, and coming
 * apart is the thing being animated — the piece that was the fuse and the piece that was
 * the shell have to go in different directions, and there are two thousand of them.
 */

/** The side of the square the pieces fly around in, in CSS pixels. */
const SIZE = 340;

/**
 * How much of that square the bomb itself takes up.
 *
 * Well under half, and that is the whole reason the canvas is bigger than the bomb: a
 * particle that leaves the canvas is clipped and gone, so drawing the bomb edge-to-edge
 * gives the pieces nowhere to fly. The first version filled the square and the entire
 * explosion was over in a quarter of a second, most of it off-canvas.
 */
const BOMB = 0.46;

/**
 * One particle per 3×3 block.
 *
 * At 1 this is 90 000 particles for a 300px square and no phone survives it; at 3 it is
 * about 2 500 on a bomb that fills the middle, which draws in well under a frame.
 */
const STEP = 3;

/**
 * Pixels per frame at the blast centre. Everything else is a fraction of it.
 *
 * Tuned against the canvas rather than picked: at 26 the nearest pieces crossed the whole
 * square in a dozen frames and the bang was invisible. At 6, with the drag below, the
 * cloud takes most of a second to clear — which is long enough to read as the bomb coming
 * apart rather than as a frame being dropped.
 */
const FORCE = 6;

/** Per frame. Enough that the pieces fall rather than drift off in a straight line. */
const GRAVITY = 0.28;

/** Air. Below 1 or nothing ever slows down and the screen empties in three frames. */
const DRAG = 0.99;

/** How long the pieces are drawn for, fading out across it. */
const LIFE_MS = 1600;

export function Blast({ glyph = '💣' }: { glyph?: string }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Drawn at the device resolution and then treated as plain pixels from here on:
    // the particles are in canvas space, so nothing below needs to know about `dpr`.
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.font = `${Math.round(h * BOMB)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, w / 2, h / 2);

    /*
     * Anyone who has asked for less motion gets the bomb and no storm.
     *
     * Not a shorter or gentler explosion — two thousand pieces flying apart is exactly
     * what `prefers-reduced-motion` is asking not to see, and the round is not decided by
     * this. The words beside it already say who is out (spec §11).
     */
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const frame0 = ctx.getImageData(0, 0, w, h);
    const particles: Particle[] = sample(frame0.data, w, h, STEP * dpr);
    impulse(particles, w / 2, h / 2, blastRadiusFor(w, h), FORCE * dpr);

    // One buffer, reused: allocating a 300×300 RGBA array every frame is 360 KB of
    // garbage sixty times a second, which is how a smooth animation becomes a stuttering
    // one on the phone that can least afford it.
    const buffer = ctx.createImageData(w, h);
    const px = buffer.data;
    const block = Math.max(1, Math.round(STEP * dpr));

    let raf = 0;
    let started = 0;
    let last = 0;

    const draw = (now: number): void => {
      if (started === 0) {
        started = now;
        last = now;
      }
      // Frames at 60Hz, clamped: a tab that was backgrounded returns with a gap of
      // seconds, and integrating that in one step teleports every piece off the canvas.
      const dt = Math.min(3, ((now - last) * 60) / 1000);
      last = now;

      const age = now - started;
      if (age >= LIFE_MS) {
        ctx.clearRect(0, 0, w, h);
        return;
      }

      advance(particles, dt, GRAVITY * dpr, DRAG);

      px.fill(0);
      // Fading as a whole rather than per particle: they are leaving the canvas anyway,
      // and one multiply here beats one per piece per frame.
      const alpha = Math.round(255 * Math.max(0, 1 - age / LIFE_MS));

      for (const p of particles) {
        const x0 = Math.round(p.x);
        const y0 = Math.round(p.y);
        if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) continue;
        // Drawn as a block, not a dot: a sampled particle stands for the square it came
        // from, and drawing single pixels makes the bomb look like it evaporated rather
        // than shattered.
        for (let y = y0; y < y0 + block && y < h; y++) {
          for (let x = x0; x < x0 + block && x < w; x++) {
            const i = (y * w + x) * 4;
            px[i] = p.r;
            px[i + 1] = p.g;
            px[i + 2] = p.b;
            px[i + 3] = alpha;
          }
        }
      }

      ctx.putImageData(buffer, 0, 0);
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [glyph]);

  return (
    <canvas
      class="boom__canvas"
      ref={canvasRef}
      style={{ width: `${SIZE}px`, height: `${SIZE}px` }}
      aria-hidden="true"
    />
  );
}
