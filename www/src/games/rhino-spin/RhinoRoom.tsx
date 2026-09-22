import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  RHINO_MAX_PLAYERS,
  RHINO_MIN_PLAYERS,
  RHINO_REPORT_MS,
  RHINO_SCENE_MS,
  RHINO_SETTLE_RATE,
  type RhinoSpinState,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
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
import { feed, gravityAngle, newEyes, newSpinner, spinEyes, spins, type Eyes, type Spinner } from './spin';
import rhinoArt from './art/rhino.svg?url&no-inline';
import rhinoSick from './art/rhino-sick.svg?url&no-inline';
import rhinoX from './art/rhino-x.svg?url&no-inline';
import './rhino-spin.css';

/**
 * Rhino Spin's room screen. Spec: docs/specs/games/rhino-spin.md §4
 *
 * The counting and the pupils live in `spin.ts`; this holds them together and
 * owns the two things that reach outside — the motion sensor, and the spin
 * report (spec §6). Both the count and the pupils change faster than Preact
 * should re-render for, so the spinner and the eyes live in refs and the frame
 * loop writes the pupils straight onto their elements.
 *
 * The closing scene is driven here rather than by the referee: when the eyes
 * have wound down is a question about this phone's own animation, and a
 * referee cannot know the answer for eight of them at once (spec §2).
 */
export function RhinoRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <RhinoRoomInner game={card} code={code} />}</RoomGate>;
}

/** How the rhino's face is doing, once the throwing window has shut. */
type Scene = 'dizzy' | 'settled' | 'over';

function RhinoRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [state, setState] = useState<RhinoSpinState | null>(null);
  const [support] = useState<OrientationSupport>(() => orientationSupport());
  const [tiltOn, setTiltOn] = useState(false);
  const [tiltAsked, setTiltAsked] = useState(false);

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'rhino-spin') setState(msg.d);
  }, []);

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const clientRef = useRef(room.client);
  clientRef.current = room.client;
  const myId = room.me?.id;

  const enableTilt = useCallback(async (): Promise<boolean> => {
    setTiltAsked(true);
    const granted = await requestOrientation();
    setTiltOn(granted);
    return granted;
  }, []);

  /** What Ready and Start hang the motion permission on — there is no touch
   *  fallback, because the whole game is one physical act (spec §5). */
  const ensureTilt = useCallback(async (): Promise<boolean> => {
    if (tiltOn) return true;
    if (support === 'unsupported') return false;
    return enableTilt();
  }, [tiltOn, support, enableTilt]);

  const spinnerRef = useRef<Spinner>(newSpinner());
  const eyesRef = useRef<Eyes>(newEyes());
  const orientRef = useRef<{ gamma: number | null; beta: number | null }>({ gamma: null, beta: null });
  const leftPupil = useRef<HTMLSpanElement>(null);
  const rightPupil = useRef<HTMLSpanElement>(null);
  const lastReportRef = useRef(0);

  const [count, setCount] = useState(0);
  const [left, setLeft] = useState(0);
  const [scene, setScene] = useState<Scene>('dizzy');

  const roundId = state?.roundId;
  const phase = state?.phase;

  // A fresh spinner per round, and the sensor only attached while one is on.
  useEffect(() => {
    if (roundId === undefined || phase === undefined) return;
    if (phase === 'done') return;
    spinnerRef.current = newSpinner();
    eyesRef.current = newEyes();
    lastReportRef.current = 0;
    setCount(0);
    setScene('dizzy');

    const onOrient = (e: DeviceOrientationEvent): void => {
      orientRef.current = { gamma: e.gamma, beta: e.beta };
    };
    window.addEventListener('deviceorientation', onOrient);
    return () => window.removeEventListener('deviceorientation', onOrient);
  }, [roundId, phase]);

  /**
   * One frame: fold the sensor in, move the pupils, and report if it is time.
   *
   * Reporting on a wall clock rather than a frame count, because the frame rate
   * is whatever the phone manages while it is in the air — which is not much —
   * and `RHINO_REPORT_MS` is a promise about the wire.
   */
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!state) return;
    let frame = 0;
    let last = performance.now();

    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      const now = performance.now();
      const dtMs = Math.min(64, now - last);
      last = now;

      const s = stateRef.current;
      if (!s) return;
      const running = s.phase === 'spin' && (clientRef.current?.now() ?? Date.now()) >= s.startsAt;

      if (running) {
        const { gamma, beta } = orientRef.current;
        spinnerRef.current = feed(spinnerRef.current, gamma, beta);
        eyesRef.current = spinEyes(eyesRef.current, gravityAngle(gamma, beta), dtMs);
      } else {
        // The window is shut, or has not opened: nothing to chase, so the eyes
        // coast — which is exactly the dizziness the scene is waiting on.
        eyesRef.current = spinEyes(eyesRef.current, null, dtMs);
        if (s.phase === 'done' && sceneRef.current === 'dizzy' && Math.abs(eyesRef.current.rate) < RHINO_SETTLE_RATE) {
          setScene('settled');
        }
      }

      // The pupils sit on the rim of their eye white — 40% of the white's own
      // radius out, which is 2% of the square face either way.
      const a = eyesRef.current.angle;
      const dx = `${(Math.cos(a) * 2).toFixed(2)}%`;
      const dy = `${(Math.sin(a) * 2).toFixed(2)}%`;
      if (leftPupil.current) leftPupil.current.style.translate = `${dx} ${dy}`;
      if (rightPupil.current) rightPupil.current.style.translate = `${dx} ${dy}`;

      if (!running) return;
      const wall = clientRef.current?.now() ?? Date.now();
      setLeft(Math.max(0, Math.ceil((s.endsAt - wall) / 1000)));
      const mine = spins(spinnerRef.current);
      if (mine !== count) setCount(mine);
      if (wall - lastReportRef.current >= RHINO_REPORT_MS) {
        lastReportRef.current = wall;
        clientRef.current?.send({ t: 'rhino-spins', d: { roundId: s.roundId, spins: mine, at: wall } });
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `state` itself is read through a ref; this only needs to restart when a
    // round appears or disappears.
  }, [state === null, count]);

  // The sick scene holds for a beat, then the scoreboard (spec §2 step 5).
  useEffect(() => {
    if (scene !== 'settled') return;
    const id = setTimeout(() => setScene('over'), RHINO_SCENE_MS);
    return () => clearTimeout(id);
  }, [scene]);

  const players = room.room?.players ?? [];
  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  const avatarOf = (id: string): string => players.find((p) => p.id === id)?.avatar ?? '🙂';

  const start = useCallback(() => {
    clientRef.current?.send({ t: 'start', d: { mode: 'rhino', solo } });
  }, [solo]);

  const readyBlocked = support === 'unsupported' || (tiltAsked && !tiltOn);
  const canStart = room.isHost && enoughToStart(room.connected, [RHINO_MIN_PLAYERS, RHINO_MAX_PLAYERS], solo);

  if (state && state.phase === 'done' && scene === 'over') {
    const rows = Object.entries(state.spins)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => ({
        id,
        avatar: avatarOf(id),
        name: nameOf(id),
        value: text({ en: `${n} spins`, fr: `${n} tours` }),
        out: false,
      }));
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
        note={text({
          en: 'A spin is a full turn of the phone, either way round.',
          fr: 'Un tour, c’est une rotation complète du téléphone, dans un sens ou dans l’autre.',
        })}
        rows={rows}
        me={myId}
        winner={state.winner}
        onAgain={start}
        canAct={canStart}
      />
    );
  }

  if (state) {
    const now = clientRef.current?.now() ?? Date.now();
    const countdown = Math.max(0, Math.ceil((state.startsAt - now) / 1000));
    const done = state.phase === 'done';
    // Solo records no winner (spec §7), but the one person who spun is still
    // the one who got dizzy — crosses would be reading the null too literally.
    const iWon = done && (state.winner === myId || (state.solo && (state.spins[myId ?? ''] ?? 0) > 0));
    const face = !done || scene === 'dizzy' ? rhinoArt : iWon ? rhinoSick : rhinoX;
    const showPupils = !done || scene === 'dizzy';

    return (
      <div class="rhino" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          status={done ? text({ en: 'Dizzy', fr: 'Le tournis' }) : text({ en: `${count} spins`, fr: `${count} tours` })}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
        />

        <div class="rhino__board">
          <p class="rhino__count" aria-hidden="true">{count}</p>

          <div class="rhino__face">
            <img src={face} alt="" />
            {showPupils && (
              <>
                <span ref={leftPupil} class="rhino__pupil rhino__pupil--left" />
                <span ref={rightPupil} class="rhino__pupil rhino__pupil--right" />
              </>
            )}
          </div>

          {!done && <p class="rhino__clock">{text({ en: `${left} s left`, fr: `${left} s restantes` })}</p>}
          {done && scene === 'dizzy' && (
            <p class="rhino__scene">{text({ en: 'Still spinning…', fr: 'Ça tourne encore…' })}</p>
          )}
          {done && scene !== 'dizzy' && (
            <p class="rhino__scene">
              {iWon
                ? text({ en: 'You spun the most. You look awful.', fr: 'Vous avez le plus tourné. Vous avez une sale tête.' })
                : text({ en: 'Out cold.', fr: 'K.-O.' })}
            </p>
          )}

          <p class="visually-hidden" aria-live="polite">
            {text({ en: `${count} spins`, fr: `${count} tours` })}
          </p>

          {countdown > 0 && <p class="rhino__countdown" aria-live="assertive">{countdown}</p>}
        </div>

        <div class="rhino__ladder">
          {Object.entries(state.spins).map(([id, n]) => (
            <span key={id}>{avatarOf(id)} <b>{n}</b></span>
          ))}
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
      canStart={canStart}
      startLabel={t.common.startRound}
      onStart={start}
      readyBlocked={readyBlocked}
      onBeforeReady={ensureTilt}
      extras={
        <>
          <RhinoSafety />
          <RhinoPrimer support={support} on={tiltOn} asked={tiltAsked} onEnable={() => void enableTilt()} />
        </>
      }
    />
  );
}

