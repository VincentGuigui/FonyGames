import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  SQUASH_MAX_PLAYERS,
  SQUASH_MIN_PLAYERS,
  SQUASH_TOTAL,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import { useSoloTesting } from '../../core/useSolo';
import { SquashBoard } from './SquashBoard';
import { SquashGame } from './game';
import { prepareBuzzAudio, soundOn, setSoundOn } from './buzz';

/**
 * Squash Mosquitoes' room. Spec: docs/specs/games/squash-mosquitoes.md
 *
 * The simplest room in the catalogue: no sensor, no permission, no fullscreen gate, no
 * elimination. Everyone races the same shared pattern on their own private board, and
 * the shared template needs nothing extra to say so.
 */
export function SquashRoom(props: { game: GameCard }): JSX.Element {
  return (
    <RoomGate game={props.game}>
      {(code, card) => <SquashRoomInner game={card} code={code} />}
    </RoomGate>
  );
}

function SquashRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const [, redraw] = useState(0);
  const [sound, setSound] = useState(soundOn);

  useEffect(() => {
    prepareBuzzAudio();
  }, []);

  useEffect(() => {
    setSoundOn(sound);
  }, [sound]);

  // Created before the socket, because the first `squash` frame can arrive before
  // this component has ever rendered — the same reasoning Spill's room gives.
  const gameRef = useRef<SquashGame | null>(null);
  if (!gameRef.current) gameRef.current = new SquashGame();
  const game = gameRef.current;

  const onGame = useCallback(
    (msg: ServerMessage) => {
      game.apply(msg);
      // The game object is mutable and Preact cannot see into it. This nudges the
      // chrome and the 66-button grid; the flying wander animates on its own rAF loop.
      redraw((n) => n + 1);
    },
    [game],
  );

  const solo = useSoloTesting();
  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;

  useEffect(() => {
    if (client && myId) game.identify(myId, () => client.now());
  }, [game, client, myId]);

  const state = game.state;
  const limits: [number, number] = [SQUASH_MIN_PLAYERS, SQUASH_MAX_PLAYERS];

  if (state?.phase === 'running') {
    return (
      <SquashBoard
        game={game}
        players={room.room?.players ?? []}
        me={myId ?? null}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        accent={card.accent}
        clock={() => client?.now() ?? Date.now()}
        onTap={(position) => {
          if (!client) return;
          client.send({ t: 'squash-tap', d: { roundId: state.roundId, position } });
        }}
        sound={sound}
        onSound={setSound}
      />
    );
  }

  if (state?.phase === 'done') {
    const players = room.room?.players ?? [];
    const scores = state.scores;
    // Most squashed first — the win condition and the ranking are the same number.
    const ranked = [...players].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));

    return (
      <GameOverScreen
        room={room}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        status=""
        rows={ranked.map((p) => ({
          id: p.id,
          avatar: p.avatar,
          name: p.name,
          value: scores[p.id] ?? 0,
          unit: `/ ${SQUASH_TOTAL}`,
        }))}
        me={myId}
        winner={state.winner}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'squash', solo } })}
        canAct={room.isHost && enoughToStart(room.connected, limits, solo)}
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
      canStart={room.isHost && enoughToStart(room.connected, limits, solo)}
      startLabel={state ? t.common.playAgain : text({ en: 'Start the swarm', fr: 'Lancer l’essaim' })}
      onStart={() => client?.send({ t: 'start', d: { mode: 'squash', solo } })}
    />
  );
}
