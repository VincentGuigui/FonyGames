import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  CROWD_COURSE_LENGTH,
  CROWD_FINISH_Y,
  CROWD_MAX_PLAYERS,
  CROWD_MIN_PLAYERS,
  CROWD_REPORT_MS,
  CROWD_START_Y,
  type CrowdRaceState,
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
import { CrowdCanvas } from './CrowdCanvas';
import { startRun, step, type CrowdRun } from './game';
import './crowd-race.css';

/** How far up the fixed course a walker has come, 0..1 — `y` is absolute
 *  (world `0` is the screen's own bottom edge, not the start line), so the
 *  start margin has to come back out before dividing by the course length. */
function progressOf(y: number): number {
  return Math.max(0, Math.min(1, (y - CROWD_START_Y) / CROWD_COURSE_LENGTH));
}

/**
 * Crowd Race's room screen. Spec: docs/specs/games/crowd-race.md §4
 *
 * The simulation lives in `game.ts` and the drawing in `CrowdCanvas.tsx`;
 * this holds them together and owns the two things that talk to the outside
 * world — the tilt sensor, and the four-times-a-second position report
 * (spec §6). Tilt Race's own split, for the same reason: the run changes 60
 * times a second and Preact must never re-render for it, so it lives in a
 * ref and the canvas reads it fresh each frame.
 */
export function CrowdRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <CrowdRoomInner game={card} code={code} />}</RoomGate>;
}

function CrowdRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [state, setState] = useState<CrowdRaceState | null>(null);
  const [support] = useState<OrientationSupport>(() => orientationSupport());
  const [tiltOn, setTiltOn] = useState(false);
  const [tiltAsked, setTiltAsked] = useState(false);

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'crowd') setState(msg.d);
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

  /** What Ready and Start hang the tilt on — there is no touch fallback
   *  (spec §5), Asteroid Race and Tilt Race's own shape. */
  const ensureTilt = useCallback(async (): Promise<boolean> => {
    if (tiltOn) return true;
    if (support === 'unsupported') return false;
    return enableTilt();
  }, [tiltOn, support, enableTilt]);

  // The walk. A ref, for the reason in this component's own doc comment.
  const runRef = useRef<CrowdRun | null>(null);
  const orientRef = useRef<{ gamma: number | null; beta: number | null }>({ gamma: null, beta: null });
  const lastReportRef = useRef(0);
  const finishedRef = useRef(false);

  const [hud, setHud] = useState({ y: 0, place: 1 });

  const phase = state?.phase;
  const roundId = state?.roundId;

  // A fresh walk per round.
  useEffect(() => {
    if (roundId === undefined || phase === undefined || phase === 'done') return;
    runRef.current = startRun(roundId);
    finishedRef.current = false;
    lastReportRef.current = 0;

    const onOrient = (e: DeviceOrientationEvent): void => {
      orientRef.current = { gamma: e.gamma, beta: e.beta };
    };
    window.addEventListener('deviceorientation', onOrient);
    return () => window.removeEventListener('deviceorientation', onOrient);
  }, [roundId, phase]);

  /**
   * One frame: step the walk, then report if it is time.
   *
   * Reporting on a wall clock rather than a frame count, because the frame
   * rate is whatever the phone manages and `CROWD_REPORT_MS` is a promise
   * about the wire, not about rendering.
   */
  const onFrame = useCallback(
    (dtMs: number) => {
      const s = state;
      const run = runRef.current;
      if (!s || !run) return;
      const now = clientRef.current?.now() ?? Date.now();
      if (s.phase !== 'running') return;

      const next = step(run, orientRef.current, dtMs);
      runRef.current = next;

      if (now - lastReportRef.current >= CROWD_REPORT_MS) {
        lastReportRef.current = now;
        clientRef.current?.send({ t: 'crowd-move', d: { roundId: s.roundId, x: next.x, y: next.y, at: now } });

        let ahead = 0;
        for (const [id, walker] of Object.entries(s.walkers)) {
          if (id === myId) continue;
          if (walker.y > next.y) ahead++;
        }
        setHud({ y: next.y, place: ahead + 1 });
      }

      if (!finishedRef.current && next.y >= CROWD_FINISH_Y) {
        finishedRef.current = true;
      }
    },
    [state?.roundId, state?.phase, myId],
  );

  const players = room.room?.players ?? [];
  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  const avatarOf = (id: string): string => players.find((p) => p.id === id)?.avatar ?? '🙂';

  const rivals = useCallback(() => {
    const s = state;
    if (!s || myId === undefined) return [];
    return Object.entries(s.walkers)
      .filter(([id]) => id !== myId)
      .map(([id, w]) => ({ x: w.x, y: w.y, avatar: avatarOf(id) }));
  }, [state?.walkers, myId, players]);

  const start = useCallback(() => {
    clientRef.current?.send({ t: 'start', d: { mode: 'crowd', solo } });
  }, [solo]);

  const readyBlocked = support === 'unsupported' || (tiltAsked && !tiltOn);

  if (state && state.phase === 'done') {
    // Finishers first, by finish time; then everyone else by distance —
    // there is no separate placings list on the wire (spec §6), only the
    // walkers themselves, so the order is derived here.
    const rows = Object.keys(state.walkers).sort((a, b) => {
      const wa = state.walkers[a];
      const wb = state.walkers[b];
      const fa = wa?.finishedAt;
      const fb = wb?.finishedAt;
      if (fa !== null && fb !== null) return (fa ?? 0) - (fb ?? 0);
      if (fa !== null) return -1;
      if (fb !== null) return 1;
      return (wb?.y ?? 0) - (wa?.y ?? 0);
    });
    const tableRows = rows.map((id) => {
      const walker = state.walkers[id];
      const done = (walker?.finishedAt ?? null) !== null;
      const far = progressOf(walker?.y ?? 0);
      return {
        id,
        avatar: avatarOf(id),
        name: nameOf(id),
        value: done ? text({ en: 'home', fr: 'arrivé' }) : `${Math.round(far * 100)}%`,
        out: false,
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
        note={text({ en: 'Placings are by distance up the street for anyone who did not finish.', fr: 'Les places se jouent à la distance parcourue pour ceux qui n’ont pas fini.' })}
        rows={tableRows}
        me={myId}
        winner={state.winner}
        onAgain={start}
        canAct={room.isHost && enoughToStart(room.connected, [CROWD_MIN_PLAYERS, CROWD_MAX_PLAYERS], solo)}
      />
    );
  }

  if (state) {
    const now = clientRef.current?.now() ?? Date.now();
    const countdown = Math.max(0, Math.ceil((state.startsAt - now) / 1000));
    const total = Object.keys(state.walkers).length;
    const progressPct = Math.round(progressOf(hud.y) * 100);

    return (
      <div class="crowd" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          status={text({ en: `${hud.place}/${total} · ${progressPct}%`, fr: `${hud.place}/${total} · ${progressPct} %` })}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
        />

        <div class="crowd__board">
          <CrowdCanvas
            run={() => runRef.current ?? startRun(state.roundId)}
            myAvatar={myId !== undefined ? avatarOf(myId) : '🙂'}
            rivals={rivals}
            onFrame={onFrame}
          />

          {/* The progress rail: every player's dot up the street — without it
              a race spread out over several screen-heights is invisible
              (spec §4). */}
          <div class="crowd__rail" aria-label={text({ en: 'Race positions', fr: 'Positions' })}>
            {Object.entries(state.walkers).map(([id, w]) => (
              <span
                key={id}
                class={`crowd__dot ${id === myId ? 'crowd__dot--me' : ''} ${w.away ? 'crowd__dot--away' : ''}`}
                style={{ bottom: `${progressOf(w.y) * 100}%` }}
              >
                {avatarOf(id)}
              </span>
            ))}
          </div>

          <p class="visually-hidden" aria-live="polite">
            {text({ en: `${hud.place} of ${total}, ${progressPct}% up the street`, fr: `${hud.place} sur ${total}, ${progressPct} % de la rue parcourue` })}
          </p>

          {countdown > 0 && <p class="crowd__countdown" aria-live="assertive">{countdown}</p>}
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
      canStart={room.isHost && enoughToStart(room.connected, [CROWD_MIN_PLAYERS, CROWD_MAX_PLAYERS], solo)}
      startLabel={t.common.startRound}
      onStart={start}
      readyBlocked={readyBlocked}
      onBeforeReady={ensureTilt}
      extras={<CrowdPrimer support={support} on={tiltOn} asked={tiltAsked} onEnable={() => void enableTilt()} />}
    />
  );
}

/**
 * The tilt primer. Tilt-only, no fallback (spec §5), so this says who the
 * game excludes before anyone starts — AGENTS.md §4 requires it of every
 * game that takes that branch — and offers Try again after a refusal.
 */
function CrowdPrimer({
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
  const heading = text({ en: 'Gravity says which way is up', fr: 'La gravité indique le chemin' });

  if (support === 'unsupported') {
    return <PermissionPrimer heading={heading} body={text({
      en: 'This phone has no tilt sensor, and tilting it is the only way to steer — Crowd Race cannot run here.',
      fr: 'Ce téléphone n’a pas de capteur d’inclinaison, et l’incliner est la seule façon de se diriger — Crowd Race ne peut pas fonctionner ici.',
    })} />;
  }

  if (asked && !on) {
    return (
      <PermissionPrimer
        heading={heading}
        body={text({
          en: 'Tilt was turned down. There is no on-screen stick and no tap version — nothing else can move the pedestrian.',
          fr: 'L’inclinaison a été refusée. Il n’y a ni joystick à l’écran ni version tactile — rien d’autre ne peut faire avancer le piéton.',
        })}
        action={{ label: text({ en: 'Try again', fr: 'Réessayer' }), onClick: onEnable }}
      />
    );
  }

  if (on) {
    return <PermissionPrimer heading={heading} enabled body={text({
      en: 'Ready. You walk wherever gravity says is up — hold the phone upside down and you will walk backward.',
      fr: 'Prêt. Vous marchez dans la direction que la gravité indique comme « le haut » — tenez le téléphone à l’envers et vous reculerez.',
    })} />;
  }

  return <PermissionPrimer heading={heading} body={text({
    en: 'This one needs the tilt sensor, and nothing else can play it. You walk wherever gravity says is up, all the time — turn the phone upside down and you walk backward.',
    fr: 'Ce jeu a besoin du capteur d’inclinaison, et rien d’autre ne permet d’y jouer. Vous marchez en permanence là où la gravité indique le haut — tenez le téléphone à l’envers pour reculer.',
  })} />;
}
