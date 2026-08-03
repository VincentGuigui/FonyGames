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
const CABBAGE_LEAF = '#2f9e5b';
const CABBAGE_VEIN = '#1c6b3d';
const STUMP = '#6d7f5a';
const GOAT = '#e8e2d4';
const GOAT_SHADE = '#c9c1ad';
const GOAT_HORN = '#8d8172';

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
    if (i < cabbages) drawCabbage(ctx, x, y, slot * 0.32);
    else drawStump(ctx, x, y, slot * 0.32);
  }
}

/**
 * A cabbage: outer leaves, a paler heart, and the curled veins that say
 * *vegetable* rather than *green circle*.
 *
 * It was a circle with a ring inside, which at a glance was a token rather than
 * something a goat would want to eat. The silhouette does the work — the leaf
 * lobes break the outline, so it still reads as a cabbage in one colour.
 */
function drawCabbage(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);

  // Sitting shadow, so it belongs on the soil instead of floating over it.
  ctx.fillStyle = 'rgb(0 0 0 / 28%)';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.8, r * 0.95, r * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();

  // Outer leaves: five lobes around the head, wider than they are tall.
  ctx.fillStyle = CABBAGE_LEAF;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2 + 0.3;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * r * 0.52, Math.sin(a) * r * 0.42, r * 0.62, r * 0.44, a, 0, Math.PI * 2);
    ctx.fill();
  }

  // The head.
  ctx.fillStyle = CABBAGE;
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.06, r * 0.78, r * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();

  // Two veins curling out of the heart. Darker, not lighter: a light line on a
  // light head disappears against the leaves behind it.
  ctx.strokeStyle = CABBAGE_VEIN;
  ctx.lineWidth = Math.max(1.5, r * 0.11);
  ctx.lineCap = 'round';
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, r * 0.34);
    ctx.quadraticCurveTo(dir * r * 0.5, r * 0.1, dir * r * 0.28, -r * 0.42);
    ctx.stroke();
  }
  ctx.restore();
}

