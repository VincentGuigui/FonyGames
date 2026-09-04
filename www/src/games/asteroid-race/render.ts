import { art } from '../../core/art/sprites';
import shipArt from './art/ship.svg?url&no-inline';
import { ASTEROID_CORRIDOR_R, ASTEROID_R_SMALL, type Rock } from './field';
import {
  ASTEROID_DRAW_Z,
  ASTEROID_HORIZON,
  ASTEROID_MISSILE_R,
  ASTEROID_RETICLE_LEAD_Z,
  ASTEROID_TRACER_MS,
  ASTEROID_WARN_Z,
  fogAlpha,
  project,
  type AsteroidRun,
} from './game';

/**
 * Asteroid Race's drawing. Spec: docs/specs/games/asteroid-race.md §4, §13
 *
 * Plain `<canvas>`, no library — Neon Fall §13 measured the alternative on
 * this project and Tiles Surfer §4 reuses that rejection.
 *
 * **Rocks are drawn, not sprited**, which is the one place this game departs
 * from `docs/design/illustrations.md` §4 and does so deliberately: a rock's
 * silhouette comes from its own seed so every phone draws the same one, it is
 * scaled continuously by distance, it is faded toward the background by the
 * fog, and it splits into two smaller shapes. A sprite may only be translated,
 * scaled and rotated; the fade and the split are neither. The **ship** is a
 * sprite, because it never changes shape.
 */

const shipSprite = art(shipArt);

const BG = '#05070D';
/** Large rocks dark, small rocks light — the issue's own two greys. Size is
 *  what actually says "this one splits" (§4); these are texture. */
const ROCK_LARGE = '#4B5563';
const ROCK_SMALL = '#9CA3AF';
const RIM = '#E2E8F0';
const TUBE = '#334155';
const RETICLE = '#A3E635';
const DANGER = '#EF4444';

/** How often a guide ring is drawn down the tube, in units. They are the depth
 *  cue the issue asks for — a ring sweeping past says "this is how fast you are
 *  going" in a way nothing static can. */
const RING_EVERY = 25;

/** One rock's own outline, as radius multipliers around the circle. Derived
 *  from its seed, so the same rock is the same shape on every phone, and
 *  cached because a silhouette never changes once generated. */
const shapes = new Map<number, number[]>();
function silhouette(seed: number): number[] {
  const cached = shapes.get(seed);
  if (cached) return cached;
  const pts: number[] = [];
  let h = seed >>> 0;
  for (let i = 0; i < 9; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    pts.push(0.76 + (h / 4294967296) * 0.48);
  }
  shapes.set(seed, pts);
  return pts;
}

type Star = { angle: number; radius: number; z: number };

/** The starfield: points well outside the tube, streaming past. Purely
 *  decorative, and recycled rather than regenerated. */
export function makeStars(count = 140): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      angle: Math.random() * Math.PI * 2,
      radius: ASTEROID_CORRIDOR_R * (1.4 + Math.random() * 2.6),
      z: Math.random() * ASTEROID_DRAW_Z,
    });
  }
  return stars;
}

export type View = { width: number; height: number; dpr: number };

/** World point -> pixels. `ox`/`oy` are board WIDTHS from the vanishing point,
 *  both axes scaled by width so the projection keeps its aspect on any phone. */
function toPixel(p: { ox: number; oy: number }, view: View): { x: number; y: number } {
  return { x: view.width / 2 + p.ox * view.width, y: view.height * ASTEROID_HORIZON + p.oy * view.width };
}

export function draw(ctx: CanvasRenderingContext2D, run: AsteroidRun, stars: Star[], view: View): void {
  const { width, height } = view;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  drawStars(ctx, run, stars, view);
  drawTube(ctx, run, view);

  // Far to near, so a near rock paints over a far one.
  const rocks = run.rocksNear(run.distance - 10, run.distance + ASTEROID_DRAW_Z);
  rocks.sort((a, b) => b.z - a.z);
  for (const rock of rocks) drawRock(ctx, rock, run, view);

  drawReticle(ctx, run, view);
  drawTracer(ctx, run, view);
  drawShip(ctx, run, view);
}

