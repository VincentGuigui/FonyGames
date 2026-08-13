import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  BUMP_RELAY_MAX_PLAYERS,
  BUMP_RELAY_MIN_PLAYERS,
  type PlayerId,
  type ServerMessage,
} from '../../../../shared/protocol';
import { useRoom, useShareRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { detectBumps } from '../../core/sensors/bump';
import { motionSupport, requestMotion, type MotionSupport } from '../../core/sensors/motion';
import { applyRelay, type RelayState } from './game';
import { BombScreen } from './BombScreen';

/**
 * Bump Relay's room screen. Spec: docs/specs/games/bump-relay.md
 *
 * The first game in the catalogue that needs a **sensor permission**, so it is also the first
 * that has to ask for one without being obnoxious about it. Two rules shape this file:
 *
 * 1. `requestMotion()` must be called straight out of a tap handler — iOS refuses it otherwise,
 *    and refuses it silently after an `await` (docs/device-capabilities.md §2). So the primer is
 *    a button, and the request is the first thing its handler does.
 * 2. Nothing is asked for on arrival. The lobby explains the game and the safety line first; the
 *    permission is requested when the player opts in, and the game is fully playable if they
 *    never do (spec §5, §11).
 */
export function BumpRoom(props: { game: GameCard }): JSX.Element {
  return (
    <RoomGate game={props.game}>
      {(code) => <BumpRoomInner game={props.game} code={code} />}
    </RoomGate>
  );
}

function BumpRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const [state, setState] = useState<RelayState>(null);
  /** Server time until which our bumps are being ignored, from a `calm-down` frame. */
  const [mutedUntil, setMutedUntil] = useState(0);
  const [support] = useState<MotionSupport>(motionSupport);
  const [motionOn, setMotionOn] = useState(false);
  const [motionAsked, setMotionAsked] = useState(false);

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'calm-down') {
      setMutedUntil(msg.d.untilServerTime);
      return;
    }
    setState((prev) => applyRelay(prev, msg, Date.now()));
  }, []);

  const room = useRoom(code, card.slug, onGame);
  const { joinUrl, copied, showQr, share, toggleQr } = useShareRoom(code, card.title, room.setError);
  const client = room.client;
  const myId = room.me?.id;

  const running = state?.phase === 'running';
  const iAmAlive = !!myId && !!state && state.alive.includes(myId);

  /*
   * The motion listener exists only while this phone is actually in a live round (spec §5). A
   * leaked `devicemotion` listener drains a battery for nothing, and `onMotion` already drops it
   * while the tab is hidden.
   *
   * `clientRef` rather than `client` in the dependency list: re-running this effect would build a
   * new detector, and a detector's first job is to establish what "calm" looks like — restarting
   * it mid-round would swallow the next bump.
   */
  const clientRef = useRef(client);
  clientRef.current = client;
  const roundRef = useRef(state?.roundId ?? 0);
  roundRef.current = state?.roundId ?? 0;

  useEffect(() => {
    if (!motionOn || !running || !iAmAlive) return;

    const detector = detectBumps((at) => {
      const c = clientRef.current;
      if (!c) return;
      /*
       * The sensor stamps a bump with `performance.now()`; the referee pairs bumps in server
       * time within ±250 ms. Converting through the elapsed-since-the-spike offset keeps the
       * *interval* intact, which is the only thing pairing depends on — sending a raw
       * `performance.now()` would land tens of thousands of seconds in the past and never pair.
       */
      const serverAt = c.now() - (performance.now() - at);
      c.send({ t: 'bump', d: { at: serverAt, roundId: roundRef.current } });

      // Confirms the phone felt it, on a screen you are not looking at. Absent on iOS, where
      // spec §5 leaves the tension to sound and the flash.
      navigator.vibrate?.(30);
    });

    return () => detector.stop();
  }, [motionOn, running, iAmAlive]);

  /** Straight out of the tap: see rule 1 in the file docblock. */
  async function enableMotion(): Promise<void> {
    setMotionAsked(true);
    const granted = await requestMotion();
    setMotionOn(granted);
    if (!granted) {
      room.setError('No motion access — you can still pass with a tap.');
    }
  }

  const muted = mutedUntil > (client?.now() ?? Date.now());

  if (state && running) {
    return (
      <BombScreen
        state={state}
        players={room.room?.players ?? []}
        myId={myId}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        canBump={motionOn}
        muted={muted}
        onPass={(to: PlayerId) =>
          client?.send({ t: 'pass', d: { to, roundId: state.roundId } })
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
        room.isHost &&
        room.connected >= BUMP_RELAY_MIN_PLAYERS &&
        room.connected <= BUMP_RELAY_MAX_PLAYERS
      }
      startLabel={state ? 'Play again' : 'Start round'}
      onStart={() => client?.send({ t: 'start', d: { mode: 'relay' } })}
      note={note(room.isHost, room.connected)}
      playerTag={(id) => {
        if (!state) return null;
        if (state.winner === id) return 'won';
        return state.alive.includes(id) ? null : 'out';
      }}
      extras={
        <>
          {/*
            Spec §9 requires the safety line in the lobby, and it has to be VISIBLE there.
            It started life in the `aside` slot, which renders inside How to play — a panel that
            now arrives collapsed for whoever came through the chooser, so the one instruction
            that keeps people from cracking their phones together was hidden behind a tap. It
            lives in its own always-open panel, above the primer, as the spec orders it.
          */}
          <section class="panel safety" role="note">
            <h2 class="panel__heading">Before you start</h2>
            <p class="safety__body">
              Tap phones <strong>gently</strong>, corner to corner. Keep your cases on. Stand
              still — no running, no throwing.
            </p>
          </section>

          <MotionPrimer
            support={support}
            on={motionOn}
            asked={motionAsked}
            onEnable={enableMotion}
          />
        </>
      }
    />
  );
}

