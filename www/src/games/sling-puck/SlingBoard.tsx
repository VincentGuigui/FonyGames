import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Player } from '../../../../shared/protocol';
import type { RoomClient } from '../../core/room/client';
import type { SlingGame } from './game';
import { startRenderer, type Renderer } from './render';
import { toBoard, onBoard } from './layout';
import { PUCK_RADIUS } from './physics';
import { StatusBar } from '../../core/ui/StatusBar';
import { RulesPanel } from '../../core/ui/RulesPanel';
import { Scoreboard } from '../../core/ui/Scoreboard';

/**
 * Your half of the board. Spec: docs/specs/games/sling-puck.md §8, §13
 *
 * Drag a puck back and let go. As in Spill and Goat Siege the canvas animates on
 * its own rAF loop and Preact only re-renders the chrome, so a 60 fps
 * virtual-DOM diff never happens — but here the loop is also what advances the
 * simulation, so `onCross` is wired straight into it.
 *
 * Pointer handling here is deliberately dumb: down grabs, move carries, up
 * releases. Whether a release throws the puck is decided in `game.ts`, which knows
 * whether it was actually pulled — so a tap cannot be turned into a shot by the
 * component.
 */

export function SlingBoard({
  game,
  title,
  concept,
  rules,
  accent,
  client,
  players,
}: {
  game: SlingGame;
  title: string;
  concept: string;
  rules: string[];
  /**
   * The game's accent, set as `--game-accent` on the round screen's own root.
   *
   * The lobby template sets it for its screens and the round screen is not inside it,
   * so without this every accented thing here — the status bar's number, the score
   * panel's values — fell back to the SITE accent. That is how Ghost Hunt shipped a
   * green game with an orange radar.
   */
  accent: string;
  client: RoomClient | null;
  players: Player[];
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  // The pointer that owns the current drag. One finger at a time on the band.
  const pointerRef = useRef<{ id: number } | null>(null);

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
    pointerRef.current = { id: e.pointerId };
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent): void {
    const owner = pointerRef.current;
    if (!owner || owner.id !== e.pointerId) return;
    const p = at(e);
    if (!p) return;
    game.drag(p.x, p.y);
  }

  function up(e: PointerEvent): void {
    const owner = pointerRef.current;
    if (!owner || owner.id !== e.pointerId) return;
    pointerRef.current = null;
    // Always a release. Whether it *fires* is the game's call, not the component's:
    // a puck that was never pulled is put back down, so a tap is not a shot and
    // tapping repeatedly does nothing at all.
    game.release();
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

  // "Theirs" used to be a second big number in the corner of this board. It is the
  // shared panel now, so the same glance works the same way in every game.
  const state = game.state;
  const scores = (state?.players ?? []).map((id) => {
    const p = players.find((q) => q.id === id);
    return {
      id,
      avatar: p?.avatar ?? '?',
      name: p?.name ?? 'them',
      value: state?.pucks[id] ?? 0,
    };
  });

  return (
    <div class="sling" style={{ '--game-accent': accent } as JSX.CSSProperties}>
      <canvas
        ref={canvasRef}
        class="sling__canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={lost}
      />

      <div class="sling__hud">
        <StatusBar
          score={{ value: view.mine, label: 'yours' }}
          title={title}
          concept={concept}
          rules={rules}
        />
      </div>

      {/*
        Emptying your half wins, so FEWEST pucks is the lead — the one game besides
        Spill where `best: 'high'` would put the bold on whoever is losing.

        Top right, because the bottom half of this screen is the player's own board and
        a panel over it would be a panel over the thing they are flicking.
      */}
      <Scoreboard rows={scores} me={client?.playerId} unit="pucks" best="low" corner="top-right" />

      <p class="sling__hint">
        {view.spectating
          ? 'Watching this one out.'
          : 'Drag a puck down onto the elastic, pull back and let go.'}
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
