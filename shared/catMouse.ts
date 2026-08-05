import {
  CM_BOARD_H,
  CM_CATCH_RADIUS,
  CM_CAT_SPEED_FACTOR,
  CM_MOUSE_SPEED,
  CM_SANITY_SPEED,
} from './protocol';

/**
 * Cat and Mouse geometry, shared by the browser and the room server.
 * Spec: docs/specs/games/cat-and-mouse.md §5, §9
 *
 * One module rather than two copies, for the reason spill's geometry is shared
 * (roadmap, 2026-08-02): the client moves an icon and the server decides whether
 * that move was legal, so both have to mean the same thing by "too far". Written
 * twice, the two would drift and the drift would show up as a mouse that dodges
 * on its own phone and dies on everyone else's.
 *
 * Units are the isotropic board units of spec §5: `x` runs 0..1 and `y` runs
 * 0..`CM_BOARD_H`, one unit being one board **width** in both axes. So a circle
 * is a circle and a diagonal is straight, on any phone.
 *
 * DOM-free, so it typechecks under tsconfig.worker.json.
 */

export type Point = { x: number; y: number };

/** The centre of the floor — where a caught mouse comes back (spec §6). */
export const CM_CENTRE: Point = { x: 0.5, y: CM_BOARD_H / 2 };

/** Clamp a point onto the floor. Nothing ever leaves it, on either side. */
export function clampToFloor(p: Point): Point {
  return {
    x: Math.min(1, Math.max(0, p.x)),
    y: Math.min(CM_BOARD_H, Math.max(0, p.y)),
  };
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Board widths per second for this role, in `capped` mode. */
export function speedOf(isCat: boolean): number {
  return isCat ? CM_MOUSE_SPEED * CM_CAT_SPEED_FACTOR : CM_MOUSE_SPEED;
}

/**
 * How far this role may legally travel in `dtMs`, plus the tolerance the server
 * allows on top.
 *
 * The tolerance exists because the client walks the icon on its own clock and
 * reports the result: its frames and the server's ticks do not line up, so an
 * honest client routinely reports a step covering slightly more time than the
 * server measured. Without slack every such report would be truncated and the
 * icon would visibly lag its own finger. 40% is generous enough for a stutter
 * and far too small to be worth cheating with.
 */
export function maxStep(isCat: boolean, dtMs: number, drag: 'direct' | 'capped'): number {
  const perSecond = drag === 'capped' ? speedOf(isCat) : CM_SANITY_SPEED;
  // A floor on the window, so a tick that arrives early cannot pin an icon in
  // place: two ticks 1 ms apart must not mean "you may not move".
  const seconds = Math.max(dtMs, 40) / 1000;
  return perSecond * seconds * 1.4;
}

/**
 * Move `from` toward `to`, but no further than `limit`.
 *
 * **Truncated, never rejected** (spec §9). A player on a slow link produces big
 * steps through no fault of their own, and refusing those would freeze them
 * while punishing exactly the person already suffering. Truncation keeps them
 * moving in the direction they asked for and makes a speed hack pointless,
 * because the surplus is simply discarded.
 */
export function truncate(from: Point, to: Point, limit: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (!(d > limit) || d === 0) return clampToFloor(to);
  const k = limit / d;
  return clampToFloor({ x: from.x + dx * k, y: from.y + dy * k });
}

/**
 * One step of `capped` walking: `pos` heading for `target` over `dtMs`.
 *
 * Client-side only in practice — the server never simulates a drag, it only
 * bounds one (spec §9) — but it lives here because the speed it walks at has to
 * be the same speed the server bounds it to.
 */
export function walk(pos: Point, target: Point, isCat: boolean, dtMs: number): Point {
  const step = (speedOf(isCat) * dtMs) / 1000;
  const d = dist(pos, target);
  if (d <= step || d === 0) return clampToFloor(target);
  return clampToFloor({
    x: pos.x + ((target.x - pos.x) / d) * step,
    y: pos.y + ((target.y - pos.y) / d) * step,
  });
}

/** Close enough to count as a touch. */
export function touching(a: Point, b: Point): boolean {
  return dist(a, b) <= CM_CATCH_RADIUS;
}
