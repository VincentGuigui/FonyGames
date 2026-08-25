/**
 * The muzzle flash's geometry: four beams, one from each screen corner,
 * converging on the crosshair. Spec: docs/specs/games/ufo-hunt.md §2
 *
 * Its own file, separate from `UfoScreen.tsx`, for the same reason `scope.ts` is:
 * that component imports its gameplay sprite through Vite's `?url&no-inline`
 * loader, which a plain esbuild/node test harness cannot resolve — so the pure
 * geometry worth testing directly has to live somewhere that import never reaches.
 */

/** How short of dead centre a beam stops — the crosshair itself is never covered. */
export const LASER_GAP_PX = 10;

export type Beam = { x1: number; y1: number; x2: number; y2: number };

/**
 * One beam per screen corner, each aimed at the centre but cut `gap` px short of
 * it — pure geometry, so it is exact regardless of the viewport's own aspect
 * ratio rather than a guess baked into a fixed SVG viewBox.
 */
export function cornerBeams(width: number, height: number, gap: number): Beam[] {
  const cx = width / 2;
  const cy = height / 2;
  const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height }, { x: width, y: height }];
  return corners.map(({ x, y }) => {
    const dx = cx - x;
    const dy = cy - y;
    const dist = Math.hypot(dx, dy) || 1;
    const t = Math.max(0, (dist - gap) / dist);
    return { x1: x, y1: y, x2: x + dx * t, y2: y + dy * t };
  });
}
