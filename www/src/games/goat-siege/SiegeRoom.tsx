import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  SIEGE_CABBAGES,
  SIEGE_MAX_PLAYERS,
  SIEGE_MIN_PLAYERS,
  type GoatState,
  type Player,
  type ServerMessage,
} from '../../../../shared/protocol';
import { codeFromLocation, shareRoom, useRoom } from '../../core/room/useRoom';
import { GameLobby } from '../../lobby/GameLobby';
import { SiegeBoard } from './SiegeBoard';
import { SiegeGame } from './game';

/**
 * Goat Siege's room screen. Spec: docs/specs/games/goat-siege.md
 *
 * The lobby is the shared template (`lobby/GameLobby.tsx`). Goat Siege needs
 * nothing from its slots except the result of the last round, which is the
 * point of having a template: a game that has no special requirements should
 * not have to restate the common ones.
 */
export function SiegeRoom({ game: card }: { game: GameCard }): JSX.Element {
  const code = useMemo(() => codeFromLocation(), []);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, redraw] = useState(0);

  const gameRef = useRef<SiegeGame | null>(null);
  if (!gameRef.current) gameRef.current = new SiegeGame();
  const game = gameRef.current;

  const onGame = useCallback(
    (msg: ServerMessage) => {
      game.apply(msg);
      redraw((n) => n + 1);
    },
    [game],
  );

  const room = useRoom(code, onGame);
  const client = room.client;
  const myId = room.me?.id;

  useEffect(() => {
    if (client && myId) game.identify(myId, () => client.now());
  }, [game, client, myId]);

  const joinUrl = `${location.origin}${location.pathname}#${code}`;

  async function share(): Promise<void> {
    const outcome = await shareRoom(card.title, code, joinUrl);
    if (outcome === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else if (outcome === 'failed') {
      room.setError('Could not copy — long-press the code to select it.');
    }
  }

  const state = game.state;

  // While a round is live the board owns the screen; the rules and the way out
  // live in its gear menu, so there is no bouncing back to the lobby.
  if (state?.phase === 'running') {
    return (
      <SiegeBoard
        game={game}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        client={client}
        players={room.room?.players ?? []}
      />
    );
  }

  return (
    <GameLobby
      card={card}
      code={code}
      joinUrl={joinUrl}
      room={room}
      copied={copied}
      showQr={showQr}
      onShare={share}
      onToggleQr={() => setShowQr((v) => !v)}
      canStart={
        room.isHost && room.connected >= SIEGE_MIN_PLAYERS && room.connected <= SIEGE_MAX_PLAYERS
      }
      startLabel={state ? 'Play again' : 'Start round'}
      onStart={() => client?.send({ t: 'start', d: { mode: 'siege' } })}
      note={note(room.isHost, room.connected)}
      playerTag={(id) => {
        const n = state?.cabbages[id];
        return n === undefined ? null : `${n} left`;
      }}
      {...(state?.phase === 'done'
        ? { standings: <Standings state={state} players={room.room?.players ?? []} /> }
        : {})}
    />
  );
}

function note(isHost: boolean, connected: number): string {
  if (!isHost) return 'The host starts the round.';
  if (connected < SIEGE_MIN_PLAYERS) return 'Waiting for one more player…';
  if (connected > SIEGE_MAX_PLAYERS) {
    return `Goat Siege is ${SIEGE_MIN_PLAYERS}–${SIEGE_MAX_PLAYERS} players.`;
  }
  return `${SIEGE_CABBAGES} cabbages each. Last patch standing wins.`;
}

function Standings({ state, players }: { state: GoatState; players: Player[] }): JSX.Element {
  const ranked = [...state.players].sort(
    (a, b) => (state.cabbages[b] ?? 0) - (state.cabbages[a] ?? 0),
  );
  return (
    <section class="panel">
      <h2 class="panel__heading">Result</h2>
      <ol class="scoreline">
        {ranked.map((id) => {
          const p = players.find((q) => q.id === id);
          return (
            <li key={id}>
              <span class="scoreline__name">
                {p?.avatar} {p?.name ?? '—'}
              </span>
              <span class="scoreline__time">{state.cabbages[id] ?? 0}</span>
              <span class="scoreline__unit">left</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
