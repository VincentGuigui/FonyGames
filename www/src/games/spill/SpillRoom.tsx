import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  SPILL_LOSE_LEVEL,
  SPILL_MAX_PLAYERS,
  SPILL_MIN_PLAYERS,
  type Player,
  type ServerMessage,
  type SpillState,
} from '../../../../shared/protocol';
import { codeFromLocation, shareRoom, useRoom } from '../../core/room/useRoom';
import { AvatarPicker, CodeCard, ConnectionBanner, PlayerList } from '../../lobby/parts';
import { SeatMap } from './SeatMap';
import { SpillBoard } from './SpillBoard';
import { SpillGame } from './game';
import { THEMES, themeById } from './themes';
import { loadThemeId, saveThemeId } from './themePref';

/**
 * Spill's room screen. Spec: docs/specs/games/spill.md
 *
 * Two states: the table setup — where you are told where to put your phone —
 * and the board. The setup is not a loading screen: reading it is what makes
 * the aiming work, so it stays reachable mid-round from the board's Table
 * button (spec §8).
 */
export function SpillRoom({ game: card }: { game: GameCard }): JSX.Element {
  const code = useMemo(() => codeFromLocation(), []);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [themeId, setThemeId] = useState(loadThemeId);
  const [showMap, setShowMap] = useState(false);
  const [, redraw] = useState(0);

  // Created before the socket, because the first `spill` frame can arrive
  // before this component has ever re-rendered.
  const gameRef = useRef<SpillGame | null>(null);
  if (!gameRef.current) gameRef.current = new SpillGame();
  const game = gameRef.current;

  const onGame = useCallback(
    (msg: ServerMessage) => {
      game.apply(msg);
      // The game object is mutable and Preact cannot see into it. This nudges
      // the chrome only — the board animates on its own rAF loop.
      redraw((n) => n + 1);
    },
    [game],
  );

  const room = useRoom(code, onGame);
  const client = room.client;
  const theme = themeById(themeId);
  const myId = room.me?.id;

  useEffect(() => {
    if (client && myId) game.identify(myId, () => client.now());
  }, [game, client, myId]);

  useEffect(() => saveThemeId(themeId), [themeId]);

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

  if (state?.phase === 'running' && !showMap) {
    return (
      <SpillBoard
        game={game}
        theme={theme}
        client={client}
        me={myId ?? null}
        players={room.room?.players ?? []}
        onShowMap={() => setShowMap(true)}
      />
    );
  }

  const canStart =
    room.isHost && room.connected >= SPILL_MIN_PLAYERS && room.connected <= SPILL_MAX_PLAYERS;

  return (
    <div class="lobby spill-lobby" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
      <header class="lobby__header">
        {showMap ? (
          <button class="lobby__back" type="button" onClick={() => setShowMap(false)}>
            ← Back to the game
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
        <h2 class="setup__heading">Phones flat on the table</h2>
        <p class="setup__rule">
          Screen up, with the <strong>top edge pointing at the middle</strong> of the
          table.
        </p>
        {state && myId ? (
          <SeatMap
            seats={state.seats}
            players={room.room?.players ?? []}
            me={myId}
            out={state.out}
            size={220}
          />
        ) : (
          <p class="setup__hint">
            Your spot appears here when the round starts — {SPILL_MIN_PLAYERS} to{' '}
            {SPILL_MAX_PLAYERS} players in a ring.
          </p>
        )}
        <p class="setup__why">
          That one rule is what lets you aim: flick towards someone and it lands on
          their phone.
        </p>
        <p class="setup__warn" role="note">
          No actual liquids near the phones.
        </p>
      </section>

      {/* Outside the block below on purpose: the look is switchable mid-round
          from the Table screen, not only before the first one starts. */}
      <section class="theme-picker">
        <h2 class="players__heading">Look</h2>
        <div class="avatar-picker__row">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              class={`btn ${t.id === themeId ? 'btn--primary' : ''}`}
              aria-pressed={t.id === themeId}
              onClick={() => setThemeId(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
      </section>

      {showMap ? null : (
        <>
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
                const i = state?.seats.indexOf(id) ?? -1;
                return i < 0 ? null : `seat ${i + 1}`;
              }}
            />
            {room.me && <AvatarPicker current={room.me.avatar} onPick={room.setAvatar} />}
          </section>

          <footer class="lobby__footer">
            <button
              class="btn btn--primary btn--big"
              type="button"
              disabled={!canStart}
              onClick={() => client?.send({ t: 'start', d: { mode: 'spill' } })}
            >
              {state ? 'Play again' : 'Start round'}
            </button>
            <p class="lobby__note">{note(room.isHost, room.connected)}</p>
          </footer>
        </>
      )}
    </div>
  );
}

function note(isHost: boolean, connected: number): string {
  if (!isHost) return 'The host starts the round.';
  if (connected < SPILL_MIN_PLAYERS) return 'Waiting for one more player…';
  if (connected > SPILL_MAX_PLAYERS) {
    return `Spill is ${SPILL_MIN_PLAYERS}–${SPILL_MAX_PLAYERS} players — beyond that the ring gets too crowded to aim.`;
  }
  return `Empty your phone to win. Reach ${SPILL_LOSE_LEVEL} and you are out.`;
}

function Standings({
  state,
  players,
}: {
  state: SpillState;
  players: Player[];
}): JSX.Element {
  // Least left first: emptying your phone is the win condition.
  const ranked = [...state.seats].sort(
    (a, b) => (state.levels[a] ?? 0) - (state.levels[b] ?? 0),
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
              <span class="scoreline__time">{state.levels[id] ?? 0}</span>
              <span class="scoreline__unit">left</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