/** What a cabbage leaves behind: a stump and a scatter of dropped leaves. */
function drawStump(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = 'rgb(255 255 255 / 13%)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // A chewed stalk, so an eaten slot reads as *eaten* and not merely as empty.
  ctx.strokeStyle = STUMP;
  ctx.lineWidth = Math.max(2, r * 0.22);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, r * 0.45);
  ctx.lineTo(0, -r * 0.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 0.3, r * 0.5);
  ctx.lineTo(r * 0.3, r * 0.5);
  ctx.stroke();
  ctx.restore();
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

  // Body: a rounded barrel with a rump, rather than a plain ellipse. The extra
  // bulk at the back and the dip behind the shoulder are what make a four-legged
  // animal read as an animal at 30 px.
  ctx.fillStyle = GOAT;
  ctx.beginPath();
  ctx.moveTo(-r * 0.95, -r * 0.1);
  ctx.quadraticCurveTo(-r * 1.0, -r * 0.62, -r * 0.35, -r * 0.6);
  ctx.quadraticCurveTo(r * 0.15, -r * 0.58, r * 0.5, -r * 0.5);
  ctx.quadraticCurveTo(r * 1.0, -r * 0.4, r * 0.95, r * 0.1);
  ctx.quadraticCurveTo(r * 0.9, r * 0.6, r * 0.2, r * 0.62);
  ctx.quadraticCurveTo(-r * 0.5, r * 0.64, -r * 0.85, r * 0.4);
  ctx.quadraticCurveTo(-r * 1.0, r * 0.2, -r * 0.95, -r * 0.1);
  ctx.closePath();
  ctx.fill();

  // Underside in shade, so the barrel has a top and a bottom. Kept low and wide
  // and well inside the outline — drawn any higher it reads as a belt.
  ctx.fillStyle = GOAT_SHADE;
  ctx.beginPath();
  ctx.ellipse(-r * 0.05, r * 0.5, r * 0.66, r * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs: two back, two front, the far pair shaded so they sit behind.
  //
  // Each foot lands **outside** its hip, so the stance splays — back legs
  // trailing, front legs reaching. Curled inwards instead, all four hooves met
  // under the belly and the goat looked hobbled.
  const legW = Math.max(2, r * 0.15);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [hip, far] of [
    [-0.4, true],
    [0.44, true],
    [-0.58, false],
    [0.6, false],
  ] as [number, boolean][]) {
    const out = hip + Math.sign(hip) * 0.3;
    ctx.strokeStyle = far ? GOAT_SHADE : GOAT;
    ctx.lineWidth = far ? legW * 0.85 : legW;
    ctx.beginPath();
    ctx.moveTo(r * hip, r * 0.45);
    // Bent at the knee — a straight stick reads as furniture, not a leap.
    ctx.quadraticCurveTo(r * hip, r * 0.92, r * out, r * 1.1);
    ctx.stroke();
    // A hoof, so the leg ends in something.
    ctx.fillStyle = GOAT_HORN;
    ctx.beginPath();
    ctx.arc(r * out, r * 1.1, legW * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tail, flicked up.
  ctx.strokeStyle = GOAT;
  ctx.lineWidth = Math.max(2, r * 0.13);
  ctx.beginPath();
  ctx.moveTo(-r * 0.92, -r * 0.12);
  ctx.quadraticCurveTo(-r * 1.25, -r * 0.3, -r * 1.18, -r * 0.6);
  ctx.stroke();

  // Neck into the head, as one shape so there is no seam between them.
  ctx.fillStyle = GOAT;
  ctx.beginPath();
  ctx.moveTo(r * 0.45, -r * 0.45);
  ctx.quadraticCurveTo(r * 0.85, -r * 0.55, r * 0.92, -r * 0.85);
  ctx.lineTo(r * 1.3, -r * 0.62);
  ctx.quadraticCurveTo(r * 1.35, -r * 0.3, r * 0.9, -r * 0.2);
  ctx.closePath();
  ctx.fill();

  // Muzzle: a snout that comes to a blunt point, which is most of "goat".
  ctx.beginPath();
  ctx.ellipse(r * 1.24, -r * 0.52, r * 0.3, r * 0.2, -0.35, 0, Math.PI * 2);
  ctx.fill();

  // Ear, dropped back along the neck.
  ctx.fillStyle = GOAT_SHADE;
  ctx.beginPath();
  ctx.ellipse(r * 0.82, -r * 0.82, r * 0.2, r * 0.1, -0.9, 0, Math.PI * 2);
  ctx.fill();

  if (kind === 'adult') {
    // Horns sweeping back over the neck, and a beard. Both are silhouette, not
    // colour: §10 forbids telling an adult from a kid by hue.
    // Two of them, clearly apart and short. Overlapping long curves merged into
    // one thick line that read as an aerial.
    ctx.strokeStyle = GOAT_HORN;
    ctx.lineWidth = Math.max(2, r * 0.13);
    const horns: [number, number, number, number][] = [
      [0.34, -1.18, 0.78, -1.34],
      [0.6, -1.32, 0.92, -1.24],
    ];
    for (const [tipX, tipY, ctlX, ctlY] of horns) {
      ctx.beginPath();
      ctx.moveTo(r * 0.97, -r * 0.92);
      ctx.quadraticCurveTo(r * ctlX, r * ctlY, r * tipX, r * tipY);
      ctx.stroke();
    }

    ctx.fillStyle = GOAT;
    ctx.beginPath();
    ctx.moveTo(r * 1.12, -r * 0.32);
    ctx.quadraticCurveTo(r * 1.05, r * 0.22, r * 0.86, r * 0.3);
    ctx.quadraticCurveTo(r * 1.02, -r * 0.05, r * 0.98, -r * 0.36);
    ctx.closePath();
    ctx.fill();
  }

  // Eye and nostril. The nostril is what stops the muzzle reading as a thumb.
  ctx.fillStyle = '#10121a';
  ctx.beginPath();
  ctx.arc(r * 1.02, -r * 0.66, Math.max(1.4, r * 0.075), 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(r * 1.36, -r * 0.5, Math.max(1, r * 0.05), 0, Math.PI * 2);
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
