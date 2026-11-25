import { TENT_ARMS, TENT_SQUAT_MS, TENT_SUMMIT_M, TENT_HANG_MS } from '../../../../shared/protocol';
import { REACH, START_BODY, bandPegs, startPegs, type Peg, type Point } from '../../../../shared/tentacules';
import { art, type SpriteSheet } from '../../core/art/sprites';
import { ART_REFERENCE_HUE, hexHue, rotatedPixel } from '../../core/art/tint';
import happyArt from './art/octopus-happy.svg?url&no-inline';
import worriedArt from './art/octopus-worried.svg?url&no-inline';
import strainArt from './art/octopus-strain.svg?url&no-inline';
import joyArt from './art/octopus-joy.svg?url&no-inline';
import dizzyArt from './art/octopus-dizzy.svg?url&no-inline';
import coralArt from './art/coral.svg?url&no-inline';
import weedArt from './art/weed.svg?url&no-inline';

/**
 * Tentacules' canvas. Spec: docs/specs/games/tentacules.md §4
 *
 * The wall is 1 unit wide and fills the canvas width; the camera keeps the body
 * at mid-screen once it gets there, so the wall scrolls instead. Everything is
 * drawn from the frame passed in — no state of its own beyond the peg cache.
 */

export type Face = 'happy' | 'worried' | 'strain' | 'joy' | 'dizzy';
const FACES: Record<Face, SpriteSheet> = {
  happy: art(happyArt),
  worried: art(worriedArt),
  strain: art(strainArt),
  joy: art(joyArt),
  dizzy: art(dizzyArt),
};
const DECOR = [art(coralArt), art(weedArt)];

/** The head is this wide, in wall units; the tentacles leave it at 80 % of its height. */
export const HEAD = 0.2;
const PEG_R = 0.022;
/** Every player's own octopus is this coral-rose, a step from the game's accent;
 *  rivals keep their avatar colour as shadows. The head sprite is carried to it
 *  by hue; the tentacles are the head's own pink taken the same way, a little lighter. */
export const OCTO_COLOR = '#FF7F90';

/** The tentacle colour that goes with a head tinted `tint` (the sprite is painted in `ART_REFERENCE_HUE`). */
function skinOf(tint: string): string {
  const [r, g, b] = rotatedPixel(240, 128, 240, hexHue(tint) - ART_REFERENCE_HUE);
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}
/** A dragged tentacle over a peg it can take. */
const GRAB_OK = '#4ADE80';

/* ── Pegs, built once per band ───────────────────────────────────────────── */

const bands = new Map<string, Peg[]>();
export function band(seed: number, b: number): Peg[] {
  const key = `${seed}:${b}`;
  let pegs = bands.get(key);
  if (!pegs) {
    if (bands.size > 400) bands.clear();
    pegs = bandPegs(seed, b);
    bands.set(key, pegs);
  }
  return pegs;
}

/** Every peg between two heights, the player's own starting pegs included. */
export function pegsNear(seed: number, low: number, high: number): Peg[] {
  const out: Peg[] = [];
  for (let b = Math.max(0, Math.floor(low)); b <= Math.floor(high); b++) for (const p of band(seed, b)) if (p.y >= low && p.y <= high) out.push(p);
  if (low < 1) out.push(...startPegs());
  return out;
}

export function pegOf(seed: number, id: number): Peg | null {
  if (id < 0) return startPegs().find((p) => p.id === id) ?? null;
  return band(seed, Math.floor((id - 1) / 100)).find((p) => p.id === id) ?? null;
}

/* ── The frame ───────────────────────────────────────────────────────────── */

export type Shadow = { id: string; name: string; avatar: string; tint: string; holds: (Peg | null)[]; body: Point | null; height: number };
export type Rival = { tint: string; since: number };

