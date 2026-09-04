import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  ASTEROID_MAX_PLAYERS,
  ASTEROID_MIN_PLAYERS,
  ASTEROID_TRACK_LENGTH,
  type PlayerId,
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
import { useGameText, type GameText } from '../../core/i18n/gameText';
import { useSoloTesting } from '../../core/useSolo';
import { AsteroidCanvas, type Report } from './AsteroidCanvas';
import impactGif from './art/impact_missile.gif?url&no-inline';
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

type Burst = { id: number; x: number; y: number };

/** `impact_missile.gif`'s own measured length — the same file, and the same
 *  number, Gravity Shooter reads off it (`game.ts` there). */
const IMPACT_MS = 540;

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

  const onHit = useCallback((at: { x: number; y: number }) => {
    const id = ++burstId.current;
    setBursts((prev) => [...prev, { id, x: at.x, y: at.y }]);
    setTimeout(() => setBursts((prev) => prev.filter((b) => b.id !== id)), IMPACT_MS);
  }, []);

  const enableTilt = useCallback(() => {
    setTiltAsked(true);
    void requestOrientation().then((granted) => setTiltOn(granted));
  }, []);

  const players = room.room?.players ?? [];
  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  const avatarOf = (id: string): string => players.find((p) => p.id === id)?.avatar ?? '🙂';

  useEffect(() => {
    setBursts([]);
  }, [roundId]);

  if (state && state.phase === 'done') {
    const runs = Object.entries(state.runs);
    // Finishers first, by time; then everyone else by how far they got.
    runs.sort(([, a], [, b]) => {
      if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
      if (a.finishedAt !== null) return -1;
      if (b.finishedAt !== null) return 1;
      return b.distance - a.distance;
    });
    const cleanest = runs.reduce<[PlayerId, number] | null>(
      (best, [id, run]) => (best === null || run.hits < best[1] ? [id, run.hits] : best),
      null,
    );
    return (
      <GameOverScreen
        room={room}
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
        note={cleanest
          ? text({
            en: `Cleanest run: ${nameOf(cleanest[0])}, ${cleanest[1]} rocks clipped`,
            fr: `Vol le plus propre : ${nameOf(cleanest[0])}, ${cleanest[1]} rochers touchés`,
          })
          : undefined}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'asteroid', solo } })}
        canAct={room.isHost && enoughToStart(room.connected, [ASTEROID_MIN_PLAYERS, ASTEROID_MAX_PLAYERS], solo)}
      />
    );
  }

  if (state && state.phase === 'running') {
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
          tilt={tiltOn}
          onReport={sendReport}
          onHit={onHit}
          onFinished={sendReport}
        />
        {bursts.map((b) => (
          <img
            key={b.id}
            src={impactGif}
            class="asteroid__impact"
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
      note={note(room.isHost, room.connected, text)}
      readyBlocked={support !== 'unsupported' && !tiltAsked}
      extras={<TiltPrimer support={support} on={tiltOn} asked={tiltAsked} onEnable={enableTilt} />}
    />
  );
}

/**
 * The tilt primer, and the honest fallback: refused tilt is not a dead end, it
 * is a virtual stick on the board itself (spec §5). Two axes are why this game
 * cannot reuse Neon Fall's pair of held zones.
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
  const heading = text({ en: 'Tilt to fly', fr: 'Incliner pour voler' });

  if (support === 'unsupported' || (asked && !on)) {
    return <PermissionPrimer heading={heading} body={`${support === 'unsupported'
      ? text({ en: 'This phone has no tilt sensor.', fr: 'Ce téléphone n’a pas de capteur d’inclinaison.' })
      : text({ en: 'Tilt was turned down.', fr: 'L’accès à l’inclinaison a été refusé.' })} ${text({
      en: 'You will fly with a stick instead — hold anywhere on the board and drag.',
      fr: 'Vous piloterez avec un stick — maintenez n’importe où sur l’écran et glissez.',
    })}`} />;
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
      body={text({
        en: 'Tilting flies the ship. Nothing is recorded — the tilt never leaves your phone at all, only how far down the track you have got.',
        fr: 'L’inclinaison pilote le vaisseau. Rien n’est enregistré — l’inclinaison ne quitte jamais votre téléphone, seule votre distance est transmise.',
      })}
      action={{ label: text({ en: 'Turn on tilt', fr: 'Activer l’inclinaison' }), onClick: onEnable }}
    />
  );
}

function note(isHost: boolean, connected: number, text: GameText): string {
  if (connected > ASTEROID_MAX_PLAYERS) return text({ en: 'Asteroid Race is up to 8 players.', fr: 'Asteroid Race se joue jusqu’à 8 joueurs.' });
  if (!isHost) return text({ en: 'The host starts the race.', fr: "L’hôte démarre la course." });
  if (connected === 1) return text({ en: 'Alone, this is a time trial — the field is the same every time it is dealt.', fr: 'Seul, c’est un contre-la-montre — le champ est le même pour tous.' });
  return text({ en: 'Everyone flies the same asteroid field. First one through wins.', fr: 'Tout le monde traverse le même champ d’astéroïdes. Le premier arrivé gagne.' });
}
