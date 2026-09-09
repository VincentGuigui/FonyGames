import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { CROWD_COURSE_LENGTH, CROWD_STREET_WIDTH } from '../../../../shared/protocol';
import type { CrowdRun } from './game';

/**
 * Crowd Race's board. Spec: docs/specs/games/crowd-race.md §4, §13
 *
 * `TrackCanvas.tsx`'s pattern — a `latest` prop ref plus one
 * `requestAnimationFrame` loop, DPR-aware — and like that one the SIMULATION
 * runs in here too, because there is no referee tick to drive it from
 * anywhere else (spec §2.2: the crowd is never even known to the referee).
 *
 * **Placeholder art, by request**: every obstacle is a plain-colour ellipse —
 * literally its own hitbox, drawn — until real transparent PNGs replace them.
 * That is not a compromise here: "everything has an ellipsoidal collision
 * hitbox" is the issue's own rule, so drawing the hitbox *is* drawing the
 * obstacle, honestly, rather than a rough stand-in for one.
 *
 * **The camera scrolls vertically only.** `CROWD_STREET_WIDTH` is a fixed
 * logical width every phone agrees on, mapped 1:1 to the canvas's own width —
 * left and right never scroll, which is what lets a lateral dodge be judged
 * against the whole lane rather than a moving window of it. The player is
 * held two-thirds of the way down the screen (the "lower third" the spec
 * asks for), so there is room above to see the crowd coming.
 */

type Props = {
  /** Read fresh every frame: the simulation is stepped by the caller's loop. */
  run: () => CrowdRun;
  /** This phone's own avatar, drawn at its own position. */
  myAvatar: string;
  /** Other players, by their own last-reported position (spec §4). */
  rivals: () => { x: number; y: number; avatar: string }[];
  /** Called once per drawn frame, so the room can step the run and report. */
  onFrame: (dtMs: number) => void;
};

const PAVEMENT = '#3a3f3a';
const CURB = '#c9c2a8';
const TREE = '#2f6b3c';
const PEDESTRIAN = '#c98a4b';
const BICYCLE = '#3b6ea5';
const FINISH = '#d64545';

export function CrowdCanvas({ run, myAvatar, rivals, onFrame }: Props): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ run, myAvatar, rivals, onFrame });
  latest.current = { run, myAvatar, rivals, onFrame };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let frame = 0;
    let last = performance.now();

    const draw = (): void => {
      const { run, myAvatar, rivals, onFrame } = latest.current;
      const now = performance.now();
      // Clamped: a backgrounded tab returns with a gap of seconds, and
      // stepping that in one go would carry a bounce or a cascade straight
      // through everything in its path.
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

      const state = run();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = PAVEMENT;
      ctx.fillRect(0, 0, width, height);

      // World units to pixels: the street's fixed width fills the canvas
      // exactly, so the same scale applies to both axes and an ellipse never
      // stretches (spec §4).
      const scale = width / CROWD_STREET_WIDTH;
      const viewWorldHeight = height / scale;
      const cameraY = state.y - viewWorldHeight * (2 / 3);

      ctx.save();
      ctx.scale(scale, scale);
      ctx.translate(0, -cameraY);

      // Kerb lines down both edges — the only scenery this street has beyond
      // the obstacles themselves, and enough to read as a street rather than
      // an empty grid.
      ctx.fillStyle = CURB;
      ctx.fillRect(0, cameraY, 6, viewWorldHeight);
      ctx.fillRect(CROWD_STREET_WIDTH - 6, cameraY, 6, viewWorldHeight);

      // The finish line, if it is anywhere near visible.
      if (CROWD_COURSE_LENGTH > cameraY - 40 && CROWD_COURSE_LENGTH < cameraY + viewWorldHeight + 40) {
        ctx.fillStyle = FINISH;
        ctx.fillRect(0, CROWD_COURSE_LENGTH - 4, CROWD_STREET_WIDTH, 8);
      }

      // Obstacles, culled to what could possibly be on screen.
      for (const o of state.obstacles) {
        if (o.y < cameraY - o.ry - 20 || o.y > cameraY + viewWorldHeight + o.ry + 20) continue;
        ctx.fillStyle = o.kind === 'tree' ? TREE : o.kind === 'bicycle' ? BICYCLE : PEDESTRIAN;
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, o.rx, o.ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Rivals: their own avatar, at their own last-reported position —
      // scenery to look at, never something to collide with (spec §12 Q1).
      ctx.font = `${28}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const rival of rivals()) {
        if (rival.y < cameraY - 40 || rival.y > cameraY + viewWorldHeight + 40) continue;
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.fillText(rival.avatar, rival.x, rival.y);
        ctx.restore();
      }

      // This phone's own avatar, always drawn last so it is never hidden
      // under the crowd.
      ctx.font = `${34}px system-ui, sans-serif`;
      ctx.fillText(myAvatar, state.x, state.y);

      ctx.restore();
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvas} class="crowd__canvas" />;
}
