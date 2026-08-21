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
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { detectShakes } from '../../core/sensors/shake';
import { motionSupport, requestMotion, type MotionSupport } from '../../core/sensors/motion';
import { applyRush, type RushState } from './game';
import { createTune, setSoundOn, soundOn, type Tune } from './tune';
import { RushScreen } from './RushScreen';
import { useGameText, type GameText } from '../../core/i18n/gameText';
import { PermissionPrimer } from '../../core/ui/PermissionPrimer';

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
      {(code, card) => <RushRoomInner game={card} code={code} />}
    </RoomGate>
  );
}

function RushRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const text = useGameText();
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

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
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
      room.setError(text({ en: 'No motion access — you can watch, but not race this one.', fr: "Pas d’accès au mouvement — vous pouvez regarder, mais pas participer à cette course." }));
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
        slug={card.slug}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        accent={card.accent}
        onAgain={again}
        canAgain={room.isHost && enoughPlayers}
        sound={sound}
        onSound={setSound}
        room={room}
        readyBlocked={support !== 'unsupported' && !motionAsked}
        onReadySetup={enableMotion}
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
      startLabel={text({ en: 'Start the race', fr: 'Démarrer la course' })}
      onStart={again}
      readyBlocked={support !== 'unsupported' && !motionAsked}
      note={note(room.isHost, room.connected, motionOn, solo, text)}
      extras={
        <>
          {/*
            The safety line gets its own visible panel rather than a slot inside
            How to play, which now arrives collapsed for the host — that is
            exactly how the same line ended up hidden in Pass the Bomb (spec §9).
          */}
          <section class="panel rush-safety" role="note">
            <h2 class="panel__heading">{text({ en: 'Before you start', fr: 'Avant de commencer' })}</h2>
            <p class="rush-safety__body">
              <strong>{text({ en: 'Grip it properly and keep your arm down.', fr: 'Tenez-le fermement et gardez le bras baissé.' })}</strong>{' '}
              {text({ en: 'No throwing, no swinging near faces, and take the strap or popsocket off if it makes you loosen your grip.', fr: 'Ne le lancez pas, ne l’agitez pas près des visages et retirez la dragonne ou le support s’il gêne votre prise.' })}
            </p>
            <p class="rush-safety__note">
              {text({ en: 'Shaking harder does not help — the game counts changes of direction, not force.', fr: 'Secouer plus fort ne sert à rien — le jeu compte les changements de direction, pas la force.' })}
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
  const text = useGameText();
  const heading = text({ en: 'Shaking', fr: 'Secouer' });
  if (support === 'unsupported' || (asked && !on)) {
    return (
      <PermissionPrimer
        heading={heading}
        body={`${support === 'unsupported'
          ? text({ en: 'This phone has no motion sensor, so it cannot tell when you shake it.', fr: 'Ce téléphone n’a pas de capteur de mouvement et ne peut pas détecter les secousses.' })
          : text({ en: 'Motion was turned down, so this phone cannot tell when you shake it.', fr: 'L’accès au mouvement a été refusé, le téléphone ne peut donc pas détecter les secousses.' })} ${text(
          { en: 'There is no tap version of this one — a thumb is faster than an arm, so it would not stand in for shaking, it would win — so you can watch the race, and the track is worth watching.', fr: 'Il n’existe pas de version tactile — un pouce est plus rapide qu’un bras et gagnerait au lieu de remplacer le geste — mais vous pouvez regarder la course.' },
        )}`}
      />
    );
  }

  if (on) {
    return <PermissionPrimer heading={heading} enabled body={text(
      { en: 'Ready. Grip it, and wait for the off.', fr: 'Prêt. Tenez-le fermement et attendez le départ.' })} />;
  }

  return (
    <PermissionPrimer
      heading={heading}
      body={text({ en: "Counting your shakes needs permission to read the phone's motion. Nothing is recorded — the only thing sent is a count, a few times a second, never the readings themselves.", fr: 'Compter les secousses nécessite l’accès au mouvement du téléphone. Rien n’est enregistré — seul un nombre est envoyé quelques fois par seconde, jamais les mesures.' })}
      action={{ label: text({ en: 'Turn on shake detection', fr: 'Activer la détection' }), onClick: onEnable }}
    />
  );
}

function note(isHost: boolean, connected: number, motionOn: boolean, solo: boolean, text: GameText): string {
  if (!solo && connected < RUSH_MIN_PLAYERS) {
    const missing = RUSH_MIN_PLAYERS - connected;
    return text({ en: `Need ${missing} more player${missing === 1 ? '' : 's'} — a race of one is just shaking.`, fr: `Il manque ${missing} joueur${missing === 1 ? '' : 's'} — seul, ce n’est pas une course.` });
  }
  if (connected > RUSH_MAX_PLAYERS) return text({ en: `${RUSH_MAX_PLAYERS} players is the most this one takes.`, fr: `${RUSH_MAX_PLAYERS} joueurs maximum.` });
  if (!isHost) return text({ en: 'The host starts the race.', fr: "L’hôte démarre la course." });
  if (!motionOn) return text({ en: 'Turn on shake detection above, or start and watch.', fr: 'Activez la détection ci-dessus, ou démarrez pour regarder.' });
  return text({ en: 'Arms loose. Ready when you are.', fr: 'Bras détendus. Démarrez quand vous voulez.' });
}
