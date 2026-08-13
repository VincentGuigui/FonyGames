import { wrapDeg, type Aim } from '../../core/sensors/orientation';
import { ELEVATION_MAX_DEG, ELEVATION_MIN_DEG } from '../../../../shared/protocol';

/**
 * The touch fallback: a 360° panorama you drag instead of a room you sweep.
 * Spec: docs/specs/games/ghost-hunt.md §5.4
 *
 * This is a **real** alternative rather than a consolation, which is why Ghost
 * Hunt is not on the no-fallback list with Steady Hand and Shake Rush. Dragging a
 * sphere is genuinely the same puzzle — a hidden direction, found by searching —
 * where "hold a phone still" has no touch equivalent at all. It is seated,
 * one-handed and quiet, so it is the accessible way to play rather than a worse
 * one, and any player may choose it from the lobby.
 *
 * It is also the only way this game can be tested in a browser on a laptop.
 *
 * ## The projection
 *
 * The image is equirectangular: x is 0…360° of azimuth, y is +90°…−90° of
 * elevation, so the horizon is exactly the middle row. Drawing a view is
 * therefore a crop, and the only fiddly part is the seam — a view straddling
 * x = 0 has to be drawn in two pieces, because a source rectangle cannot wrap.
 *
 * A true rectilinear reprojection would be more correct at the edges and much
 * more code for a background nobody is examining. A cylindrical crop is what
 * every simple panorama viewer does, and it preserves the one property the game
 * needs: the centre of the screen is exactly the aim.
 */

/** Degrees across the screen. Roughly a phone camera's field of view. */
export const FOV_DEG = 70;

/** Degrees per pixel of drag. Slow enough to aim, fast enough to sweep. */
export const DRAG_SENSITIVITY = 0.22;

/**
 * Where a drag leaves you, clamped so you cannot roll over the poles.
 *
 * Azimuth wraps — the sphere is continuous sideways — but elevation is clamped a
 * little beyond the band the targets live in, so the player can always see a
 * ghost at the extremes without ever ending up upside down.
 */
export function dragTo(from: Aim, dx: number, dy: number): Aim {
  return {
    azimuth: wrapDeg(from.azimuth + dx * DRAG_SENSITIVITY),
    elevation: Math.min(
      ELEVATION_MAX_DEG + 15,
      Math.max(ELEVATION_MIN_DEG - 15, from.elevation - dy * DRAG_SENSITIVITY),
    ),
  };
}

/** Where in the image a direction lands, in 0…1 of width and height. */
export function project(aim: Aim): { u: number; v: number } {
  return {
    // Azimuth 0 is the middle of the image, so the seam falls behind the player
    // rather than straight ahead where it would be noticed.
    u: (((aim.azimuth + 180) % 360) + 360) % 360 / 360,
    v: (90 - aim.elevation) / 180,
  };
}

/**
 * Draw the view centred on `aim`.
 *
 * `canvas` is the full-bleed background. The source rectangle is computed in
 * image pixels and split at the seam when it wraps.
 */
export function drawSphere(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  imageW: number,
  imageH: number,
  aim: Aim,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || imageW === 0) return;

  const { width: cw, height: ch } = canvas;
  const vFov = FOV_DEG * (ch / cw);

  const sw = (FOV_DEG / 360) * imageW;
  const sh = (vFov / 180) * imageH;
  const { u, v } = project(aim);
  const sx = u * imageW - sw / 2;
  const sy = Math.min(imageH - sh, Math.max(0, v * imageH - sh / 2));

  ctx.clearRect(0, 0, cw, ch);

  // A source rectangle cannot wrap, so a view over the seam is two draws: the
  // tail of the image, then the head, butted together.
  const left = ((sx % imageW) + imageW) % imageW;
  const overhang = left + sw - imageW;

  if (overhang <= 0) {
    ctx.drawImage(image, left, sy, sw, sh, 0, 0, cw, ch);
    return;
  }

  const firstW = sw - overhang;
  const split = (firstW / sw) * cw;
  ctx.drawImage(image, left, sy, firstW, sh, 0, 0, split, ch);
  ctx.drawImage(image, 0, sy, overhang, sh, split, 0, cw - split, ch);
}

/**
 * Follow one finger across the screen.
 *
 * One pointer only: a second finger arriving mid-drag would otherwise jump the
 * view, and there is nothing here to pinch.
 *
 * Attached to the whole screen rather than to the canvas, because the canvas is at
 * the BOTTOM of the stack — the dimming veil, the ring and the readout all sit on
 * top of it, and the middle of the screen is exactly where a thumb starts. A drag
 * that begins on a real control is left alone so buttons still work.
 */
export function trackDrag(el: HTMLElement, onMove: (dx: number, dy: number) => void): () => void {
  let id: number | null = null;
  let lastX = 0;
  let lastY = 0;

  const down = (e: PointerEvent): void => {
    if (id !== null) return;
    if ((e.target as Element | null)?.closest('button, a, details, summary')) return;
    id = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    el.setPointerCapture(e.pointerId);
  };

  const move = (e: PointerEvent): void => {
    if (e.pointerId !== id) return;
    onMove(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  };

  const up = (e: PointerEvent): void => {
    if (e.pointerId !== id) return;
    id = null;
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);

  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}
