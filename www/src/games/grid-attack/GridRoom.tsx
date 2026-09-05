import { useCallback, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import { GRID_MAX_PLAYERS, GRID_MIN_PLAYERS, type ServerMessage } from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { goFullscreen, useLandscapeRound } from '../../core/screen';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
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
      {(code, card) => <GridRoomInner game={card} code={code} />}
    </RoomGate>
  );
}

function GridRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const [state, setState] = useState<Board>(null);

  const onGame = useCallback((msg: ServerMessage) => {
    setState((prev) => applyGrid(prev, msg));
  }, []);

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;

  const live = state !== null && state.phase !== 'done';
  const seats = state && myId ? sides(state, myId) : null;
  const iAmReady = !!myId && !!state && (state.ready[myId] ?? false);

  /*
   * Sideways for as long as a board is on screen — including the loading screen, which is
   * where the player is being asked to turn the phone in the first place, and **including
   * the result**.
   *
   * `live` excluded the end screen, so the moment the last life went the page snapped back
   * to portrait under a phone the player was still holding sideways: the result arrived
   * rotated 90°, and the "turn your phone upright" notice fired on top of it. Landscape
   * ends when the player leaves the game, not when the round does.
   */
  useLandscapeRound(state !== null);

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
        room={room}
        slug={card.slug}
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
            unit: t.common.lives,
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
      startLabel={state ? t.common.playAgain : text({ en: 'Start the game', fr: 'Démarrer la partie' })}
      onStart={() => client?.send({ t: 'start', d: { mode: 'grid' } })}
      /*
       * Two grids facing each other, so there is nothing to look at alone — the same
       * reason Sling Puck opts out. Solo testing would show one player attacking nobody.
       */
      soloSupported={false}
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
  const text = useGameText();
  return (
    <div class="grid-ready" style={{ '--game-accent': accent } as JSX.CSSProperties}>
      <p class="grid-ready__icon" aria-hidden="true">
        🔄
      </p>
      <h1 class="grid-ready__title">{title}</h1>
      {mine ? (
        <>
          <p class="grid-ready__say">{text({ en: 'Waiting for the other phone…', fr: 'En attente de l’autre téléphone…' })}</p>
          <p class="grid-ready__note">
            {theirs ? text({ en: 'Starting now.', fr: 'Démarrage immédiat.' })
              : text({ en: 'They have to tap their button too.', fr: 'L’autre joueur doit aussi toucher son bouton.' })}
          </p>
        </>
      ) : (
        <>
          <button class="btn btn--big grid-ready__go" type="button" onClick={onReady}>
            {text({ en: 'Go fullscreen', fr: 'Passer en plein écran' })}
          </button>
          <p class="grid-ready__note">
            {text({ en: 'Turn your phone sideways. If your browser will not do fullscreen, the game plays anyway.', fr: 'Tournez votre téléphone à l’horizontale. Si le plein écran est indisponible, la partie fonctionne quand même.' })}
          </p>
        </>
      )}
    </div>
  );
}