/**
 * The throwing warning. This is the one game in the repo that asks for a phone
 * to leave a hand, and AGENTS.md §7 allows it on the condition that the warning
 * is here, in the lobby, before anyone joins (spec §9).
 */
function RhinoSafety(): JSX.Element {
  const text = useGameText();
  return (
    <PermissionPrimer
      heading={text({ en: 'You are going to throw your phone', fr: 'Vous allez lancer votre téléphone' })}
      body={text({
        en: 'This one can break a phone. Throw low, indoors, over a bed or a sofa, away from other people — and mind the ceiling and the lights. A dropped phone is on you.',
        fr: 'Ce jeu peut casser un téléphone. Lancez bas, à l’intérieur, au-dessus d’un lit ou d’un canapé, loin des autres — et attention au plafond et aux lampes. Un téléphone tombé, c’est pour votre pomme.',
      })}
    />
  );
}

/**
 * The motion primer. Motion-only, no fallback (spec §5), so this says who the
 * game excludes before anyone starts — AGENTS.md §4 requires it of every game
 * that takes that branch — and offers Try again after a refusal.
 */
function RhinoPrimer({
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
  const heading = text({ en: 'The phone counts its own turns', fr: 'Le téléphone compte ses propres tours' });

  if (support === 'unsupported') {
    return <PermissionPrimer heading={heading} body={text({
      en: 'This phone has no motion sensor, and there is nothing else to count a spin with — Rhino Spin cannot run here.',
      fr: 'Ce téléphone n’a pas de capteur de mouvement, et rien d’autre ne peut compter un tour — Rhino Spin ne peut pas fonctionner ici.',
    })} />;
  }

  if (asked && !on) {
    return (
      <PermissionPrimer
        heading={heading}
        body={text({
          en: 'Motion was turned down. There is no tap version — throwing the phone is the whole game.',
          fr: 'Le mouvement a été refusé. Il n’y a pas de version tactile — lancer le téléphone, c’est tout le jeu.',
        })}
        action={{ label: text({ en: 'Try again', fr: 'Réessayer' }), onClick: onEnable }}
      />
    );
  }

  if (on) {
    return <PermissionPrimer heading={heading} enabled body={text({
      en: 'Ready. Nothing leaves the phone but the number of spins.',
      fr: 'Prêt. Rien ne quitte le téléphone à part le nombre de tours.',
    })} />;
  }

  return <PermissionPrimer heading={heading} body={text({
    en: 'This one needs the motion sensor, and nothing else can play it. The phone watches which way is down and counts a point every full turn.',
    fr: 'Ce jeu a besoin du capteur de mouvement, et rien d’autre ne permet d’y jouer. Le téléphone observe où est le bas et compte un point à chaque tour complet.',
  })} />;
}
