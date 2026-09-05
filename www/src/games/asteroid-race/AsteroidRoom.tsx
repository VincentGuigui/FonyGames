import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  ASTEROID_MAX_PLAYERS,
  ASTEROID_MIN_PLAYERS,
  ASTEROID_TRACK_LENGTH,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { StatusBar } from '../../core/ui/StatusBar';
import { Scoreboard } from '../../core/ui/Scoreboard';
import { GameOverScreen } from '../../core/ui/GameOver';
import { PermissionPrimer } from '../../core/ui/PermissionPrimer';
import { orientationSupport, requestOrientation, type OrientationSupport } from '../../core/sensors/orientation';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import { useSoloTesting } from '../../core/useSolo';
import { ASTEROID_EXPLOSION_GIF_MS, ASTEROID_FINALE_HOLD_MS, ASTEROID_IMPACT_GIF_MS } from './game';
import { AsteroidCanvas, type Report } from './AsteroidCanvas';
import impactGif from './art/impact_missile.gif?url&no-inline';
import explosionGif from './art/explosion.gif?url&no-inline';
import './asteroid-race.css';

/**
 * Asteroid Race's room screen. Spec: docs/specs/games/asteroid-race.md §4
 *
 * The room owns everything the referee has an opinion about — the ladder, the
 * phase, the results — and nothing about the flight, which lives entirely in
 * `AsteroidCanvas` because it lives entirely on this phone (spec §2.2).
 *
 * The impact GIF is a DOM overlay rather than something the canvas draws, the
 * same split Gravity Shooter's own bursts use: a GIF is a file the browser
 * already knows how to play.
 */
export function AsteroidRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <AsteroidRoomInner game={card} code={code} />}</RoomGate>;
}

type Burst = { id: number; kind: 'missile' | 'explosion'; x: number; y: number };

/** Each burst stays up for exactly as long as its own GIF runs — the real
 *  durations, measured off the files (`game.ts`), not padded guesses. */
const BURST_MS: Record<Burst['kind'], number> = { missile: ASTEROID_IMPACT_GIF_MS, explosion: ASTEROID_EXPLOSION_GIF_MS };
const BURST_ART: Record<Burst['kind'], string> = { missile: impactGif, explosion: explosionGif };

function AsteroidRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [, redraw] = useState(0);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const burstId = useRef(0);
  const stateRef = useRef<Extract<ServerMessage, { t: 'asteroid' }>['d'] | null>(null);

  const [support] = useState<OrientationSupport>(orientationSupport);
  const [tiltOn, setTiltOn] = useState(false);
  const [tiltAsked, setTiltAsked] = useState(false);

  /**
   * The ship's own destruction (spec §4): the referee can — and for a solo
   * run, always does — declare `phase: 'done'` the instant this player's own
   * last-life report arrives, seconds before the explosion has even started
   * playing on this phone. `finaleRunning` is what holds the results panel
   * back for the whole sequence — impact, then explosion, then one more
   * second — the same "hold the truth until the animation that justifies it
   * has played" pattern Gravity Shooter's own dying-ship fade uses.
   */
  const [finaleRunning, setFinaleRunning] = useState(false);

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'asteroid') stateRef.current = msg.d;
    redraw((n) => n + 1);
  }, []);

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;
  const state = stateRef.current;
  const roundId = state?.roundId ?? 0;

  const sendReport = useCallback(
    (report: Report) => {
      if (!client || !state) return;
      client.send({ t: 'asteroid-report', d: { roundId: state.roundId, ...report, at: client.now() } });
    },
    [client, state],
  );

  const addBurst = useCallback((kind: Burst['kind'], at: { x: number; y: number }) => {
    const id = ++burstId.current;
    setBursts((prev) => [...prev, { id, kind, x: at.x, y: at.y }]);
    setTimeout(() => setBursts((prev) => prev.filter((b) => b.id !== id)), BURST_MS[kind]);
  }, []);

  const onHit = useCallback((at: { x: number; y: number }) => addBurst('missile', at), [addBurst]);

  /**
   * This run's own last life, spent. The impact GIF already played at the
   * rock (`onHit`, same frame) — this is the ship's own explosion, held for
   * its own real duration plus one more second before anything is allowed to
   * replace the board (spec §4).
   */
  const onDestroyed = useCallback(
    (at: { x: number; y: number }) => {
      addBurst('explosion', at);
      setFinaleRunning(true);
      setTimeout(() => setFinaleRunning(false), ASTEROID_EXPLOSION_GIF_MS + ASTEROID_FINALE_HOLD_MS);
    },
    [addBurst],
  );

  const enableTilt = useCallback(async (): Promise<boolean> => {
    setTiltAsked(true);
    const granted = await requestOrientation();
    setTiltOn(granted);
    return granted;
  }, []);

  /**
   * What Ready and Start hang the tilt on. There is no stick to fall back to any
   * more (spec §5), so a refusal really does swallow the tap: a ship nobody can
   * steer is not a way to be in the round, it is a way to fly straight into the
   * first rock. UFO Hunt's shape, for UFO Hunt's reason.
   */
  const ensureTilt = useCallback(async (): Promise<boolean> => {
    if (tiltOn) return true;
    if (support === 'unsupported') return false;
    return enableTilt();
  }, [tiltOn, support, enableTilt]);

  const players = room.room?.players ?? [];
  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  const avatarOf = (id: string): string => players.find((p) => p.id === id)?.avatar ?? '🙂';

  useEffect(() => {
    setBursts([]);
    setFinaleRunning(false);
  }, [roundId]);

  // A match-ending destruction still has to be watched: the referee can
  // declare `phase: 'done'` (a solo run ends the instant its only life is
  // spent) before the explosion has even started playing on this phone.
  const stillAnimating = finaleRunning;

  if (state && state.phase === 'done' && !stillAnimating) {
    const runs = Object.entries(state.runs);
    // Finishers first, by time; then everyone else by how far they got.
    runs.sort(([, a], [, b]) => {
      if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
      if (a.finishedAt !== null) return -1;
      if (b.finishedAt !== null) return 1;
      return b.distance - a.distance;
    });
    return (
      <GameOverScreen
        room={room}
        readyBlocked={support === 'unsupported' || (tiltAsked && !tiltOn)}
        onReadySetup={() => void enableTilt()}
        onBeforeReady={ensureTilt}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        rows={runs.map(([id, run]) => ({
          id,
          avatar: avatarOf(id),
          name: nameOf(id),
          value: run.finishedAt !== null
            ? `${((run.finishedAt - state.startsAt) / 1000).toFixed(1)}s`
            : `${Math.round((run.distance / ASTEROID_TRACK_LENGTH) * 100)}%`,
        }))}
        me={myId}
        winner={state.winner}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'asteroid', solo } })}
        canAct={room.isHost && enoughToStart(room.connected, [ASTEROID_MIN_PLAYERS, ASTEROID_MAX_PLAYERS], solo)}
      />
    );
  }

  if (state && (state.phase === 'running' || stillAnimating)) {
    const mine = myId ? state.runs[myId] : undefined;
    const ladder = Object.entries(state.runs)
      .map(([id, run]) => ({
        id,
        avatar: avatarOf(id),
        name: nameOf(id),
        value: run.finishedAt !== null ? '🏁' : `${Math.round((run.distance / ASTEROID_TRACK_LENGTH) * 100)}%`,
      }));
    const place = 1 + Object.values(state.runs).filter((run) => run.distance > (mine?.distance ?? 0)).length;
    const total = Object.keys(state.runs).length;

    return (
      <div class="asteroid" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          status={mine && mine.lives <= 0
            ? text({ en: 'Out of lives — watching the rest', fr: 'Plus de vies — vous regardez la fin' })
            : total > 1
              ? text({ en: `${place} of ${total}`, fr: `${place}e sur ${total}` })
              : text({ en: 'Time trial', fr: 'Contre-la-montre' })}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
        />
        <AsteroidCanvas
          roundId={state.roundId}
          onReport={sendReport}
          onHit={onHit}
          onDestroyed={onDestroyed}
          onFinished={sendReport}
        />
        {bursts.map((b) => (
          <img
            key={b.id}
            src={BURST_ART[b.kind]}
            class={`asteroid__impact asteroid__impact--${b.kind}`}
            style={{ left: `${(b.x * 100).toFixed(2)}%`, top: `${(b.y * 100).toFixed(2)}%` }}
            alt=""
          />
        ))}
        <Scoreboard rows={ladder} me={myId} unit={text({ en: 'progress', fr: 'progression' })} best="none" />
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
      canStart={room.isHost && enoughToStart(room.connected, [ASTEROID_MIN_PLAYERS, ASTEROID_MAX_PLAYERS], solo)}
      startLabel={state ? t.common.playAgain : t.common.startRound}
      onStart={() => client?.send({ t: 'start', d: { mode: 'asteroid', solo } })}
      readyBlocked={support === 'unsupported' || (tiltAsked && !tiltOn)}
      onBeforeReady={ensureTilt}
      extras={<TiltPrimer support={support} on={tiltOn} asked={tiltAsked} isHost={room.isHost} onEnable={() => void enableTilt()} />}
    />
  );
}