/**
 * The permission primer, and the honest version of what happens if you say no.
 *
 * Never auto-requested. A prompt that appears before the player knows what the game is gets
 * denied, and on iOS a denial is remembered — so asking early costs the permission permanently
 * (docs/device-capabilities.md §2).
 */
function MotionPrimer({
  support,
  on,
  asked,
  onEnable,
}: {
  support: MotionSupport;
  on: boolean;
  asked: boolean;
  onEnable: () => void;
}): JSX.Element {
  if (support === 'unsupported') {
    return (
      <section class="panel primer">
        <h2 class="panel__heading">Passing the bomb</h2>
        <p class="primer__body">
          This phone has no motion sensor, so bumping won't register. You can still play — the
          bomb passes with a tap, and the round works the same way.
        </p>
      </section>
    );
  }

  if (on) {
    return (
      <section class="panel primer">
        <h2 class="panel__heading">Passing the bomb</h2>
        <p class="primer__body primer__body--on">
          Bumping is on. Knock your phone gently against someone else's to pass it.
        </p>
      </section>
    );
  }

  return (
    <section class="panel primer">
      <h2 class="panel__heading">Passing the bomb</h2>
      <p class="primer__body">
        {asked
          ? 'Motion was turned down, so bumping is off. Tap-to-pass still works — or allow motion in your browser settings and reload.'
          : 'Bumping needs permission to read this phone’s motion. Nothing is recorded — the only thing sent is “a bump happened”, never the readings themselves.'}
      </p>
      <button class="btn btn--primary primer__enable" type="button" onClick={onEnable}>
        {asked ? 'Try again' : 'Turn on bumping'}
      </button>
      <p class="primer__opt-out">Rather not? Tap-to-pass is always available in the round.</p>
    </section>
  );
}

function note(isHost: boolean, connected: number): string {
  if (connected < BUMP_RELAY_MIN_PLAYERS) {
    const missing = BUMP_RELAY_MIN_PLAYERS - connected;
    return `Need ${missing} more player${missing === 1 ? '' : 's'} — it takes ${BUMP_RELAY_MIN_PLAYERS} to pass a bomb around.`;
  }
  if (connected > BUMP_RELAY_MAX_PLAYERS) {
    return `${BUMP_RELAY_MAX_PLAYERS} players is the most this one takes.`;
  }
  if (!isHost) return 'The host starts the round.';
  return 'Stand in a circle, arms out. The fuse is hidden.';
}
