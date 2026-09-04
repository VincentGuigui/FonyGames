import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { TILES_HEIGHT_TRACKS, TILES_LINE_FRACTION, TILES_SPAWN_INTERVAL_MS, TILES_TRACK_COUNT } from '../../../../shared/protocol';
import { TILES_COMMENT_MS, type LiveTile, type TilesRun } from './game';

/** Where the line sits for a board this tall — one formula, shared by drawing
 *  and by tap detection, so the two can never drift apart. */
function lineYFor(height: number): number {
  return height * TILES_LINE_FRACTION;
}

/** How long a tile is drawn: its own height, plus one spawn interval's worth of
 *  travel for every beat merged into it (spec §2.2b). */
function tileLengthPx(tile: LiveTile, tileHeightPx: number, lineY: number): number {
  return tileHeightPx + ((tile.beats - 1) * TILES_SPAWN_INTERVAL_MS * lineY) / tile.fallMs;
}

/** A tapped tile's own flash — a lighter version of the accent, always green. */
const TILES_HIT_COLOR = '#4ADE80';
/** A long tile being held right now — the same green, so "I have this" reads
 *  the same whether it is a flash or a hold in progress (spec §4). */
const TILES_HELD_COLOR = '#4ADE80';
/** A missed tile's own flash — the same idea, in red. */
const TILES_MISS_COLOR = '#F87171';

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
        // Banked before the sweep: a hold whose last beat lands this very frame
        // has been played out, not dropped.
        run.awardHolds(t);
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

      const pad = laneWidth * 0.12;
      for (const tile of run.tiles) {
        // A merged tile is drawn as ONE tile as long as the beats it swallowed
        // (spec §2.2b): its own height, plus a spawn interval's worth of travel
        // for every extra beat. Nothing here decides anything — `beatAt` in
        // game.ts owns when a beat actually lands.
        const bottomY = (lineY * (t - tile.spawnedAt)) / tile.fallMs;
        const lengthPx = tileLengthPx(tile, tileHeightPx, lineY);
        const topY = bottomY - lengthPx;
        if (bottomY < 0 || topY > height) continue;
        const x = tile.track * laneWidth;
        context.globalAlpha = 0.85;
        context.fillStyle = tile.held ? TILES_HELD_COLOR : accent;
        context.fillRect(x + pad, topY, laneWidth - pad * 2, lengthPx);
        // The beats inside a long tile, as faint ticks — a player has to see
        // that a long tile is worth several before holding one is a decision.
        if (tile.beats > 1) {
          context.globalAlpha = 0.35;
          context.fillStyle = '#0B1220';
          for (let n = 1; n < tile.beats; n++) {
            const y = bottomY - (lineY * n * TILES_SPAWN_INTERVAL_MS) / tile.fallMs;
            context.fillRect(x + pad, y - 1, laneWidth - pad * 2, 2);
          }
        }
      }
      context.globalAlpha = 1;

      // Accuracy feedback: a colour flash over the line and a symbol above it,
      // both fading out over TILES_COMMENT_MS, both anchored to the LINE rather
      // than the tile's last position — the line is what the tap judged against.
      run.pruneComments(t);
      context.textAlign = 'center';
      for (const c of run.comments) {
        const alpha = Math.max(0, 1 - (t - c.at) / TILES_COMMENT_MS);
        const cx = c.track * laneWidth + laneWidth / 2;

        context.globalAlpha = alpha * 0.85;
        context.fillStyle = c.hit ? TILES_HIT_COLOR : TILES_MISS_COLOR;
        context.fillRect(c.track * laneWidth + pad, lineY - tileHeightPx / 2, laneWidth - pad * 2, tileHeightPx);

        context.globalAlpha = alpha;
        context.font = '24px sans-serif';
        context.textBaseline = 'bottom';
        context.fillText(c.text, cx, lineY - tileHeightPx / 2 - 6);
      }
      context.globalAlpha = 1;

      onTick();
      frame = requestAnimationFrame(draw);
    };

    /**
     * Which lane each finger went down in. A long tile is held, so a press and
     * its release have to be paired per POINTER — two thumbs is the normal way
     * to hold one lane while tapping another, and a release has to free the
     * lane its own finger took, not whichever lane happens to be held.
     */
    const holding = new Map<number, number>();

    const laneOf = (event: PointerEvent, rect: DOMRect): number => {
      const laneWidth = rect.width / TILES_TRACK_COUNT;
      return Math.min(TILES_TRACK_COUNT - 1, Math.max(0, Math.floor((event.clientX - rect.left) / laneWidth)));
    };

    const onPointerDown = (event: PointerEvent): void => {
      const rect = element.getBoundingClientRect();
      const laneWidth = rect.width / TILES_TRACK_COUNT;
      const track = laneOf(event, rect);
      holding.set(event.pointerId, track);
      latest.current.run.press(track, latest.current.elapsedMs(), laneWidth * TILES_HEIGHT_TRACKS, lineYFor(rect.height));
      latest.current.onTick();
    };

    const onPointerUp = (event: PointerEvent): void => {
      const track = holding.get(event.pointerId);
      if (track === undefined) return;
      holding.delete(event.pointerId);
      latest.current.run.release(track, latest.current.elapsedMs());
      latest.current.onTick();
    };

    element.addEventListener('pointerdown', onPointerDown);
    // On window, not the canvas: a finger that slides off the board still has
    // to end its hold, and a pointercancel (a call, the app backgrounding)
    // must too — otherwise the tile is held by a finger that is not there.
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  return <canvas ref={canvas} class="tiles-canvas" />;
}
