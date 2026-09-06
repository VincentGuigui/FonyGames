import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  COLOR_HUNT_ACTION_MS,
  COLOR_HUNT_MAX_PLAYERS,
  COLOR_HUNT_MIN_PLAYERS,
  COLOR_HUNT_SAMPLE_HZ,
  type ColorHuntState,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import type { Rgb } from '../../../../shared/color';
import { useGameRoom } from '../../core/room/useRoom';
import { useSoloTesting } from '../../core/useSolo';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { StatusBar } from '../../core/ui/StatusBar';
import { Scoreboard } from '../../core/ui/Scoreboard';
import { GameOverScreen } from '../../core/ui/GameOver';
import { PermissionPrimer } from '../../core/ui/PermissionPrimer';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import { startCamera, type Camera } from './camera';
import { magnifier, type Magnifier } from './sample';
import './color-hunt.css';

/**
 * Color Hunt's room screen. Spec: docs/specs/games/color-hunt.md §4
 *
 * The feed is shown, the middle of it is sampled ten times a second, and one
 * message per round carries the average. Nothing else. There is no
 * end-of-round screen by design (spec §2) — the next target replaces the last
 * one the instant the referee scores it — so the live ladder is the only place
 * a score is ever seen.
 */
export function ColorHuntRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <ColorHuntRoomInner game={card} code={code} />}</RoomGate>;
}

