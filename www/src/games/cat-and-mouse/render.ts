import { CM_BOARD_H, CM_CATCH_RADIUS } from '../../../../shared/protocol';
import { art } from '../../core/art/sprites';
import catUrl from './art/cat.svg?url&no-inline';
import mouseUrl from './art/mouse.svg?url&no-inline';
import mouseHollowUrl from './art/mouse-hollow.svg?url&no-inline';
import type { CatMouseGame, Drawable } from './game';
import { fit, toScreen, type Floor } from './layout';

/**
 * Cat and Mouse's canvas loop. Spec: docs/specs/games/cat-and-mouse.md §5, §7
 *
 * Like Sling Puck's loop this one also **drives** the game — it is the only thing
 * calling `advance()`, so your own icon moves at the frame rate and reports on the
 * server's tick. Everyone else is interpolated inside `game.view()`.
 *
 * ## What §7 requires, and how it is drawn
 *
 * The same floor is not drawn the same way for everyone, because a mouse and the
 * cat are looking at different problems:
 *
 * | You are | Your icon | Other mice | A mouse in grace |
 * | --- | --- | --- | --- |
 * | a mouse | filled | hollow | hollow + dashed |
 * | the cat | filled | filled | hollow + dashed |
 *
 * So **hollow means two different things** — "not yours" to a mouse, "untouchable"
 * to the cat. That is why grace gets a *second* cue on top of hollow: a dashed
 * ring. Never fill alone, for the same reason it is never colour alone.
 *
 * The cat is always filled, on every screen, and reads by **shape**: it is the one
 * icon that is not a mouse. So hollow always means "a mouse, and not one to worry
 * about".
 *
 * Accessibility (§12): no strobing. A catch is not a flash — the ring around a
 * mouse in grace rotates slowly, and `prefers-reduced-motion` makes it static
 * dashes instead. Nothing here blinks.
 *
 * ## What is a file and what is not
 *
 * The cat and the mouse are `art/*.svg`, per the split rule in
 * design/illustrations.md §4: an icon that is only ever *translated* is a sprite. The
 * rings are not, and cannot be — the grace ring turns on a clock and the own-icon ring
 * depends on who is looking, so both are state-driven and drawn here.
 *
 * Hollow is a **second file**, not a fill swapped at the draw site: by the time canvas
 * sees a sprite it is pixels, and pixels cannot be recoloured. That is the real cost of
 * the sprite, and the two files have to stay in step.
 *
 * The procedural cat and mouse below stay as the fallback. `at()` returns null while a
 * file loads and forever if it 404s, so a missing sprite degrades to the drawn version
 * instead of an empty floor (AGENTS.md §4) — and it makes the whole sprite step
 * revertible in one commit.
 */

const MAX_FPS = 60;

/*
 * Loaded at module scope, so the fetch starts when this chunk executes — before the
 * board mounts. Spans are in units of the icon radius: the box each file draws inside,
 * centred on the origin, so a blit needs no offset arithmetic. The cat's is wider
 * because its tail reaches 1.7R and its ears 1.32R up.
 */
const catArt = art(catUrl);
const mouseArt = art(mouseUrl);
const mouseHollowArt = art(mouseHollowUrl);
const CAT_SPAN = 4.5;
const MOUSE_SPAN = 3.2;

/** Also hardcoded in art/cat.svg, for the cat's eyes. The two must agree. */
const FLOOR = '#151622';
const FLOOR_EDGE = '#0c0d15';
const GRID = 'rgb(192 132 252 / 7%)';
const CAT = '#C084FC';
const MOUSE = '#f4f1e8';
const GRACE = '#8ab4ff';

/** Icon radius in board units. Bigger than CM_CATCH_RADIUS on purpose — see below. */
const ICON_R = CM_CATCH_RADIUS;

export type Renderer = { stop(): void; floor(): Floor };

export function startRenderer(
  canvas: HTMLCanvasElement,
  game: CatMouseGame,
  now: () => number,
  onMove: (p: { x: number; y: number }) => void,
): Renderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');

  let raf = 0;
  let last = 0;
  let floor = fit(canvas.clientWidth || 1, canvas.clientHeight || 1);
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
    ctx!.clearRect(0, 0, w, h);
    floor = fit(w, h);

    game.advance(onMove);

    drawFloor(ctx!, floor);

    const view = game.view();
    const iAmCat = game.iAmCat;
    const t = now();

    // The cat last, so it is never hidden under a mouse it is chasing. Which of
    // the two is on top matters: the cat is the thing you are watching.
    for (const a of view) if (!a.isCat) drawActor(ctx!, floor, a, iAmCat, t, ts, calm, dpr);
    for (const a of view) if (a.isCat) drawActor(ctx!, floor, a, iAmCat, t, ts, calm, dpr);
  }

  raf = requestAnimationFrame(frame);
  return { stop: () => cancelAnimationFrame(raf), floor: () => floor };
}

/**
 * The floor: a plain slab with a faint grid.
 *
 * The grid is not decoration. On an empty rectangle there is nothing to judge a
 * diagonal against, and this is a game about reading where someone is heading —
 * the lines give the eye a reference without competing with the icons.
 */
