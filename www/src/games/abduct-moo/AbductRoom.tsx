import { useCallback, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  ABDUCT_MAX_PLAYERS,
  ABDUCT_MIN_PLAYERS,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { useSoloTesting } from '../../core/useSolo';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useGameText, type GameText } from '../../core/i18n/gameText';
import { applyAbduct, ranking, scoreOf, type AbductState } from './game';
import { AbductScreen } from './AbductScreen';

/**
 * Abduct-Moo's room screen. Spec: docs/specs/games/abduct-moo.md
 *
 * Touch only, no permission to request — closer in shape to 100 Taps' own room
 * than to UFO Hunt's. The one thing this game has that neither of those does: it
 * runs, round after round, entirely on its own inside a single `start` until one
 * cow is left standing — `state.phase === 'done'` is the only moment `again()`
 * is ever offered, there is no host action in between (spec §2).
 */
export function AbductRoom(props: { game: GameCard }): JSX.Element {
  return (
    <RoomGate game={props.game}>
      {(code, card) => <AbductRoomInner game={card} code={code} />}
    </RoomGate>
  );
}

function AbductRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const text = useGameText();
  const [state, setState] = useState<AbductState>(null);

  const onGame = useCallback((msg: ServerMessage) => {
    setState((prev) => applyAbduct(prev, msg));
  }, []);

  const solo = useSoloTesting();
  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;

  const limits: [number, number] = [ABDUCT_MIN_PLAYERS, ABDUCT_MAX_PLAYERS];
  const enough = enoughToStart(room.connected, limits, solo);
  const again = (): void => client?.send({ t: 'start', d: { mode: 'abduct', solo } });

  if (state && state.phase !== 'done') {
    return (
      <AbductScreen
        state={state}
        players={room.room?.players ?? []}
        myId={myId}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        accent={card.accent}
        now={() => client?.now() ?? Date.now()}
        onPick={(barn) => {
          if (!client) return;
          client.send({ t: 'abduct-pick', d: { roundId: state.roundId, round: state.round, barn } });
        }}
      />
    );
  }

  if (state && state.phase === 'done') {
    const players = room.room?.players ?? [];
    const order = ranking(state, players.map((p) => p.id));
    const byId = new Map(players.map((p) => [p.id, p]));
    return (
      <GameOverScreen
        room={room}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        status={text({ en: 'Match over', fr: 'Partie terminée' })}
        rows={order.map((id) => ({
          id,
          avatar: byId.get(id)?.avatar ?? '🐄',
          name: byId.get(id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' }),
          value: scoreOf(state, id),
          unit: text({ en: 'points', fr: 'points' }),
          out: state.out.includes(id),
        }))}
        me={myId}
        winner={state.winner}
        onAgain={again}
        againLabel={text({ en: 'Play again', fr: 'Rejouer' })}
        canAct={room.isHost && enough}
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
      canStart={room.isHost && enough}
      startLabel={state ? text({ en: 'Play again', fr: 'Rejouer' }) : text({ en: 'Start the match', fr: 'Démarrer la partie' })}
      onStart={again}
      note={note(room.isHost, room.connected, solo, text)}
    />
  );
}

function note(isHost: boolean, connected: number, solo: boolean, text: GameText): string {
  if (!solo && connected < ABDUCT_MIN_PLAYERS) return text({ en: 'Waiting for one more player…', fr: 'En attente d’un joueur supplémentaire…' });
  if (connected > ABDUCT_MAX_PLAYERS) {
    return text({ en: `Abduct-Moo is ${ABDUCT_MIN_PLAYERS}–${ABDUCT_MAX_PLAYERS} players.`, fr: `Abduct-Moo se joue de ${ABDUCT_MIN_PLAYERS} à ${ABDUCT_MAX_PLAYERS} joueurs.` });
  }
  if (!isHost) return text({ en: 'The host rounds everyone up.', fr: 'L’hôte rassemble tout le monde.' });
  return text({ en: 'Pick a barn each round. Get caught and you’re out — last cow standing wins.', fr: 'Choisissez une grange à chaque manche. Enlevée, votre vache est éliminée — la dernière debout gagne.' });
}
