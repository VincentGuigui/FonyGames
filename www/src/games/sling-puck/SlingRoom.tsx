import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  SLING_PLAYERS,
  SLING_START_PUCKS,
  type ServerMessage,
} from '../../../../shared/protocol';
import { useRoom, useShareRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { SlingBoard } from './SlingBoard';
import { GameOverScreen } from '../../core/ui/GameOver';
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

/**
 * Everything about *which* room is the shared gate's job: the chooser when there is no code
 * in the hash, "this room doesn't exist" when the hash is damaged, and this screen once
 * there is a room to be in (lobby/RoomGate.tsx). Five copies of that logic used to live in
 * five files, identical down to the comment.
 */
export function SlingRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code) => <SlingRoomInner game={props.game} code={code} />}</RoomGate>;
}

function SlingRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
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
  const { joinUrl, copied, showQr, share, toggleQr } = useShareRoom(code, card.title, room.setError);
  const client = room.client;
  const myId = room.me?.id;

  useEffect(() => {
    if (client && myId) game.identify(myId, () => client.now());
  }, [game, client, myId]);

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
        accent={card.accent}
        client={client}
        players={room.room?.players ?? []}
      />
    );
  }

  /* The result, on the shared end screen (core/ui/GameOver.tsx). */
  if (state?.phase === 'done') {
    const players = room.room?.players ?? [];
    const byId = new Map(players.map((p) => [p.id, p]));
    // Fewest left first — an empty side is the win here, the opposite of Goat Siege.
    const ranked = [...state.players].sort((a, b) => (state.pucks[a] ?? 0) - (state.pucks[b] ?? 0));
    return (
      <GameOverScreen
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        status="Round over"
        rows={ranked.map((id) => ({
          id,
          avatar: byId.get(id)?.avatar ?? '🙂',
          name: byId.get(id)?.name ?? 'Someone',
          value: state.pucks[id] ?? 0,
          unit: 'left',
        }))}
        me={myId}
        winner={game.winner}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'sling' } })}
        canAct={room.isHost && room.connected === SLING_PLAYERS}
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
      onToggleQr={toggleQr}
      canStart={room.isHost && room.connected === SLING_PLAYERS}
      startLabel={state ? 'Play again' : 'Start round'}
      onStart={() => client?.send({ t: 'start', d: { mode: 'sling' } })}
      note={note(room.isHost, room.connected)}
      soloSupported={false}
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

