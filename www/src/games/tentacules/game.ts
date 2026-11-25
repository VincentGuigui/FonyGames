import { TENT_ARMS, TENT_HANG_MS, TENT_SQUAT_MS } from '../../../../shared/protocol';
import {
  GRAVITY,
  MAX_PULL,
  REACH,
  START_BODY,
  canGrab,
  dist,
  launchVelocity,
  place,
  slingArmed,
  startPegs,
  type Peg,
  type Point,
} from '../../../../shared/tentacules';

/**
 * One phone's octopus. Spec: docs/specs/games/tentacules.md §2
 *
 * Pure: the room feeds it time, the pegs near it and what the referee says,
 * and it returns what to send. The rules — reach, where the body sits, the
 * slingshot — are `shared/tentacules.ts`, the same ones the referee checks.
 */

export type Mode = 'held' | 'flying' | 'falling';

export type Octo = {
  holds: (Peg | null)[];
  /** The body as drawn: it eases towards where its holds put it. */
  body: Point;
  vel: Point;
  mode: Mode;
  /** When it came to hang by one tentacle (ms), or null. */
  oneSince: number | null;
};

export type Send =
  | { t: 'grab'; arm: number; peg: number }
  | { t: 'let-go'; arms: number[] }
  | { t: 'reset' };

/** A drop lands on the nearest peg within this of the finger. */
export const SNAP = 0.08;
/**
 * The drawn body hangs from its holds on a spring: gravity sags it, a grab or a
 * let-go sets it swinging, and it settles. Fewer tentacles means a looser spring
 * and a longer wobble; five hold it almost still. Only the drawing — where the
 * body *is* for the rules stays `rest()`, which the referee computes too.
 */
const SPRING = 70;
const DAMPING_BASE = 7;
const DAMPING_PER_ARM = 2.2;
/** How far a body sags below its resting place, per missing tentacle (wall units). */
const SAG_PER_MISSING = 0.01;
/** A gentle push side to side while hanging by one or two tentacles. */
const SWAY_ONE = 1.2;
const SWAY_TWO = 0.6;
/** Falling faster than this would tunnel past pegs a thumb could catch. */
const TERMINAL = 5;
/** Below the start by this much, a fall puts the octopus back on its starting pegs. */
const RESET_BELOW = 0.6;

export function fresh(): Octo {
  return { holds: startPegs(), body: { ...START_BODY }, vel: { x: 0, y: 0 }, mode: 'held', oneSince: null };
}

export function heldPegs(o: Octo): Peg[] {
  return o.holds.filter((p): p is Peg => p !== null);
}

/** Where the holds put the body; null when nothing holds it. */
export function rest(o: Octo): Point | null {
  return place(heldPegs(o));
}

export function armed(o: Octo): boolean {
  return o.mode === 'held' && slingArmed(heldPegs(o));
}

function settle(o: Octo, now: number): Octo {
  const n = heldPegs(o).length;
  return {
    ...o,
    mode: n > 0 ? 'held' : o.mode === 'held' ? 'falling' : o.mode,
    oneSince: n === 1 ? (o.oneSince ?? now) : null,
  };
}

/** Who holds a shared peg, and since when: the referee's word, for every other player. */
export type Taken = (peg: number) => { since: number } | null;

export type Drop =
  | { ok: true; octo: Octo; send: Send }
  | { ok: false; reason: 'mine' | 'taken' | 'reach' | 'nothing' };

/**
 * A tentacle let go of at `at`: on a peg, it grabs it if the rules allow;
 * on empty space, it lets go — unless it was already free, which changes nothing.
 */
export function drop(o: Octo, arm: number, at: Point, near: readonly Peg[], taken: Taken, now: number): Drop {
  const peg = near
    .filter((p) => dist(p, at) <= SNAP)
    .sort((a, b) => dist(a, at) - dist(b, at))[0];
  if (!peg) {
    if (o.holds[arm] === null) return { ok: false, reason: 'nothing' };
    const holds = o.holds.map((h, i) => (i === arm ? null : h));
    return { ok: true, octo: settle({ ...o, holds }, now), send: { t: 'let-go', arms: [arm] } };
  }
  if (o.holds.some((h) => h?.id === peg.id)) return { ok: false, reason: 'mine' };
  const holder = peg.id > 0 ? taken(peg.id) : null;
  if (holder && now - holder.since < TENT_SQUAT_MS) return { ok: false, reason: 'taken' };
  const others = o.holds.filter((h, i): h is Peg => h !== null && i !== arm);
  if (!canGrab(others, peg, o.body)) return { ok: false, reason: 'reach' };
  const holds = o.holds.map((h, i) => (i === arm ? peg : h));
  return { ok: true, octo: settle({ ...o, holds, vel: { x: 0, y: 0 } }, now), send: { t: 'grab', arm, peg: peg.id } };
}