function css(rgb: Rgb): string {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

/** The six, in both languages — a word reads across a room faster than a
 *  swatch (spec §4), and it is the one concession §11 can make to a player who
 *  knows a red thing when they see one. */
const NAMES: Record<string, { en: string; fr: string }> = {
  red: { en: 'RED', fr: 'ROUGE' },
  yellow: { en: 'YELLOW', fr: 'JAUNE' },
  green: { en: 'GREEN', fr: 'VERT' },
  cyan: { en: 'CYAN', fr: 'CYAN' },
  blue: { en: 'BLUE', fr: 'BLEU' },
  magenta: { en: 'MAGENTA', fr: 'MAGENTA' },
};

function ColorHuntRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [state, setState] = useState<ColorHuntState | null>(null);

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'color-hunt') setState(msg.d);
  }, []);

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;
  const clientRef = useRef(client);
  clientRef.current = client;

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraAsked, setCameraAsked] = useState(false);
  const cameraRef = useRef<Camera | null>(null);
  const magRef = useRef<Magnifier | null>(null);
  const videoElRef = useRef<HTMLVideoElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  /** The last reading, for the round's own submission. A ref rather than
   *  state: it changes ten times a second and nothing re-renders for it. */
  const readingRef = useRef<Rgb | null>(null);

  const running = state?.phase === 'hunt';

  const enableCamera = useCallback(async (): Promise<boolean> => {
    setCameraAsked(true);
    const cam = await startCamera();
    cameraRef.current = cam;
    magRef.current = cam ? magnifier(cam.video) : null;
    setCameraOn(!!cam);
    return !!cam;
  }, []);

  /**
   * What Ready and Start hang the camera on. A refusal really does swallow the
   * tap: there is no touch version of "point at something red" (spec §5), and
   * a seat that cannot see is not a way to be in the round.
   */
  const ensureCamera = useCallback(async (): Promise<boolean> => {
    if (cameraOn) return true;
    return enableCamera();
  }, [cameraOn, enableCamera]);

  /* The feed's element only exists once the round screen mounts, and the
     camera is granted from the LOBBY — so this depends on `running` as well as
     on `cameraOn`, exactly as UFO Hunt's own does and for the same bug. */
  useEffect(() => {
    const el = videoElRef.current;
    const cam = cameraRef.current;
    if (el && cam && el.srcObject !== cam.video.srcObject) el.srcObject = cam.video.srcObject;
  }, [cameraOn, running]);

  /* Released when the hunt ends, when the tab is hidden, and on unmount.
     Stopped, not paused (spec §10). */
  useEffect(() => {
    const release = (): void => {
      cameraRef.current?.stop();
      cameraRef.current = null;
      magRef.current = null;
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
    if (state?.phase === 'done') {
      cameraRef.current?.stop();
      cameraRef.current = null;
      magRef.current = null;
      setCameraOn(false);
    }
  }, [state?.phase]);

  /*
   * The magnifier. Ten reads a second rather than sixty (spec §5): a ring that
   * updates at frame rate is a strobe, and this is slow enough to aim by while
   * still following the phone. The ring's colour is written straight into the
   * DOM — Preact never re-renders for it.
   */
  useEffect(() => {
    if (!running || !cameraOn) return;
    const id = window.setInterval(() => {
      const rgb = magRef.current?.read();
      if (!rgb) return;
      readingRef.current = rgb;
      if (ringRef.current) ringRef.current.style.background = css(rgb);
    }, Math.round(1000 / COLOR_HUNT_SAMPLE_HZ));
    return () => window.clearInterval(id);
  }, [running, cameraOn]);

  /*
   * One submission per round, sent just before the window shuts rather than
   * continuously: unlike Color Match there is no wheel to nudge, so a stream
   * of identical readings would be pure traffic. The referee's own grace
   * covers the flight time (spec §6).
   */
  useEffect(() => {
    const s = state;
    if (!s || s.phase !== 'hunt') return;
    const send = (): void => {
      const rgb = readingRef.current;
      const c = clientRef.current;
      if (!rgb || !c) return;
      c.send({ t: 'hunt-find', d: { roundId: s.roundId, round: s.round, rgb: [rgb[0], rgb[1], rgb[2]], at: c.now() } });
    };
    const now = clientRef.current?.now() ?? Date.now();
    // A little before the deadline, so an honest reading is not lost to its own
    // flight time; and again right on it, in case the last second mattered.
    const early = window.setTimeout(send, Math.max(0, s.dueAt - now - 600));
    const last = window.setTimeout(send, Math.max(0, s.dueAt - now - 60));
    return () => {
      window.clearTimeout(early);
      window.clearTimeout(last);
    };
  }, [state?.roundId, state?.round, state?.phase, state?.dueAt]);

  // The pie, straight into the DOM.
  const pieRef = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const s = state;
    if (!s || s.phase !== 'hunt') return;
    let frame = 0;
    const loop = (): void => {
      const el = pieRef.current;
      if (el) {
        const now = clientRef.current?.now() ?? Date.now();
        const left = Math.max(0, Math.min(1, (s.dueAt - now) / COLOR_HUNT_ACTION_MS));
        el.style.strokeDasharray = `${(PIE_C * left).toFixed(2)} ${PIE_C.toFixed(2)}`;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [state?.roundId, state?.round, state?.phase, state?.dueAt]);

  const players = room.room?.players ?? [];
  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  const avatarOf = (id: string): string => players.find((p) => p.id === id)?.avatar ?? '🙂';
  const enough = enoughToStart(room.connected, [COLOR_HUNT_MIN_PLAYERS, COLOR_HUNT_MAX_PLAYERS], solo);
  /* Blocked by a REFUSAL, not by silence: before anyone has been asked, Ready
     and Start are the thing that asks (issue #29). */
  const readyBlocked = cameraAsked && !cameraOn;

  if (state && state.phase === 'done') {
    const ranked = Object.entries(state.totals).sort(([, a], [, b]) => b - a);
    return (
      <GameOverScreen
        room={room}
        readyBlocked={readyBlocked}
        onReadySetup={() => void enableCamera()}
        onBeforeReady={ensureCamera}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        note={text({
          en: `The room ran out of colours after ${state.round} rounds.`,
          fr: `La pièce a été épuisée après ${state.round} manches.`,
        })}
        rows={ranked.map(([id, total]) => ({ id, avatar: avatarOf(id), name: nameOf(id), value: total, unit: text({ en: 'pts', fr: 'pts' }) }))}
        me={myId}
        winner={state.winner}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'color-hunt', solo } })}
        canAct={room.isHost && enough}
      />
    );
  }

  if (state && running) {
    const target = state.target as Rgb;
    const word = NAMES[state.name] ?? { en: state.name.toUpperCase(), fr: state.name.toUpperCase() };
    const mine = myId ? state.finds[myId] : undefined;
    const ladder = Object.entries(state.totals).map(([id, total]) => ({ id, avatar: avatarOf(id), name: nameOf(id), value: total }));

    return (
      <div class="chunt" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          status={mine ? text({ en: `Last round: ${mine.score}`, fr: `Manche précédente : ${mine.score}` }) : text({ en: 'Hunting', fr: 'À la chasse' })}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
        />

        <div class="chunt__target" style={{ background: css(target) }}>
          <span class="chunt__word">{text(word)}</span>
          <svg class="chunt__pie" viewBox="-12 -12 24 24" aria-hidden="true">
            <circle r="10" fill="rgba(4, 33, 29, 0.55)" />
            <circle ref={pieRef} class="chunt__pie-arc" r="5" fill="none" stroke="#F8FAFC" stroke-width="10" stroke-dasharray="31.4" />
          </svg>
        </div>

        <div class="chunt__viewport">
          <video ref={videoElRef} class="chunt__feed" playsInline muted autoPlay />
          <div ref={ringRef} class="chunt__ring" aria-label={text({ en: 'What you are pointing at', fr: 'Ce que vous visez' })} />
          {!cameraOn && (
            <p class="chunt__nofeed">{text({ en: 'No camera — nothing to hunt with.', fr: 'Pas de caméra — rien pour chasser.' })}</p>
          )}
        </div>

        <Scoreboard rows={ladder} me={myId} unit={text({ en: 'pts', fr: 'pts' })} best="high" />
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
      canStart={room.isHost && enough}
      startLabel={state ? t.common.playAgain : t.common.startRound}
      onStart={() => client?.send({ t: 'start', d: { mode: 'color-hunt', solo } })}
      readyBlocked={readyBlocked}
      onBeforeReady={ensureCamera}
      extras={<CameraPrimer on={cameraOn} asked={cameraAsked} isHost={room.isHost} onEnable={() => void enableCamera()} />}
    />
  );
}

