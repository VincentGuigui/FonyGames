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
import { AvatarPicker, CodeCard, ConnectionBanner, PlayerList } from '../../lobby/parts';
import { SiegeBoard } from './SiegeBoard';
import { SiegeGame } from './game';

/**
 * Goat Siege's room screen. Spec: docs/specs/games/goat-siege.md
 *
 * Same composition as Spill's: the shared room chrome around a game-specific
 * middle. The board takes over while a round is running.
 */
export function SiegeRoom({ game: card }: { game: GameCard }): JSX.Element {
  const code = useMemo(() => codeFromLocation(), []);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inRoom, setInRoom] = useState(false);
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

  if (state?.phase === 'running' && !inRoom) {
    return (
      <SiegeBoard
        game={game}
        client={client}
        players={room.room?.players ?? []}
        onLeave={() => setInRoom(true)}
      />
    );
  }

  const canStart =
    room.isHost && room.connected >= SIEGE_MIN_PLAYERS && room.connected <= SIEGE_MAX_PLAYERS;

  return (
    <div class="lobby" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
      <header class="lobby__header">
        {inRoom && state?.phase === 'running' ? (
          <button class="lobby__back" type="button" onClick={() => setInRoom(false)}>
            ← Back to your patch
          </button>
        ) : (
          <a class="lobby__back" href="/">
            ← All games
          </a>
        )}
        <h1 class="lobby__title">{card.title}</h1>
        <p class="lobby__pitch">{card.pitch}</p>
      </header>

      <ConnectionBanner status={room.status} />

      <section class="setup">
        <h2 class="setup__heading">Mind your cabbages</h2>
        <p class="setup__rule">
          Lob a goat at a neighbour. Tap the ones coming for you —{' '}
          <strong>a shooed goat splits into two kids</strong>, and they eat too.
        </p>
        <p class="setup__why">
          So shooing everything is not the winning move. Sometimes you let one
          through on purpose.
        </p>
      </section>

      <CodeCard
        code={code}
        joinUrl={joinUrl}
        copied={copied}
        showQr={showQr}
        onShare={share}
        onToggleQr={() => setShowQr((v) => !v)}
      />

      {room.error && (
        <p class="lobby__error" role="alert">
          {room.error}
        </p>
      )}

      {state?.phase === 'done' && (
        <Standings state={state} players={room.room?.players ?? []} />
      )}

      <section class="players">
        <h2 class="players__heading">
          Players{room.room ? ` (${room.room.players.length})` : ''}
        </h2>
        <PlayerList
          room={room.room}
          me={room.me}
          onRename={room.rename}
          tagFor={(id) => {
            const n = state?.cabbages[id];
            return n === undefined ? null : `${n} left`;
          }}
        />
        {room.me && <AvatarPicker current={room.me.avatar} onPick={room.setAvatar} />}
      </section>

      <footer class="lobby__footer">
        <button
          class="btn btn--primary btn--big"
          type="button"
          disabled={!canStart}
          onClick={() => client?.send({ t: 'start', d: { mode: 'siege' } })}
        >
          {state ? 'Play again' : 'Start round'}
        </button>
        <p class="lobby__note">{note(room.isHost, room.connected)}</p>
      </footer>
    </div>
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

function Standings({
  state,
  players,
}: {
  state: GoatState;
  players: Player[];
}): JSX.Element {
  const ranked = [...state.players].sort(
    (a, b) => (state.cabbages[b] ?? 0) - (state.cabbages[a] ?? 0),
  );
  return (
    <section class="standings">
      <h2 class="players__heading">Result</h2>
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
