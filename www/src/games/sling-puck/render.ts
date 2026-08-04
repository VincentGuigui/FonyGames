import {
  GAP_LEFT,
  GAP_RIGHT,
  MAX_PULL,
  POST_LEFT,
  POST_RIGHT,
  PUCK_RADIUS,
  inSling,
} from './physics';
import { ARRIVE_MS, type SlingGame } from './game';
import { fit, toScreen, type Board } from './layout';

/**
 * Sling Puck's canvas loop. Spec: docs/specs/games/sling-puck.md §8, §13
 *
 * Unlike Spill and Goat Siege this loop also **drives** the game: it is the only
 * thing calling `advance()`, so the simulation runs at the frame rate and stops
 * when the tab does. That is deliberate — a frozen half is the player's own
 * problem and nobody else's (spec §9).
 *
 * Accessibility constraints from §13, enforced here:
 *
 * - the gap reads by **shape** — a break in a drawn wall — not by colour;
 * - a bounce is never a flash;
 * - `prefers-reduced-motion` drops the band's wobble and the arrival flourish,
 *   and keeps the puck motion, which *is* the game.
 */

const MAX_FPS = 60;

const FELT = '#131a26';
const FELT_EDGE = '#0c1017';
const WALL = '#8a6a44';
const WALL_LIP = '#5d472d';
const BAND = '#FB7185';
const PUCK = '#f4f1e8';
const PUCK_EDGE = '#b9b2a0';
const AIM = 'rgb(251 113 133 / 45%)';

export type Renderer = { stop(): void; board(): Board };

export function startRenderer(
  canvas: HTMLCanvasElement,
  game: SlingGame,
  now: () => number,
  onCross: (c: { x: number; vx: number; vy: number }) => void,
): Renderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');

  let raf = 0;
  let last = 0;
  let board = fit(canvas.clientWidth || 1, canvas.clientHeight || 1);
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frame(ts: number): void {
    raf = requestAnimationFrame(frame);
    if (ts - last < 1000 / MAX_FPS) return;
    // First frame has no previous timestamp, and a backgrounded tab returns with
    // a huge one. Either would teleport every puck, so the step is capped at
    // three frames' worth — pucks resume from where they were, as spec §9 says.
    const dt = last === 0 ? 1 / 60 : Math.min((ts - last) / 1000, 0.05);
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
    board = fit(w, h);

    for (const c of game.advance(dt)) onCross(c);

    const view = game.view();
    // A puck can be carried anywhere on the board, but the band only follows one
    // that has reached it. Above the band line there is nothing loaded, so it is
    // drawn slack and no aim is shown — which is also the honest picture: a
    // release up there puts the puck down instead of firing it.
    const loaded = view.drag && inSling(view.drag.y) ? view.drag : null;
    drawTable(ctx!, board);
    drawBand(ctx!, board, loaded, calm ? 0 : ts / 1000);

    for (const p of view.pucks) {
      const arrived = view.arrivals.find((a) => a.id === p.id);
      const glow = !calm && arrived ? 1 - (now() - arrived.at) / ARRIVE_MS : 0;
      // A held puck is drawn where the finger is, not where the simulation left
      // it — it was taken out of the simulation the moment it was grabbed.
      const held = view.drag?.puckId === p.id ? view.drag : null;
      drawPuck(ctx!, board, held ?? p, Math.max(0, glow));
    }

    if (loaded) drawAim(ctx!, board, loaded);
  }

  raf = requestAnimationFrame(frame);
  return { stop: () => cancelAnimationFrame(raf), board: () => board };
}

/**
 * The felt, and the wall around it with a **break** where the gap is.
 *
 * The break is the single most important thing on the screen to read at a
 * glance, so the wall either side of it is drawn thick and solid and the gap is
 * simply absent — no highlight, no colour cue, nothing that a colour-blind
 * player or a bright table would take away (spec §13).
 */
