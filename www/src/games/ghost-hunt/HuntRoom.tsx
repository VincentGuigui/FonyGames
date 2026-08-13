import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  HUNT_MAX_PLAYERS,
  HUNT_MIN_PLAYERS,
  type ServerMessage,
} from '../../../../shared/protocol';
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
import { paintEdges, startCamera, RING_FPS, RING_PX, type Camera } from './vision';
import { drawSphere, dragTo, trackDrag } from './photosphere';

/** How you are playing. Chosen in the lobby, not forced by a denial. */
type Route = 'sensor' | 'sphere';

const IDLE: LockState = { error: Number.POSITIVE_INFINITY, dwell: 0, locked: false };

/**
 * Ghost Hunt's room screen. Spec: docs/specs/games/ghost-hunt.md
 *
 * Two permissions, asked **separately and in this order**: orientation, then
 * camera. Both from a tap, never on load, both remembered when denied
 * (docs/device-capabilities.md §2).
 *
 * The order is the point. A player who has already granted orientation has seen
 * the game work once, which is a far better moment to ask for the alarming
 * permission than the lobby of a game they have never played. And the game is
 * playable after either one, or neither:
 *
 * - orientation + camera → the full thing
 * - orientation only     → the same hunt, ring on a dark ground
 * - camera only, or none → the photosphere, which is a real alternative rather
 *                          than a consolation (§5.4) and is offered to everyone
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
  const backdropRef = useRef<HTMLCanvasElement | null>(null);
  const ringRef = useRef<HTMLCanvasElement | null>(null);
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

      // A new ghost: the dwell starts from nothing, and so does its clock.
      if (index !== indexRef.current) {
        indexRef.current = index;
        shownAtRef.current = now;
        lockRef.current.reset();
      }

      const aim =
        route === 'sensor' ? (trackerRef.current?.read().aim ?? null) : sphereAimRef.current;

      const next = lockRef.current.update(aim, target, now);
      setLock(next);

      if (next.locked) {
        clientRef.current?.send({
          t: 'found',
          d: { roundId: s.roundId, index, ms: Math.round(now - shownAtRef.current) },
        });
      }

      // The backdrop and the ring, at their own rate — 15 fps of Sobel is the
      // budget, and it has nothing to do with how often the aim is evaluated.
      if (now - lastEdge >= 1000 / RING_FPS) {
        lastEdge = now;
        paint(route, backdropRef.current, ringRef.current, cameraRef.current, sphereImgRef.current, sphereAimRef.current);
      }

      setSecondsLeft(Math.max(0, Math.ceil((s.endsAt - (clientRef.current?.now() ?? Date.now())) / 1000)));
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, route]);

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
   * bottom of the stack, and the veil, ring and readout above it were swallowing
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
    void import('./art/photosphere.png?url&no-inline').then((mod) => {
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

  /** Straight out of the tap — iOS refuses the prompt otherwise, and remembers. */
  async function enableOrientation(): Promise<void> {
    setOrientationAsked(true);
    const granted = await requestOrientation();
    if (!granted) {
      room.setError('No motion access — you can still play by dragging the view.');
      return;
    }
    trackerRef.current?.stop();
    trackerRef.current = trackOrientation();
    setOrientationOn(true);
    setRoute('sensor');
  }

  async function enableCamera(): Promise<void> {
    setCameraAsked(true);
    const cam = await startCamera();
    cameraRef.current = cam;
    setCameraOn(!!cam);
    if (!cam) room.setError('No camera — the ring works on a dark ground instead.');
  }

  /** Now is forward. The offset never leaves the phone (spec §10). */
  const reAnchor = (): void => {
    trackerRef.current?.anchor();
    client?.send({ t: 'anchor', d: { roundId: state?.roundId ?? 0 } });
  };

  useEffect(() => () => trackerRef.current?.stop(), []);

  const again = (): void => client?.send({ t: 'start', d: { mode: 'hunt' } });
  const enough = room.connected >= HUNT_MIN_PLAYERS && room.connected <= HUNT_MAX_PLAYERS;
  const mode: 'camera' | 'sphere' | 'dark' =
    route === 'sphere' ? 'sphere' : cameraOn ? 'camera' : 'dark';

  if (state && state.phase === 'over') {
    return (
      <HuntResults
        state={state}
        players={room.room?.players ?? []}
        myId={myId}
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
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        onReAnchor={reAnchor}
        onSweepInstead={support === 'unsupported' ? null : enableOrientation}
        backdropRef={(el) => {
          backdropRef.current = el;
          if (el) sizeToScreen(el);
        }}
        ringRef={(el) => {
          ringRef.current = el;
        }}
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
        // Forward is whatever you are facing when the round begins.
        trackerRef.current?.anchor();
        if (route === 'sensor' && !cameraOn && !cameraAsked) void enableCamera();
        again();
      }}
      note={note(room.isHost, room.connected, route, orientationOn)}
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
            onSensor={enableOrientation}
            onSphere={() => setRoute('sphere')}
            onCamera={enableCamera}
          />
        </>
      }
    />
  );
}

