import type { Theme, ThemeDraw } from './index';

/**
 * The default look: a wavy pool of water.
 *
 * The surface is two summed sines at different frequencies and speeds — one
 * slow swell, one faster ripple. Summing two incommensurate waves is what stops
 * it looking like a metronome; a single sine reads as obviously fake.
 *
 * Deliberately cheap: one path, no physics, no particles. It has to hold 60 fps
 * on a mid-range Android next to a WebSocket.
 */

const DEEP = '#0b3a5e';
const BODY = '#1f7fc4';
const CREST = '#7fd4ff';

function surfaceY(x: number, w: number, top: number, t: number, calm: boolean): number {
  if (calm) return top;
  // Amplitude scales with the screen: a fixed 6px swell that reads well on a
  // small canvas is invisible across a 390pt phone.
  const a1 = w / 26;
  const a2 = w / 60;
  const swell = Math.sin((x / w) * Math.PI * 2 + t * 1.1) * a1;
  const ripple = Math.sin((x / w) * Math.PI * 5.3 - t * 2.7) * a2;
  return top + swell + ripple;
}

export const waterTheme: Theme = {
  id: 'water',
  name: 'Water',
  accent: '#38BDF8',

  drawBackdrop({ ctx, w, h }: ThemeDraw): void {
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, w, h);
  },

  drawPool(d: ThemeDraw, level: number, tilt: number): void {
    const { ctx, w, h, t, calm } = d;
    if (level <= 0) return;

    // Tilt from the last flick makes the pool slosh rather than sit level.
    const lean = calm ? 0 : Math.max(-1, Math.min(1, tilt)) * 10;
    const top = h - Math.max(0, Math.min(1, level)) * h;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, surfaceY(0, w, top, t, calm) - lean);
    const step = Math.max(4, Math.floor(w / 48));
    for (let x = step; x <= w; x += step) {
      const lift = lean * (1 - (2 * x) / w);
      ctx.lineTo(x, surfaceY(x, w, top, t, calm) + lift);
    }
    ctx.lineTo(w, h);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, top, 0, h);
    grad.addColorStop(0, BODY);
    grad.addColorStop(1, DEEP);
    ctx.fillStyle = grad;
    ctx.fill();

    // A brighter line along the crest gives the surface a readable edge.
    ctx.beginPath();
    ctx.moveTo(0, surfaceY(0, w, top, t, calm) - lean);
    for (let x = step; x <= w; x += step) {
      const lift = lean * (1 - (2 * x) / w);
      ctx.lineTo(x, surfaceY(x, w, top, t, calm) + lift);
    }
    ctx.strokeStyle = CREST;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  },

  drawProjectile({ ctx, t, calm }: ThemeDraw, x: number, y: number, size: number): void {
    // Big enough to be an obvious touch target: catching one is the game's
    // riskiest move and it must not be a game of hunting for a dot.
    const r = 18 * Math.sqrt(size);
    // A droplet is a circle with a slight teardrop stretch, wobbling as it goes.
    const wobble = calm ? 1 : 1 + Math.sin(t * 9) * 0.08;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 / wobble, wobble);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = BODY;
    ctx.fill();
    ctx.strokeStyle = CREST;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Highlight, so a droplet reads as wet rather than as a dot.
    ctx.beginPath();
    ctx.arc(-r * 0.3, -r * 0.35, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fill();
    ctx.restore();
  },

  drawSplash({ ctx, calm }: ThemeDraw, x: number, y: number, age: number): void {
    const a = Math.max(0, Math.min(1, age));
    ctx.save();
    ctx.globalAlpha = 1 - a;
    ctx.strokeStyle = CREST;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 8 + a * 34, 0, Math.PI * 2);
    ctx.stroke();
    if (!calm) {
      // A few flung beads. Deterministic angles: a splash should look the same
      // on every phone showing it.
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        const dist = 10 + a * 40;
        ctx.beginPath();
        ctx.arc(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, 3 * (1 - a), 0, Math.PI * 2);
        ctx.fillStyle = CREST;
        ctx.fill();
      }
    }
    ctx.restore();
  },

  words: { unit: 'drop', unitPlural: 'drops', verb: 'Fling' },
};
