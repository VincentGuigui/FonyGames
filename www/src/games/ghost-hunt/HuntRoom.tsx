import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  HUNT_MAX_PLAYERS,
  HUNT_MIN_PLAYERS,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { soloTesting } from '../../core/solo';
import { useRoom, useShareRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import {
  orientationSupport,
  requestOrientation,
  trackOrientation,
  type Aim,
  type OrientationSupport,
  type OrientationTracker,
} from '../../core/sensors/orientation';
import {
  applyHunt,
  createLock,
  ghostSpeed,
  myIndex,
  myTarget,
  type HuntState,
  type LockState,
} from './game';
import { HuntResults, HuntScreen } from './HuntScreen';
import { paintEdges, startCamera, RADAR_FPS, RADAR_PX, type Camera } from './vision';
import { CameraIcon, RoomImageIcon } from './icons';
import { drawSphere, dragTo, trackDrag } from './photosphere';
import { ghostAt } from './radar';

/** How you are playing. Chosen in the lobby, not forced by a denial. */
/**
 * Where the hunt happens: your own room through the camera, or a photosphere.
 *
 * Renamed from `'sensor' | 'sphere'`, which named one route after its INPUT and the other
 * after its scenery — and that pairing is exactly what stopped being true when the virtual
 * room learnt to be aimed with the phone as well as with a finger. A route is a place now;
 * how you look around inside it is `Aiming`.
 */
type Route = 'camera' | 'sphere';

/**
 * How you look around, which only the virtual room lets you choose.
 *
 * The camera route has no choice to make: the picture on screen is wherever the phone is
 * pointing, so dragging it would be dragging the room.
 */
type Aiming = 'sensor' | 'drag';

/**
 * How long the phone gets to prove it has an orientation sensor before the finger takes
 * the room back. Long enough for a first event at any sane rate, short enough that a
 * player who tapped the wrong thing is not left looking at a frozen room.
 */
const SENSOR_GRACE_MS = 1_200;

const IDLE: LockState = {
  error: Number.POSITIVE_INFINITY,
  dwell: 0,
  locked: false,
  spot: null,
  bearing: null,
};

/**
 * Ghost Hunt's room screen. Spec: docs/specs/games/ghost-hunt.md
 *
 * Two routes, and the player picks one in the lobby:
 *
 * - **camera** — orientation for the aim, the live feed as the playground. Both
 *   permissions are asked for by the one tap that chooses this route, orientation
 *   first, straight out of the gesture (docs/device-capabilities.md §2).
 * - **finger** — drag a panorama. No permissions, same hunt, and a real
 *   alternative rather than a consolation (§5.4).
 *
 * Every denial has a landing place, and none of them is "you cannot play":
 *
 * - orientation + camera → the full thing
 * - orientation only     → the same hunt, radar on a dark ground
 * - neither              → the finger route, which needs nothing
 */
export function HuntRoom(props: { game: GameCard }): JSX.Element {
  return (
    <RoomGate game={props.game}>
      {(code) => <HuntRoomInner game={props.game} code={code} />}
    </RoomGate>
  );
}

function HuntRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const [state, setState] = useState<HuntState>(null);
  const [support] = useState<OrientationSupport>(orientationSupport);
  /*
   * The camera is the default, because it is the game: the pitch, the card and the whole
   * of §2 are about turning around in your own room. The virtual room is the seated
   * alternative, and it used to be what a player got by doing nothing.
   *
   * Defaulting to it does NOT grant anything — a permission still needs a tap, and the
   * Start button is that tap when nobody has pressed the picker (see `onStart`).
   */
  const [route, setRoute] = useState<Route>('camera');
  /** Virtual room only: turn the phone, or drag with a finger. */
  const [aiming, setAiming] = useState<Aiming>('drag');
  const [orientationOn, setOrientationOn] = useState(false);
  const [orientationAsked, setOrientationAsked] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraAsked, setCameraAsked] = useState(false);
  const [lock, setLock] = useState<LockState>(IDLE);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const onGame = useCallback((msg: ServerMessage) => {
    setState((prev) => applyHunt(prev, msg));
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
   * Forward is whatever this phone is facing when the round BEGINS — for everyone.
   *
   * It used to be anchored in the host's start handler, which is a tap only the host has,
   * so every other player in the room hunted against an unanchored origin: their ghosts
   * were in the right places relative to each other and in the wrong place relative to
   * the room. Keyed on the round id so "again" re-anchors and a re-render does not.
   */
  const anchoredRound = useRef(0);
  useEffect(() => {
    if (!running || !state) return;
    if (anchoredRound.current === state.roundId) return;
    anchoredRound.current = state.roundId;
    trackerRef.current?.anchor();
  }, [running, state?.roundId]);

  /*
   * The moving parts live in refs rather than state because they are read by a
   * 60 Hz loop: a setState per sensor frame would re-render the whole screen
   * sixty times a second to move one circle.
   */
  const trackerRef = useRef<OrientationTracker | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const sphereAimRef = useRef<Aim>({ azimuth: 0, elevation: 0 });
  const lockRef = useRef(createLock());
  const backdropRef = useRef<HTMLCanvasElement>(null);
  const radarRef = useRef<HTMLCanvasElement>(null);
  const sphereImgRef = useRef<HTMLImageElement | null>(null);
  const stateRef = useRef<HuntState>(null);
  stateRef.current = state;
  const clientRef = useRef(client);
  clientRef.current = client;
  const meRef = useRef(myId);
  meRef.current = myId;

  /**
   * Is the phone doing the aiming?
   *
   * Always on the camera route — the picture IS where the phone points — and on the
   * virtual room only when the player has switched to it.
   */
  const bySensor = route === 'camera' || aiming === 'sensor';

  /** The index whose dwell is in progress, so a new ghost starts from cold. */
  const indexRef = useRef(-1);
  /** When the current ghost appeared on THIS phone, for the find time. */
  const shownAtRef = useRef(0);

  /*
   * One loop for the whole round: aim, lock, and repaint.
   *
   * `requestAnimationFrame` rather than an interval, so it stops dead when the tab
   * is hidden — which is also what makes the camera-release rule below cheap.
   */
  useEffect(() => {
    if (!running) return;

    let raf = 0;
    let lastEdge = 0;

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);

      const s = stateRef.current;
      const me = meRef.current;
      if (!s || s.phase !== 'running') return;

      const target = myTarget(s, me);
      const index = myIndex(s, me);

      // A new ghost: the hold starts from nothing, and so does its clock.
      if (index !== indexRef.current) {
        indexRef.current = index;
        shownAtRef.current = now;
        lockRef.current.reset();
      }

      /*
       * One question — is the phone doing the aiming — asked the same way for both routes.
       * The camera route always is; the virtual room is when the player has switched it on.
       */
      const aim = bySensor ? (trackerRef.current?.read().aim ?? null) : sphereAimRef.current;

      /*
       * The ghost roams, so what the lock is given is where it is **now** rather
       * than the direction the server chose. The path comes from the index and the
       * ghost's age on this phone, so a player who reaches a ghost late still walks
       * it from the same starting point.
       *
       * The PACE comes from this player's own catch count: the more you have caught,
       * the faster it drifts (`ghostSpeed`). It is the one thing about a ghost that
       * is not the same for everyone, and radar.ts says why that is deliberate.
       */
      const ghost = target
        ? ghostAt(target, index, now - shownAtRef.current, ghostSpeed(s.scores[me ?? ''] ?? 0))
        : null;

      const next = lockRef.current.update(aim, ghost, now);
      setLock(next);

      if (next.locked) {
        clientRef.current?.send({
          t: 'found',
          d: { roundId: s.roundId, index, ms: Math.round(now - shownAtRef.current) },
        });
      }

      // The background and the radar, at their own rate — 15 fps of Sobel is the
      // budget, and it has nothing to do with how often the aim is evaluated.
      if (now - lastEdge >= 1000 / RADAR_FPS) {
        lastEdge = now;
        paint(
          route,
          backdropRef.current,
          radarRef.current,
          cameraRef.current,
          sphereImgRef.current,
          bySensor ? (trackerRef.current?.read().aim ?? sphereAimRef.current) : sphereAimRef.current,
        );
      }

      setSecondsLeft(Math.max(0, Math.ceil((s.endsAt - (clientRef.current?.now() ?? Date.now())) / 1000)));
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, route, bySensor]);

  /*
   * Size the background canvas once the round screen exists, and again if the window
   * changes shape.
   *
   * This used to live in the canvas's own `ref` callback, which the screen re-created on
   * every render — so it ran at sensor rate, and since assigning `canvas.width` CLEARS
   * the canvas, the background was wiped immediately after every paint. The feed was
   * drawn correctly sixty times a second and shown none of them.
   */
  useEffect(() => {
    if (!running) return;
    const fit = (): void => {
      const el = backdropRef.current;
      if (el) sizeToScreen(el);
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
    };
  }, [running]);

  /*
   * The camera is released when the round ends, when the tab is hidden and when
   * this unmounts. Stopped, not paused: a paused track keeps the phone's camera
   * indicator lit, which reads as being spied on — and §10 spends a whole section
   * promising otherwise.
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

  /*
   * The sphere is dragged, not aimed.
   *
   * Bound to the screen ROOT, not to the canvas it draws onto: the canvas is the
   * bottom of the stack, and the veil, radar and readout above it were swallowing
   * every drag before the sphere saw one. `trackDrag` skips drags that start on a
   * control, so the buttons still work.
   */
  useEffect(() => {
    const root = backdropRef.current?.parentElement;
    if (!root || route !== 'sphere' || aiming !== 'drag' || !running) return;
    return trackDrag(root, (dx, dy) => {
      sphereAimRef.current = dragTo(sphereAimRef.current, dx, dy);
    });
  }, [route, aiming, running]);

  /* The panorama is fetched only when somebody actually chooses the fallback. */
  useEffect(() => {
    if (route !== 'sphere' || sphereImgRef.current) return;
    let live = true;
    void import('./art/photosphere.jpg?url&no-inline').then((mod) => {
      if (!live) return;
      const img = new Image();
      img.src = (mod as { default: string }).default;
      img.onload = () => {
        sphereImgRef.current = img;
      };
    });
    return () => {
      live = false;
    };
  }, [route]);

  /**
   * "Use your camera to find the ghost" — both permissions, one tap.
   *
   * They used to be two buttons, and the second one only appeared after the first
   * succeeded, so the camera was a thing you discovered rather than a thing you
   * chose. The choice a player is actually making is *how they want to play*, and
   * for this route the camera is not an extra: it is the room they are searching.
   *
   * Orientation first, straight out of the tap — iOS refuses that prompt outside a
   * gesture and remembers a denial (docs/device-capabilities.md §2). The camera is
   * asked for second and is allowed to fail: no camera means a dark ground, which
   * loses the scenery and not the game (spec §7).
   */
  async function enableCameraRoute(): Promise<boolean> {
    setOrientationAsked(true);
    const granted = await requestOrientation();
    if (!granted) {
      room.setError('No motion access — use your finger to explore instead.');
      return false;
    }
    trackerRef.current?.stop();
    trackerRef.current = trackOrientation();
    setOrientationOn(true);
    setRoute('camera');

    setCameraAsked(true);
    const cam = await startCamera();
    cameraRef.current = cam;
    setCameraOn(!!cam);
    if (!cam) room.setError('No camera — the radar works on a dark ground instead.');
    // The camera is allowed to fail; the orientation is not, and it is the one this
    // answer is about — the round is playable on a dark ground, not without an aim.
    return true;
  }

  /**
   * Turn the phone, or drag — in the virtual room only.
   *
   * Straight out of the toggle's tap, because switching TO the sensor may need the
   * orientation permission and iOS refuses that prompt outside a gesture. A refusal
   * leaves the finger in charge and says so, rather than leaving a room that no longer
   * responds to anything.
   */
  async function switchAiming(next: Aiming): Promise<void> {
    if (next === 'drag') {
      setAiming('drag');
      return;
    }

    if (!orientationOn) {
      setOrientationAsked(true);
      const granted = await requestOrientation();
      if (!granted) {
        room.setError('No motion access — keep using your finger.');
        return;
      }
      trackerRef.current?.stop();
      trackerRef.current = trackOrientation();
      setOrientationOn(true);
    }
    /*
     * Forward is set here, not at the start of the round: the player has been dragging,
     * so whatever they are physically facing has nothing to do with where they are
     * looking in the sphere. Anchoring now makes "straight ahead" the way the phone is
     * pointing at the moment they hand it the job.
     */
    trackerRef.current?.anchor();
    setAiming('sensor');

    /*
     * A granted permission is not a sensor.
     *
     * `requestOrientation()` answers true on anything that is not iOS — including a
     * laptop, and including a phone whose sensor is off — because there is no prompt to
     * refuse. So the permission says yes, no `deviceorientation` event ever arrives, and
     * the view freezes with a toggle claiming the phone is in charge. Give it a moment to
     * produce a reading, and hand the room back to the finger if it does not.
     */
    setTimeout(() => {
      if (trackerRef.current?.ready()) return;
      setAiming('drag');
      room.setError('This phone is not reporting movement — keep using your finger.');
    }, SENSOR_GRACE_MS);
  }

  useEffect(() => () => trackerRef.current?.stop(), []);

  const again = (): void => client?.send({ t: 'start', d: { mode: 'hunt', solo } });
  const enough = enoughToStart(room.connected, [HUNT_MIN_PLAYERS, HUNT_MAX_PLAYERS], solo);
  const mode: 'camera' | 'sphere' | 'dark' =
    route === 'sphere' ? 'sphere' : cameraOn ? 'camera' : 'dark';

  if (state && state.phase === 'over') {
    return (
      <HuntResults
        state={state}
        players={room.room?.players ?? []}
        myId={myId}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        accent={card.accent}
        onAgain={again}
        canAgain={room.isHost && enough}
      />
    );
  }

  if (state && running) {
    return (
      <HuntScreen
        state={state}
        players={room.room?.players ?? []}
        myId={myId}
        lock={lock}
        secondsLeft={secondsLeft}
        mode={mode}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        backdropRef={backdropRef}
        radarRef={radarRef}
        {...(route === 'sphere'
          ? { aiming, onAiming: (next: Aiming) => void switchAiming(next) }
          : {})}
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
      startLabel={state ? 'Hunt again' : 'Start the hunt'}
      onStart={() => {
        /*
         * The camera route is the default, so most players reach this button without
         * having pressed the picker — and a permission needs a tap. This IS a tap, so it
         * asks here rather than starting a round whose aim can never move.
         *
         * `void`, not awaited: `enableCameraRoute` anchors and starts the round itself
         * once it knows what it was given.
         */
        if (route === 'camera' && !orientationOn) {
          void enableCameraRoute().then((ok) => {
            // Turned down: the virtual room needs nothing and is a real way to play, so
            // the round still starts — seated, with a finger, as the error line says.
            if (!ok) setRoute('sphere');
            again();
          });
          return;
        }

        /*
         * No anchoring here any more. Forward is set when the ROUND begins, by the effect
         * near the top of this component, because that is an event every phone in the
         * room sees — this handler is a tap only the host has.
         */
        again();
      }}
      note={note(room.isHost, room.connected, route, orientationOn, solo)}
      /*
       * The physical warning rides with the rules rather than in a panel of its own.
       *
       * Its panel is gone, but the warning is not: this is a game played by people
       * holding a phone above their heads and turning on the spot in a room with
       * furniture and each other in it (spec §10), and that is the one thing here that
       * can actually hurt somebody. The same slot Cat and Mouse uses to name who it
       * excludes.
       */
      aside={
        <p class="howto__warn" role="note">
          Feet planted, turn slowly, and keep an arm's length from the furniture and from
          each other — the screen is not a window, and you cannot see the floor in it.
        </p>
      }
      extras={
        <RoutePicker
          support={support}
          route={route}
          orientationOn={orientationOn}
          orientationAsked={orientationAsked}
          cameraOn={cameraOn}
          cameraAsked={cameraAsked}
          onCameraRoute={enableCameraRoute}
          onFingerRoute={() => setRoute('sphere')}
        />
      }
    />
  );
}

/**
 * Paint the background and the radar for whichever route is live.
 *
 * The **background is the playground**: on the camera route it is the live feed at
 * full bleed, which is the room you are searching, and on the finger route it is the
 * panorama you are dragging. The radar is the same picture run through the edge
 * filter — one source, two treatments, so what is in the radar is always what is in
 * front of you.
 */
function paint(
  route: Route,
  backdrop: HTMLCanvasElement | null,
  radar: HTMLCanvasElement | null,
  camera: Camera | null,
  sphere: HTMLImageElement | null,
  aim: Aim,
): void {
  if (route === 'sphere' && backdrop && sphere?.complete) {
    drawSphere(backdrop, sphere, sphere.naturalWidth, sphere.naturalHeight, aim);
    // The backdrop is already in screen pixels, so the dial's window is its own size.
    if (radar) paintEdges(radar, backdrop, backdrop.width, backdrop.height, dialWindow(radar, 1));
    return;
  }

  if (route === 'camera' && camera) {
    const v = camera.video;
    if (v.videoWidth > 0) {
      if (backdrop) coverWith(backdrop, v, v.videoWidth, v.videoHeight);
      if (radar) {
        /*
         * The same scale the backdrop is drawn at, so the dial is a window onto the room
         * behind it rather than a second, wider picture of the same room — see
         * `paintEdges`. Without a backdrop to measure against there is nothing to match,
         * so the filter falls back to its own default.
         */
        const scale = backdrop
          ? Math.max(backdrop.width / v.videoWidth, backdrop.height / v.videoHeight)
          : null;
        paintEdges(radar, v, v.videoWidth, v.videoHeight, scale ? dialWindow(radar, scale) : undefined);
      }
    }
    return;
  }

  // No feed at all: the radar is a plain dark disc and the hunt is unaffected.
  // Losing the scenery must never lose the game (spec §7).
  if (radar) {
    const ctx = radar.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#05070b';
      ctx.fillRect(0, 0, RADAR_PX, RADAR_PX);
    }
  }
}

