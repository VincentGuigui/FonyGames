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
import { applyHunt, createLock, myIndex, myTarget, type HuntState, type LockState } from './game';
import { HuntResults, HuntScreen } from './HuntScreen';
import { paintEdges, startCamera, RADAR_FPS, RADAR_PX, type Camera } from './vision';
import { drawSphere, dragTo, trackDrag } from './photosphere';
import { ghostAt } from './radar';

/** How you are playing. Chosen in the lobby, not forced by a denial. */
type Route = 'sensor' | 'sphere';

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
  const [route, setRoute] = useState<Route>('sphere');
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

      const aim =
        route === 'sensor' ? (trackerRef.current?.read().aim ?? null) : sphereAimRef.current;

      /*
       * The ghost roams, so what the lock is given is where it is **now** rather
       * than the direction the server chose. The roam is derived from the index and
       * the ghost's age on this phone, so every player walks the identical path from
       * the identical starting point — see `ghostAt` in radar.ts for why that has to
       * be true rather than merely tidy.
       */
      const ghost = target ? ghostAt(target, index, now - shownAtRef.current) : null;

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
        paint(route, backdropRef.current, radarRef.current, cameraRef.current, sphereImgRef.current, sphereAimRef.current);
      }

      setSecondsLeft(Math.max(0, Math.ceil((s.endsAt - (clientRef.current?.now() ?? Date.now())) / 1000)));
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, route]);

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
    if (!root || route !== 'sphere' || !running) return;
    return trackDrag(root, (dx, dy) => {
      sphereAimRef.current = dragTo(sphereAimRef.current, dx, dy);
    });
  }, [route, running]);

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
  async function enableCameraRoute(): Promise<void> {
    setOrientationAsked(true);
    const granted = await requestOrientation();
    if (!granted) {
      room.setError('No motion access — use your finger to explore instead.');
      return;
    }
    trackerRef.current?.stop();
    trackerRef.current = trackOrientation();
    setOrientationOn(true);
    setRoute('sensor');

    setCameraAsked(true);
    const cam = await startCamera();
    cameraRef.current = cam;
    setCameraOn(!!cam);
    if (!cam) room.setError('No camera — the radar works on a dark ground instead.');
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
         * Forward is whatever you are facing when the round begins, and this is the
         * ONLY time it is set. There used to be a Re-centre button on the round
         * screen; it is gone, so a player who wants a new forward starts a new round.
         * Reasoning and the drift trade-off that buys: spec §3.
         */
        trackerRef.current?.anchor();
        again();
      }}
      note={note(room.isHost, room.connected, route, orientationOn, solo)}
      extras={
        <>
          <section class="panel hunt-safety" role="note">
            <h2 class="panel__heading">Before you start</h2>
            <p class="hunt-safety__body">
              <strong>Look up first. Feet planted, turn slowly</strong>, and keep an arm's
              length from the furniture and from each other. The screen is not a window —
              you cannot see the floor in it.
            </p>
            <p class="hunt-safety__note">
              You will be holding a camera up in a room with other people in it. Say what
              you are doing before you start.
            </p>
          </section>

          {/*
            The camera answer comes BEFORE the camera is asked for. "This game wants
            your camera" is the most alarming sentence in the catalogue and the
            honest answer is short (spec §10).
          */}
          <section class="panel hunt-privacy" role="note">
            <h2 class="panel__heading">About the camera</h2>
            <p class="hunt-privacy__body">
              <strong>No picture ever leaves your phone.</strong> The feed goes straight to
              the outline in the middle of the screen and is thrown away frame by frame.
              Nothing is recorded, nothing is uploaded, and the game never looks at it —
              the ghosts come from the server and the aim from the motion sensor.
            </p>
          </section>

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
        </>
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
    if (radar) paintEdges(radar, backdrop, backdrop.width, backdrop.height);
    return;
  }

  if (route === 'sensor' && camera) {
    const v = camera.video;
    if (v.videoWidth > 0) {
      if (backdrop) coverWith(backdrop, v, v.videoWidth, v.videoHeight);
      if (radar) paintEdges(radar, v, v.videoWidth, v.videoHeight);
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
 * How you want to play, chosen rather than fallen back into.
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
      <h2 class="panel__heading">How you want to play</h2>

      <div class="hunt-route">
        <button
          class={`btn hunt-route__pick ${route === 'sensor' ? 'hunt-route__pick--on' : ''}`}
          type="button"
          disabled={support === 'unsupported'}
          onClick={onCameraRoute}
        >
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
        </button>

        <button
          class={`btn hunt-route__pick ${route === 'sphere' ? 'hunt-route__pick--on' : ''}`}
          type="button"
          onClick={onFingerRoute}
        >
          <span class="hunt-route__title">Use your finger to explore</span>
          <span class="hunt-route__note">
            Seated and one-handed, in a room somewhere else. No permissions, same hunt.
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
  if (route === 'sensor' && !orientationOn) return 'Pick how you want to play above.';
  // Worth saying once, plainly: forward is set here and there is no re-centre on the
  // round screen to fix it with.
  if (route === 'sensor') return 'Face the way you want to call forward, then start.';
  return 'Drag to look around. Ready when you are.';
}