function drawFloor(ctx: CanvasRenderingContext2D, f: Floor): void {
  ctx.fillStyle = FLOOR;
  ctx.fillRect(f.left, f.top, f.w, f.h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(f.left, f.top, f.w, f.h);
  ctx.clip();
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  const step = f.scale / 6;
  ctx.beginPath();
  for (let i = 1; i < 6; i++) {
    const x = f.left + i * step;
    ctx.moveTo(x, f.top);
    ctx.lineTo(x, f.top + f.h);
  }
  for (let y = f.top + step; y < f.top + f.h; y += step) {
    ctx.moveTo(f.left, y);
    ctx.lineTo(f.left + f.w, y);
  }
  ctx.stroke();
  ctx.restore();

  // A drawn edge, so the floor's limits are visible rather than implied by where
  // icons stop. The clamp is real, so the boundary should be too.
  ctx.strokeStyle = FLOOR_EDGE;
  ctx.lineWidth = Math.max(2, f.scale * 0.012);
  ctx.strokeRect(f.left, f.top, f.w, f.h);
}

function drawActor(
  ctx: CanvasRenderingContext2D,
  f: Floor,
  a: Drawable,
  iAmCat: boolean,
  serverNow: number,
  ts: number,
  calm: boolean,
  dpr: number,
): void {
  const p = toScreen(f, a.x, a.y);
  const r = ICON_R * f.scale;
  const inGrace = a.graceUntil > serverNow;

  // §7's table, in one expression. The cat is never hollow on any screen.
  const filled = a.isCat || a.isMe || (iAmCat && !inGrace);

  const sheet = a.isCat ? catArt : filled ? mouseArt : mouseHollowArt;
  const span = (a.isCat ? CAT_SPAN : MOUSE_SPAN) * r;
  const sp = sheet.at(span, dpr);
  if (sp) ctx.drawImage(sp.source, p.x - sp.w / 2, p.y - sp.h / 2, sp.w, sp.h);
  else if (a.isCat) drawCat(ctx, p.x, p.y, r);
  else drawMouse(ctx, p.x, p.y, r, filled);

  // Grace: hollow plus a ring, because hollow alone already means "not yours" to
  // a mouse player. The ring rotates rather than blinking — §12 forbids strobing.
  if (inGrace) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (!calm) ctx.rotate((ts / 1400) % (Math.PI * 2));
    ctx.strokeStyle = GRACE;
    ctx.lineWidth = Math.max(1.5, r * 0.16);
    ctx.setLineDash([r * 0.5, r * 0.42]);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Your own icon gets a ring too — a different one, solid and tight. Finding
  // your own mouse in a scatter of five has to be instant, and fill alone does
  // not do it once the cat's screen fills everything (§7).
  if (a.isMe) {
    ctx.strokeStyle = a.isCat ? CAT : MOUSE;
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.95, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * A mouse: a body, a snout, a tail and one ear.
 *
 * **The fallback**, not the normal path: `art/mouse.svg` and `art/mouse-hollow.svg`
 * are ports of these exact numbers and are what actually draws. This stays so a
 * missing or slow file degrades to a playable floor rather than an empty one, and so
 * the sprite step is revertible.
 */
function drawMouse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  filled: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = Math.max(1.5, r * 0.22);
  ctx.strokeStyle = MOUSE;
  ctx.fillStyle = MOUSE;

  // Tail — the cheapest way to say "mouse" at 20 px.
  ctx.beginPath();
  ctx.moveTo(r * 0.75, r * 0.15);
  ctx.quadraticCurveTo(r * 1.5, r * 0.5, r * 1.15, r * 1.1);
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.stroke();

  ctx.lineWidth = Math.max(1.5, r * 0.22);
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.82, 0, 0, Math.PI * 2);
  if (filled) ctx.fill();
  else ctx.stroke();

  // Ear. Filled either way, so a hollow mouse still reads as a mouse and not as
  // a plain circle.
  ctx.beginPath();
  ctx.arc(-r * 0.45, -r * 0.6, r * 0.42, 0, Math.PI * 2);
  if (filled) ctx.fill();
  else ctx.stroke();

  ctx.restore();
}

/**
 * The cat: bigger, angular, two ears. Always filled, on every screen.
 *
 * Ears are the tell. At icon size a cat and a mouse are both a blob, so the
 * silhouette has to carry it — two triangles on top read as "cat" instantly and
 * survive being 18 px on a cheap screen.
 *
 * The fallback for `art/cat.svg`, same as `drawMouse` above.
 */
function drawCat(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = CAT;

  const R = r * 1.25;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * R * 0.32, -R * 0.62);
    ctx.lineTo(s * R * 0.92, -R * 1.32);
    ctx.lineTo(s * R * 0.95, -R * 0.34);
    ctx.closePath();
    ctx.fill();
  }

  ctx.beginPath();
  ctx.ellipse(0, 0, R, R * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail, thick and hooked — the other half of the silhouette.
  ctx.strokeStyle = CAT;
  ctx.lineWidth = Math.max(1.5, R * 0.2);
  ctx.beginPath();
  ctx.moveTo(R * 0.85, R * 0.3);
  ctx.quadraticCurveTo(R * 1.7, R * 0.6, R * 1.35, -R * 0.45);
  ctx.stroke();

  // Eyes, in the floor's colour, so the cat is looking at you rather than being
  // a purple lozenge. Two dots is all it takes at this size.
  ctx.fillStyle = FLOOR;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s * R * 0.34, -R * 0.12, R * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Board height, re-exported so the board component does not import the protocol. */
export const FLOOR_H = CM_BOARD_H;