/** Paint the backdrop and the ring for whichever route is live. */
function paint(
  route: Route,
  backdrop: HTMLCanvasElement | null,
  ring: HTMLCanvasElement | null,
  camera: Camera | null,
  sphere: HTMLImageElement | null,
  aim: Aim,
): void {
  if (route === 'sphere' && backdrop && sphere?.complete) {
    drawSphere(backdrop, sphere, sphere.naturalWidth, sphere.naturalHeight, aim);
    if (ring) paintEdges(ring, backdrop, backdrop.width, backdrop.height);
    return;
  }

  if (route === 'sensor' && camera) {
    const v = camera.video;
    if (backdrop && v.videoWidth > 0) {
      const ctx = backdrop.getContext('2d');
      ctx?.drawImage(v, 0, 0, backdrop.width, backdrop.height);
    }
    if (ring && v.videoWidth > 0) paintEdges(ring, v, v.videoWidth, v.videoHeight);
    return;
  }

  // No feed at all: the ring is a plain dark disc and the hunt is unaffected.
  // Losing the scenery must never lose the game (spec §7).
  if (ring) {
    const ctx = ring.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#05070b';
      ctx.fillRect(0, 0, RING_PX, RING_PX);
    }
  }
}

function sizeToScreen(el: HTMLCanvasElement): void {
  // Deliberately NOT devicePixelRatio: this is a dimmed backdrop behind a
  // wireframe, and painting three times the pixels for it would cost the ring its
  // frame budget on exactly the phones that can least afford it.
  el.width = Math.round(el.clientWidth || window.innerWidth);
  el.height = Math.round(el.clientHeight || window.innerHeight);
}

/**
 * How you want to play, chosen rather than fallen back into.
 *
 * The photosphere is offered to everyone from the start, not only after a denial:
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
  onSensor,
  onSphere,
  onCamera,
}: {
  support: OrientationSupport;
  route: Route;
  orientationOn: boolean;
  orientationAsked: boolean;
  cameraOn: boolean;
  cameraAsked: boolean;
  onSensor: () => void;
  onSphere: () => void;
  onCamera: () => void;
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
          onClick={onSensor}
        >
          <span class="hunt-route__title">Sweep the room</span>
          <span class="hunt-route__note">
            {support === 'unsupported'
              ? 'This phone has no motion sensor'
              : denied
                ? 'Motion was turned down'
                : orientationOn
                  ? 'Ready — point where you are facing when the round starts'
                  : 'Hold the phone up and turn. Needs motion access.'}
          </span>
        </button>

        <button
          class={`btn hunt-route__pick ${route === 'sphere' ? 'hunt-route__pick--on' : ''}`}
          type="button"
          onClick={onSphere}
        >
          <span class="hunt-route__title">Drag to look around</span>
          <span class="hunt-route__note">
            Seated and one-handed, in a photo of somewhere else. No permissions, same
            hunt.
          </span>
        </button>
      </div>

      {route === 'sensor' && orientationOn && (
        <button class="btn hunt-route__camera" type="button" onClick={onCamera} disabled={cameraOn}>
          {cameraOn
            ? 'Camera on — the ring shows your room'
            : cameraAsked
              ? 'No camera — the ring works on a dark ground'
              : 'Turn on the camera for the full effect'}
        </button>
      )}
    </section>
  );
}

function note(isHost: boolean, connected: number, route: Route, orientationOn: boolean): string {
  if (connected < HUNT_MIN_PLAYERS) {
    const missing = HUNT_MIN_PLAYERS - connected;
    return `Need ${missing} more player${missing === 1 ? '' : 's'} — hunting alone proves nothing.`;
  }
  if (connected > HUNT_MAX_PLAYERS) return `${HUNT_MAX_PLAYERS} players is the most this one takes.`;
  if (!isHost) return 'The host starts the hunt.';
  if (route === 'sensor' && !orientationOn) return 'Turn on motion above, or drag instead.';
  if (route === 'sensor') return 'Face the way you want to call forward, then start.';
  return 'Drag to look around. Ready when you are.';
}