/**
 * How much of the source the dial covers, in source pixels.
 *
 * `scale` is how many screen pixels one source pixel becomes on the backdrop, so dividing
 * the dial's on-screen diameter by it gives the window that lands exactly under the dial.
 * `clientWidth` is zero for a canvas that has not been laid out yet — the first frame or
 * two of a round — and a zero window would sample nothing, so it falls back to the dial's
 * own buffer size.
 */
function dialWindow(radar: HTMLCanvasElement, scale: number): number {
  const onScreen = radar.clientWidth || RADAR_PX;
  return onScreen / scale;
}

/**
 * Draw a frame across the whole canvas **without stretching it**.
 *
 * A camera frame is landscape and the screen is portrait, so the old
 * `drawImage(v, 0, 0, w, h)` squeezed a 4:3 frame into a 9:19 one — the room came
 * out as tall thin smears, which reads as a broken filter rather than as your room.
 * This crops to the centre instead, the same as `object-fit: cover`.
 */
function coverWith(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  sw: number,
  sh: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const scale = Math.max(canvas.width / sw, canvas.height / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(source, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

function sizeToScreen(el: HTMLCanvasElement): void {
  // Deliberately NOT devicePixelRatio: this is a background behind a wireframe, and
  // painting three times the pixels for it would cost the radar its frame budget on
  // exactly the phones that can least afford it.
  const w = Math.round(el.clientWidth || window.innerWidth);
  const h = Math.round(el.clientHeight || window.innerHeight);
  // Assigning either dimension CLEARS the canvas, even to the value it already holds,
  // so a resize handler that fires spuriously must not throw away the frame.
  if (el.width === w && el.height === h) return;
  el.width = w;
  el.height = h;
}

/**
 * The game mode, chosen rather than fallen back into.
 *
 * Two choices, named by **what you do** rather than by which sensor they use — a
 * player picking between "Sweep the room" and "Drag to look around" is being asked
 * to guess which one needs a camera. And each choice now turns on everything it
 * needs from the one tap: the camera used to be a third button that only appeared
 * after motion was granted, so the feature this game is built around was something
 * you discovered rather than something you chose.
 *
 * The finger route is offered to everyone from the start, not only after a denial:
 * it is seated, one-handed and quiet, which makes it the accessible way to play
 * rather than a lesser one (spec §11).
 */
function RoutePicker({
  support,
  route,
  orientationOn,
  orientationAsked,
  cameraOn,
  cameraAsked,
  onCameraRoute,
  onFingerRoute,
}: {
  support: OrientationSupport;
  route: Route;
  orientationOn: boolean;
  orientationAsked: boolean;
  cameraOn: boolean;
  cameraAsked: boolean;
  onCameraRoute: () => void;
  onFingerRoute: () => void;
}): JSX.Element {
  const denied = orientationAsked && !orientationOn;

  return (
    <section class="panel primer">
      {/*
        The same heading Cat and Mouse uses, and any game that grows a second way to play
        should use it too. A player who has met one mode picker should recognise the next
        without reading it — which they could not while one was called "How you want to
        play" and the other "Dragging", two names for one idea, neither of them the idea.
      */}
      <h2 class="panel__heading">Select a game mode</h2>

      <div class="hunt-route">
        <button
          class={`btn hunt-route__pick ${route === 'camera' ? 'hunt-route__pick--on' : ''}`}
          type="button"
          disabled={support === 'unsupported'}
          onClick={onCameraRoute}
        >
          {/* An icon per mode, so the two are told apart before either is read. */}
          <span class="hunt-route__icon">
            <CameraIcon />
          </span>
          <span class="hunt-route__title">Use your camera to find the ghost</span>
          <span class="hunt-route__note">
            {support === 'unsupported'
              ? 'This phone has no motion sensor'
              : denied
                ? 'Motion was turned down — use your finger instead'
                : orientationOn && cameraOn
                  ? 'Ready. Your room is the hunting ground.'
                  : orientationOn && cameraAsked
                    ? 'No camera — the radar works on a dark ground'
                    : orientationOn
                      ? 'Ready — hold the phone up and turn'
                      : 'Hold the phone up and turn. Needs motion and the camera.'}
          </span>
          {/*
            The privacy answer, on the button that asks for the camera.

            It had a collapsed panel of its own further up the lobby, which put the most
            alarming sentence in the catalogue — "this game wants your camera" — and its
            answer in two different places, with the answer somewhere you had to already
            be reassured enough to go looking. Here it is unmissable and unavoidable: it
            is part of the thing you are about to tap (spec §10).
          */}
          <span class="hunt-route__privacy">
            No worry — no picture ever leaves your phone. The feed goes straight to the
            outline on screen and is thrown away frame by frame.
          </span>
        </button>

        {/*
          The permission needs a tap of its own, and this is it.
          
          It was only ever asked for from the START button — which nobody but the host
          has. So every other player in the room arrived at the round with no camera and
          no aim, on the route that is the DEFAULT, having done nothing wrong: the camera
          option was already highlighted, because it is the default, so there was nothing
          on screen suggesting anything was left to do.

          Shown to the host as well. Granting before the round rather than during it also
          means the browser's permission dialog is not racing the first frame.
        */}
        {route === 'camera' && support !== 'unsupported' && !orientationOn && (
          <button class="btn btn--primary hunt-route__allow" type="button" onClick={onCameraRoute}>
            {denied ? 'Try again' : 'Allow motion and camera'}
          </button>
        )}

        <button
          class={`btn hunt-route__pick ${route === 'sphere' ? 'hunt-route__pick--on' : ''}`}
          type="button"
          onClick={onFingerRoute}
        >
          <span class="hunt-route__icon">
            <RoomImageIcon />
          </span>
          <span class="hunt-route__title">Find the ghost in a virtual room</span>
          <span class="hunt-route__note">
            Somewhere else entirely. Look around by turning the phone or dragging — you
            can swap mid-hunt — and it needs no permissions.
          </span>
        </button>
      </div>
    </section>
  );
}

function note(
  isHost: boolean,
  connected: number,
  route: Route,
  orientationOn: boolean,
  solo: boolean,
): string {
  if (!solo && connected < HUNT_MIN_PLAYERS) {
    const missing = HUNT_MIN_PLAYERS - connected;
    return `Need ${missing} more player${missing === 1 ? '' : 's'} — hunting alone proves nothing.`;
  }
  if (connected > HUNT_MAX_PLAYERS) return `${HUNT_MAX_PLAYERS} players is the most this one takes.`;
  if (!isHost) return 'The host starts the hunt.';
  if (route === 'camera' && !orientationOn) return 'Camera and motion are asked for when you start.';
  // Worth saying once, plainly: forward is set here and there is no re-centre on the
  // round screen to fix it with.
  if (route === 'camera') return 'Face the way you want to call forward, then start.';
  return 'Look around the virtual room. Ready when you are.';
}
