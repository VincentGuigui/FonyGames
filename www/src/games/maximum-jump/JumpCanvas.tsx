import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { MAXJUMP_JUMP_STEP, MAXJUMP_STRIDE } from '../../../../shared/protocol';
import type { Attempt } from './jump';
import sheet from './art/jumper.png';

/**
 * Maximum Jump's board. Spec: docs/specs/games/maximum-jump.md §4
 *
 * `TrackCanvas.tsx`'s pattern — a `latest` prop ref plus one
 * `requestAnimationFrame` loop, DPR-aware — with the simulation stepped by the
 * caller through `onFrame`, because the run-up has to advance whether or not
 * anything is being drawn.
 *
 * The camera holds the jumper at `CAMERA_X` of the board's width and scrolls
 * the world past them, so the run-up reads as running rather than as a figure
 * sliding off the edge. Metres in, pixels out: the world is metres (jump.ts)
 * and `PPM` is the only place that changes.
 */

type Props = {
  /** Read fresh every frame: the attempt is stepped by the caller's loop. */
  attempt: () => Attempt;
  accent: string;
  onFrame: (dtMs: number) => void;
};

/** The sheet: 6 columns, 2 rows (generate-jumper.mjs). */
const CELL = 128;
const RUN_FRAMES = 6;
const SPECIAL = { takeoff: 0, hang: 1, flap: 2, land: 3, faceplant: 4, idle: 5 } as const;

/** Pixels per metre at a 1x board, and where the jumper sits across it. */
const PPM = 26;
const CAMERA_X = 0.3;
/** How high off the ground the figure's own feet are in its cell, as a share
 *  of the cell — the sprite is drawn standing, not centred. */
const FOOT = 0.92;

const SKY_TOP = '#101823';
const SKY_LOW = '#1D2733';
const TRACK = '#8C4A32';
const SAND = '#D9C79A';
const BOARD = '#F3E9D2';
const MARK = '#2A3441';

export function JumpCanvas({ attempt, accent, onFrame }: Props): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ attempt, accent, onFrame });
  latest.current = { attempt, accent, onFrame };
  const image = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.src = sheet;
    image.current = img;
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let frame = 0;
    let last = performance.now();

    const draw = (): void => {
      const { attempt, accent, onFrame } = latest.current;
      const now = performance.now();
      // Clamped: a backgrounded tab comes back with a gap of seconds, and
      // stepping that in one go would fly the whole jump in a single frame.
      const dtMs = Math.min(64, now - last);
      last = now;
      onFrame(dtMs);

      const ctx = element.getContext('2d');
      if (!ctx) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = element.clientWidth;
      const h = element.clientHeight;
      if (element.width !== Math.round(w * dpr) || element.height !== Math.round(h * dpr)) {
        element.width = Math.round(w * dpr);
        element.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const a = attempt();
      // Where the jumper is along the world, in metres from the start.
      const line = MAXJUMP_JUMP_STEP * MAXJUMP_STRIDE;
      const me = a.phase === 'run' ? a.atStep * MAXJUMP_STRIDE : line + a.x;
      // High enough that the track and the jumper's feet clear the control row
      // along the bottom, which is fixed height and overlays the board.
      const ground = h * 0.64;
      const originX = w * CAMERA_X - me * PPM;
      const at = (metres: number): number => originX + metres * PPM;

      const sky = ctx.createLinearGradient(0, 0, 0, ground);
      sky.addColorStop(0, SKY_TOP);
      sky.addColorStop(1, SKY_LOW);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, ground);

      // The track, then the board, then the pit.
      ctx.fillStyle = TRACK;
      ctx.fillRect(0, ground, Math.min(w, at(line)), h - ground);
      ctx.fillStyle = SAND;
      ctx.fillRect(Math.max(0, at(line)), ground, w, h - ground);
      ctx.fillStyle = BOARD;
      ctx.fillRect(at(line) - 4, ground, 8, h - ground);

      // Distance marks every five metres, so the run-up and the flight both
      // read as movement rather than as a stationary figure on a flat colour.
      ctx.fillStyle = MARK;
      for (let m = 0; m <= line + 20; m += 5) {
        const x = at(m);
        if (x < -10 || x > w + 10) continue;
        ctx.fillRect(x, ground, 2, 6);
      }

      // The take-off line, called out in the accent so it is never a surprise.
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(at(line), ground);
      ctx.lineTo(at(line), ground - h * 0.16);
      ctx.stroke();

      const sprite = image.current;
      if (sprite?.complete && sprite.naturalWidth > 0) {
        const size = Math.min(h * 0.44, 150);
        const cell = frameFor(a);
        const x = w * CAMERA_X - size / 2;
        const y = ground - a.y * PPM - size * FOOT;
        ctx.drawImage(sprite, cell.col * CELL, cell.row * CELL, CELL, CELL, x, y, size, size);
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvas} class="maxjump__canvas" />;
}

/**
 * Which cell of the sheet this moment is.
 *
 * The run cycle is walked by *distance*, not by a timer: a jumper who is going
 * faster takes more strides in the same second, and driving the animation off
 * the clock instead would leave the feet skating.
 */
function frameFor(a: Attempt): { col: number; row: number } {
  if (a.phase === 'foul') return { col: SPECIAL.faceplant, row: 1 };
  if (a.phase === 'landed') return { col: SPECIAL.land, row: 1 };
  if (a.phase === 'flight') {
    // Rising is still the take-off shape; falling is the landing one; the
    // middle of the arc is the hang, alternating with the flap so the tapping
    // has something to look like.
    if (a.vy > 2) return { col: SPECIAL.takeoff, row: 1 };
    if (a.vy < -3) return { col: SPECIAL.land, row: 1 };
    return { col: Math.floor(a.x * 3) % 2 === 0 ? SPECIAL.hang : SPECIAL.flap, row: 1 };
  }
  if (a.speed <= 0) return { col: SPECIAL.idle, row: 1 };
  return { col: Math.floor(a.atStep * 2) % RUN_FRAMES, row: 0 };
}
