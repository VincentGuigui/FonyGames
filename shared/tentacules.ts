import { TENT_ARMS, TENT_MODES, TENT_SUMMIT_M, type TentMode } from './protocol';

/**
 * Tentacules' rules. Spec: docs/specs/games/tentacules.md §2
 *
 * Shared by the phone, which climbs, and the referee, which checks every grab
 * and computes every height — so "within reach" and "where the body sits" are
 * one function on both sides. DOM-free.
 *
 * Lengths are wall units: the wall is 1 wide. y grows upwards; the start is at
 * the bottom, near y = 0.
 */

export type Point = { x: number; y: number };
export type Peg = Point & { id: number };

/** How far a tentacle reaches from the centre of the body. */
export const REACH = 0.57;
/** A full slingshot pull straight up rises this high. */
export const MAX_LEAP = 1.5;
/** The furthest the body can be pulled back. */
export const MAX_PULL = 0.25;
/** A pull shorter than this launches nothing. */
export const MIN_PULL = 0.04;
/** Slingshot armed: two holds this far apart across, at this angle seen from the body. */
export const ARM_SPREAD = 0.35;
export const ARM_ANGLE = (100 * Math.PI) / 180;
/** Gravity, in wall units a second squared. */
export const GRAVITY = 6;
/** Launch speed of a full pull: enough to rise `MAX_LEAP`. */
export const LAUNCH_SPEED = Math.sqrt(2 * GRAVITY * MAX_LEAP);
/** Slack the referee allows on a reach, for float drift between engines. */
export const REACH_SLACK = 0.02;

/** The centre of the starting star. */
const START_STAR: Point = { x: 0.5, y: 0.3 };

/** Each player's own five starting pegs — ids −1 to −5 — round the body, as a star. */
export function startPegs(): Peg[] {
  return Array.from({ length: TENT_ARMS }, (_, k) => {
    const a = Math.PI / 2 + (k * 2 * Math.PI) / TENT_ARMS;
    return { id: -(k + 1), x: START_STAR.x + 0.28 * Math.cos(a), y: START_STAR.y + 0.28 * Math.sin(a) };
  });
}


/** Metres climbed, for a body at height `y`. */
export function heightOf(y: number): number {
  return Math.max(0, y - START_BODY.y);
}

export function normaliseTentMode(raw: unknown): TentMode {
  const mode = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['mode'] : undefined;
  return (TENT_MODES as readonly unknown[]).includes(mode) ? (mode as TentMode) : 'trial';
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/* ── The body (spec §2.1) ────────────────────────────────────────────────── */

/** How far up the body pulls itself, from the centre of its pegs (0) to its full stretch (1). */
export const LIFT = 0.7;
/** Hanging by one tentacle, the body dangles this far below its peg. */
export const HANG_DROP = 0.15;

function centroid(pegs: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of pegs) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pegs.length, y: y / pegs.length };
}

function within(p: Point, pegs: readonly Point[], slack: number): boolean {
  return pegs.every((q) => dist(p, q) <= REACH + slack + 1e-9);
}

/**
 * The highest point within reach of every peg — the body at full stretch — or
 * null if no point reaches them all. It is the top of one reach circle or where
 * two of them cross, so trying those is enough.
 */
function stretch(pegs: readonly Point[], slack = 0): Point | null {
  const r = REACH + slack;
  const cands: Point[] = pegs.map((p) => ({ x: p.x, y: p.y + r }));
  for (let i = 0; i < pegs.length; i++) {
    for (let j = i + 1; j < pegs.length; j++) {
      const a = pegs[i] as Point;
      const b = pegs[j] as Point;
      const d = dist(a, b);
      if (d === 0 || d > 2 * r) continue;
      const h = Math.sqrt(Math.max(0, r * r - (d / 2) * (d / 2)));
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const ux = (b.x - a.x) / d;
      const uy = (b.y - a.y) / d;
      cands.push({ x: mx - uy * h, y: my + ux * h }, { x: mx + uy * h, y: my - ux * h });
    }
  }
  let best: Point | null = null;
  for (const c of cands) if (within(c, pegs, slack) && (best === null || c.y > best.y)) best = c;
  return best;
}

/**
 * Where a body held by these pegs sits (spec §2.1). It pulls itself up: most
 * of the way from the centre of its pegs to the highest point every tentacle
 * still reaches, so reaching higher lifts it and the star shape shows. On one
 * peg it dangles just below. Null when nothing holds it, or nothing could.
 */
