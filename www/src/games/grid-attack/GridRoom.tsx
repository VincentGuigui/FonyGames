import { useCallback, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  GRID_LIVES,
  GRID_MAX_PLAYERS,
  GRID_MIN_PLAYERS,
  GRID_TAPS,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { goFullscreen, useLandscapeRound } from '../../core/screen';
import { useRoom, useShareRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { GameOverScreen } from '../../core/ui/GameOver';
import { applyGrid, livesOf, sides, type GridBoard as Board } from './game';
import { GridBoard } from './GridBoard';

/**
 * Grid Attack's room. Spec: docs/specs/games/grid-attack.md
 *
 * The first game in the catalogue whose board is **sideways**, which is the only thing here
 * that is not the usual shape:
 *
 * 1. The lobby is portrait like every other, because it is the shared template.
 * 2. When the round starts, each phone gets a **loading screen with one button**. Tapping
 *    it asks for fullscreen — which every browser refuses outside a gesture, and iPhone
 *    Safari refuses entirely — and tells the referee this phone is looking at the board.
 * 3. The round does not begin until both have. Being attacked for two seconds while
 *    reading a "go fullscreen" prompt is not a game.
 */
export function GridRoom(props: { game: GameCard }): JSX.Element {
  return (
    <RoomGate game={props.game}>
      {(code) => <GridRoomInner game={props.game} code={code} />}
    </RoomGate>
  );
}

function GridRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const [state, setState] = useState<Board>(null);

  const onGame = useCallback((msg: ServerMessage) => {
    setState((prev) => applyGrid(prev, msg));
  }, []);

  const room = useRoom(code, card.slug, onGame);
  const { joinUrl, copied, showQr, share, toggleQr } = useShareRoom(code, card.title, room.setError);
  const client = room.client;
  const myId = room.me?.id;

  const live = state !== null && state.phase !== 'done';
  const seats = state && myId ? sides(state, myId) : null;
  const iAmReady = !!myId && !!state && (state.ready[myId] ?? false);

  // Sideways for as long as a board is on screen — including the loading screen, which is
  // where the player is being asked to turn the phone in the first place.
  useLandscapeRound(live);

  const clock = useCallback(() => client?.now() ?? Date.now(), [client]);

  async function ready(): Promise<void> {
    // Straight out of the tap, and before anything is awaited: a fullscreen request that
    // has been through an `await` is no longer "during a gesture" as far as the browser is
    // concerned, which is the same trap iOS sets for motion permission.
    const full = goFullscreen(document.documentElement);
    client?.send({ t: 'grid-ready', d: { roundId: state?.roundId ?? 0 } });
    // Deliberately unread: fullscreen is a nicety and the board plays without it. Awaited
    // only so a rejection is handled rather than becoming an unhandled promise.
    await full;
  }

  if (state && live && seats) {
    if (state.phase === 'waiting') {
      return (
        <GetReady
          accent={card.accent}
          title={card.title}
          mine={iAmReady}
          theirs={state.ready[seats.theirs] ?? false}
          onReady={ready}
        />
      );
    }

    return (
      <GridBoard
        state={state}
        players={room.room?.players ?? []}
        myId={seats.mine}
        theirId={seats.theirs}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        accent={card.accent}
        clock={clock}
        onTap={(cell, side) =>
          client?.send({ t: 'grid-tap', d: { roundId: state.roundId, cell, side } })
        }
      />
    );
  }

  if (state && state.phase === 'done') {
    const players = room.room?.players ?? [];
    const ranked = [...players].sort((a, b) => livesOf(state, b.id) - livesOf(state, a.id));
    return (
      <GameOverScreen
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        status=""
        rows={ranked.map((p) => {
          const left = livesOf(state, p.id);
          return {
            id: p.id,
            avatar: p.avatar,
            name: p.name,
            value: left,
            unit: left === 1 ? 'life' : 'lives',
            ...(left <= 0 ? { out: true } : {}),
          };
        })}
        me={myId}
        winner={state.winner}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'grid' } })}
        canAct={room.isHost && enoughToStart(room.connected, [GRID_MIN_PLAYERS, GRID_MAX_PLAYERS])}
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
      canStart={room.isHost && enoughToStart(room.connected, [GRID_MIN_PLAYERS, GRID_MAX_PLAYERS])}
      startLabel={state ? 'Play again' : 'Start the game'}
      onStart={() => client?.send({ t: 'start', d: { mode: 'grid' } })}
      note={note(room.isHost, room.connected)}
      /*
       * Two grids facing each other, so there is nothing to look at alone — the same
       * reason Sling Puck opts out. Solo testing would show one player attacking nobody.
       */
      soloSupported={false}
      extras={
        <section class="panel">
          <h2 class="panel__heading">Before you start</h2>
          <p class="grid-primer__body">
            The board is <strong>sideways and fullscreen</strong>. When the game starts, both
            phones get a button — tap it, turn the phone, and the round begins the moment you
            have both done it.
          </p>
          <p class="grid-primer__note">
            {GRID_TAPS} quick taps to light one of theirs. {GRID_TAPS} quick taps to put out
            one of yours. {GRID_LIVES} lives each.
          </p>
        </section>
      }
    />
  );
}

/**
 * The loading screen: one button, and then waiting for the other phone.
 *
 * It exists because fullscreen cannot be asked for any other way — every browser requires
 * a gesture — and it earns its place by being where the round is held until both players
 * are actually looking at a board.
 */
function GetReady({
  accent,
  title,
  mine,
  theirs,
  onReady,
}: {
  accent: string;
  title: string;
  mine: boolean;
  theirs: boolean;
  onReady: () => void;
}): JSX.Element {
  return (
    <div class="grid-ready" style={{ '--game-accent': accent } as JSX.CSSProperties}>
      <p class="grid-ready__icon" aria-hidden="true">
        🔄
      </p>
      <h1 class="grid-ready__title">{title}</h1>
      {mine ? (
        <>
          <p class="grid-ready__say">Waiting for the other phone…</p>
          <p class="grid-ready__note">
            {theirs ? 'Starting now.' : 'They have to tap their button too.'}
          </p>
        </>
      ) : (
        <>
          <button class="btn btn--big grid-ready__go" type="button" onClick={onReady}>
            Go fullscreen
          </button>
          <p class="grid-ready__note">
            Turn your phone sideways. If your browser will not do fullscreen, the game plays
            anyway.
          </p>
        </>
      )}
    </div>
  );
}

function note(isHost: boolean, connected: number): string {
  if (connected < GRID_MIN_PLAYERS) return 'Two phones, side by side. Waiting for the second.';
  if (connected > GRID_MAX_PLAYERS) return 'Two players only — this one is a duel.';
  if (!isHost) return 'The host starts the game.';
  return 'Sit opposite each other. You will both need both thumbs.';
}
