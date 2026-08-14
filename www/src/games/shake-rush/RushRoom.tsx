import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  RUSH_DISTANCE,
  RUSH_MAX_PLAYERS,
  RUSH_MIN_PLAYERS,
  RUSH_TICK_MS,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { soloTesting } from '../../core/solo';
import { useRoom, useShareRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { detectShakes } from '../../core/sensors/shake';
import { motionSupport, requestMotion, type MotionSupport } from '../../core/sensors/motion';
import { applyRush, type RushState } from './game';
import { createTune, setSoundOn, soundOn, type Tune } from './tune';
import { RushScreen } from './RushScreen';

/**
 * Shake Rush's room screen. Spec: docs/specs/games/shake-rush.md
 *
 * The third game to need a motion permission, and it follows Pass the Bomb's
 * pattern exactly: nothing is requested on arrival, the primer is a button, and
 * `requestMotion()` is the first thing its handler does — iOS refuses the prompt
 * outside a user gesture and remembers a denial.
 *
 * Where it differs is that there is **no fallback** (spec §5). A thumb taps at
 * 8–10/s against an arm's 5–6/s, so a tap route would not substitute for shaking,
 * it would beat it — a version of this game played with a thumb is a different
 * game wearing its name. A player without motion access spectates, and the lobby
 * says so before anyone starts rather than after they are stuck.
 */
export function RushRoom(props: { game: GameCard }): JSX.Element {
  return (
    <RoomGate game={props.game}>
      {(code) => <RushRoomInner game={props.game} code={code} />}
    </RoomGate>
  );
}

function RushRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const [state, setState] = useState<RushState>(null);
  const [support] = useState<MotionSupport>(motionSupport);
  const [motionOn, setMotionOn] = useState(false);
  const [motionAsked, setMotionAsked] = useState(false);
  const [sound, setSound] = useState(soundOn);

  const onGame = useCallback((msg: ServerMessage) => {
    setState((prev) => applyRush(prev, msg));
  }, []);

  /*
   * Read once per render rather than per click: it changes only when the admin
   * centre writes it, which cannot happen while this page is open.
   */
  const solo = soloTesting();

  const room = useRoom(code, card.slug, onGame);
  const { joinUrl, copied, showQr, share, toggleQr } = useShareRoom(code, card.title, room.setError);
  const client = room.client;
  const myId = room.me?.id;

  const running = state?.phase === 'running';
  /*
   * At the line — by distance, not by being listed in `finished`.
   *
   * The two are usually the same frame and sometimes are not: when the first runner home
   * also ends the race, the only frame that arrives can be `rush-end`, whose `finished`
   * list the client never saw. Reading the distance answers the same question from data
   * every frame carries, which matters here because this flag both stops the sending loop
   * and triggers the tune's ending — and an ending that plays for everyone except the
   * winner of a race won outright is the exact wrong failure.
   */
  const home =
    !!myId && !!state && (state.finished.includes(myId) || (state.at[myId] ?? 0) >= RUSH_DISTANCE);

  /*
   * One tune for the life of the page, built on first render rather than passed to
   * `useRef(createTune())` — that form calls `createTune()` on every render and throws the
   * result away, which would drop the loaded synth on the floor sixty times a second.
   */
  const tuneRef = useRef<Tune | null>(null);
  if (tuneRef.current === null) tuneRef.current = createTune();
  /** Stable for the life of the component, so effects can close over it directly. */
  const tune = tuneRef.current;

  const clientRef = useRef(client);
  clientRef.current = client;
  const roundRef = useRef(state?.roundId ?? 0);
  roundRef.current = state?.roundId ?? 0;

  /*
   * One detector and one interval for the whole race.
   *
   * Batched, not one message per shake: at 5 shakes a second across 8 players a
   * frame-per-shake is 40 messages/s for a track nobody reads that precisely
   * (spec §6). The detector accumulates and the interval ships the count.
   *
   * An EMPTY window is not sent — a phone whose sensor has stopped has nothing to
   * report, and saying "0" instead would keep its runner from ever being marked
   * `away`. Same rule as Steady Hand, learnt there the hard way.
   */
  useEffect(() => {
    if (!motionOn || !running || home) return;

    /*
     * One note per shake, played from the detector's callback rather than from the
     * interval below: the interval knows how many shakes happened in the window but not
     * when, so notes fired from it would arrive in bursts of three on a 90 ms grid
     * instead of on the movement (games/shake-rush/tune.ts).
     */
    tune.rewind();
    const detector = detectShakes(() => tune.step());
    const timer = setInterval(() => {
      const c = clientRef.current;
      if (!c) return;
      const { n, samples } = detector.read();
      if (samples === 0) return;
      c.send({ t: 'shake', d: { n, roundId: roundRef.current } });
    }, RUSH_TICK_MS);

    return () => {
      clearInterval(timer);
      detector.stop();
    };
  }, [motionOn, running, home]);

  /**
   * Home: the tune plays its own ending.
   *
   * The song is a few notes longer than the track (`melody.ts`), so crossing the line and
   * the tune landing are one event. Without this a finisher would either hear the song cut
   * off mid-phrase or have to keep shaking a race they had already won.
   */
  useEffect(() => {
    if (home) tune.finish();
  }, [home]);

  /*
   * The referee's position for this runner, handed to the tune so a long race cannot
   * finish on the wrong note. It corrects only a real divergence — see `RESYNC_SLACK`.
   */
  const myAt = myId && state ? state.at[myId] : undefined;
  useEffect(() => {
    if (myAt !== undefined) tune.seek(myAt);
  }, [myAt]);

  useEffect(() => {
    tune.setMuted(!sound);
    setSoundOn(sound);
  }, [sound]);

  /** Dispose the audio graph when the page is done with it, not on every render. */
  useEffect(() => () => tune.stop(), []);

  /** Straight out of the tap — see the file docblock. */
  async function enableMotion(): Promise<void> {
    setMotionAsked(true);
    const granted = await requestMotion();
    setMotionOn(granted);
    if (!granted) {
      room.setError('No motion access — you can watch, but not race this one.');
      return;
    }
    /*
     * Same gesture, second job: an AudioContext only starts inside a user gesture, and
     * the first note of the race happens mid-shake, which is not one. Not awaited — the
     * permission result is what the screen is waiting on, and a slow synth download must
     * not hold it up.
     */
    void tune.arm();
  }

  const again = (): void => client?.send({ t: 'start', d: { mode: 'rush', solo } });
  const enoughPlayers = enoughToStart(room.connected, [RUSH_MIN_PLAYERS, RUSH_MAX_PLAYERS], solo);

  if (state && (running || state.phase === 'over')) {
    return (
      <RushScreen
        state={state}
        players={room.room?.players ?? []}
        myId={myId}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        accent={card.accent}
        onAgain={again}
        canAgain={room.isHost && enoughPlayers}
        sound={sound}
        onSound={setSound}
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
      canStart={room.isHost && enoughPlayers}
      startLabel="Start the race"
      onStart={again}
      note={note(room.isHost, room.connected, motionOn, solo)}
      extras={
        <>
          {/*
            The safety line gets its own visible panel rather than a slot inside
            How to play, which now arrives collapsed for the host — that is
            exactly how the same line ended up hidden in Pass the Bomb (spec §9).
          */}
          <section class="panel rush-safety" role="note">
            <h2 class="panel__heading">Before you start</h2>
            <p class="rush-safety__body">
              <strong>Grip it properly and keep your arm down.</strong> No throwing, no
              swinging near faces, and take the strap or popsocket off if it makes you
              loosen your grip.
            </p>
            <p class="rush-safety__note">
              Shaking harder does not help — the game counts changes of direction, not
              force.
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
 * The permission primer, and the honest version of a refusal.
 *
 * Never auto-requested: a prompt before the player knows what the game is gets
 * denied, and on iOS a denial is remembered, so asking early spends the
 * permission for good (docs/device-capabilities.md §2).
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
  if (support === 'unsupported' || (asked && !on)) {
    return (
      <section class="panel primer">
        <h2 class="panel__heading">Shaking</h2>
        <p class="primer__body">
          {support === 'unsupported'
            ? 'This phone has no motion sensor, so it cannot tell when you shake it.'
            : 'Motion was turned down, so this phone cannot tell when you shake it.'}{' '}
          There is no tap version of this one — a thumb is faster than an arm, so it
          would not stand in for shaking, it would win — so you can watch the race,
          and the track is worth watching.
        </p>
      </section>
    );
  }

  if (on) {
    return (
      <section class="panel primer">
        <h2 class="panel__heading">Shaking</h2>
        <p class="primer__body primer__body--on">Ready. Grip it, and wait for the off.</p>
      </section>
    );
  }

  return (
    <section class="panel primer">
      <h2 class="panel__heading">Shaking</h2>
      <p class="primer__body">
        Counting your shakes needs permission to read the phone's motion. Nothing is
        recorded — the only thing sent is a count, a few times a second, never the
        readings themselves.
      </p>
      <button class="btn btn--primary primer__enable" type="button" onClick={onEnable}>
        Turn on shake detection
      </button>
    </section>
  );
}

function note(isHost: boolean, connected: number, motionOn: boolean, solo: boolean): string {
  if (!solo && connected < RUSH_MIN_PLAYERS) {
    const missing = RUSH_MIN_PLAYERS - connected;
    return `Need ${missing} more player${missing === 1 ? '' : 's'} — a race of one is just shaking.`;
  }
  if (connected > RUSH_MAX_PLAYERS) return `${RUSH_MAX_PLAYERS} players is the most this one takes.`;
  if (!isHost) return 'The host starts the race.';
  if (!motionOn) return 'Turn on shake detection above, or start and watch.';
  return 'Arms loose. Ready when you are.';
}
