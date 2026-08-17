import { SPLASH_MS, type SpillGame, type View } from './game';
import { SPILL_HOLD_MS } from '../../../../shared/protocol';
import type { Theme, ThemeDraw } from './themes';
import { bounceLeaving } from '../../../../shared/spillGeometry';

/**
 * The canvas loop. Spec: docs/specs/games/spill.md §6
 *
 * This file owns *when* and *where* things are drawn; the theme owns what they
 * look like. Nothing here knows about water. That separation is a hard
 * requirement, not a preference, so resist the urge to reach for a colour or a
 * shape in this file.
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
  /** The current aim, while a finger is down. `window` is the half-width in radians. */
  aim: () => { angle: number; hit: number | null; window: number; bounces: boolean } | null,
): Renderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');

  let theme = initial;
  let raf = 0;
  let last = 0;
  const started = performance.now();
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize(): { w: number; h: number; dpr: number } {
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
    // dpr rides along because a theme drawing a sprite needs it: draw coordinates
    // are CSS pixels, and the sprite loader rasterises in device pixels.
    return { w, h, dpr };
  }

  function frame(ts: number): void {
    raf = requestAnimationFrame(frame);
    if (ts - last < 1000 / MAX_FPS) return;
    last = ts;

    const { w, h, dpr } = resize();
    const d: ThemeDraw = { ctx: ctx!, w, h, t: (ts - started) / 1000, calm, dpr };
    const view = game.view(w, h);

    theme.drawBackdrop(d);
    theme.drawPool(d, view.level, tiltOf(view));
    drawAim(d, aim(), theme);

    for (const v of view.visible) {
      theme.drawProjectile(d, v.x, v.y, v.drop.size);
      // The ring means "you can grab this". A returning miss is ours and is not
      // catchable, so it must not wear one — offering a grab that the server will
      // refuse is worse than offering nothing.
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

/**
 * The line you are about to throw along, drawn in the theme's accent.
 *
 * With two players it draws the **bounces**, not a straight ray. That is not
 * decoration: the side edges are what a two-player flick aims off, and a preview
 * that ignored them would be showing the player something that will not happen.
 *
 * Behind the line sits the **window** — how far off this throw may be and still land
 * (spec §2). It narrows as the drag gets faster, and seeing it close is how a player
 * discovers that hurrying costs accuracy without anyone having to write it down.
 */
function drawAim(
  d: ThemeDraw,
  aim: { angle: number; hit: number | null; window: number; bounces: boolean } | null,
  theme: Theme,
): void {
  if (!aim) return;
  const { ctx, w, h } = d;

  wedge(d, aim.angle, aim.window, theme);

  ctx.save();
  ctx.globalAlpha = aim.hit === null ? 0.3 : 0.9;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 4;
  // Dashed when the flick would miss the table entirely — the only warning a
  // player gets that they are about to throw their water on the floor.
  ctx.setLineDash(aim.hit === null ? [8, 10] : []);
  ctx.beginPath();

  if (aim.bounces) {
    // Sampled rather than solved for the reflection points: the path is cheap to
    // evaluate and enough samples make the corners crisp anyway.
    for (let i = 0; i <= AIM_SAMPLES; i++) {
      const at = bounceLeaving(aim.angle, i / AIM_SAMPLES);
      const x = at.x * w;
      const y = at.y * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  } else {
    const reach = Math.hypot(w, h) / 2;
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 + Math.sin(aim.angle) * reach, h / 2 - Math.cos(aim.angle) * reach);
  }

  ctx.stroke();
  ctx.restore();
}

/** Enough to keep the bounce corners from visibly cutting. */
const AIM_SAMPLES = 48;

/**
 * How much room this throw has to be wrong in, as a faint fan behind the aim line.
 *
 * Drawn as a straight wedge even with two players, where the throw itself bounces:
 * the window is an angular tolerance measured at the moment of release, not a
 * corridor the water travels down, and folding it through the side walls would draw
 * a shape that means something the rule does not.
 */
function wedge(d: ThemeDraw, angle: number, half: number, theme: Theme): void {
  if (half <= 0) return;
  const { ctx, w, h } = d;
  const reach = Math.hypot(w, h) / 2;
  // Canvas angles run anticlockwise from the +x axis; ours run clockwise from up.
  const toCanvas = (a: number): number => a - Math.PI / 2;

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.moveTo(w / 2, h / 2);
  ctx.arc(w / 2, h / 2, reach, toCanvas(angle - half), toCanvas(angle + half));
  ctx.closePath();
  ctx.fill();
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
