import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { ASTEROID_LIVES, ASTEROID_REPORT_MS } from '../../../../shared/protocol';
import { useGameText } from '../../core/i18n/gameText';
import { trackSteer2, type Steer2Tracker } from '../../core/sensors/steer';
import { AsteroidRun, type RunEvent } from './game';
import { draw, makeStars, screenFraction, type View } from './render';

/**
 * Asteroid Race's board. Spec: docs/specs/games/asteroid-race.md §4, §5
 *
 * This component owns the whole run: one `requestAnimationFrame` loop steps
 * `AsteroidRun`, draws it, and writes the fast-moving HUD straight into the DOM
 * through refs. Preact never re-renders at frame rate — the two button charges
 * and the life pips change every frame, and re-rendering the room sixty times a
 * second to move a gradient stop would be the one performance mistake this
 * game could actually feel.
 *
 * What leaves here is a report, once a second (spec §6), plus a hit event so
 * the room can play the impact GIF.
 */

export type Report = { distance: number; lives: number; hits: number };

type Props = {
  roundId: number;
  /** Tilt is on. False falls back to the virtual stick (spec §5). */
  tilt: boolean;
  onReport: (report: Report) => void;
  /** A rock was clipped, at this fraction of the board — for the impact GIF. */
  onHit: (at: { x: number; y: number }) => void;
  onFinished: (report: Report) => void;
};

export function AsteroidCanvas({ roundId, tilt, onReport, onHit, onFinished }: Props): JSX.Element {
  const text = useGameText();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pipsRef = useRef<HTMLParagraphElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const boostRef = useRef<HTMLButtonElement>(null);
  const missileRef = useRef<HTMLButtonElement>(null);
  const runRef = useRef<AsteroidRun | null>(null);
  const latest = useRef({ tilt, onReport, onHit, onFinished });
  latest.current = { tilt, onReport, onHit, onFinished };

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;

    const run = new AsteroidRun(roundId);
    runRef.current = run;
    const stars = makeStars();
    let frame = 0;
    let last = performance.now();
    let reportedAt = 0;
    let reportedLives = ASTEROID_LIVES;
    let shownLives = -1;

    /** Tilt, when it is on. The game never touches a raw orientation event —
     *  `core/sensors` is the only place this codebase reads one (spec §5). */
    let tracker: Steer2Tracker | null = null;
    if (latest.current.tilt) {
      tracker = trackSteer2();
      // Calibrated here rather than at the first sample: this is the moment the
      // player is holding the phone to fly, not the moment they picked it up.
      setTimeout(() => tracker?.calibrate(), 0);
    }

    /** The fallback: drag anywhere on the board and the ship follows the
     *  thumb's offset from where it went down (spec §5). Two axes rule out Neon
     *  Fall's two held zones. */
    let stick: { originX: number; originY: number; x: number; y: number } | null = null;
    const STICK_REACH = 0.14; // fraction of the board width for full deflection

    const report = (): Report => ({ distance: run.distance, lives: run.lives, hits: run.hits });

    const loop = (now: number): void => {
      const dt = now - last;
      last = now;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (width === 0 || height === 0) {
        frame = requestAnimationFrame(loop);
        return;
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (element.width !== pixelWidth || element.height !== pixelHeight) {
        element.width = pixelWidth;
        element.height = pixelHeight;
      }
      const ctx = element.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const view: View = { width, height, dpr };

      let steerX = 0;
      let steerY = 0;
      if (tracker?.ready()) {
        const s = tracker.read();
        steerX = s.x;
        steerY = s.y;
      } else if (stick) {
        steerX = Math.max(-1, Math.min(1, (stick.x - stick.originX) / (width * STICK_REACH)));
        steerY = Math.max(-1, Math.min(1, -(stick.y - stick.originY) / (width * STICK_REACH)));
      }

      const events: RunEvent[] = run.step(dt, steerX, steerY);
      for (const event of events) {
        if (event.kind === 'hit') {
          const at = screenFraction(event.at, run, view);
          if (at) latest.current.onHit(at);
        }
      }

      draw(ctx, run, stars, view);

      // The HUD, written straight into the DOM — no Preact re-render.
      if (run.lives !== shownLives && pipsRef.current) {
        shownLives = run.lives;
        pipsRef.current.textContent = '●'.repeat(Math.max(0, run.lives)) + '○'.repeat(Math.max(0, ASTEROID_LIVES - run.lives));
      }
      if (barRef.current) barRef.current.style.setProperty('--progress', `${Math.min(1, run.distance / 2400) * 100}%`);
      if (boostRef.current) boostRef.current.style.setProperty('--charge', `${run.boostCharge * 100}%`);
      if (missileRef.current) missileRef.current.style.setProperty('--charge', `${run.missileCharge * 100}%`);

      // One report a second, plus the instant a life goes or the line is
      // crossed — never per frame (spec §6).
      const finished = run.finishedAtMs !== null || run.lives <= 0;
      if (run.elapsedMs - reportedAt >= ASTEROID_REPORT_MS || run.lives !== reportedLives || finished) {
        reportedAt = run.elapsedMs;
        reportedLives = run.lives;
        if (finished) {
          latest.current.onFinished(report());
          return; // the loop stops with the run; the board freezes where it is
        }
        latest.current.onReport(report());
      }

      frame = requestAnimationFrame(loop);
    };

    const localPoint = (event: PointerEvent): { x: number; y: number } => {
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (tracker) return; // tilt is flying; the board is not a control surface
      const p = localPoint(event);
      stick = { originX: p.x, originY: p.y, x: p.x, y: p.y };
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (!stick) return;
      const p = localPoint(event);
      stick.x = p.x;
      stick.y = p.y;
    };
    const onPointerUp = (): void => {
      // Released, the stick recentres — exactly what levelling the phone does.
      stick = null;
    };

    element.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      tracker?.stop();
      element.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [roundId]);

  return (
    <div class="asteroid__board">
      <canvas ref={canvasRef} class="asteroid__canvas" />
      <p ref={pipsRef} class="asteroid__lives" aria-label={text({ en: 'Your lives', fr: 'Vos vies' })}>
        {'●'.repeat(ASTEROID_LIVES)}
      </p>
      <div ref={barRef} class="asteroid__progress" aria-hidden="true" />
      <div class="asteroid__controls">
        <button
          ref={boostRef}
          type="button"
          class="asteroid__button asteroid__button--boost"
          onClick={() => runRef.current?.boost()}
        >
          {text({ en: 'Boost', fr: 'Boost' })}
        </button>
        <button
          ref={missileRef}
          type="button"
          class="asteroid__button asteroid__button--missile"
          onClick={() => runRef.current?.fire()}
        >
          {text({ en: 'Fire', fr: 'Tirer' })}
        </button>
      </div>
    </div>
  );
}
