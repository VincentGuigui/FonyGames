import type { Theme, ThemeDraw } from './index';

/**
 * Second theme, and the one that proves the interface is real: balloons are
 * **discrete objects**, not a liquid. If `Theme` only worked for things that
 * slosh, it would not be an abstraction — it would be water with a colour knob.
 *
 * The "pool" becomes a pile whose height tracks `level`, and the sloshing tilt
 * becomes a lean of the whole heap.
 */

const COLOURS = ['#f472b6', '#fbbf24', '#4ade80', '#38bdf8', '#c084fc'];

/** Deterministic pseudo-random so every phone draws the same pile. */
function jitter(i: number, salt: number): number {
  return ((Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453) % 1 + 1) % 1;
}

function balloon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  colour: string,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.85, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
  // The knot — what makes it read as a balloon and not a ball.
  ctx.beginPath();
  ctx.moveTo(x - r * 0.16, y + r);
  ctx.lineTo(x + r * 0.16, y + r);
  ctx.lineTo(x, y + r * 1.25);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.35, r * 0.22, r * 0.3, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
}

export const balloonTheme: Theme = {
  id: 'balloon',
  name: 'Water balloons',
  accent: '#f472b6',

  drawBackdrop({ ctx, w, h }: ThemeDraw): void {
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, w, h);
  },

  drawPool(d: ThemeDraw, level: number, tilt: number): void {
    const { ctx, w, h, t, calm } = d;
    if (level <= 0) return;

    const r = Math.max(12, w / 14);
    const rows = Math.max(1, Math.round((level * h) / (r * 1.6)));
    const perRow = Math.max(1, Math.floor(w / (r * 1.9)));
    const lean = calm ? 0 : Math.max(-1, Math.min(1, tilt)) * 8;

    for (let row = 0; row < rows; row++) {
      const y = h - r - row * r * 1.5;
      // Offset alternate rows so it stacks like a heap, not a grid.
      const offset = (row % 2) * r * 0.9;
      for (let i = 0; i < perRow; i++) {
        const idx = row * perRow + i;
        const x = offset + r + i * r * 1.9 + (jitter(idx, 1) - 0.5) * r * 0.4;
        if (x > w + r) continue;
        const bob = calm ? 0 : Math.sin(t * 1.6 + idx) * 2;
        const leanHere = lean * (1 - (2 * x) / w);
        balloon(ctx, x + leanHere, y + bob, r, COLOURS[idx % COLOURS.length] as string);
      }
    }
  },

  drawProjectile({ ctx, t, calm }: ThemeDraw, x: number, y: number, size: number): void {
    // Matches water.ts: the touch target must be the same whatever the theme,
    // or swapping the look would quietly change the difficulty.
    const r = 18 * Math.sqrt(size);
    const spin = calm ? 0 : Math.sin(t * 5) * 0.25;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    balloon(ctx, 0, 0, r, COLOURS[Math.floor(size) % COLOURS.length] as string);
    ctx.restore();
  },

  drawSplash({ ctx, calm }: ThemeDraw, x: number, y: number, age: number): void {
    const a = Math.max(0, Math.min(1, age));
    ctx.save();
    ctx.globalAlpha = 1 - a;
    // A burst balloon: shreds flying outward, not a ripple.
    const shreds = calm ? 4 : 8;
    for (let i = 0; i < shreds; i++) {
      const ang = (i / shreds) * Math.PI * 2;
      const dist = 6 + a * 46;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist);
      ctx.lineTo(
        x + Math.cos(ang + 0.25) * (dist + 9),
        y + Math.sin(ang + 0.25) * (dist + 9),
      );
      ctx.strokeStyle = COLOURS[i % COLOURS.length] as string;
      ctx.lineWidth = 4 * (1 - a);
      ctx.stroke();
    }
    ctx.restore();
  },

  words: { unit: 'balloon', unitPlural: 'balloons', verb: 'Lob' },
};