function drawTable(ctx: CanvasRenderingContext2D, b: Board): void {
  const felt = ctx.createLinearGradient(b.left, b.top, b.left, b.top + b.h);
  felt.addColorStop(0, FELT_EDGE);
  felt.addColorStop(0.45, FELT);
  felt.addColorStop(1, FELT_EDGE);
  ctx.fillStyle = felt;
  ctx.fillRect(b.left, b.top, b.w, b.h);

  // Every wall is drawn in the margin *outside* the play area: its inner face
  // lands exactly where the physics stops a puck (see layout.ts).
  const lip = b.lip;
  const mid = lip / 2;
  ctx.lineWidth = lip;
  ctx.lineCap = 'butt';

  // Left, right and bottom walls: one continuous path.
  ctx.strokeStyle = WALL;
  ctx.beginPath();
  ctx.moveTo(b.left - mid, b.top - lip);
  ctx.lineTo(b.left - mid, b.top + b.h + mid);
  ctx.lineTo(b.left + b.w + mid, b.top + b.h + mid);
  ctx.lineTo(b.left + b.w + mid, b.top - lip);
  ctx.stroke();

  // Top wall in two pieces, with the gap between them.
  const y = b.top - mid;
  ctx.beginPath();
  ctx.moveTo(b.left - lip, y);
  ctx.lineTo(b.left + GAP_LEFT * b.scale, y);
  ctx.moveTo(b.left + GAP_RIGHT * b.scale, y);
  ctx.lineTo(b.left + b.w + lip, y);
  ctx.stroke();

  // Short returns into the board at each side of the break, so the opening reads
  // as a doorway with jambs rather than as a gap in a line.
  ctx.strokeStyle = WALL_LIP;
  ctx.lineWidth = Math.max(3, lip * 0.6);
  for (const gx of [GAP_LEFT, GAP_RIGHT]) {
    const x = b.left + gx * b.scale;
    ctx.beginPath();
    ctx.moveTo(x, b.top - lip);
    ctx.lineTo(x, b.top + b.scale * 0.045);
    ctx.stroke();
  }
}

/** The band: a straight line at rest, a V from post to puck to post when loaded. */
function drawBand(
  ctx: CanvasRenderingContext2D,
  b: Board,
  drag: { x: number; y: number } | null,
  t: number,
): void {
  const l = toScreen(b, POST_LEFT.x, POST_LEFT.y);
  const r = toScreen(b, POST_RIGHT.x, POST_RIGHT.y);

  ctx.strokeStyle = BAND;
  ctx.lineWidth = Math.max(2.5, b.scale * 0.012);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(l.x, l.y);
  if (drag) {
    const v = toScreen(b, drag.x, drag.y);
    ctx.lineTo(v.x, v.y);
    ctx.lineTo(r.x, r.y);
  } else {
    // A slack band breathes very slightly, so it reads as elastic rather than as
    // a drawn line. Dropped entirely under prefers-reduced-motion (t = 0).
    const sag = t === 0 ? 0 : Math.sin(t * 2.2) * b.scale * 0.006;
    ctx.quadraticCurveTo((l.x + r.x) / 2, l.y + sag, r.x, r.y);
  }
  ctx.stroke();

  // The posts.
  ctx.fillStyle = WALL;
  for (const p of [l, r]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3.5, b.scale * 0.018), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPuck(
  ctx: CanvasRenderingContext2D,
  b: Board,
  p: { x: number; y: number },
  glow: number,
): void {
  const s = toScreen(b, p.x, p.y);
  const r = PUCK_RADIUS * b.scale;

  if (glow > 0) {
    ctx.strokeStyle = `rgb(251 113 133 / ${Math.round(glow * 70)}%)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 4 + (1 - glow) * 10, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = PUCK;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();

  // A rim and an inner ring: a puck has a machined edge, and the ring makes
  // spin-free sliding legible against the felt.
  ctx.strokeStyle = PUCK_EDGE;
  ctx.lineWidth = Math.max(1.5, r * 0.14);
  ctx.beginPath();
  ctx.arc(s.x, s.y, r * 0.92, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  ctx.arc(s.x, s.y, r * 0.45, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * A faint line up-board from the held puck, showing where the band will send it.
 *
 * Not a full trajectory: bounces are the skill, and drawing them would hand the
 * whole game away. This shows only the launch direction, which the V already
 * implies — it just makes it readable under a thumb.
 */
function drawAim(
  ctx: CanvasRenderingContext2D,
  b: Board,
  drag: { x: number; y: number },
): void {
  const from = toScreen(b, drag.x, drag.y);
  // Same geometry as slingVelocity: the V's two segments, summed.
  const l1 = Math.hypot(POST_LEFT.x - drag.x, POST_LEFT.y - drag.y);
  const l2 = Math.hypot(POST_RIGHT.x - drag.x, POST_RIGHT.y - drag.y);
  if (l1 === 0 || l2 === 0) return;
  let dx = (POST_LEFT.x - drag.x) / l1 + (POST_RIGHT.x - drag.x) / l2;
  let dy = (POST_LEFT.y - drag.y) / l1 + (POST_RIGHT.y - drag.y) / l2;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  dx /= len;
  dy /= len;

  // Length scales with the pull, so the line reads as power as well as aim.
  const pull = Math.min(1, (drag.y - POST_LEFT.y) / MAX_PULL);
  const reach = b.scale * (0.1 + pull * 0.45);

  ctx.strokeStyle = AIM;
  ctx.lineWidth = Math.max(2, b.scale * 0.008);
  ctx.setLineDash([b.scale * 0.03, b.scale * 0.025]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(from.x + dx * reach, from.y + dy * reach);
  ctx.stroke();
  ctx.setLineDash([]);
}
