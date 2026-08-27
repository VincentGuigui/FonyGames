import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  TAPTAP_MAX_PLAYERS,
  TAPTAP_MIN_PLAYERS,
  TAPTAP_TOTAL,
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
import { SoundToggle, TapTapBoard } from './TapTapBoard';
import { TapTapGame, formatClock } from './game';
import { createTune, setSoundOn, soundOn, type Tune } from './tune';

/**
 * Tap Tap Music's room. Spec: docs/specs/games/tap-tap-music.md
 *
 * Same shape as Squash Mosquitoes' room — no sensor, no permission, no fullscreen
 * gate — plus the one thing that game has no need for: a tune, armed from the
 * player's own first tap rather than a dedicated permission button, because a tap
 * IS the gesture an AudioContext needs (`tune.ts`).
 */
export function TapTapRoom(props: { game: GameCard }): JSX.Element {
  return (
    <RoomGate game={props.game}>
      {(code, card) => <TapTapRoomInner game={card} code={code} />}
    </RoomGate>
  );
}

function TapTapRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const [, redraw] = useState(0);
  const [sound, setSound] = useState(soundOn);

  // Created before the socket, same reasoning SquashRoom gives: the first `taptap`
  // frame can arrive before this component has ever rendered.
  const gameRef = useRef<TapTapGame | null>(null);
  if (!gameRef.current) gameRef.current = new TapTapGame();
  const game = gameRef.current;

  const tuneRef = useRef<Tune | null>(null);
  if (tuneRef.current === null) tuneRef.current = createTune();
  const tune = tuneRef.current;

  const onGame = useCallback(
    (msg: ServerMessage) => {
      game.apply(msg);
      // The game object is mutable and Preact cannot see into it — this nudges the
      // chrome and the hundred-button grid; the running clock animates on its own
      // rAF loop inside TapTapBoard.
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
   * One note per correct tap, and the finishing cadence the instant MY OWN board
   * clears — never on somebody else's win, the same reason Shake Rush's `finish()`
   * only fires for the runner who is actually home.
   */
  useEffect(() => {
    tune.seekTo(progress);
    if (progress >= TAPTAP_TOTAL) tune.finish();
  }, [tune, progress]);

  const limits: [number, number] = [TAPTAP_MIN_PLAYERS, TAPTAP_MAX_PLAYERS];

  if (state?.phase === 'running') {
    return (
      <TapTapBoard
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
          client.send({ t: 'taptap-tap', d: { roundId: state.roundId, cell } });
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
      .sort((a, b) => (remaining[a.id] ?? TAPTAP_TOTAL) - (remaining[b.id] ?? TAPTAP_TOTAL));
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
            value: remaining[p.id] ?? TAPTAP_TOTAL,
            unit: text({ en: 'left', fr: 'restantes' }),
            out: true,
          };
        })}
        me={myId}
        winner={state.winner}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'taptap', solo } })}
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
      onStart={() => client?.send({ t: 'start', d: { mode: 'taptap', solo } })}
      note={note(room.isHost, room.connected, solo, text)}
    />
  );
}

function note(isHost: boolean, connected: number, solo: boolean, text: GameText): string {
  if (!solo && connected < TAPTAP_MIN_PLAYERS) return text({ en: 'Waiting for one more player…', fr: 'En attente d’un joueur supplémentaire…' });
  if (connected > TAPTAP_MAX_PLAYERS) {
    return text({ en: `Tap Tap Music is ${TAPTAP_MIN_PLAYERS}–${TAPTAP_MAX_PLAYERS} players.`, fr: `Tap Tap Music se joue de ${TAPTAP_MIN_PLAYERS} à ${TAPTAP_MAX_PLAYERS} joueurs.` });
  }
  if (!isHost) return text({ en: 'The host starts the board.', fr: "L’hôte démarre le plateau." });
  // The host is ready to start and the "How to play" panel already covers the
  // mechanic (card.ts's concept + rules) — nothing left worth a second note.
  return '';
}
