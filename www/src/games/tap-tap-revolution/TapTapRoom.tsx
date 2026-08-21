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
import { useRoom, useShareRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { soloTesting } from '../../core/solo';
import { SoundToggle, TapTapBoard } from './TapTapBoard';
import { TapTapGame, formatClock } from './game';
import { createTune, setSoundOn, soundOn, type Tune } from './tune';

/**
 * Tap Tap Revolution's room. Spec: docs/specs/games/tap-tap-revolution.md
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

  const solo = soloTesting();
  const room = useRoom(code, card.slug, onGame);
  const { joinUrl, copied, showQr, share, toggleQr } = useShareRoom(code, card.title, room.setError);
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
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        status="Time"
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
            unit: 'left',
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
      startLabel={state ? t.common.playAgain : 'Start the board'}
      onStart={() => client?.send({ t: 'start', d: { mode: 'taptap', solo } })}
      note={note(room.isHost, room.connected, solo)}
    />
  );
}

function note(isHost: boolean, connected: number, solo: boolean): string {
  if (!solo && connected < TAPTAP_MIN_PLAYERS) return 'Waiting for one more player…';
  if (connected > TAPTAP_MAX_PLAYERS) {
    return `Tap Tap Revolution is ${TAPTAP_MIN_PLAYERS}–${TAPTAP_MAX_PLAYERS} players.`;
  }
  if (!isHost) return 'The host starts the board.';
  return `Everyone gets the same ${TAPTAP_TOTAL} cells, in the same order. First to clear them wins.`;
}
