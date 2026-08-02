import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Player, PlayerId } from '../../../../shared/protocol';
import type { RoomClient } from '../../core/room/client';
import type { SiegeGame } from './game';
import { startRenderer, type Renderer } from './render';

/**
 * The patch. Spec: docs/specs/games/goat-siege.md §4
 *
 * Tap a goat to shoo it; tap a neighbour's button to lob one at them. As in
 * Spill, the canvas animates on its own rAF loop and Preact only re-renders the
 * chrome, so a 60 fps virtual-DOM diff never happens.
 */
export function SiegeBoard({
  game,
  client,
  players,
  onLeave,
}: {
  game: SiegeGame;
  client: RoomClient | null;
  players: Player[];
  onLeave: () => void;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  // Seeded from the game: zero cabbages means you are out, so a board that
  // starts at zero would announce the wrong thing for a moment.
  const [cabbages, setCabbages] = useState(() => game.view(1, 1).cabbages);
  const [cooling, setCooling] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !client) return;
    const r = startRenderer(canvas, game, () => client.now());
    rendererRef.current = r;
    return () => {
      r.stop();
      rendererRef.current = null;
    };
  }, [game, client]);

  useEffect(() => {
    const tick = (): void => setCabbages(game.view(1, 1).cabbages);
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [game]);

  const roundId = game.state?.roundId ?? 0;

  function shoo(e: PointerEvent): void {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !client) return;
    const hit = game.shooAt(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    if (hit) client.send({ t: 'shoo', d: { goatId: hit.goatId, roundId } });
  }

  function lob(to: PlayerId): void {
    if (!client) return;
    client.send({ t: 'lob', d: { to, roundId } });
    // Local only — the server enforces the real cooldown. This just stops the
    // button reading as live while a lob is in flight to the server.
    setCooling(true);
    setTimeout(() => setCooling(false), 1500);
  }

  const out = game.view(1, 1).out;

  return (
    <div class="siege">
      <canvas ref={canvasRef} class="siege__canvas" onPointerDown={shoo} />

      <div class="siege__hud">
        <p class="siege__count">
          <strong>{cabbages}</strong>
          <span>cabbages</span>
        </p>
        <button class="btn siege__leave" type="button" onClick={onLeave}>
          Room
        </button>
      </div>

      <div class="siege__lobbar">
        {game.targets().map((id) => {
          const p = players.find((q) => q.id === id);
          return (
            <button
              key={id}
              class="btn siege__lob"
              type="button"
              disabled={cooling || out}
              onClick={() => lob(id)}
            >
              <span aria-hidden="true">{p?.avatar ?? '?'}</span>
              <span class="siege__lob-name">{p?.name ?? 'neighbour'}</span>
            </button>
          );
        })}
      </div>

      <p class="siege__hint">
        {out
          ? 'Your patch is bare. Watching the rest of them.'
          : 'Tap a goat to shoo it — it splits into two kids, so tap those too.'}
      </p>
    </div>
  );
}
