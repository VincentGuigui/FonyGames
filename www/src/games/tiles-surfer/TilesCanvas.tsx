import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { TILES_HEIGHT_TRACKS, TILES_LINE_FRACTION, TILES_TRACK_COUNT } from '../../../../shared/protocol';
import type { TilesRun } from './game';

/** Where the line sits for a board this tall — one formula, shared by drawing
 *  and by tap detection, so the two can never drift apart. */
function lineYFor(height: number): number {
  return height * TILES_LINE_FRACTION;
}

type Props = {
  run: TilesRun;
  /** Local run time (ms since this round's own board started) — this player's own clock. */
  elapsedMs: () => number;
  accent: string;
  /** Called once per drawn frame, so the room can read `run`'s fields and check for a report. */
  onTick: () => void;
};

/**
 * Tiles Surfer's own board. Spec: docs/specs/games/tiles-surfer.md §4
 *
 * `FightCanvas.tsx`'s pattern: a `latest` prop ref plus one `requestAnimationFrame`
 * loop, DPR-aware. The one thing that makes this board different from every other
 * canvas in the catalogue is that the SIMULATION lives here too, not just the
 * drawing — `run.spawnDue`/`run.sweepMissed` run inside the same loop that paints,
 * because there is no referee tick to drive them from anywhere else (spec §8).
 *
 * A tap targets the LANE, not the tile's own moving pixel — a fixed column width
 * derived from measured canvas width, the same "tap the lane" idiom Neon Fall's
 * protector triggers already use, and the same "measure, don't guess" reasoning
 * Aliens Love Cows' own cone alignment fix already established.
 */
export function TilesCanvas({ run, elapsedMs, accent, onTick }: Props): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ run, elapsedMs, accent, onTick });
  latest.current = { run, elapsedMs, accent, onTick };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let frame = 0;

    const draw = (): void => {
      const { run, elapsedMs, accent, onTick } = latest.current;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (width === 0 || height === 0) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (element.width !== pixelWidth || element.height !== pixelHeight) {
        element.width = pixelWidth;
        element.height = pixelHeight;
      }
      const context = element.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const laneWidth = width / TILES_TRACK_COUNT;
      const tileHeightPx = laneWidth * TILES_HEIGHT_TRACKS;
      const lineY = lineYFor(height);
      const t = elapsedMs();

      if (run.alive) {
        run.spawnDue(t);
        run.sweepMissed(t, tileHeightPx, lineY);
      }

      context.strokeStyle = accent;
      context.globalAlpha = 0.15;
      context.lineWidth = 1;
      for (let i = 1; i < TILES_TRACK_COUNT; i++) {
        const x = Math.round(i * laneWidth) + 0.5;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }

      context.globalAlpha = 0.9;
      context.fillStyle = accent;
      context.fillRect(0, lineY, width, 2);

      context.globalAlpha = 0.85;
      const pad = laneWidth * 0.12;
      for (const tile of run.tiles) {
        const bottomY = (lineY * (t - tile.spawnedAt)) / tile.fallMs;
        const topY = bottomY - tileHeightPx;
        if (bottomY < 0 || topY > height) continue;
        const x = tile.track * laneWidth;
        context.fillRect(x + pad, topY, laneWidth - pad * 2, tileHeightPx);
      }
      context.globalAlpha = 1;

      onTick();
      frame = requestAnimationFrame(draw);
    };

    const onPointerDown = (event: PointerEvent): void => {
      const rect = element.getBoundingClientRect();
      const laneWidth = rect.width / TILES_TRACK_COUNT;
      const track = Math.min(TILES_TRACK_COUNT - 1, Math.max(0, Math.floor((event.clientX - rect.left) / laneWidth)));
      const tileHeightPx = laneWidth * TILES_HEIGHT_TRACKS;
      const lineY = lineYFor(rect.height);
      latest.current.run.tap(track, latest.current.elapsedMs(), tileHeightPx, lineY);
      latest.current.onTick();
    };

    element.addEventListener('pointerdown', onPointerDown);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  return <canvas ref={canvas} class="tiles-canvas" />;
}
