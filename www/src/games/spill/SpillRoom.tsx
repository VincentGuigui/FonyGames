import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  SPILL_MAX_PLAYERS,
  SPILL_MIN_PLAYERS,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { useSoloTesting } from '../../core/useSolo';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { SeatMap } from './SeatMap';
import { SpillBoard } from './SpillBoard';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useLocale } from '../../core/i18n/LocaleContext';
import { useGameText } from '../../core/i18n/gameText';
import { SpillGame } from './game';
import { SPILL_THEME } from './themes';

/**
 * Spill's room screen. Spec: docs/specs/games/spill.md
 *
 * The lobby is the shared template (`lobby/GameLobby.tsx`); what is specific to
 * Spill goes in its slots — the table diagram inside how-to-play, and the theme
 * picker below the players. Reading the placement rule is what makes the aiming
 * work, so the diagram is also in the board's gear menu: it has to stay
 * reachable mid-round (spec §8).
 */

/**
 * Everything about *which* room is the shared gate's job: the chooser when there is no code
 * in the hash, "this room doesn't exist" when the hash is damaged, and this screen once
 * there is a room to be in (lobby/RoomGate.tsx). Five copies of that logic used to live in
 * five files, identical down to the comment.
 */
export function SpillRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <SpillRoomInner game={card} code={code} />}</RoomGate>;
}

function SpillRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const themeWords = SPILL_THEME.words[useLocale().locale];
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

  /*
   * Read once per render rather than per click: it changes only when the admin
   * centre writes it, which cannot happen while this page is open.
   */
  const solo = useSoloTesting();

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;

  useEffect(() => {
    if (client && myId) game.identify(myId, () => client.now());
  }, [game, client, myId]);


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
        theme={SPILL_THEME}
        client={client}
        me={myId ?? null}
        players={room.room?.players ?? []}
      />
    );
  }

  /*
   * The result, on the shared end screen (core/ui/GameOver.tsx).
   *
   * Until now a finished round dropped back to the LOBBY with a small "Result" panel
   * pushed down between the room code and the avatar picker — so winning looked like
   * leaving, and "play again" was a lobby button below two panels of joining furniture.
   */
  if (state?.phase === 'done') {
    const players = room.room?.players ?? [];
    const byId = new Map(players.map((p) => [p.id, p]));
    // Least left first: emptying your phone is the win condition, so `low` is good here
    // and this is one of the two games where sorting the other way would rank the loser.
    const ranked = [...state.seats].sort((a, b) => (state.levels[a] ?? 0) - (state.levels[b] ?? 0));
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
          // The winner emptied their phone — a number next to "Win" would only
          // repeat what the crown at the top of the panel already says.
          ...(id === game.winner
            ? { value: t.common.win }
            : { value: state.levels[id] ?? 0, unit: `${themeWords.unitPlural} ${themeWords.left}` }),
          ...(state.out.includes(id) ? { out: true } : {}),
        }))}
        me={myId}
        winner={game.winner}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'spill', solo } })}
        canAct={
          room.isHost && enoughToStart(room.connected, [SPILL_MIN_PLAYERS, SPILL_MAX_PLAYERS], solo)
        }
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
      canStart={
        room.isHost && enoughToStart(room.connected, [SPILL_MIN_PLAYERS, SPILL_MAX_PLAYERS], solo)
      }
      startLabel={state ? t.common.playAgain : t.common.startRound}
      onStart={() => client?.send({ t: 'start', d: { mode: 'spill', solo } })}
      playerTag={(id) => {
        const i = state?.seats.indexOf(id) ?? -1;
        return i < 0 ? null : text({ en: `seat ${i + 1}`, fr: `place ${i + 1}` });
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
              {text({ en: 'Your spot on the table appears here when the round starts —', fr: 'Votre place autour de la table apparaîtra ici au début de la manche —' })}{' '}
              {text({ en: `${SPILL_MIN_PLAYERS} to ${SPILL_MAX_PLAYERS} players in a ring.`, fr: `${SPILL_MIN_PLAYERS} à ${SPILL_MAX_PLAYERS} joueurs en cercle.` })}
            </p>
          )}
          <p class="howto__warn" role="note">
            {text({ en: 'No actual liquids near the phones.', fr: 'Aucun vrai liquide près des téléphones.' })}
          </p>
        </>
      }
    />
  );
}
