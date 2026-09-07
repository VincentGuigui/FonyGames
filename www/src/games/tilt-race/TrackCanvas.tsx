import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { TILT_CRUISE_SPEED } from '../../../../shared/protocol';
import { TRACK_HALF_WIDTH, atArc, type Track } from '../../../../shared/tiltTrack';
import type { Drive } from './drive';

/**
 * Tilt Race's board. Spec: docs/specs/games/tilt-race.md §2.1, §4
 *
 * `TilesCanvas.tsx`'s pattern — a `latest` prop ref plus one
 * `requestAnimationFrame` loop, DPR-aware — and like that one the SIMULATION
 * runs in here too, because there is no referee tick to drive it from
 * anywhere else (spec §6).
 *
 * ## The one thing that makes this canvas different
 *
 * **The map never rotates. The car does.** The track is drawn in a fixed
 * orientation — north up, always — and the camera simply follows the car across
 * it (spec §2.1).
 *
 * That is two lines of `ctx` setup and it is the whole game:
 *
 *     translate(width / 2, height / 2)     put the camera on the car
 *     translate(-car.x, -car.y)            and centre it
 *
 * It was the other way round first: the car pinned upright and the world
 * turning under it. That is the conventional choice and it is wrong for *this*
 * control, because the steering is the phone's own rotation, 1:1 (`roll.ts`).
 * A map that turned with the phone would cancel the very rotation the player is
 * making — the car would sit still on screen no matter how far the wrist went,
 * and the one cue that the control is direct would be invisible. Fixed map,
 * turning car: the sprite on screen points wherever the phone points.
 *
 * The physics is untouched by any of it — `drive.ts` runs in track space, where
 * the car has a real heading. Simulating in screen space instead is the trap
 * Asteroid Race's own comments warn about, and it makes the handling depend on
 * the aspect ratio.
 */

type Props = {
  track: Track;
  /** Read fresh every frame: the simulation is stepped by the caller's loop. */
  car: () => Drive;
  /** Other players' arc lengths, for the ghosts on the road ahead. */
  rivals: () => { s: number; lap: number; avatar: string }[];
  accent: string;
  /**
   * How many world units fit across the screen. Smaller is more zoomed in.
   *
   * 460 puts the road (72 units wide) at about 60 px on a 390 px screen and
   * shows five or six tiles ahead. At the 900 this started as, the whole
   * circuit fitted on screen at once and the game read as a maze puzzle seen
   * from orbit rather than a car on a track — found by looking at the first
   * screenshot, not by measuring anything.
   */
  span?: number;
  /** Called once per drawn frame, so the room can step the car and report. */
  onFrame: (dtMs: number) => void;
};

/** Ground, rails and the car, in literal hexes — a canvas cannot read CSS. */
const GRASS = '#16281c';
const ROAD = '#2b2f38';
const RAIL = '#e8eaf0';
const KERB = '#c0392b';
const CAR_GLASS = '#0f1420';

