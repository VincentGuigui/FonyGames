import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  TAPS100_MAX_PLAYERS,
  TAPS100_MIN_PLAYERS,
  TAPS100_TOTAL,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText, type GameText } from '../../core/i18n/gameText';
import { useSoloTesting } from '../../core/useSolo';
import { SoundToggle, Taps100Board } from './Taps100Board';
import { Taps100Game, formatClock } from './game';
import { createTune, setSoundOn, soundOn, type Tune } from './tune';

/**
 * 100 Taps' room. Spec: docs/specs/games/hundred-taps.md
 *
 * Tap Tap Music's own room, with the window mechanic gone: no sensor, no
 * permission, no fullscreen gate — plus the same tune-armed-from-the-first-tap
 * pattern that game uses, since a tap IS the gesture an AudioContext needs.
 */
export function Taps100Room(props: { game: GameCard }): JSX.Element {
  return (
    <RoomGate game={props.game}>
      {(code, card) => <Taps100RoomInner game={card} code={code} />}
    </RoomGate>
  );
}

function Taps100RoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const [, redraw] = useState(0);
  const [sound, setSound] = useState(soundOn);

  // Created before the socket, same reasoning every other room gives: the first
  // `taps100` frame can arrive before this component has ever rendered.
  const gameRef = useRef<Taps100Game | null>(null);
  if (!gameRef.current) gameRef.current = new Taps100Game();
  const game = gameRef.current;

  const tuneRef = useRef<Tune | null>(null);
  if (tuneRef.current === null) tuneRef.current = createTune();
  const tune = tuneRef.current;

  const onGame = useCallback(
    (msg: ServerMessage) => {
      game.apply(msg);
      redraw((n) => n + 1);
    },
    [game],
  );

  const solo = useSoloTesting();
  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;

  useEffect(() => {
    tune.setMuted(!sound);
    setSoundOn(sound);
  }, [tune, sound]);

  /** Dispose the audio graph when the page is done with it, not on every render. */
  useEffect(() => () => tune.stop(), [tune]);

  const state = game.state;
  const progress = game.progress;

  /*
   * One note per correct tap, and the finishing flourish the instant MY OWN board
   * clears — never on somebody else's win.
   */
  useEffect(() => {
    tune.seekTo(progress);
    if (progress >= TAPS100_TOTAL) tune.finish();
  }, [tune, progress]);

  const limits: [number, number] = [TAPS100_MIN_PLAYERS, TAPS100_MAX_PLAYERS];

  if (state?.phase === 'running') {
    return (
      <Taps100Board
        game={game}
        players={room.room?.players ?? []}
        me={myId ?? null}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        accent={card.accent}
        clock={() => client?.now() ?? Date.now()}
        sound={sound}
        onSound={setSound}
        onTap={(cell) => {
          if (!client) return;
          // The first tap of a round is also the user gesture an AudioContext
          // needs — `arm()` is safe to call again on every later tap.
          void tune.arm();
          client.send({ t: 'taps100-tap', d: { roundId: state.roundId, cell } });
        }}
      />
    );
  }

  if (state?.phase === 'done') {
    const players = room.room?.players ?? [];
    const finishedAt = state.finishedAt;
    const remaining = state.remaining;

    const finished = players
      .filter((p) => finishedAt[p.id] != null)
      .sort((a, b) => (finishedAt[a.id] ?? 0) - (finishedAt[b.id] ?? 0));
    const unfinished = players
      .filter((p) => finishedAt[p.id] == null)
      .sort((a, b) => (remaining[a.id] ?? TAPS100_TOTAL) - (remaining[b.id] ?? TAPS100_TOTAL));
    const ranked = [...finished, ...unfinished];

    return (
      <GameOverScreen
        room={room}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        status={text({ en: 'Time', fr: 'Temps' })}
        menu={<SoundToggle on={sound} onChange={setSound} />}
        rows={ranked.map((p) => {
          const at = finishedAt[p.id];
          if (at != null) {
            return { id: p.id, avatar: p.avatar, name: p.name, value: formatClock(at - state.startsAt) };
          }
          return {
            id: p.id,
            avatar: p.avatar,
            name: p.name,
            value: remaining[p.id] ?? TAPS100_TOTAL,
            unit: text({ en: 'left', fr: 'restantes' }),
            out: true,
          };
        })}
        me={myId}
        winner={state.winner}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'taps100', solo } })}
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
      startLabel={state ? t.common.playAgain : text({ en: 'Start the board', fr: 'Démarrer le plateau' })}
      onStart={() => client?.send({ t: 'start', d: { mode: 'taps100', solo } })}
      note={note(room.isHost, room.connected, solo, text)}
    />
  );
}

function note(isHost: boolean, connected: number, solo: boolean, text: GameText): string {
  if (!solo && connected < TAPS100_MIN_PLAYERS) return text({ en: 'Waiting for one more player…', fr: 'En attente d’un joueur supplémentaire…' });
  if (connected > TAPS100_MAX_PLAYERS) {
    return text({ en: `100 Taps is ${TAPS100_MIN_PLAYERS}–${TAPS100_MAX_PLAYERS} players.`, fr: `100 Taps se joue de ${TAPS100_MIN_PLAYERS} à ${TAPS100_MAX_PLAYERS} joueurs.` });
  }
  if (!isHost) return text({ en: 'The host starts the board.', fr: "L’hôte démarre le plateau." });
  return text({ en: `Everyone gets the same ${TAPS100_TOTAL} numbers, shuffled the same way. First to tap them all in order wins.`, fr: `Tout le monde reçoit les mêmes ${TAPS100_TOTAL} nombres, mélangés de la même façon. Le premier à tous les toucher dans l’ordre gagne.` });
}
