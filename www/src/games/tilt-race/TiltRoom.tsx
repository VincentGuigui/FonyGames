import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  TILT_MAX_PLAYERS,
  TILT_MIN_PLAYERS,
  TILT_REPORT_MS,
  TILT_CRUISE_SPEED,
  TILT_TOP_SPEED,
  type ServerMessage,
  type TiltState,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import type { Track } from '../../../../shared/tiltTrack';
import { useGameRoom } from '../../core/room/useRoom';
import { useSoloTesting } from '../../core/useSolo';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { StatusBar } from '../../core/ui/StatusBar';
import { GameOverScreen } from '../../core/ui/GameOver';
import { PermissionPrimer } from '../../core/ui/PermissionPrimer';
import { orientationSupport, requestOrientation, type OrientationSupport } from '../../core/sensors/orientation';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import { TrackCanvas } from './TrackCanvas';
import { progress, startDrive, step, type Drive } from './drive';
import { reverseSpin, reverseSpot, type EdgeSpot } from './gravityButton';
import { rollTracker } from './roll';
import './tilt-race.css';

/**
 * Tilt Race's room screen. Spec: docs/specs/games/tilt-race.md §4
 *
 * The simulation lives in `drive.ts` and the drawing in `TrackCanvas.tsx`; this
 * holds them together and owns the two things that talk to the outside world —
 * the tilt sensor, and the four-times-a-second progress report.
 *
 * **The car is a ref, not state.** It changes 60 times a second and Preact must
 * never re-render for it; the canvas reads it through a getter each frame. Only
 * things a human reads at human speed — the lap, the speed readout, the
 * reverse button's resting place — go through `useState`. Asteroid Race's HUD
 * makes the same split for the same reason.
 */
export function TiltRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <TiltRoomInner game={card} code={code} />}</RoomGate>;
}

function TiltRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [state, setState] = useState<TiltState | null>(null);
  const [support] = useState<OrientationSupport>(() => orientationSupport());
  const [tiltOn, setTiltOn] = useState(false);
  const [tiltAsked, setTiltAsked] = useState(false);

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'tilt') setState(msg.d);
  }, []);

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;
  const clientRef = useRef(client);
  clientRef.current = client;

  const enableTilt = useCallback(async (): Promise<boolean> => {
    setTiltAsked(true);
    const granted = await requestOrientation();
    setTiltOn(granted);
    return granted;
  }, []);

  /**
   * What Ready and Start hang the tilt on. There is no touch fallback (spec
   * §5), so a refusal really does swallow the tap — a car nobody can steer is
   * not a way to be in the race. Asteroid Race's shape, for the same reason.
   */
  const ensureTilt = useCallback(async (): Promise<boolean> => {
    if (tiltOn) return true;
    if (support === 'unsupported') return false;
    return enableTilt();
  }, [tiltOn, support, enableTilt]);

  /**
   * The circuit, rebuilt only when the round changes.
   *
   * `cum` and `length` are recomputed here rather than sent, because they are
   * derivable from the points and a wire format with three redundant fields is
   * three chances for them to disagree.
   */
  const track = useMemo<Track | null>(() => {
    if (!state || state.track.length < 4) return null;
    const points = state.track.map((p) => ({ x: p.x, y: p.y }));
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1] as { x: number; y: number };
      const b = points[i] as { x: number; y: number };
      cum.push((cum[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
    }
    return { points, cum, length: state.lapLength, cells: state.cells };
  }, [state?.roundId, state?.track.length, state?.lapLength]);

  // The car. A ref, for the reason in this component's own doc comment.
  const carRef = useRef<Drive | null>(null);
  const rollRef = useRef<ReturnType<typeof rollTracker> | null>(null);
  const reverseRef = useRef(false);
  const orientRef = useRef<{ gamma: number | null; beta: number | null }>({ gamma: null, beta: null });
  const lastReportRef = useRef(0);
  const finishedRef = useRef(false);

  const [hud, setHud] = useState({ speed: 0, lap: 0, place: 1 });
  /*
   * The reverse button's place is a ref and a direct style write, NOT state.
   *
   * Riding along with the four-times-a-second HUD update is fine for a lap
   * counter and far too slow for something the player is watching follow their
   * own wrist: it lands a visible quarter-second after the phone has turned.
   * Gravity is sampled every frame, so the button
   * moves every frame; going through `useState` to do that would re-render
   * Preact sixty times a second, which is exactly what this component's own
   * doc comment forbids. Writing the two style properties on the node is the
   * same trick the canvas uses, for the same reason.
   */
  const reverseEl = useRef<HTMLButtonElement | null>(null);
  const spotRef = useRef<EdgeSpot>({ x: 0.5, y: 0.88 });
  const spinRef = useRef(0);
  const frozenSpin = useRef<number | null>(null);
  const frozenSpot = useRef<EdgeSpot | null>(null);

  const phase = state?.phase;
  const roundId = state?.roundId;

  // A fresh car per round, and a fresh tilt tracker with it. `calibrate()` is
  // a no-op on a tracker this new (`roll.ts`) — kept for symmetry with the
  // reused-tracker case rather than because this instance needs it.
  useEffect(() => {
    if (!track || phase === undefined || phase === 'done') return;
    carRef.current = startDrive(track);
    finishedRef.current = false;
    lastReportRef.current = 0;
    const tracker = rollTracker();
    tracker.calibrate();
    rollRef.current = tracker;

    // One event, one instrument: the steering and the reverse button's own
    // place both come out of where gravity points (spec §5) — no second
    // sensor, no second permission.
    const onOrient = (e: DeviceOrientationEvent): void => {
      orientRef.current = { gamma: e.gamma, beta: e.beta };
      tracker.sample(e.gamma, e.beta);
    };
    window.addEventListener('deviceorientation', onOrient);
    return () => {
      rollRef.current = null;
      window.removeEventListener('deviceorientation', onOrient);
    };
  }, [track, roundId, phase]);

  /**
   * One frame: step the car, then report if it is time.
   *
   * Reporting on a wall clock rather than a frame count, because the frame rate
   * is whatever the phone manages and `TILT_REPORT_MS` is a promise about the
   * wire, not about rendering.
   */
  const onFrame = useCallback(
    (dtMs: number) => {
      // The button first, and before any of the early returns below: it
      // follows the phone whether or not the lights have gone out, and it is
      // the one thing here that must not wait for the next report.
      const spot = reverseSpot(orientRef.current.gamma, orientRef.current.beta, reverseRef.current, frozenSpot.current);
      const spin = reverseSpin(orientRef.current.gamma, orientRef.current.beta, reverseRef.current, frozenSpin.current);
      spotRef.current = spot;
      spinRef.current = spin;
      const el = reverseEl.current;
      if (el) {
        el.style.left = `${spot.x * 100}%`;
        el.style.top = `${spot.y * 100}%`;
        // The face turns with gravity so the arrow points at the real floor
        // (#43). The `rotate` property, not a transform: the stylesheet centres
        // this button with `translate`, and the two compose.
        el.style.rotate = `${spin}rad`;
      }

      const s = state;
      const car = carRef.current;
      if (!s || !track || !car) return;
      const now = clientRef.current?.now() ?? Date.now();
      // Nothing moves until the lights: the countdown is what gets eight
      // phones away together (spec §2).
      if (s.phase !== 'running' || now < s.startsAt) return;

      const roll = rollRef.current?.read() ?? 0;
      const next = step(track, car, { roll, reverse: reverseRef.current }, dtMs);
      carRef.current = next;

      if (now - lastReportRef.current >= TILT_REPORT_MS) {
        lastReportRef.current = now;
        clientRef.current?.send({ t: 'tilt-move', d: { roundId: s.roundId, s: next.s, lap: next.lap, at: now } });

        // The readouts, at report rate rather than frame rate — nobody reads a
        // speed sixty times a second, and this is a re-render.
        const mine = progress(track, next);
        let ahead = 0;
        for (const [id, car2] of Object.entries(s.field)) {
          if (id === myId) continue;
          if (car2.lap * track.length + car2.s > mine) ahead++;
        }
        setHud({ speed: Math.max(0, Math.round(next.speed)), lap: next.lap, place: ahead + 1 });
      }

      if (!finishedRef.current && next.lap >= s.laps) {
        finishedRef.current = true;
        clientRef.current?.send({ t: 'tilt-finish', d: { roundId: s.roundId, at: now } });
      }
    },
    [state?.roundId, state?.phase, state?.startsAt, state?.laps, track, myId],
  );

  const players = room.room?.players ?? [];
  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  const avatarOf = (id: string): string => players.find((p) => p.id === id)?.avatar ?? '🙂';

  const rivals = useCallback(() => {
    const s = state;
    // No ghosts until this phone knows which car is its own, or it would draw
    // itself twice — once fixed at the centre and once as a rival.
    if (!s || myId === undefined) return [];
    return Object.entries(s.field)
      .filter(([id, car]) => id !== myId && !car.left)
      .map(([id, car]) => ({ s: car.s, lap: car.lap, avatar: avatarOf(id) }));
  }, [state?.field, myId, players]);

  const start = useCallback(() => {
    clientRef.current?.send({ t: 'start', d: { mode: 'tilt', solo } });
  }, [solo]);

  const readyBlocked = support === 'unsupported' || (tiltAsked && !tiltOn);

  if (state && state.phase === 'done' && track) {
    const rows = state.order.map((id) => {
      const car = state.field[id];
      const done = car?.finished ?? false;
      const far = car ? (car.lap * track.length + car.s) / (state.laps * track.length) : 0;
      return {
        id,
        avatar: avatarOf(id),
        name: nameOf(id),
        value: done ? text({ en: 'home', fr: 'arrivé' }) : `${Math.round(Math.min(1, far) * 100)}%`,
        out: car?.left ?? false,
      };
    });
    return (
      <GameOverScreen
        room={room}
        readyBlocked={readyBlocked}
        onReadySetup={() => void enableTilt()}
        onBeforeReady={ensureTilt}
        screen={card.screen}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        note={text({ en: 'Placings are by distance for anyone still out there.', fr: 'Les places se jouent à la distance pour ceux encore en piste.' })}
        rows={rows}
        me={myId}
        winner={state.winner}
        onAgain={start}
        canAct={room.isHost && enoughToStart(room.connected, [TILT_MIN_PLAYERS, TILT_MAX_PLAYERS], solo)}
      />
    );
  }

  if (state && track) {
    const now = clientRef.current?.now() ?? Date.now();
    const countdown = Math.max(0, Math.ceil((state.startsAt - now) / 1000));
    const total = Object.keys(state.field).length;

    return (
      <div class="tilt" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          status={text({
            en: `Lap ${Math.min(hud.lap + 1, state.laps)}/${state.laps} · ${hud.place}/${total}`,
            fr: `Tour ${Math.min(hud.lap + 1, state.laps)}/${state.laps} · ${hud.place}/${total}`,
          })}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
        />

        <div class="tilt__board">
          <TrackCanvas
            track={track}
            car={() => carRef.current ?? startDrive(track)}
            rivals={rivals}
            myAvatar={myId !== undefined ? avatarOf(myId) : '🙂'}
            onFrame={onFrame}
          />

          {/* The speed readout, small, top-left (spec §4). Coloured once past
              cruise, because that is where the skid starts and the player has
              to know which side of it they are on. */}
          <p class={`tilt__speed ${hud.speed > TILT_CRUISE_SPEED ? 'tilt__speed--hot' : ''}`}>
            <strong>{hud.speed}</strong>
            <span class="tilt__speed-max">/{TILT_TOP_SPEED}</span>
          </p>

          {/* The progress rail: every player's dot on one lap. Without it a
              race with eight cars on separate parts of the circuit is
              invisible (spec §4). */}
          <div class="tilt__rail" aria-label={text({ en: 'Race positions', fr: 'Positions' })}>
            {Object.entries(state.field).map(([id, car]) => (
              <span
                key={id}
                class={`tilt__dot ${id === myId ? 'tilt__dot--me' : ''} ${car.left ? 'tilt__dot--left' : ''}`}
                style={{ top: `${Math.min(100, ((car.lap * track.length + car.s) / (state.laps * track.length)) * 100)}%` }}
              >
                {avatarOf(id)}
              </span>
            ))}
          </div>

          {/* Announced as text, so the race state never depends on reading a
              rotating map (spec §11). */}
          <p class="visually-hidden" aria-live="polite">
            {text({ en: `${hud.place} of ${total}, lap ${hud.lap + 1}`, fr: `${hud.place} sur ${total}, tour ${hud.lap + 1}` })}
          </p>

          {countdown > 0 && (
            <p class="tilt__countdown" aria-live="assertive">{countdown}</p>
          )}

          {/*
            Reverse. It sits where gravity says down is and slides around the
            screen's edge as the phone turns — every frame, off the same
            sensor reading that steers the car, so it keeps up with the wrist
            rather than trailing it. It FREEZES while held: a button that slid
            out from under the thumb already on it would be unusable (spec §2).

            The `style` here is only the opening position; `onFrame` writes the
            two properties directly from then on.
          */}
          <button
            type="button"
            class="tilt__reverse"
            ref={reverseEl}
            style={{ left: `${spotRef.current.x * 100}%`, top: `${spotRef.current.y * 100}%` }}
            aria-label={text({ en: 'Reverse', fr: 'Marche arrière' })}
            onPointerDown={(e) => {
              e.preventDefault();
              frozenSpot.current = spotRef.current;
              frozenSpin.current = spinRef.current;
              reverseRef.current = true;
            }}
            onPointerUp={() => {
              reverseRef.current = false;
              frozenSpot.current = null;
              frozenSpin.current = null;
            }}
            onPointerLeave={() => {
              reverseRef.current = false;
              frozenSpot.current = null;
              frozenSpin.current = null;
            }}
            onPointerCancel={() => {
              reverseRef.current = false;
              frozenSpot.current = null;
              frozenSpin.current = null;
            }}
          >
            {/* A straight arrow down, not a curved return one: the car backs
                straight out the way it came, and the curve read as "turn
                round". */}
            <span aria-hidden="true">↓</span>
          </button>
        </div>
      </div>
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
      canStart={room.isHost && enoughToStart(room.connected, [TILT_MIN_PLAYERS, TILT_MAX_PLAYERS], solo)}
      startLabel={t.common.startRound}
      onStart={start}
      readyBlocked={readyBlocked}
      onBeforeReady={ensureTilt}
      extras={<TiltPrimer support={support} on={tiltOn} asked={tiltAsked} onEnable={() => void enableTilt()} />}
    />
  );
}

/**
 * The tilt primer. Tilt-only, no fallback (spec §5), so this says who the game
 * excludes before anyone starts — which AGENTS.md §4 requires of every game
 * that takes that branch — and offers Try again after a refusal, the one
 * re-ask device-capabilities.md §2 allows.
 */
function TiltPrimer({
  support,
  on,
  asked,
  onEnable,
}: {
  support: OrientationSupport;
  on: boolean;
  asked: boolean;
  onEnable: () => void;
}): JSX.Element {
  const text = useGameText();
  const heading = text({ en: 'Your phone is the steering wheel', fr: 'Votre téléphone est le volant' });

  if (support === 'unsupported') {
    return <PermissionPrimer heading={heading} body={text({
      en: 'This phone has no tilt sensor, and turning the phone is the only control this game has — Tilt Race cannot run here.',
      fr: 'Ce téléphone n’a pas de capteur d’inclinaison, et tourner le téléphone est la seule commande du jeu — Tilt Race ne peut pas fonctionner ici.',
    })} />;
  }

  if (asked && !on) {
    return (
      <PermissionPrimer
        heading={heading}
        body={text({
          en: 'Tilt was turned down. There is no on-screen wheel and no tap version — the car cannot be pointed anywhere without it.',
          fr: 'L’inclinaison a été refusée. Il n’y a ni volant à l’écran ni version tactile — sans elle, la voiture ne peut être dirigée nulle part.',
        })}
        action={{ label: text({ en: 'Try again', fr: 'Réessayer' }), onClick: onEnable }}
      />
    );
  }

  if (on) {
    return <PermissionPrimer heading={heading} enabled body={text({
      en: 'Ready. Turn the phone and the car turns with it, degree for degree — right round if you like. The map stays put.',
      fr: 'Prêt. Tournez le téléphone et la voiture tourne avec lui, degré pour degré — un tour complet si vous voulez. La carte, elle, ne bouge pas.',
    })} />;
  }

  return <PermissionPrimer heading={heading} body={text({
    en: 'This one needs the tilt sensor, and nothing else can play it. The phone is the steering wheel — turn it and the car turns with it.',
    fr: 'Ce jeu a besoin du capteur d’inclinaison, et rien d’autre ne permet d’y jouer. Le téléphone est le volant — tournez-le et la voiture tourne avec lui.',
  })} />;
}
