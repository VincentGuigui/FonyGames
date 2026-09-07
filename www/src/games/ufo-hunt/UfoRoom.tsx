import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  UFOHUNT_MAX_PLAYERS,
  UFOHUNT_MIN_PLAYERS,
  UFOHUNT_MISSILE_CHARGE_GOAL,
  UFOHUNT_SCOPE_DEG,
  UFOHUNT_SHOT_COOLDOWN_MS,
  ufoAngleBetween,
  ufoImpact,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { useSoloTesting } from '../../core/useSolo';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { GameOverScreen } from '../../core/ui/GameOver';
import { PermissionPrimer } from '../../core/ui/PermissionPrimer';
import {
  orientationSupport,
  requestOrientation,
  trackOrientation,
  type OrientationSupport,
  type OrientationTracker,
} from '../../core/sensors/orientation';
import { applyUfoHunt, leaderOf, missileChargeOf, ranking, scoreOf, type UfoHuntState } from './game';
import { bearingDeg, saucerAt, scopeHeat, screenSpot } from './scope';
import { UfoScreen, type GifBurst, type GifBurstKind } from './UfoScreen';
import { startCamera, type Camera } from './camera';
import { armLaserAudio, playExplosion, playLaser, playMissile } from './laser';
import { useGameText } from '../../core/i18n/gameText';

/**
 * UFO Hunt's room screen. Spec: docs/specs/games/ufo-hunt.md
 *
 * One route, no picker: orientation for the aim, the live camera feed as the sky
 * the saucer hangs in — Ghost Hunt's own camera route
 * (`ghost-hunt/HuntRoom.tsx`'s `enableCameraRoute`), except **neither permission has
 * a landing place on denial** (spec §5.3).
 *
 * **Both are asked for by Ready, or by Start for the host** (issue #29) — the same
 * shape Steady Hand and Shake Rush now use, since a permission with no alternative
 * is not something a second button can add a choice to. `readyBlocked` is still what
 * turns a REFUSAL into "blocks Start" here: a player who has said no to either cannot
 * mark themselves ready, so the room's own readiness check never lets the host's
 * start through for them. Before the asking, nothing is blocked — the button that
 * would be disabled is the one that does the asking.
 */
const BOTH_NEEDED = {
  en: "UFO Hunt needs your camera to show the saucer in the sky above you, and your phone's motion sensor to aim at it — without both there's nothing to point at.",
  fr: 'UFO Hunt a besoin de votre caméra pour montrer la soucoupe dans le ciel au-dessus de vous, et du capteur de mouvement de votre téléphone pour viser — sans les deux, il n’y a rien à pointer.',
};

export function UfoRoom(props: { game: GameCard }): JSX.Element {
  return (
    <RoomGate game={props.game}>
      {(code, card) => <UfoRoomInner game={card} code={code} />}
    </RoomGate>
  );
}

function UfoRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const text = useGameText();
  const [state, setState] = useState<UfoHuntState>(null);
  const [support] = useState<OrientationSupport>(orientationSupport);
  const [orientationOn, setOrientationOn] = useState(false);
  const [orientationAsked, setOrientationAsked] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraAsked, setCameraAsked] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const [bearing, setBearing] = useState<number | null>(null);
  const [hot, setHot] = useState(0);
  /** Bumped on every shot actually fired — `UfoScreen` keys its laser-flash
   *  overlay on this so each shot replays the animation from scratch. */
  const [shotId, setShotId] = useState(0);
  /** Live impact/explosion gifs (spec §2.5, §2.6) — see `addBurst` below. */
  const [bursts, setBursts] = useState<GifBurst[]>([]);

  const onGame = useCallback((msg: ServerMessage) => {
    setState((prev) => applyUfoHunt(prev, msg));
  }, []);

  const burstIdRef = useRef(0);
  /**
   * Drop a gif overlay at a screen position and let it clean itself up.
   *
   * `pos` is `null` whenever the saucer was not actually on screen at the
   * moment worth marking — off-screen kills, mainly (spec §2.5) — and this
   * simply skips those rather than drawing at a guessed spot. Durations
   * match each gif's own real playtime (`impact_laser.gif` 5 frames/500ms,
   * `explosion.gif` 16 frames/960ms, `impact_missile.gif` 6 frames/540ms,
   * all `loop: 0` — infinite — so something here has to end it) with a
   * small margin so the last frame is never cut mid-flicker.
   */
  const addBurst = useCallback((kind: GifBurstKind, pos: { x: number; y: number } | null) => {
    if (!pos) return;
    const id = ++burstIdRef.current;
    const durationMs = kind === 'explosion' ? 1000 : kind === 'missile' ? 580 : 540;
    setBursts((prev) => [...prev, { id, kind, x: pos.x, y: pos.y }]);
    setTimeout(() => setBursts((prev) => prev.filter((b) => b.id !== id)), durationMs);
  }, []);

  const solo = useSoloTesting();
  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;

  const running = state?.phase === 'running';

  const trackerRef = useRef<OrientationTracker | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const videoElRef = useRef<HTMLVideoElement>(null);
  const stateRef = useRef<UfoHuntState>(null);
  stateRef.current = state;
  const clientRef = useRef(client);
  clientRef.current = client;
  /** The wave's own index, so a kill (a jump to a fresh one) can play the explosion once. */
  const waveIndexRef = useRef(-1);
  const lastShotAtRef = useRef(0);

  /*
   * Forward is whatever this phone is facing when the round BEGINS — Ghost Hunt's
   * own §3 reasoning, unchanged: keyed on the round id so "again" re-anchors and a
   * re-render does not.
   */
  const anchoredRound = useRef(0);
  useEffect(() => {
    if (!running || !state) return;
    if (anchoredRound.current === state.roundId) return;
    anchoredRound.current = state.roundId;
    trackerRef.current?.anchor();
    waveIndexRef.current = -1;
  }, [running, state?.roundId]);

  /*
   * One loop for the whole round: aim, screen position, and the countdown.
   * `requestAnimationFrame` so it stops dead when the tab is hidden, same as Ghost
   * Hunt's own loop.
   */
  useEffect(() => {
    if (!running) return;

    let raf = 0;
    // The saucer's own last on-screen spot, one frame behind `spot` state on
    // purpose: by the time a kill's index change is DETECTED, `stateRef.current`
    // already holds the fresh wave, so the explosion (spec §2.5) has to reuse
    // wherever the OLD wave was last seen rather than recompute a position that
    // no longer exists.
    let lastSpot: { x: number; y: number } | null = null;
    const frame = (): void => {
      raf = requestAnimationFrame(frame);

      const s = stateRef.current;
      if (!s || s.phase !== 'running') return;

      if (s.wave.index !== waveIndexRef.current) {
        // The very first frame of a round is not a kill — nothing exploded yet,
        // the wave simply appeared.
        if (waveIndexRef.current >= 0) {
          playExplosion();
          addBurst('explosion', lastSpot);
        }
        waveIndexRef.current = s.wave.index;
      }

      const serverNow = clientRef.current?.now() ?? Date.now();
      const aim = trackerRef.current?.read().aim ?? null;
      const saucer = aim ? saucerAt(s.wave, serverNow) : null;
      const spot = aim && saucer ? screenSpot(aim, saucer) : null;

      setSpot(spot);
      lastSpot = spot;
      setBearing(aim && saucer ? bearingDeg(aim, saucer) : null);
      setHot(aim && saucer ? scopeHeat(aim, saucer, UFOHUNT_SCOPE_DEG) : 0);
      setSecondsLeft(Math.max(0, Math.ceil((s.endsAt - serverNow) / 1000)));
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, addBurst]);

  /*
   * The camera's own video element, sized to fill the backdrop by CSS `object-fit`
   * — there is no per-frame canvas copy to run, unlike Ghost Hunt's radar: the raw
   * feed is shown unfiltered (spec §5.2).
   *
   * Depends on `running` as well as `cameraOn`: the camera is granted from the
   * LOBBY, before `<video>` exists at all — `UfoScreen` (and this ref) only mount
   * once the round actually starts. An effect keyed on `cameraOn` alone fires
   * while `videoElRef.current` is still null and never runs again, so the
   * element that eventually mounts never gets a source. Cheap either way: this
   * only re-checks an already-true `el.srcObject !== cam.video.srcObject` guard.
   */
  useEffect(() => {
    const el = videoElRef.current;
    const cam = cameraRef.current;
    if (el && cam && el.srcObject !== cam.video.srcObject) el.srcObject = cam.video.srcObject;
  }, [cameraOn, running]);

  /*
   * The camera is released when the round ends, when the tab is hidden and when
   * this unmounts. Stopped, not paused — Ghost Hunt's own rule, spec §10 here too.
   */
  useEffect(() => {
    const release = (): void => {
      cameraRef.current?.stop();
      cameraRef.current = null;
      setCameraOn(false);
    };
    const onHide = (): void => {
      if (document.hidden) release();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      release();
    };
  }, []);

  useEffect(() => {
    if (!running) {
      cameraRef.current?.stop();
      cameraRef.current = null;
      setCameraOn(false);
    }
  }, [running]);

  useEffect(() => () => trackerRef.current?.stop(), []);

  /**
   * Both permissions, one tap — orientation first, straight out of the gesture (iOS
   * refuses it otherwise), then the camera. Unlike Ghost Hunt's own
   * `enableCameraRoute`, **neither denial has a landing place**: this returns false
   * and leaves the round unstarted rather than degrading to a dark ground or a
   * touch-dragged panorama (spec §5.3).
   */
  async function enableRequired(): Promise<boolean> {
    armLaserAudio();
    setOrientationAsked(true);
    const grantedOrientation = await requestOrientation();
    if (!grantedOrientation) {
      room.setError(text(BOTH_NEEDED));
      return false;
    }
    trackerRef.current?.stop();
    trackerRef.current = trackOrientation();
    setOrientationOn(true);

    setCameraAsked(true);
    const cam = await startCamera();
    cameraRef.current = cam;
    setCameraOn(!!cam);
    if (!cam) {
      room.setError(text(BOTH_NEEDED));
      return false;
    }
    return true;
  }

  /**
   * What Ready and Start hang both permissions on. Unlike the two motion games, a
   * refusal here really does resolve false and swallow the tap — this game has no
   * spectator seat to fall back to (spec §5.3).
   */
  async function ensureRequired(): Promise<boolean> {
    if (orientationOn && cameraOn) return true;
    return enableRequired();
  }

  const again = (): void => client?.send({ t: 'start', d: { mode: 'ufo', solo } });
  const enough = enoughToStart(room.connected, [UFOHUNT_MIN_PLAYERS, UFOHUNT_MAX_PLAYERS], solo);
  /*
   * Blocked by a REFUSAL, not by silence. Before anyone has been asked, Ready and
   * Start are the thing that asks (issue #29), so disabling them until the answer
   * exists would disable the only control that can produce one. After a refusal this
   * game still blocks — its documented departure from "denied is a supported state"
   * (spec §5.3) — and the primer's Try again is the way back.
   */
  const readyBlocked = (orientationAsked || cameraAsked) && (!orientationOn || !cameraOn);

  const onShoot = (): void => {
    const s = stateRef.current;
    const c = clientRef.current;
    if (!s || s.phase !== 'running' || !c) return;
    const now = performance.now();
    // The blaster's own felt recharge: one sound and one message per tap rather
    // than a flood of both. The server enforces the real cooldown regardless
    // (spec §2.4, §8) — this only keeps a spam of taps from sounding like one.
    if (now - lastShotAtRef.current < UFOHUNT_SHOT_COOLDOWN_MS) return;
    lastShotAtRef.current = now;

    const aim = trackerRef.current?.read().aim;
    if (!aim) return;
    c.send({ t: 'ufo-shoot', d: { roundId: s.roundId, aimAz: aim.azimuth, aimEl: aim.elevation } });
    playLaser();
    setShotId((id) => id + 1);

    // Predicted locally, from the same roam function and formula the referee
    // itself scores with (`saucerAt`/`ufoAngleBetween`/`ufoImpact`) — purely for
    // this player's own impact flash (spec §2.5), never what actually decides
    // the shot. The referee's own broadcast is that, same as everywhere else.
    // The burst's own POSITION is `spot` — this render's own screen coordinate
    // already driving `.ufohunt__saucer`, not a freshly recomputed one — so it
    // lands exactly on the sprite as drawn, not a few pixels off from a
    // slightly later reading of the same aim.
    const saucer = saucerAt(s.wave, c.now());
    if (ufoImpact(ufoAngleBetween(aim, saucer)) > 0) addBurst('laser', spot ?? screenSpot(aim, saucer));
  };

  const onMissile = (): void => {
    const s = stateRef.current;
    const c = clientRef.current;
    if (!s || s.phase !== 'running' || !c || !myId) return;
    if (missileChargeOf(s, myId) < UFOHUNT_MISSILE_CHARGE_GOAL) return;

    const aim = trackerRef.current?.read().aim;
    if (!aim) return;
    c.send({ t: 'ufo-missile', d: { roundId: s.roundId, aimAz: aim.azimuth, aimEl: aim.elevation } });
    playMissile();
    setShotId((id) => id + 1);

    const saucer = saucerAt(s.wave, c.now());
    if (ufoImpact(ufoAngleBetween(aim, saucer)) > 0) addBurst('missile', spot ?? screenSpot(aim, saucer));
  };

  if (state && state.phase === 'done') {
    const players = room.room?.players ?? [];
    const order = ranking(state, players.map((p) => p.id));
    const byId = new Map(players.map((p) => [p.id, p]));
    return (
      <GameOverScreen
        room={room}
        readyBlocked={readyBlocked}
        onReadySetup={() => void enableRequired()}
        onBeforeReady={ensureRequired}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        status={text({ en: 'Hunt over', fr: 'Chasse terminée' })}
        rows={order.map((id) => ({
          id,
          avatar: byId.get(id)?.avatar ?? '🛸',
          name: byId.get(id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' }),
          value: Math.round(scoreOf(state, id)),
          unit: text({ en: 'score', fr: 'score' }),
        }))}
        me={myId}
        winner={leaderOf(state, order)}
        onAgain={again}
        againLabel={text({ en: 'Hunt again', fr: 'Rechasser' })}
        canAct={room.isHost && enough}
      />
    );
  }

  if (state && running) {
    return (
      <UfoScreen
        state={state}
        players={room.room?.players ?? []}
        myId={myId}
        spot={spot}
        bearing={bearing}
        hot={hot}
        secondsLeft={secondsLeft}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        videoRef={videoElRef}
        onShoot={onShoot}
        shotId={shotId}
        bursts={bursts}
        onMissile={onMissile}
        missileCharge={myId ? missileChargeOf(state, myId) : 0}
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
      startLabel={state ? text({ en: 'Hunt again', fr: 'Rechasser' }) : text({ en: 'Start the hunt', fr: 'Démarrer la chasse' })}
      onStart={again}
      onBeforeReady={ensureRequired}
      readyBlocked={readyBlocked}
      aside={
        <p class="howto__warn" role="note">
          {text({ en: "Feet planted, turn slowly, and keep an arm's length from the furniture and from each other — the screen is not a window, and you cannot see the floor in it.", fr: 'Gardez les pieds au sol, tournez lentement et restez à une longueur de bras des meubles et des autres — l’écran n’est pas une fenêtre et vous ne voyez pas le sol.' })}
        </p>
      }
      extras={
        <UfoPrimer
          support={support}
          orientationOn={orientationOn}
          orientationAsked={orientationAsked}
          cameraOn={cameraOn}
          cameraAsked={cameraAsked}
          isHost={room.isHost}
          onEnable={() => void enableRequired()}
        />
      }
    />
  );
}

/**
 * The one permission card this game offers — no picker, because there is only one
 * way to play it (spec §5.3). Built on the same `PermissionPrimer` shell Steady
 * Hand's own no-fallback motion permission already uses.
 *
 * It explains, and after a refusal it offers the way back; what it no longer does is
 * hold a button in front of the first ask. Ready and Start do that now (issue #29),
 * because a permission with no alternative is not a choice this panel can offer.
 */
function UfoPrimer({
  support,
  orientationOn,
  orientationAsked,
  cameraOn,
  cameraAsked,
  isHost,
  onEnable,
}: {
  support: OrientationSupport;
  orientationOn: boolean;
  orientationAsked: boolean;
  cameraOn: boolean;
  cameraAsked: boolean;
  isHost: boolean;
  onEnable: () => void;
}): JSX.Element {
  const text = useGameText();
  const heading = text({ en: 'Camera and motion', fr: 'Caméra et mouvement' });

  if (support === 'unsupported') {
    return (
      <PermissionPrimer heading={heading} body={text({
        en: 'This phone has no motion sensor, so there is nothing to aim with — UFO Hunt cannot run here.',
        fr: 'Ce téléphone n’a pas de capteur de mouvement, donc rien pour viser — UFO Hunt ne peut pas fonctionner ici.',
      })} />
    );
  }

  const orientationDenied = orientationAsked && !orientationOn;
  const cameraDenied = cameraAsked && orientationOn && !cameraOn;

  if (orientationDenied || cameraDenied) {
    return (
      <PermissionPrimer
        heading={heading}
        body={text(BOTH_NEEDED)}
        action={{ label: text({ en: 'Try again', fr: 'Réessayer' }), onClick: onEnable }}
      />
    );
  }

  if (orientationOn && cameraOn) {
    return (
      <PermissionPrimer heading={heading} enabled body={text({
        en: 'Ready. Hold the phone up — your own sky is the hunting ground.',
        fr: 'Prêt. Levez le téléphone — votre propre ciel devient le terrain de chasse.',
      })} />
    );
  }

  return (
    <PermissionPrimer
      heading={heading}
      body={`${text({
        en: 'The saucer hangs in your own sky, so this needs both your camera and your phone’s motion sensor — there is no version without them. No picture ever leaves your phone; the feed is only ever shown on your own screen.',
        fr: 'La soucoupe plane dans votre propre ciel : ce jeu a besoin à la fois de votre caméra et du capteur de mouvement — il n’existe pas de version sans eux. Aucune image ne quitte votre téléphone ; le flux n’est jamais affiché qu’à l’écran.',
      })} ${isHost
        ? text({ en: 'Start the hunt and your phone will ask for both.', fr: 'Démarrez la chasse et votre téléphone vous demandera les deux.' })
        : text({ en: 'Tap Ready and your phone will ask for both.', fr: 'Touchez Prêt et votre téléphone vous demandera les deux.' })}`}
    />
  );
}
