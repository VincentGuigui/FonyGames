import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  SIEGE_CABBAGES,
  SIEGE_MAX_PLAYERS,
  SIEGE_MIN_PLAYERS,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { soloTesting } from '../../core/solo';
import { useRoom, useShareRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { SiegeBoard } from './SiegeBoard';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { SiegeGame } from './game';

/**
 * Goat Siege's room screen. Spec: docs/specs/games/goat-siege.md
 *
 * The lobby is the shared template (`lobby/GameLobby.tsx`). Goat Siege needs
 * nothing from its slots except the result of the last round, which is the
 * point of having a template: a game that has no special requirements should
 * not have to restate the common ones.
 */

/**
 * Everything about *which* room is the shared gate's job: the chooser when there is no code
 * in the hash, "this room doesn't exist" when the hash is damaged, and this screen once
 * there is a room to be in (lobby/RoomGate.tsx). Five copies of that logic used to live in
 * five files, identical down to the comment.
 */
export function SiegeRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <SiegeRoomInner game={card} code={code} />}</RoomGate>;
}

function SiegeRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
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

  /*
   * Read once per render rather than per click: it changes only when the admin
   * centre writes it, which cannot happen while this page is open.
   */
  const solo = soloTesting();

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
      <SiegeBoard
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

  /*
   * The result, on the shared end screen (core/ui/GameOver.tsx) rather than as a panel
   * inside the lobby — see the note in `GameOver.tsx` about finishing looking like leaving.
   */
  if (state?.phase === 'done') {
    const players = room.room?.players ?? [];
    const byId = new Map(players.map((p) => [p.id, p]));
    // Most cabbages left wins here — the opposite of Spill and Sling Puck, which is
    // exactly why the shared panel never sorts anything itself.
    const ranked = [...state.players].sort((a, b) => (state.cabbages[b] ?? 0) - (state.cabbages[a] ?? 0));
    return (
      <GameOverScreen
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        rows={ranked.map((id) => ({
          id,
          avatar: byId.get(id)?.avatar ?? '🙂',
          name: byId.get(id)?.name ?? 'Someone',
          value: state.cabbages[id] ?? 0,
          unit: t.common.left,
          ...(state.out.includes(id) ? { out: true } : {}),
        }))}
        me={myId}
        winner={game.winner}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'siege', solo } })}
        canAct={
          room.isHost && enoughToStart(room.connected, [SIEGE_MIN_PLAYERS, SIEGE_MAX_PLAYERS], solo)
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
        room.isHost && enoughToStart(room.connected, [SIEGE_MIN_PLAYERS, SIEGE_MAX_PLAYERS], solo)
      }
      startLabel={state ? t.common.playAgain : t.common.startRound}
      onStart={() => client?.send({ t: 'start', d: { mode: 'siege', solo } })}
      note={note(room.isHost, room.connected, solo)}
      playerTag={(id) => {
        const n = state?.cabbages[id];
        return n === undefined ? null : `${n} left`;
      }}
    />
  );
}

function note(isHost: boolean, connected: number, solo: boolean): string {
  if (!isHost) return 'The host starts the round.';
  if (!solo && connected < SIEGE_MIN_PLAYERS) return 'Waiting for one more player…';
  if (connected > SIEGE_MAX_PLAYERS) {
    return `Goat Siege is ${SIEGE_MIN_PLAYERS}–${SIEGE_MAX_PLAYERS} players.`;
  }
  return `${SIEGE_CABBAGES} cabbages each. Last patch standing wins.`;
}

