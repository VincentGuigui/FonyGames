import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { CROWD_FINISH_Y, CROWD_SCREEN_HEIGHT, CROWD_START_Y, CROWD_STREET_WIDTH } from '../../../../shared/protocol';
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
 * **The street is fixed, not scrolling**: the whole course, start to
 * finish, always fits on one screen — there is no camera to follow the
 * player with. The fixed `CROWD_STREET_WIDTH` x `CROWD_SCREEN_HEIGHT`
 * rectangle is scaled to fit inside the canvas (`Math.min` of the two axis
 * scales, "contain" rather than "cover"), so it never crops on a phone whose
 * own aspect ratio is not exactly the world's, and centred so any leftover
 * space is split evenly rather than pinned to one edge.
 *
 * World `y` grows upward (start near the bottom, finish near the top,
 * "small margins" — spec §2, §4), but canvas pixels grow downward, so every
 * world `y` this file draws is passed through `flip()` first. That is a
 * scalar flip of the coordinate going in, not a negative `ctx.scale` — the
 * latter would also mirror `fillText`'s glyphs (the player's and rivals' own
 * avatars) upside down.
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
const START = '#8a9a8f';

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

      // "Contain" fit: the whole fixed course is always fully visible, letter-
      // or pillar-boxed rather than cropped on an aspect ratio the world
      // rectangle does not exactly match.
      const scale = Math.min(width / CROWD_STREET_WIDTH, height / CROWD_SCREEN_HEIGHT);
      const offsetX = (width - CROWD_STREET_WIDTH * scale) / 2;
      const offsetY = (height - CROWD_SCREEN_HEIGHT * scale) / 2;
      const flip = (worldY: number): number => CROWD_SCREEN_HEIGHT - worldY;

      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);

      // Kerb lines down both edges — the only scenery this street has beyond
      // the obstacles themselves, and enough to read as a street rather than
      // an empty grid.
      ctx.fillStyle = CURB;
      ctx.fillRect(0, 0, 6, CROWD_SCREEN_HEIGHT);
      ctx.fillRect(CROWD_STREET_WIDTH - 6, 0, 6, CROWD_SCREEN_HEIGHT);

      // The start line, a small margin up from the bottom, and the finish
      // line, a small margin down from the top (spec §2, §4) — both always
      // on screen, since the whole course is.
      ctx.fillStyle = START;
      ctx.fillRect(0, flip(CROWD_START_Y) - 3, CROWD_STREET_WIDTH, 6);
      ctx.fillStyle = FINISH;
      ctx.fillRect(0, flip(CROWD_FINISH_Y) - 4, CROWD_STREET_WIDTH, 8);

      // Obstacles — the whole board fits on screen, so nothing is culled.
      for (const o of state.obstacles) {
        ctx.fillStyle = o.kind === 'tree' ? TREE : o.kind === 'bicycle' ? BICYCLE : PEDESTRIAN;
        ctx.beginPath();
        ctx.ellipse(o.x, flip(o.y), o.rx, o.ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Rivals: their own avatar, at their own last-reported position —
      // scenery to look at, never something to collide with (spec §12 Q1).
      ctx.font = `${28}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const rival of rivals()) {
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.fillText(rival.avatar, rival.x, flip(rival.y));
        ctx.restore();
      }

      // This phone's own avatar, always drawn last so it is never hidden
      // under the crowd.
      ctx.font = `${34}px system-ui, sans-serif`;
      ctx.fillText(myAvatar, state.x, flip(state.y));

      ctx.restore();
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvas} class="crowd__canvas" />;
}
