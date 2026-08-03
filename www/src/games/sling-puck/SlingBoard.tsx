import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RoomClient } from '../../core/room/client';
import type { SlingGame } from './game';
import { startRenderer, type Renderer } from './render';
import { toBoard, onBoard } from './layout';
import { PUCK_RADIUS } from './physics';
import { GameMenu } from '../../core/ui/GameMenu';
import { RulesPanel } from '../../core/ui/RulesPanel';

/**
 * Your half of the board. Spec: docs/specs/games/sling-puck.md §8, §13
 *
 * Drag a puck back and let go. As in Spill and Goat Siege the canvas animates on
 * its own rAF loop and Preact only re-renders the chrome, so a 60 fps
 * virtual-DOM diff never happens — but here the loop is also what advances the
 * simulation, so `onCross` is wired straight into it.
 *
 * A tap without a drag fires the puck at the gap instead, at a fixed speed: the
 * accessibility fallback from §13, required in the first iteration rather than
 * later.
 */

/** Movement under this many board units is a tap, not a drag. */
const TAP_SLOP = PUCK_RADIUS * 0.6;

export function SlingBoard({
  game,
  title,
  concept,
  rules,
  client,
}: {
  game: SlingGame;
  title: string;
  concept: string;
  rules: string[];
  client: RoomClient | null;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  // The pointer that owns the current drag, and where it started, so a tap can
  // be told from a drag on release.
  const pointerRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !client) return;
    const r = startRenderer(
      canvas,
      game,
      () => client.now(),
      (c) => {
        const roundId = game.state?.roundId ?? 0;
        client.send({ t: 'cross', d: { roundId, x: c.x, vx: c.vx, vy: c.vy } });
      },
    );
    rendererRef.current = r;
    return () => {
      r.stop();
      rendererRef.current = null;
    };
  }, [game, client]);

  /** Pointer position in board units, or null before the first frame. */
  function at(e: PointerEvent): { x: number; y: number } | null {
    const rect = canvasRef.current?.getBoundingClientRect();
    const b = rendererRef.current?.board();
    if (!rect || !b) return null;
    return toBoard(b, e.clientX - rect.left, e.clientY - rect.top);
  }

  function down(e: PointerEvent): void {
    if (pointerRef.current) return; // one finger owns the band
    const p = at(e);
    if (!p || !onBoard(p.x, p.y, PUCK_RADIUS)) return;
    if (!game.grab(p.x, p.y)) return;
    pointerRef.current = { id: e.pointerId, x: p.x, y: p.y, moved: false };
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent): void {
    const owner = pointerRef.current;
    if (!owner || owner.id !== e.pointerId) return;
    const p = at(e);
    if (!p) return;
    if (Math.hypot(p.x - owner.x, p.y - owner.y) > TAP_SLOP) owner.moved = true;
    game.drag(p.x, p.y);
  }

  function up(e: PointerEvent): void {
    const owner = pointerRef.current;
    if (!owner || owner.id !== e.pointerId) return;
    pointerRef.current = null;

    if (owner.moved) {
      game.release();
    } else {
      // A tap, not a drag: fire at the gap at a fixed speed (spec §13). The grab
      // from pointerdown is released first so `tap` can make its own.
      game.cancel();
      game.tap(owner.x, owner.y);
    }
  }

  function lost(e: PointerEvent): void {
    const owner = pointerRef.current;
    if (!owner || owner.id !== e.pointerId) return;
    pointerRef.current = null;
    // A cancelled pointer is not a shot. Firing one would mean a notification
    // sliding down mid-drag cost you a puck.
    game.cancel();
  }

  // Read straight from the game on every render, rather than mirrored into state
  // by a timer. A polled copy lagged the crossing that changed it, and in a
  // throttled background tab it stopped updating altogether — the count showed a
  // score the server had already moved on from.
  const view = game.view();

  return (
    <div class="sling">
      <canvas
        ref={canvasRef}
        class="sling__canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={lost}
      />

      <div class="sling__hud">
        <p class="sling__count">
          <strong>{view.mine}</strong>
          <span>yours</span>
        </p>
        <p class="sling__count sling__count--them">
          <strong>{view.theirs}</strong>
          <span>theirs</span>
        </p>
        <GameMenu title={title} concept={concept} rules={rules} />
      </div>

      <p class="sling__hint">
        {view.spectating
          ? 'Watching this one out.'
          : 'Drag a puck back and let go — or just tap one to fire it straight.'}
      </p>

      {/* Keyed on the round so "Play again" always shows a fresh panel. */}
      {game.state && (
        <RulesPanel
          key={game.state.roundId}
          title={title}
          concept={concept}
          rules={rules}
          startsAt={game.state.startsAt}
          now={() => client?.now() ?? Date.now()}
        />
      )}
    </div>
  );
}
