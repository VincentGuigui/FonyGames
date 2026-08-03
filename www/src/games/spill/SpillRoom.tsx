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
import { GameLobby } from '../../lobby/GameLobby';
import { SeatMap } from './SeatMap';
import { SpillBoard } from './SpillBoard';
import { SpillGame } from './game';
import { THEMES, themeById } from './themes';
import { loadThemeId, saveThemeId } from './themePref';

/**
 * Spill's room screen. Spec: docs/specs/games/spill.md
 *
 * The lobby is the shared template (`lobby/GameLobby.tsx`); what is specific to
 * Spill goes in its slots — the table diagram inside how-to-play, and the theme
 * picker below the players. Reading the placement rule is what makes the aiming
 * work, so the diagram is also in the board's gear menu: it has to stay
 * reachable mid-round (spec §8).
 */
export function SpillRoom({ game: card }: { game: GameCard }): JSX.Element {
  const code = useMemo(() => codeFromLocation(), []);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [themeId, setThemeId] = useState(loadThemeId);
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

  const room = useRoom(code, card.slug, onGame);
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

  // While a round is live the board owns the screen. Everything the player
  // might want mid-round — the rules, the table diagram, the look, the way out
  // — is in the board's gear menu, so there is no bouncing back to the lobby.
  if (state?.phase === 'running') {
    return (
      <SpillBoard
        game={game}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        theme={theme}
        themeId={themeId}
        onTheme={setThemeId}
        client={client}
        me={myId ?? null}
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
        room.isHost && room.connected >= SPILL_MIN_PLAYERS && room.connected <= SPILL_MAX_PLAYERS
      }
      startLabel={state ? 'Play again' : 'Start round'}
      onStart={() => client?.send({ t: 'start', d: { mode: 'spill' } })}
      note={note(room.isHost, room.connected)}
      playerTag={(id) => {
        const i = state?.seats.indexOf(id) ?? -1;
        return i < 0 ? null : `seat ${i + 1}`;
      }}
      aside={
        <>
          {state && myId ? (
            <SeatMap
              seats={state.seats}
              players={room.room?.players ?? []}
              me={myId}
              out={state.out}
              size={220}
            />
          ) : (
            <p class="howto__aside">
              Your spot on the table appears here when the round starts —{' '}
              {SPILL_MIN_PLAYERS} to {SPILL_MAX_PLAYERS} players in a ring.
            </p>
          )}
          <p class="howto__warn" role="note">
            No actual liquids near the phones.
          </p>
        </>
      }
      {...(state?.phase === 'done'
        ? { standings: <Standings state={state} players={room.room?.players ?? []} /> }
        : {})}
      extras={
        <section class="panel">
          <h2 class="panel__heading">Look</h2>
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
      }
    />
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

function Standings({ state, players }: { state: SpillState; players: Player[] }): JSX.Element {
  // Least left first: emptying your phone is the win condition.
  const ranked = [...state.seats].sort(
    (a, b) => (state.levels[a] ?? 0) - (state.levels[b] ?? 0),
  );
  return (
    // `standings` alongside `panel`: it looks like every other panel, but the
    // result of a round should still be identifiable in the DOM.
    <section class="panel standings">
      <h2 class="panel__heading">Result</h2>
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