function drawStars(ctx: CanvasRenderingContext2D, run: AsteroidRun, stars: Star[], view: View): void {
  ctx.save();
  ctx.fillStyle = '#CBD5E1';
  for (const star of stars) {
    // Recycled by wrapping its own z against the draw distance, so the field
    // never runs out and never has to be regenerated.
    const z = run.distance + ((star.z - run.distance) % ASTEROID_DRAW_Z + ASTEROID_DRAW_Z) % ASTEROID_DRAW_Z;
    const p = project({ x: Math.cos(star.angle) * star.radius, y: Math.sin(star.angle) * star.radius, z }, run);
    if (!p) continue;
    const px = toPixel(p, view);
    if (px.x < -10 || px.x > view.width + 10 || px.y < -10 || px.y > view.height + 10) continue;
    ctx.globalAlpha = 0.15 + fogAlpha(z - run.distance) * 0.55;
    ctx.fillRect(px.x, px.y, 1.5, 1.5);
  }
  ctx.restore();
}

/** The corridor itself: rings receding down the tube. Faint on purpose — the
 *  same call Neon Fall §2.1 makes for its lane guides, visible but clearly
 *  secondary to the rocks. */
function drawTube(ctx: CanvasRenderingContext2D, run: AsteroidRun, view: View): void {
  ctx.save();
  ctx.strokeStyle = TUBE;
  ctx.lineWidth = 1;
  const first = Math.ceil(run.distance / RING_EVERY) * RING_EVERY;
  for (let z = first; z < run.distance + ASTEROID_DRAW_Z; z += RING_EVERY) {
    const centre = project({ x: 0, y: 0, z }, run);
    if (!centre) continue;
    const px = toPixel(centre, view);
    const r = ASTEROID_CORRIDOR_R * centre.scale * view.width;
    if (r < 2) continue;
    ctx.globalAlpha = fogAlpha(z - run.distance) * 0.35;
    ctx.beginPath();
    ctx.arc(px.x, px.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRock(ctx: CanvasRenderingContext2D, rock: Rock, run: AsteroidRun, view: View): void {
  const p = project(rock, run);
  if (!p) return;
  const dz = rock.z - run.distance;
  const alpha = fogAlpha(dz);
  if (alpha <= 0) return;
  const px = toPixel(p, view);
  const r = rock.r * p.scale * view.width;
  if (r < 0.6) return;

  const shape = silhouette(rock.seed);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (let i = 0; i < shape.length; i++) {
    const angle = (i / shape.length) * Math.PI * 2;
    const rr = r * (shape[i] ?? 1);
    const x = px.x + Math.cos(angle) * rr;
    const y = px.y + Math.sin(angle) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = rock.size === 'large' ? ROCK_LARGE : ROCK_SMALL;
  ctx.fill();
  // A rim on the near edge, so a rock reads as a lump rather than a hole —
  // worth two lines once the fill is already this dark.
  if (r > 6) {
    ctx.globalAlpha = alpha * 0.5;
    ctx.strokeStyle = RIM;
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The crosshair, and what it is locked on. The lock matters: the beam takes the
 * nearest rock it passes through, so at a gate a player aiming off-centre would
 * spend their missile on the ring and leave the gate shut (§2.3). Showing the
 * target is what makes that a decision rather than a surprise.
 */
function drawReticle(ctx: CanvasRenderingContext2D, run: AsteroidRun, view: View): void {
  const lead = project({ x: run.x, y: run.y, z: run.distance + ASTEROID_RETICLE_LEAD_Z }, run);
  if (!lead) return;
  const px = toPixel(lead, view);
  const r = (ASTEROID_R_SMALL + ASTEROID_MISSILE_R) * lead.scale * view.width;

  ctx.save();
  ctx.strokeStyle = RETICLE;
  ctx.globalAlpha = run.missileCharge >= 1 ? 0.75 : 0.25;
  ctx.lineWidth = 1.5;
  // Four ticks rather than a full ring: a closed circle out here reads as an
  // object in the tube, which is the one thing it must not look like.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(px.x + Math.cos(a) * r, px.y + Math.sin(a) * r);
    ctx.lineTo(px.x + Math.cos(a) * r * 1.45, px.y + Math.sin(a) * r * 1.45);
    ctx.stroke();
  }

  const locked = run.missileCharge >= 1 ? run.lockedTarget() : null;
  if (locked) {
    const lp = project(locked, run);
    if (lp) {
      const lpx = toPixel(lp, view);
      const lr = locked.r * lp.scale * view.width * 1.5;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
      // A bracket, and thicker for a large rock — the one that splits.
      if (locked.size === 'large') ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.arc(lpx.x, lpx.y, Math.max(4, lr), a0 - 0.28, a0 + 0.28);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function drawTracer(ctx: CanvasRenderingContext2D, run: AsteroidRun, view: View): void {
  const age = run.tracerAgeMs;
  const shot = run.lastShotAt;
  if (age === null || !shot) return;
  const from = project({ x: run.x, y: run.y, z: run.distance + 4 }, run);
  const to = project(shot, run);
  if (!from || !to) return;
  ctx.save();
  ctx.globalAlpha = 1 - age / ASTEROID_TRACER_MS;
  ctx.strokeStyle = RETICLE;
  ctx.lineWidth = 2;
  const a = toPixel(from, view);
  const b = toPixel(to, view);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

/**
 * The ship, and the red halo around it (§4). The halo grows and pulses as well
 * as reddening: proximity has to be legible without relying on the colour
 * (ui-guidelines §2), and a pulse also reads at a glance mid-flight.
 */
function drawShip(ctx: CanvasRenderingContext2D, run: AsteroidRun, view: View): void {
  const p = project({ x: run.x, y: run.y, z: run.distance }, run);
  if (!p) return;
  const px = toPixel(p, view);
  const w = 2 * 0.8 * p.scale * view.width * 1.35;

  const threat = run.nearestThreat();
  if (threat) {
    const closeness = 1 - Math.min(1, threat.dz / ASTEROID_WARN_Z);
    const pulse = 0.55 + 0.45 * Math.sin((run.elapsedMs / 1000) * Math.PI * 2 * (2 + closeness * 4));
    ctx.save();
    ctx.globalAlpha = Math.min(0.85, 0.25 + closeness * 0.6) * pulse;
    ctx.strokeStyle = DANGER;
    ctx.lineWidth = 2 + closeness * 6;
    ctx.beginPath();
    ctx.arc(px.x, px.y, w * (0.7 + closeness * 0.25), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Blinking while stunned (§2) — the second you are not flying.
  let alpha = 1;
  if (run.stunned) alpha = 0.25 + 0.75 * (Math.sin((run.elapsedMs / 1000) * Math.PI * 2 * 6) > 0 ? 1 : 0);

  const sprite = shipSprite.at(w, view.dpr);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (sprite) {
    ctx.drawImage(sprite.source, px.x - sprite.w / 2, px.y - sprite.h / 2, sprite.w, sprite.h);
  } else {
    ctx.fillStyle = RETICLE;
    ctx.beginPath();
    ctx.moveTo(px.x, px.y - w * 0.4);
    ctx.lineTo(px.x + w * 0.45, px.y + w * 0.35);
    ctx.lineTo(px.x - w * 0.45, px.y + w * 0.35);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // The engine flare, brighter under boost — the one thing that says the boost
  // is actually doing something, since the speed itself is hard to read.
  if (run.boosting) {
    ctx.save();
    const flare = ctx.createRadialGradient(px.x, px.y + w * 0.45, 0, px.x, px.y + w * 0.45, w * 0.6);
    flare.addColorStop(0, 'rgba(253, 224, 71, 0.85)');
    flare.addColorStop(1, 'rgba(249, 115, 22, 0)');
    ctx.fillStyle = flare;
    ctx.beginPath();
    ctx.arc(px.x, px.y + w * 0.45, w * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Where a world point lands, as board fractions — for the room's own GIF
 *  overlay, which is DOM rather than canvas (the same split Gravity Shooter's
 *  bursts use). Null when it is not on screen at all. */
export function screenFraction(p: { x: number; y: number; z: number }, run: AsteroidRun, view: View): { x: number; y: number } | null {
  const proj = project(p, run);
  if (!proj) return null;
  const px = toPixel(proj, view);
  return { x: px.x / view.width, y: px.y / view.height };
}

/** How wide the ship is drawn, in board fractions — the impact GIF is sized
 *  against it so a hit reads as hitting the ship rather than the screen. */
export function shipWidthFraction(run: AsteroidRun): number {
  const p = project({ x: run.x, y: run.y, z: run.distance }, run);
  return p ? 2 * 0.8 * p.scale * 1.35 : 0.25;
}
