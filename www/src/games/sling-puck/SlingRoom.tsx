import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  SLING_PLAYERS,
  SLING_START_PUCKS,
  type Player,
  type ServerMessage,
  type SlingState,
} from '../../../../shared/protocol';
import { codeFromLocation, shareRoom, useRoom } from '../../core/room/useRoom';
import { GameLobby } from '../../lobby/GameLobby';
import { SlingBoard } from './SlingBoard';
import { HeadToHead } from './HeadToHead';
import { SlingGame } from './game';

/**
 * Sling Puck's room screen. Spec: docs/specs/games/sling-puck.md
 *
 * The lobby is the shared template (`lobby/GameLobby.tsx`). The only slot it
 * fills is the how-to-play aside, with the diagram of the two phones — because
 * "top edge to top edge" is a physical instruction the game cannot check and
 * cannot work without.
 */
export function SlingRoom({ game: card }: { game: GameCard }): JSX.Element {
  const code = useMemo(() => codeFromLocation(), []);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, redraw] = useState(0);

  const gameRef = useRef<SlingGame | null>(null);
  if (!gameRef.current) gameRef.current = new SlingGame();
  const game = gameRef.current;

  const onGame = useCallback(
    (msg: ServerMessage) => {
      game.apply(msg);
      // Every message, including `puck`. A crossing changes the score, and the
      // score is chrome — so the chrome has to re-render for it. Cheap enough to
      // do unconditionally: `SLING_MIN_GAP_MS` caps crossings at about eight a
      // second across both players, and the board itself paints on its own rAF
      // loop rather than through Preact.
      redraw((n) => n + 1);
    },
    [game],
  );

  const room = useRoom(code, card.slug, onGame);
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
      <SlingBoard
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
      canStart={room.isHost && room.connected === SLING_PLAYERS}
      startLabel={state ? 'Play again' : 'Start round'}
      onStart={() => client?.send({ t: 'start', d: { mode: 'sling' } })}
      note={note(room.isHost, room.connected)}
      playerTag={(id) => {
        const n = state?.pucks[id];
        return n === undefined ? null : `${n} left`;
      }}
      aside={
        <>
          <HeadToHead />
          <p class="howto__aside">
            Lay the two phones flat, <strong>top edge to top edge</strong>. The join
            between them is the gap.
          </p>
          {/* Spec §11: the only caution this game has. */}
          <p class="howto__warn" role="note">
            Two phones nose to nose get nudged — keep them off the table edge.
          </p>
        </>
      }
      {...(state?.phase === 'done'
        ? { standings: <Standings state={state} players={room.room?.players ?? []} /> }
        : {})}
    />
  );
}

function note(isHost: boolean, connected: number): string {
  if (!isHost) return 'The host starts the round.';
  if (connected < SLING_PLAYERS) return 'Waiting for your opponent…';
  // Exactly two, so "too many" is a real state and needs saying plainly.
  if (connected > SLING_PLAYERS) return 'Sling Puck is exactly two players.';
  return `${SLING_START_PUCKS} pucks each. First side clear wins.`;
}

function Standings({ state, players }: { state: SlingState; players: Player[] }): JSX.Element {
  // Fewest left first — the win condition is an empty side, so low is good here,
  // the opposite of Goat Siege's cabbages.
  const ranked = [...state.players].sort((a, b) => (state.pucks[a] ?? 0) - (state.pucks[b] ?? 0));
  return (
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
              <span class="scoreline__time">{state.pucks[id] ?? 0}</span>
              <span class="scoreline__unit">left</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
