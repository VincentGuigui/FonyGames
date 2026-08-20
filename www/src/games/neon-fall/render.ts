import { NEON_LANES, type NeonFallState } from '../../../../shared/protocol';
import { blinking, boltProgress, makeStars, stepStars, type Star } from './game';

/**
 * Neon Fall's canvas loop. Spec: docs/specs/games/neon-fall.md §4, §13
 *
 * As in Spill and Goat Siege, the canvas animates on its own rAF loop reading
 * straight from the referee's latest frame, and Preact only re-renders the
 * chrome around it — a 60 fps virtual-DOM diff never happens.
 *
 * §13 measured PixiJS at ~221 KB gzipped for the minimal import this game would
 * have used and rejected it; everything below is the plain-canvas alternative
 * that decision commits to.
 */

const MAX_FPS = 60;
const STAR_COUNT = 40;
const STAR_SPEED = 0.05; // board-heights per second, at full depth

const SKY_TOP = '#0B1026';
const SKY_LOW = '#141B3A';
const LANE_GUIDE = 'rgba(34, 211, 238, 0.18)';
const FLOOR = 'rgba(34, 211, 238, 0.35)';
const GLIDER = '#22D3EE';
const BOLT = '#F72585';
const STAR_COLOUR = 'rgba(34, 211, 238, 0.6)';

/** Margin, as a fraction of the shorter dimension, so the glider never touches an edge. */
const MARGIN = 0.08;

export type Renderer = { stop(): void };

export function startRenderer(
  canvas: HTMLCanvasElement,
  state: () => NeonFallState | null,
  now: () => number,
): Renderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');

  const stars = makeStars(STAR_COUNT);
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let raf = 0;
  let last = 0;
  let lastFrameAt = now();

  function frame(ts: number): void {
    raf = requestAnimationFrame(frame);
    if (ts - last < 1000 / MAX_FPS) return;
    last = ts;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

    const t = now();
    const dt = Math.max(0, Math.min(0.25, (t - lastFrameAt) / 1000));
    lastFrameAt = t;
    if (!calm) stepStars(stars, dt, STAR_SPEED);

    drawSky(ctx!, w, h);
    drawStars(ctx!, w, h, stars);
    drawLanes(ctx!, w, h);

    const s = state();
    if (!s) return;

    for (const bolt of s.bolts) {
      drawBolt(ctx!, w, h, bolt.lane, boltProgress(bolt.resolvesAt, t));
    }

    if (!blinking(s.bounceUntil, t) || calm) {
      drawGlider(ctx!, w, h, s.lane, s.y, s.bounceUntil > t);
    }
  }

  raf = requestAnimationFrame(frame);
  return { stop: () => cancelAnimationFrame(raf) };
}

/** Board x for a continuous lane position, margins included. */
function laneX(lane: number, w: number, h: number): number {
  const margin = Math.min(w, h) * MARGIN;
  const usable = w - margin * 2;
  return margin + (lane / (NEON_LANES - 1)) * usable;
}

/** Board y for a 0 (top) .. 1 (floor) fall progress, margins included. */
function fallY(y: number, h: number, w: number): number {
  const margin = Math.min(w, h) * MARGIN;
  const usable = h - margin * 2;
  return margin + y * usable;
}

function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, SKY_TOP);
  g.addColorStop(1, SKY_LOW);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawStars(ctx: CanvasRenderingContext2D, w: number, h: number, stars: Star[]): void {
  ctx.fillStyle = STAR_COLOUR;
  for (const star of stars) {
    const r = 0.6 + star.depth * 1.4;
    ctx.beginPath();
    ctx.arc(star.x * w, star.y * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLanes(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.strokeStyle = LANE_GUIDE;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < NEON_LANES; i++) {
    const x = laneX(i, w, h);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  const floorY = fallY(1, h, w);
  ctx.strokeStyle = FLOOR;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, floorY);
  ctx.lineTo(w, floorY);
  ctx.stroke();
}

/** A rising shot: a short neon streak in its lane, from the floor up to `progress`. */
function drawBolt(ctx: CanvasRenderingContext2D, w: number, h: number, lane: number, progress: number): void {
  const x = laneX(lane, w, h);
  const floorY = fallY(1, h, w);
  const headY = floorY - progress * (floorY - fallY(0, h, w));
  const tailY = Math.min(floorY, headY + Math.min(w, h) * 0.1);

  ctx.strokeStyle = BOLT;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, tailY);
  ctx.lineTo(x, headY);
  ctx.stroke();
}

/** The glider: a diamond outline, hollow while bouncing so a blink reads as "not solid". */
function drawGlider(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lane: number,
  y: number,
  bouncing: boolean,
): void {
  const x = laneX(lane, w, h);
  const cy = fallY(y, h, w);
  const size = Math.min(w, h) * 0.05;

  ctx.save();
  ctx.translate(x, cy);
  ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = GLIDER;
  ctx.lineWidth = bouncing ? 2 : 3;
  ctx.strokeRect(-size / 2, -size / 2, size, size);
  ctx.restore();
}
