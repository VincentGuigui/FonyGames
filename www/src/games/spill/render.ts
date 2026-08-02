import { SPLASH_MS, type SpillGame, type View } from './game';
import { SPILL_HOLD_MS } from '../../../../shared/protocol';
import type { Theme, ThemeDraw } from './themes';

/**
 * The canvas loop. Spec: docs/specs/games/spill.md §6
 *
 * This file owns *when* and *where* things are drawn; the theme owns what they
 * look like. Nothing here knows about water — swap the theme and the same code
 * draws balloons. That separation is a hard requirement, not a preference, so
 * resist the urge to reach for a colour or a shape in this file.
 */

/** Redraw budget: a phone lying on a table should not get warm. */
const MAX_FPS = 60;

export type Renderer = {
  setTheme(theme: Theme): void;
  stop(): void;
};

export function startRenderer(
  canvas: HTMLCanvasElement,
  game: SpillGame,
  initial: Theme,
  /** Server time — every deadline the renderer compares against is in it. */
  now: () => number,
  /** The current aim, while a finger is down. */
  aim: () => { angle: number; hit: number | null } | null,
): Renderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');

  let theme = initial;
  let raf = 0;
  let last = 0;
  const started = performance.now();
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize(): { w: number; h: number } {
    // Cap the backing store at 2× — a 3× phone gains nothing visible here and
    // pays for every pixel of a full-screen animation.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function frame(ts: number): void {
    raf = requestAnimationFrame(frame);
    if (ts - last < 1000 / MAX_FPS) return;
    last = ts;

    const { w, h } = resize();
    const d: ThemeDraw = { ctx: ctx!, w, h, t: (ts - started) / 1000, calm };
    const view = game.view(w, h);

    theme.drawBackdrop(d);
    theme.drawPool(d, view.level, tiltOf(view));
    drawAim(d, aim(), theme);

    for (const v of view.visible) {
      theme.drawProjectile(d, v.x, v.y, v.drop.size);
      if (v.phase === 'arriving') ring(d, v.x, v.y, v.drop.size, theme);
    }

    if (view.held) {
      // A held payload sits in the middle waiting to be thrown, with a ring
      // that drains as it soaks — the timer *is* the visual.
      theme.drawProjectile(d, w / 2, h / 2, view.held.size);
      const left = Math.max(0, view.held.soaksAt - now());
      fuse(d, w / 2, h / 2, left / SPILL_HOLD_MS, theme);
    }

    for (const sp of view.splashes) {
      const age = (now() - sp.at) / SPLASH_MS;
      if (age >= 1) continue;
      theme.drawSplash(d, sp.x * w, sp.y * h, age);
    }
  }

  raf = requestAnimationFrame(frame);

  return {
    setTheme(next: Theme) {
      theme = next;
    },
    stop() {
      cancelAnimationFrame(raf);
    },
  };
}

/** The pool leans toward whatever just left, so a flick reads as a shove. */
function tiltOf(view: View): number {
  const leaving = view.visible.find((v) => v.phase === 'leaving');
  return leaving ? Math.sin(leaving.drop.angle) : 0;
}

/** The line you are about to throw along, drawn in the theme's accent. */
function drawAim(
  d: ThemeDraw,
  aim: { angle: number; hit: number | null } | null,
  theme: Theme,
): void {
  if (!aim) return;
  const { ctx, w, h } = d;
  const reach = Math.hypot(w, h) / 2;
  ctx.save();
  ctx.globalAlpha = aim.hit === null ? 0.3 : 0.9;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 4;
  // Dashed when the flick would miss the table entirely — the only warning a
  // player gets that they are about to throw their water on the floor.
  ctx.setLineDash(aim.hit === null ? [8, 10] : []);
  ctx.beginPath();
  ctx.moveTo(w / 2, h / 2);
  ctx.lineTo(w / 2 + Math.sin(aim.angle) * reach, h / 2 - Math.cos(aim.angle) * reach);
  ctx.stroke();
  ctx.restore();
}

/** Marks an incoming projectile as catchable. */
function ring(d: ThemeDraw, x: number, y: number, size: number, theme: Theme): void {
  const { ctx } = d;
  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 22 + 6 * Math.sqrt(size), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** A draining arc: how long before a held payload soaks in. */
function fuse(d: ThemeDraw, x: number, y: number, left: number, theme: Theme): void {
  const { ctx } = d;
  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x, y, 42, -Math.PI / 2, -Math.PI / 2 + Math.max(0, Math.min(1, left)) * Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