const PIE_C = 2 * Math.PI * 5;

/**
 * The camera explanation, the safety copy, and the honest version of a refusal.
 *
 * No button before the first ask — Ready and Start do that (issue #29, and
 * device-capabilities.md §2 rule 3) — and Try again after a refusal, which is
 * the one re-ask that rule allows.
 */
function CameraPrimer({ on, asked, isHost, onEnable }: { on: boolean; asked: boolean; isHost: boolean; onEnable: () => void }): JSX.Element {
  const text = useGameText();
  const heading = text({ en: 'Point, don’t tap', fr: 'Visez, ne touchez pas' });

  const safety = text({
    en: 'You will be walking around looking at your screen. Look up. Don’t hunt colours in traffic, on stairs, or out of a window you could fall out of.',
    fr: 'Vous allez marcher en regardant votre écran. Levez les yeux. Ne chassez pas les couleurs dans la circulation, dans un escalier, ni par une fenêtre.',
  });

  if (asked && !on) {
    return (
      <>
        <PermissionPrimer
          heading={heading}
          body={text({
            en: 'The camera was turned down, and it is the only way to play this one — there is no tap version, so there is nothing to find a colour with.',
            fr: 'La caméra a été refusée, et c’est la seule façon de jouer — il n’y a pas de version tactile, donc rien pour trouver une couleur.',
          })}
          action={{ label: text({ en: 'Try again', fr: 'Réessayer' }), onClick: onEnable }}
        />
        <p class="chunt__safety">{safety}</p>
      </>
    );
  }

  if (on) {
    return (
      <>
        <PermissionPrimer
          heading={heading}
          enabled
          body={text({
            en: 'Ready. The ring in the middle shows the colour you are actually pointing at — that is what gets scored, not what you meant.',
            fr: 'Prêt. L’anneau central montre la couleur que vous visez réellement — c’est elle qui compte, pas celle que vous visiez.',
          })}
        />
        <p class="chunt__safety">{safety}</p>
      </>
    );
  }

  return (
    <>
      <PermissionPrimer
        heading={heading}
        body={`${text({
          en: 'The camera finds the colours. We look at 100 pixels from the middle of the picture, average them on your phone, and send one colour — no image ever leaves the device.',
          fr: 'La caméra trouve les couleurs. Nous regardons 100 pixels au centre de l’image, nous en faisons la moyenne sur votre téléphone et n’envoyons qu’une couleur — aucune image ne quitte l’appareil.',
        })} ${isHost
          ? text({ en: 'Start the round and your phone will ask.', fr: 'Démarrez la manche et votre téléphone vous le demandera.' })
          : text({ en: 'Tap Ready and your phone will ask.', fr: 'Touchez Prêt et votre téléphone vous le demandera.' })}`}
      />
      <p class="chunt__safety">{safety}</p>
      <p class="chunt__warning">
        {text({
          en: 'This one is pure colour matching, on foot — if you are colour-blind or cannot move around the room, Color Match is the same scoring without either.',
          fr: 'Tout repose ici sur la couleur, et sur vos jambes — si vous êtes daltonien ou ne pouvez pas vous déplacer, Color Match offre le même barème sans l’un ni l’autre.',
        })}
      </p>
    </>
  );
}