/**
 * The tilt explanation, and the honest version of a refusal.
 *
 * There is no stick behind this any more (spec §5): tilt is the only way to fly,
 * so the panel has no button before the first ask — Ready and Start do that
 * (issue #29) — and offers Try again after a refusal, which is the one re-ask
 * device-capabilities.md §2 allows.
 */
function TiltPrimer({
  support,
  on,
  asked,
  isHost,
  onEnable,
}: {
  support: OrientationSupport;
  on: boolean;
  asked: boolean;
  isHost: boolean;
  onEnable: () => void;
}): JSX.Element {
  const text = useGameText();
  const heading = text({ en: 'Tilt to fly', fr: 'Incliner pour voler' });

  if (support === 'unsupported') {
    return <PermissionPrimer heading={heading} body={text({
      en: 'This phone has no tilt sensor, so there is nothing to fly the ship with — Asteroid Race cannot run here.',
      fr: 'Ce téléphone n’a pas de capteur d’inclinaison, donc rien pour piloter le vaisseau — Asteroid Race ne peut pas fonctionner ici.',
    })} />;
  }

  if (asked && !on) {
    return (
      <PermissionPrimer
        heading={heading}
        body={text({
          en: 'Tilt was turned down, and it is the only way to fly this one — there is no stick and no tap version, so the ship has nothing to steer with.',
          fr: 'L’inclinaison a été refusée, et c’est la seule façon de piloter — il n’y a ni stick ni version tactile, le vaisseau n’a donc rien pour se diriger.',
        })}
        action={{ label: text({ en: 'Try again', fr: 'Réessayer' }), onClick: onEnable }}
      />
    );
  }

  if (on) {
    return <PermissionPrimer heading={heading} enabled body={text({
      en: 'Ready. Tilt left and right to steer, and tip the top edge away to climb.',
      fr: 'Prêt. Inclinez à gauche et à droite pour diriger, et basculez le haut du téléphone pour monter.',
    })} />;
  }

  return (
    <PermissionPrimer
      heading={heading}
      body={`${text({
        en: 'Tilting flies the ship. Nothing is recorded — the tilt never leaves your phone at all, only how far down the track you have got.',
        fr: 'L’inclinaison pilote le vaisseau. Rien n’est enregistré — l’inclinaison ne quitte jamais votre téléphone, seule votre distance est transmise.',
      })} ${isHost
        ? text({ en: 'Start the round and your phone will ask.', fr: 'Démarrez la manche et votre téléphone vous le demandera.' })
        : text({ en: 'Tap Ready and your phone will ask.', fr: 'Touchez Prêt et votre téléphone vous le demandera.' })}`}
    />
  );
}