export type Frame = {
  seed: number;
  w: number;
  h: number;
  dpr: number;
  /** World y at the bottom of the screen. */
  camY: number;
  now: number;
  summit: boolean;
  reduced: boolean;
  me: {
    tint: string;
    body: Point;
    holds: (Peg | null)[];
    /** Where each free tentacle's tip is drawn; filled in by `draw`. */
    tips: Point[];
    face: Face;
    armed: boolean;
    oneSince: number | null;
    drag: { arm: number; at: Point } | null;
    /** The dragged tentacle would grab the peg under it if let go now. */
    dragOk: boolean;
    pull: Point | null;
    /** How the body is moving, for the wobble: velocity, head lean (radians) and jelly squash (1 = none). */
    vel: Point;
    tilt: number;
    squash: number;
  };
  shadows: Shadow[];
  /** Pegs held by other players: their colour, and since when. */
  rivals: Map<number, Rival>;
};

function sx(f: Frame, x: number): number {
  return x * f.w;
}
function sy(f: Frame, y: number): number {
  return f.h - (y - f.camY) * f.w;
}

/** The point a tentacle leaves the head from, round its base. */
function root(body: Point, arm: number): Point {
  const a = Math.PI / 2 + (arm * 2 * Math.PI) / TENT_ARMS;
  return { x: body.x + Math.cos(a) * HEAD * 0.18, y: body.y + Math.sin(a) * HEAD * 0.12 };
}

/** Where a free tentacle hangs: out from its root, drooping, swaying a little and trailing the body's motion. */
export function dangle(body: Point, arm: number, now: number, reduced: boolean, vel: Point = { x: 0, y: 0 }): Point {
  const a = Math.PI / 2 + (arm * 2 * Math.PI) / TENT_ARMS;
  const sway = reduced ? 0 : Math.sin(now / 420 + arm * 1.7) * 0.02;
  const lag = reduced ? 0 : 0.05;
  return { x: body.x + Math.cos(a) * 0.13 + sway - vel.x * lag, y: body.y + Math.sin(a) * 0.08 - 0.07 - vel.y * lag };
}

/** How much a tentacle's curve trails the body's velocity, in wall units per unit of speed. */
const TRAIL = 0.06;

function tentacle(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  from: Point,
  to: Point,
  color: string,
  alpha: number,
  suckers: boolean,
  curl: boolean,
  trail: Point = { x: 0, y: 0 },
): void {
  const ax = sx(f, from.x);
  const ay = sy(f, from.y);
  const bx = sx(f, to.x);
  const by = sy(f, to.y);
  const len = Math.hypot(bx - ax, by - ay);
  // A soft droop: the control point sags below the straight line.
  const cx = (ax + bx) / 2 + (by - ay) * 0.12 - trail.x * TRAIL * f.w;
  const cy = (ay + by) / 2 + len * 0.22 + trail.y * TRAIL * f.w;
  const steps = 14;
  const base = f.w * 0.036;
  const tip = f.w * 0.011;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  let px = ax;
  let py = ay;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx;
    const y = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by;
    ctx.lineWidth = base + (tip - base) * t;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (suckers && i % 2 === 0 && i < steps) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(x, y + ctx.lineWidth * 0.2, Math.max(1, ctx.lineWidth * 0.18), 0, Math.PI * 2);
      ctx.fill();
    }
    px = x;
    py = y;
  }
  if (curl) {
    // The end wraps the peg and its tip points away from the octopus.
    const dx = bx - ax;
    const dy = by - ay;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const side = ux >= 0 ? 1 : -1;
    const px = -uy * side;
    const py = ux * side;
    const r = PEG_R * f.w * 1.5;
    ctx.lineWidth = tip * 1.5;
    ctx.beginPath();
    ctx.moveTo(bx - ux * r * 0.4, by - uy * r * 0.4);
    ctx.bezierCurveTo(bx + px * r * 1.6 - ux * r * 0.6, by + py * r * 1.6 - uy * r * 0.6, bx + px * r * 1.5 + ux * r * 1.8, by + py * r * 1.5 + uy * r * 1.8, bx + ux * r * 2.1, by + uy * r * 2.1);
    ctx.stroke();
  }
  ctx.restore();
}