export function TrackCanvas({ track, car, rivals, accent, span = 460, onFrame }: Props): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ track, car, rivals, accent, span, onFrame });
  latest.current = { track, car, rivals, accent, span, onFrame };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let frame = 0;
    let last = performance.now();

    const draw = (): void => {
      const { track, car, rivals, accent, span, onFrame } = latest.current;
      const now = performance.now();
      // Clamped: a backgrounded tab returns with a gap of seconds, and
      // stepping that in one go would teleport the car through a rail.
      const dt = Math.min(50, now - last);
      last = now;
      onFrame(dt);

      const ctx = element.getContext('2d');
      if (!ctx) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (element.width !== Math.round(width * dpr) || element.height !== Math.round(height * dpr)) {
        element.width = Math.round(width * dpr);
        element.height = Math.round(height * dpr);
      }

      const state = car();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = GRASS;
      ctx.fillRect(0, 0, width, height);

      // World units to pixels, then the three transforms from the header.
      const scale = width / span;
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(scale, scale);
      ctx.translate(-state.at.x, -state.at.y);

      // The road: one thick stroke down the centreline, so the drawn surface
      // and the drivable surface are the same shape by construction rather
      // than by two lists of points agreeing.
      ctx.beginPath();
      const first = track.points[0];
      if (first) ctx.moveTo(first.x, first.y);
      for (let i = 1; i < track.points.length; i++) {
        const p = track.points[i];
        if (p) ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      // Kerb first, then the road on top of it, so a thin red edge shows
      // through — the rails have to be the most readable thing at speed.
      ctx.strokeStyle = KERB;
      ctx.lineWidth = TRACK_HALF_WIDTH * 2 + 10;
      ctx.stroke();
      ctx.strokeStyle = ROAD;
      ctx.lineWidth = TRACK_HALF_WIDTH * 2;
      ctx.stroke();

      // The rails themselves, as two hairlines just inside the kerb.
      ctx.strokeStyle = RAIL;
      ctx.lineWidth = 2;
      ctx.setLineDash([18, 22]);
      ctx.stroke();
      ctx.setLineDash([]);

      // The start line.
      const line = atArc(track, 0);
      const lineNormal = { x: -line.tangent.y, y: line.tangent.x };
      ctx.beginPath();
      ctx.moveTo(line.at.x + lineNormal.x * TRACK_HALF_WIDTH, line.at.y + lineNormal.y * TRACK_HALF_WIDTH);
      ctx.lineTo(line.at.x - lineNormal.x * TRACK_HALF_WIDTH, line.at.y - lineNormal.y * TRACK_HALF_WIDTH);
      ctx.strokeStyle = RAIL;
      ctx.lineWidth = 8;
      ctx.stroke();

      // Rivals as dots on the road. Positions rather than cars, because they
      // are scenery: nobody collides with anybody (spec §6).
      ctx.font = '34px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const rival of rivals()) {
        const on = atArc(track, rival.s);
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.translate(on.at.x, on.at.y);
        // No counter-rotation needed any more: the world never turns, so an
        // avatar drawn upright stays upright.
        ctx.fillText(rival.avatar, 0, 0);
        ctx.restore();
      }
      ctx.restore();

      /*
       * The car: always dead centre of the screen, and rotated to its own
       * heading. Drawn after `restore()` so it is sized in pixels rather than
       * world units — a car that scaled with the zoom would vanish at 460 span.
       *
       * The art points up (nose at -y) and a heading of 0 is +x, so the sprite
       * is turned by `heading + PI/2` to point where the car is going.
       */
      const carLength = Math.max(26, 44 * scale * 1.6);
      const carWidth = carLength * 0.55;
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.rotate(state.heading + Math.PI / 2);
      ctx.fillStyle = accent;
      ctx.beginPath();
      // A blunt wedge: nose up, so "which way is forward" needs no explaining.
      ctx.moveTo(0, -carLength / 2);
      ctx.lineTo(carWidth / 2, carLength / 2);
      ctx.lineTo(0, carLength / 2 - carWidth * 0.25);
      ctx.lineTo(-carWidth / 2, carLength / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = CAR_GLASS;
      ctx.beginPath();
      ctx.ellipse(0, -carLength * 0.05, carWidth * 0.26, carLength * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();

      /*
       * The skid, as a wedge trailing where the momentum actually goes rather
       * than where the nose points. The car does rotate on screen now, so this
       * is no longer the only cue that it is sliding — but the gap between the
       * two is exactly what a skid is, and drawing it is what makes the gap
       * legible at speed.
       */
      const slip = state.drift - state.heading;
      if (Math.abs(state.speed) > TILT_CRUISE_SPEED && Math.abs(slip) > 0.02) {
        ctx.rotate(slip);
        ctx.globalAlpha = Math.min(0.5, Math.abs(slip) * 1.2);
        ctx.fillStyle = RAIL;
        ctx.beginPath();
        ctx.moveTo(-carWidth * 0.3, carLength * 0.45);
        ctx.lineTo(carWidth * 0.3, carLength * 0.45);
        ctx.lineTo(0, carLength * 1.5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvas} class="tilt__canvas" />;
}