export function place(pegs: readonly Point[]): Point | null {
  if (pegs.length === 0) return null;
  if (pegs.length === 1) {
    const [p] = pegs as [Point];
    return { x: p.x, y: p.y - HANG_DROP };
  }
  const top = stretch(pegs);
  if (top === null) return null;
  const c = centroid(pegs);
  const body = { x: c.x + (top.x - c.x) * LIFT, y: c.y + (top.y - c.y) * LIFT };
  return within(body, pegs, 0) ? body : top;
}

/** Can a body hold all of these at once: some point is within reach of every one. */
export function fits(pegs: readonly Point[], slack = 0): boolean {
  return pegs.length <= 1 || stretch(pegs, slack) !== null;
}

/**
 * Can a tentacle take `peg`, given the pegs the *other* tentacles hold? With
 * any held, the peg must be within reach of where they put the body, and the
 * body must still hold everything once it moves. With none, the caller knows
 * where the body is (`free`): a slingshot catch or a fall.
 */
export function canGrab(others: readonly Point[], peg: Point, free: Point | null, slack = 0): boolean {
  const body = place(others) ?? free;
  if (body === null) return false;
  if (dist(body, peg) > REACH + slack) return false;
  return fits([...others, peg], slack);
}

/** Two holds, wide apart across and seen at a wide angle from between them: ready to launch. */
export function slingArmed(pegs: readonly Point[]): boolean {
  if (pegs.length !== 2 || !fits(pegs)) return false;
  const [a, b] = pegs as [Point, Point];
  if (Math.abs(a.x - b.x) < ARM_SPREAD) return false;
  const c = centroid(pegs);
  const ua = Math.atan2(a.y - c.y, a.x - c.x);
  const ub = Math.atan2(b.y - c.y, b.x - c.x);
  let angle = Math.abs(ua - ub);
  if (angle > Math.PI) angle = 2 * Math.PI - angle;
  return angle >= ARM_ANGLE;
}

/** Where the body rests on its starting pegs, and the height counted from it. */
export const START_BODY: Point = place(startPegs()) as Point;

/** The launch velocity for a pull, or null if too short: the opposite way, as fast as it was pulled. */
export function launchVelocity(pull: Point): Point | null {
  const len = Math.hypot(pull.x, pull.y);
  if (len < MIN_PULL) return null;
  const k = (Math.min(len, MAX_PULL) / MAX_PULL) * LAUNCH_SPEED / len;
  return { x: -pull.x * k, y: -pull.y * k };
}

/* ── The wall (spec §2.4) ────────────────────────────────────────────────── */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/** Where the slingshot becomes necessary, and how tall a gap is. */
export const GAPS_FROM = 8;
/** Taller than two reaches, so no tentacle-to-tentacle step crosses it, and well
 *  inside a leap plus a reach, so a slingshot always does. */
export const GAP = 2 * REACH + 0.1;
/** Spine pegs, side by side across a gap: the launch pair below it, the landing above. */
const GAP_LEFT = 0.32;
const GAP_RIGHT = 0.68;
const SUMMIT_Y = START_BODY.y + TENT_SUMMIT_M;
const PEG_IDS_PER_BAND = 100;

/** The bottoms of the gaps up to `top`, from the seed alone: about one every 6 m at first, every 3 m by the Summit line. */
export function gaps(seed: number, top: number): number[] {
  const random = mulberry32(Math.imul(seed ^ 0x2c1b3c6d, 1));
  const out: number[] = [];
  for (let y = GAPS_FROM + random(); y < top; ) {
    out.push(y);
    y += GAP + lerp(5, 2, (y - GAPS_FROM) / (SUMMIT_Y - GAPS_FROM)) + random();
  }
  return out;
}

/** 1 away from any gap, 0 beside one: the spines pinch to the launch pair's columns near a gap. */
function openness(y: number, near: readonly number[]): number {
  let e = 1;
  for (const g of near) {
    const off = Math.abs(y - (g + GAP / 2)) - GAP / 2 - 0.25;
    e = Math.min(e, Math.max(0, off / 1.2));
  }
  return e;
}

type Phases = { a: number; a2: number; b: number; b2: number };
function phases(seed: number): Phases {
  const random = mulberry32(Math.imul(seed ^ 0x5be0cd19, 1));
  const tau = 2 * Math.PI;
  return { a: random() * tau, a2: random() * tau, b: random() * tau, b2: random() * tau };
}