/** Let go of the slingshot pulled back by `pull` from where the body rests. */
export function launch(o: Octo, pull: Point): { octo: Octo; send: Send } | null {
  if (!armed(o)) return null;
  const v = launchVelocity(pull);
  if (!v) return null;
  const at = rest(o) as Point;
  const len = Math.hypot(pull.x, pull.y);
  const k = Math.min(1, MAX_PULL / len);
  const arms = o.holds.flatMap((h, i) => (h ? [i] : []));
  return {
    octo: { holds: o.holds.map(() => null), body: { x: at.x + pull.x * k, y: at.y + pull.y * k }, vel: v, mode: 'flying', oneSince: null },
    send: { t: 'let-go', arms },
  };
}

/**
 * Time passes. Held, the body eases to where its holds put it, and a single
 * tentacle gives way after `TENT_HANG_MS`. Free, it flies or falls; a leap's
 * way down grabs the highest free peg in reach by itself; a fall past the
 * bottom starts it again on its starting pegs.
 */
export function tick(o: Octo, dt: number, now: number, near: readonly Peg[], taken: Taken, calm = false): { octo: Octo; send: Send[] } {
  const send: Send[] = [];
  let next = o;
  if (o.mode === 'held') {
    const target = rest(o);
    if (!target) return { octo: settle({ ...o, mode: 'falling' }, now), send };
    // Calm (reduced motion): critically damped, no sag, no sway — it just arrives.
    const n = heldPegs(o).length;
    const damping = calm ? 2 * Math.sqrt(SPRING) : DAMPING_BASE + DAMPING_PER_ARM * n;
    const sag = calm ? 0 : SAG_PER_MISSING * (TENT_ARMS - n);
    const sway = calm ? 0 : (n === 1 ? SWAY_ONE : n === 2 ? SWAY_TWO : 0) * Math.sin(now / 255);
    const ax = SPRING * (target.x - o.body.x) - damping * o.vel.x + sway;
    const ay = SPRING * (target.y - sag - o.body.y) - damping * o.vel.y;
    const vel = { x: o.vel.x + ax * dt, y: o.vel.y + ay * dt };
    next = { ...o, vel, body: { x: o.body.x + vel.x * dt, y: o.body.y + vel.y * dt } };
    if (o.oneSince !== null && now - o.oneSince >= TENT_HANG_MS) {
      const arms = o.holds.flatMap((h, i) => (h ? [i] : []));
      send.push({ t: 'let-go', arms });
      next = { ...next, holds: o.holds.map(() => null), mode: 'falling', oneSince: null, vel: { x: 0, y: 0 } };
    }
    return { octo: next, send };
  }

  const vy = Math.max(-TERMINAL, o.vel.y - GRAVITY * dt);
  const body = { x: Math.min(0.98, Math.max(0.02, o.body.x + o.vel.x * dt)), y: o.body.y + vy * dt };
  next = { ...o, body, vel: { x: o.vel.x * (1 - 0.6 * dt), y: vy } };

  if (o.mode === 'flying' && vy <= 0) {
    const free = near.filter((p) => dist(p, body) <= REACH && (p.id < 0 || !taken(p.id)));
    const peg = free.sort((a, b) => b.y - a.y)[0];
    if (peg) {
      const arm = armToward(body, peg);
      const holds = o.holds.map((h, i) => (i === arm ? peg : h));
      send.push({ t: 'grab', arm, peg: peg.id });
      return { octo: settle({ ...next, holds, vel: { x: 0, y: 0 } }, now), send };
    }
  }

  if (body.y < START_BODY.y - RESET_BELOW) {
    send.push({ t: 'reset' });
    return { octo: { ...fresh(), body }, send };
  }
  return { octo: next, send };
}

/** The tentacle whose resting direction points most nearly at the peg. */
export function armToward(body: Point, peg: Point): number {
  const a = Math.atan2(peg.y - body.y, peg.x - body.x);
  let best = 0;
  let gap = Infinity;
  for (let k = 0; k < TENT_ARMS; k++) {
    const home = Math.PI / 2 + (k * 2 * Math.PI) / TENT_ARMS;
    let d = Math.abs(a - home) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d < gap) {
      gap = d;
      best = k;
    }
  }
  return best;
}

/**
 * The referee's holds, for this octopus: adopt them, except for arms with a
 * send still on its way — those wait until the referee agrees or the send is
 * stale (then the referee's word stands: a refused grab springs back).
 */
export function reconcile(
  o: Octo,
  server: readonly (number | null)[],
  pending: Map<number, { peg: number | null; at: number }>,
  pegOf: (id: number) => Peg | null,
  now: number,
  staleMs = 1500,
): Octo {
  let changed = false;
  const holds = o.holds.map((h, arm) => {
    const want = server[arm] ?? null;
    const p = pending.get(arm);
    if (p) {
      if (p.peg === want) pending.delete(arm);
      else if (now - p.at < staleMs) return h;
      else pending.delete(arm);
    }
    if ((h?.id ?? null) === want) return h;
    changed = true;
    return want === null ? null : pegOf(want);
  });
  return changed ? settle({ ...o, holds }, now) : o;
}
