import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Player, PlayerId } from '../../../../shared/protocol';
import type { RoomClient } from '../../core/room/client';
import type { SiegeGame } from './game';
import { startRenderer, type Renderer } from './render';
import { StatusBar } from '../../core/ui/StatusBar';
import { RulesPanel } from '../../core/ui/RulesPanel';
import { useGameText } from '../../core/i18n/gameText';
import { Scoreboard } from '../../core/ui/Scoreboard';

/**
 * The patch. Spec: docs/specs/games/goat-siege.md §4
 *
 * Tap a goat to shoo it; tap a neighbour's button to lob one at them. As in
 * Spill, the canvas animates on its own rAF loop and Preact only re-renders the
 * chrome, so a 60 fps virtual-DOM diff never happens.
 */
export function SiegeBoard({
  game,
  title,
  concept,
  rules,
  accent,
  client,
  players,
}: {
  game: SiegeGame;
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
  const text = useGameText();
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

  // Straight off the state on every render. The state only changes when a message
  // arrives, which is exactly when a score changes, so there is nothing to poll.
  const state = game.state;
  const scores = (state?.players ?? []).map((id) => {
    const p = players.find((q) => q.id === id);
    return {
      id,
      avatar: p?.avatar ?? '?',
      name: p?.name ?? text({ en: 'neighbour', fr: 'voisin' }),
      value: state?.cabbages[id] ?? 0,
      out: !!state?.out.includes(id),
    };
  });

  return (
    <div class="siege" style={{ '--game-accent': accent } as JSX.CSSProperties}>
      <canvas ref={canvasRef} class="siege__canvas" onPointerDown={shoo} />

      <div class="siege__hud">
        <StatusBar
          score={{ value: cabbages, label: text({ en: 'cabbages', fr: 'choux' }) }}
          title={title}
          concept={concept}
          rules={rules}
        />
      </div>

      {/*
        Top right, not the default bottom left: the lob bar owns the bottom of this
        screen, and a panel over the neighbours' attack buttons would be a panel over
        the game's only control.
      */}
      <Scoreboard rows={scores} me={client?.playerId} unit={text({ en: 'cabbages', fr: 'choux' })} corner="top-right" />

      <div class="siege__lobbar">
        <span class="aimbar__label">{text({ en: 'Attack', fr: 'Attaquer' })}</span>
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
              <span class="siege__lob-name">{p?.name ?? text({ en: 'neighbour', fr: 'voisin' })}</span>
            </button>
          );
        })}
      </div>

      <p class="siege__hint">
        {out
          ? text({ en: 'Your patch is bare. Watching the rest of them.', fr: 'Votre potager est vide. Regardez les autres.' })
          : text({ en: 'Tap a goat to shoo it — it splits into two kids, so tap those too.', fr: 'Touchez une chèvre pour la chasser — elle se sépare en deux chevreaux, touchez-les aussi.' })}
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
