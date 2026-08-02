import { SIEGE_CABBAGES } from '../../../../shared/protocol';
import { CHOMP_MS, type SiegeGame } from './game';
import { CABBAGE_Y, GROUND_Y } from './layout';

/**
 * Goat Siege's canvas loop. Spec: docs/specs/games/goat-siege.md §4, §10
 *
 * Unlike Spill this game has no theme registry — the goats *are* the theme, and
 * a second artistic direction was never asked for. If one is ever wanted, copy
 * the `Theme` interface from `games/spill/themes/index.ts` rather than
 * inventing a second pattern.
 *
 * Accessibility constraint from §10, enforced here: **adult and kid differ by
 * silhouette and size, never by colour alone.**
 */

const MAX_FPS = 60;

const SKY_TOP = '#0d0f14';
const SKY_LOW = '#152033';
const GROUND = '#1d3a22';
const FENCE = '#7a5c3a';
const CABBAGE = '#4ADE80';
const GOAT = '#e8e2d4';

export type Renderer = { stop(): void };

export function startRenderer(
  canvas: HTMLCanvasElement,
  game: SiegeGame,
  now: () => number,
): Renderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');

  let raf = 0;
  let last = 0;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

    const view = game.view(w, h);
    drawGarden(ctx!, w, h, view.cabbages);

    for (const f of view.incoming) {
      drawGoat(ctx!, f.x, f.y, f.goat.kind, f.progress, calm ? 0 : ts / 1000);
    }

    for (const c of view.chomps) {
      const age = (now() - c.at) / CHOMP_MS;
      if (age >= 1) continue;
      drawChomp(ctx!, c.x * w, h * CABBAGE_Y, age);
    }
  }

  raf = requestAnimationFrame(frame);
  return { stop: () => cancelAnimationFrame(raf) };
}

function drawGarden(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cabbages: number,
): void {
  const sky = ctx.createLinearGradient(0, 0, 0, h * GROUND_Y);
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(1, SKY_LOW);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = GROUND;
  ctx.fillRect(0, h * GROUND_Y, w, h * (1 - GROUND_Y));

  // Fence along the back of the patch — the line goats come over.
  ctx.strokeStyle = FENCE;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, h * GROUND_Y);
  ctx.lineTo(w, h * GROUND_Y);
  ctx.stroke();
  ctx.lineWidth = 4;
  for (let i = 0; i <= 5; i++) {
    const x = (w * i) / 5 + w / 10;
    ctx.beginPath();
    ctx.moveTo(x, h * (GROUND_Y - 0.03));
    ctx.lineTo(x, h * (GROUND_Y + 0.03));
    ctx.stroke();
  }

  // Cabbages as discrete objects, so damage is legible at a glance (spec §4).
  // The eaten ones leave a hole rather than the row re-centring, or you could
  // not tell at a glance how much trouble you are in.
  const slot = w / (SIEGE_CABBAGES + 1);
  for (let i = 0; i < SIEGE_CABBAGES; i++) {
    const x = slot * (i + 1);
    const y = h * CABBAGE_Y;
    if (i < cabbages) {
      ctx.fillStyle = CABBAGE;
      ctx.beginPath();
      ctx.arc(x, y, slot * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgb(0 0 0 / 35%)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, slot * 0.16, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgb(255 255 255 / 14%)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x, y, slot * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/**
 * Adult and kid differ in **size and silhouette**: the adult has horns and a
 * beard, the kid is round and hornless. Colour alone would fail §10.
 */
function drawGoat(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: 'adult' | 'kid',
  progress: number,
  t: number,
): void {
  const base = kind === 'adult' ? 26 : 16;
  const r = base * (0.55 + progress * 0.65);
  const bob = Math.sin(t * 6 + x) * r * 0.06;

  ctx.save();
  ctx.translate(x, y + bob);

  // Shadow on the ground gives the arc a readable height.
  ctx.fillStyle = 'rgb(0 0 0 / 25%)';
  ctx.beginPath();
  ctx.ellipse(0, r * 1.8, r * 0.7, r * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = GOAT;
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.68, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs.
  ctx.strokeStyle = GOAT;
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.lineCap = 'round';
  for (const dx of [-0.5, -0.18, 0.18, 0.5]) {
    ctx.beginPath();
    ctx.moveTo(r * dx, r * 0.5);
    ctx.lineTo(r * dx, r * 1.1);
    ctx.stroke();
  }

  // Head.
  ctx.fillStyle = GOAT;
  ctx.beginPath();
  ctx.ellipse(r * 0.85, -r * 0.45, r * 0.42, r * 0.32, -0.3, 0, Math.PI * 2);
  ctx.fill();

  if (kind === 'adult') {
    // Horns and beard: the adult silhouette.
    ctx.strokeStyle = GOAT;
    ctx.lineWidth = Math.max(2, r * 0.14);
    ctx.beginPath();
    ctx.moveTo(r * 0.75, -r * 0.75);
    ctx.quadraticCurveTo(r * 0.4, -r * 1.3, r * 0.05, -r * 1.05);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r * 0.95, -r * 0.72);
    ctx.quadraticCurveTo(r * 0.7, -r * 1.35, r * 0.3, -r * 1.2);
    ctx.stroke();
    ctx.fillStyle = GOAT;
    ctx.beginPath();
    ctx.moveTo(r * 0.95, -r * 0.18);
    ctx.lineTo(r * 0.8, r * 0.35);
    ctx.lineTo(r * 1.15, -r * 0.1);
    ctx.fill();
  }

  ctx.fillStyle = '#10121a';
  ctx.beginPath();
  ctx.arc(r * 1.02, -r * 0.52, Math.max(1.5, r * 0.08), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** One animation, no flash — spec §10 forbids strobing. */
function drawChomp(ctx: CanvasRenderingContext2D, x: number, y: number, age: number): void {
  ctx.save();
  ctx.globalAlpha = 1 - age;
  ctx.strokeStyle = CABBAGE;
  ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const d = 8 + age * 34;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.5);
    ctx.lineTo(x + Math.cos(a) * (d + 8), y + Math.sin(a) * (d + 8) * 0.5);
    ctx.stroke();
  }
  ctx.restore();
}