/** The two spines' columns at height y: two slow, different waves across the wall. */
function spineX(y: number, ph: Phases, near: readonly number[]): [number, number] {
  const e = openness(y, near);
  const a = 0.5 + 0.26 * Math.sin(y * 0.9 + ph.a) + 0.07 * Math.sin(y * 2.3 + ph.a2);
  const b = 0.5 - 0.26 * Math.sin(y * 0.8 + ph.b) - 0.07 * Math.sin(y * 2.1 + ph.b2);
  return [lerp(GAP_LEFT, a, e), lerp(GAP_RIGHT, b, e)];
}

/** Spine step at height y: short at the bottom, longer up to the Summit line. */
export function spineStep(y: number): number {
  return lerp(0.5 * REACH, 0.8 * REACH, y / SUMMIT_Y);
}

/**
 * The pegs of band `band` — the stretch of wall from y = band to band + 1 —
 * built from the seed and the band alone, so every phone and the referee build
 * the same ones. Ids are stable: band × 100 + index + 1.
 *
 * Two interleaved spines run up the wall (one player on a peg never blocks the
 * way), decoys thin out as it rises, and from `GAPS_FROM` gaps open that only a
 * slingshot crosses: below each, a launch pair; above, a landing.
 */
export function bandPegs(seed: number, band: number): Peg[] {
  if (band < 0) return [];
  const ph = phases(seed);
  const near = gaps(seed, band + 4).filter((g) => g > band - 3);
  const inGap = (y: number): boolean => near.some((g) => y > g - 0.06 && y < g + GAP + 0.06);
  const pts: Point[] = [];
  const mid = band + 0.5;
  const per = Math.max(1, Math.ceil(1 / spineStep(mid)));
  for (const [spine, offset] of [[0, 0.25], [1, 0.75]] as const) {
    for (let k = 0; k < per; k++) {
      const y = band + (k + offset) / per;
      if (y < START_BODY.y + 0.12 || inGap(y)) continue;
      pts.push({ x: spineX(y, ph, near)[spine], y });
    }
  }
  const random = mulberry32(Math.imul(seed ^ 0x1f83d9ab, 1) + Math.imul(band + 1, 0x9e3779b1));
  const decoys = Math.round(lerp(5, 2, band / SUMMIT_Y));
  for (let k = 0; k < decoys; k++) {
    const p = { x: 0.06 + random() * 0.88, y: band + random() };
    if (p.y > START_BODY.y + 0.12 && !inGap(p.y)) pts.push(p);
  }
  for (const g of near) {
    for (const p of [
      { x: 0.5, y: g - 0.2 },
      { x: GAP_LEFT, y: g },
      { x: GAP_RIGHT, y: g },
      { x: GAP_LEFT, y: g + GAP },
      { x: GAP_RIGHT, y: g + GAP },
      { x: 0.5, y: g + GAP + 0.06 },
    ]) {
      if (p.y >= band && p.y < band + 1) pts.push(p);
    }
  }
  return pts.map((p, i) => ({ id: band * PEG_IDS_PER_BAND + i + 1, x: p.x, y: p.y }));
}

/** A peg by id: one of the shared wall's, or (negative) a player's own starting peg. */
export function pegById(seed: number, id: number): Peg | null {
  if (!Number.isInteger(id)) return null;
  if (id < 0) return startPegs().find((p) => p.id === id) ?? null;
  if (id === 0) return null;
  const band = Math.floor((id - 1) / PEG_IDS_PER_BAND);
  return bandPegs(seed, band).find((p) => p.id === id) ?? null;
}

/** Every peg of the shared wall between two heights. */
export function pegsBetween(seed: number, low: number, high: number): Peg[] {
  const out: Peg[] = [];
  for (let b = Math.max(0, Math.floor(low)); b <= Math.floor(high); b++) {
    for (const p of bandPegs(seed, b)) if (p.y >= low && p.y <= high) out.push(p);
  }
  return out;
}

/** The body a set of hold ids puts it at, or null if it holds nothing. */
export function bodyOf(seed: number, holds: readonly (number | null)[]): Point | null {
  const pegs = holds.flatMap((id) => (id === null ? [] : [pegById(seed, id)])).filter((p): p is Peg => p !== null);
  return place(pegs);
}