/** The head, leaning and squashing about the point the tentacles leave it from. */
function head(ctx: CanvasRenderingContext2D, f: Frame, body: Point, face: Face, tint: string, alpha: number, tilt = 0, squash = 1): void {
  const size = HEAD * f.w;
  const sprite = FACES[face].at(size, f.dpr, tint);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx(f, body.x), sy(f, body.y));
  ctx.rotate(tilt);
  ctx.scale(1 / squash, squash);
  if (sprite) ctx.drawImage(sprite.source, -size / 2, -size * 0.8, size, size);
  else {
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.arc(0, -size * 0.3, size * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 1, 0xc2b2ae35);
  h ^= h >>> 13;
  return (Math.imul(h, 0x27d4eb2d) >>> 0) / 4294967296;
}

export function draw(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { w, h } = f;
  const top = f.camY + h / w;
  // Water, darker as it gets deeper — here, higher up the wall.
  const deep = Math.min(1, f.camY / 40);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgb(${18 - deep * 8}, ${46 - deep * 20}, ${78 - deep * 30})`);
  g.addColorStop(1, `rgb(${24 - deep * 8}, ${70 - deep * 25}, ${96 - deep * 30})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Decor: one coral or weed per band, at a place the seed chooses.
  for (let b = Math.floor(f.camY) - 1; b <= Math.ceil(top); b++) {
    if (b < 0) continue;
    const pick = DECOR[Math.floor(hash(f.seed, b) * DECOR.length)] as SpriteSheet;
    const size = (0.22 + hash(f.seed, b + 1000) * 0.15) * w;
    const sprite = pick.at(size, f.dpr);
    if (!sprite) continue;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.drawImage(sprite.source, hash(f.seed, b + 2000) * (w - size), sy(f, b + 0.5) - size / 2, size, size);
    ctx.restore();
  }

  // Height marks every 5 m, and the Summit line.
  ctx.font = `${Math.round(w * 0.035)}px system-ui, sans-serif`;
  for (let m = 5; m <= top + 5; m += 5) {
    const y = sy(f, START_BODY.y + m);
    if (y < -20 || y > h + 20) continue;
    const line = f.summit && m === TENT_SUMMIT_M;
    ctx.strokeStyle = line ? '#FFD84D' : 'rgba(255,255,255,0.12)';
    ctx.lineWidth = line ? 4 : 1;
    ctx.setLineDash(line ? [12, 8] : [4, 8]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = line ? '#FFD84D' : 'rgba(255,255,255,0.4)';
    ctx.fillText(line ? `🏁 ${m} m` : `${m} m`, 6, y - 6);
  }

  // Pegs.
  const pegs = pegsNear(f.seed, f.camY - 0.2, top + 0.2).filter((p) => p.id > 0 || f.me.holds.some((hd) => hd?.id === p.id) || f.camY < 1);
  for (const p of pegs) {
    const x = sx(f, p.x);
    const y = sy(f, p.y);
    const r = PEG_R * w;
    ctx.fillStyle = p.id < 0 ? '#9FB4D9' : '#C9D6E8';
    ctx.strokeStyle = '#1B2030';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const rival = f.rivals.get(p.id);
    if (rival) {
      const open = f.now - rival.since >= TENT_SQUAT_MS;
      ctx.strokeStyle = rival.tint;
      ctx.lineWidth = 3;
      if (open) ctx.setLineDash([4, 4]);
      ctx.globalAlpha = open && !f.reduced ? 0.55 + 0.45 * Math.sin(f.now / 160) : 1;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  // The other players, as shadows behind.
  for (const s of f.shadows) {
    if (!s.body) continue;
    const y = sy(f, s.body.y);
    if (y < -HEAD * w * 2 || y > h + HEAD * w * 2) continue;
    s.holds.forEach((p, arm) => {
      tentacle(ctx, f, root(s.body as Point, arm), p ?? dangle(s.body as Point, arm, f.now, f.reduced), '#0B1020', 0.4, false, p !== null);
    });
    head(ctx, f, s.body, 'happy', s.tint, 0.38);
    ctx.font = `600 ${Math.round(w * 0.034)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`${s.avatar} ${s.name}`, sx(f, s.body.x), y - HEAD * w * 0.95);
    ctx.textAlign = 'left';
  }

  // Me.
  const me = f.me;
  const skin = skinOf(me.tint);
  if (me.pull) {
    const from = { x: sx(f, me.body.x), y: sy(f, me.body.y) };
    ctx.strokeStyle = '#FFD84D';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(from.x - me.pull.x * w * 2.4, from.y + me.pull.y * w * 2.4);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (let arm = 0; arm < TENT_ARMS; arm++) {
    const from = root(me.body, arm);
    const held = me.holds[arm] ?? null;
    let to: Point = held ?? dangle(me.body, arm, f.now, f.reduced, me.vel);
    let color = skin;
    if (me.drag?.arm === arm) {
      const dx = me.drag.at.x - me.body.x;
      const dy = me.drag.at.y - me.body.y;
      const len = Math.hypot(dx, dy);
      const max = REACH * 1.15;
      to = len > max ? { x: me.body.x + (dx / len) * max, y: me.body.y + (dy / len) * max } : me.drag.at;
      if (me.dragOk) color = GRAB_OK;
      else if (len > REACH) color = '#FF4D4D';
    }
    me.tips[arm] = to;
    tentacle(ctx, f, from, to, color, 1, true, held !== null && me.drag?.arm !== arm, f.reduced ? undefined : me.vel);
  }
  if (me.armed) {
    const pulse = f.reduced ? 1 : 0.5 + 0.5 * Math.sin(f.now / 110);
    ctx.strokeStyle = `rgba(255, 216, 77, ${0.4 + 0.6 * pulse})`;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(sx(f, me.body.x), sy(f, me.body.y) - HEAD * w * 0.3, HEAD * w * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#FFD84D';
    ctx.font = `700 ${Math.round(w * 0.05)}px system-ui, sans-serif`;
    ctx.fillText('⤴', sx(f, me.body.x) + HEAD * w * 0.5, sy(f, me.body.y) - HEAD * w * 0.75);
  }
  head(ctx, f, me.body, me.face, me.tint, 1, me.tilt, me.squash);
  if (me.oneSince !== null) {
    const left = Math.max(0, 1 - (f.now - me.oneSince) / TENT_HANG_MS);
    ctx.strokeStyle = left < 0.34 ? '#FF4D4D' : '#FFFFFF';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(sx(f, me.body.x), sy(f, me.body.y) - HEAD * w * 0.3, HEAD * w * 0.58, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
    ctx.stroke();
  }

  // Players off screen: a chip on the top or bottom edge, with their height.
  ctx.font = `600 ${Math.round(w * 0.034)}px system-ui, sans-serif`;
  for (const s of f.shadows) {
    if (!s.body) continue;
    const y = sy(f, s.body.y);
    if (y >= 0 && y <= h) continue;
    const label = `${s.avatar} ${s.height.toFixed(1)} m`;
    const tw = ctx.measureText(label).width + 16;
    const x = Math.min(w - tw - 4, Math.max(4, sx(f, s.body.x) - tw / 2));
    const cy = y < 0 ? 8 : h - 36;
    ctx.fillStyle = 'rgba(10,14,24,0.75)';
    ctx.beginPath();
    ctx.roundRect(x, cy, tw, 28, 14);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`${y < 0 ? '▲' : '▼'} ${label}`, x + 6, cy + 19);
  }
}
