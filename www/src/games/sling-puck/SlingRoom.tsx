import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  SLING_PLAYERS,
  SLING_START_PUCKS,
  type ServerMessage,
} from '../../../../shared/protocol';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { SlingBoard } from './SlingBoard';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText, type GameText } from '../../core/i18n/gameText';
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
  return <RoomGate game={props.game}>{(code, card) => <SlingRoomInner game={card} code={code} />}</RoomGate>;
}

function SlingRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
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

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
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
        room={room}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        rows={ranked.map((id) => ({
          id,
          avatar: byId.get(id)?.avatar ?? '🙂',
          name: byId.get(id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' }),
          value: id === game.winner ? text({ en: 'Win', fr: 'Gagné' }) : text({ en: 'Lose', fr: 'Perdu' }),
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
      startLabel={state ? t.common.playAgain : t.common.startRound}
      onStart={() => client?.send({ t: 'start', d: { mode: 'sling' } })}
      note={note(room.isHost, room.connected, text)}
      soloSupported={false}
      playerTag={(id) => {
        const n = state?.pucks[id];
        return n === undefined ? null : text({ en: `${n} left`, fr: `${n} restants` });
      }}
      aside={
        <>
          <HeadToHead />
          <p class="howto__aside">
            {text({ en: 'Lay the two phones flat, ', fr: 'Posez les deux téléphones à plat, ' })}
            <strong>{text({ en: 'top edge to top edge', fr: 'bord supérieur contre bord supérieur' })}</strong>.{' '}
            {text({ en: 'The join between them is the gap.', fr: 'La jonction entre eux forme l’ouverture.' })}
          </p>
          {/* Spec §11: the only caution this game has. */}
          <p class="howto__warn" role="note">
            {text({ en: 'Two phones nose to nose get nudged — keep them off the table edge.', fr: 'Deux téléphones face à face peuvent bouger — éloignez-les du bord de la table.' })}
          </p>
        </>
      }
    />
  );
}

function note(isHost: boolean, connected: number, text: GameText): string {
  if (!isHost) return text({ en: 'The host starts the round.', fr: "L’hôte démarre la manche." });
  if (connected < SLING_PLAYERS) return text({ en: 'Waiting for your opponent…', fr: 'En attente de votre adversaire…' });
  // Exactly two, so "too many" is a real state and needs saying plainly.
  if (connected > SLING_PLAYERS) return text({ en: 'Sling Puck is exactly two players.', fr: 'Sling Puck se joue exactement à deux.' });
  return text({ en: `${SLING_START_PUCKS} pucks each. First side clear wins.`, fr: `${SLING_START_PUCKS} palets chacun. Le premier à vider son côté gagne.` });
}

