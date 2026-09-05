import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  GRAVITY_LIVES,
  GRAVITY_MAX_PLAYERS,
  GRAVITY_MIN_PLAYERS,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { StatusBar } from '../../core/ui/StatusBar';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import { useSoloTesting } from '../../core/useSolo';
import {
  GravityGame,
  GRAVITY_EXPLOSION_GIF_MS,
  GRAVITY_IMPACT_GIF_MS,
  shipPosition,
  viewTransform,
  type Seat,
} from './game';
import { GravityCanvas, type DyingShip, type FlightEnd } from './GravityCanvas';
import impactMissileGif from './art/impact_missile.gif?url&no-inline';
import explosionGif from './art/explosion.gif?url&no-inline';
import './gravity-shooter.css';

/**
 * Gravity Shooter's room screen. Spec: docs/specs/games/gravity-shooter.md
 *
 * The lobby is the shared template. The round screen has no `Scoreboard` —
 * there is no score, just each ship's own five lives (spec §4) — and its own
 * GIF burst overlay follows UFO Hunt's exact pattern (`UfoRoom.tsx`'s
 * `addBurst`): triggered once, positioned once, removed by a timeout.
 */
export function GravityRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <GravityRoomInner game={card} code={code} />}</RoomGate>;
}

type Burst = { id: number; kind: 'missile' | 'explosion'; x: number; y: number };

/** Each burst stays up for exactly as long as its own GIF runs — the real
 *  durations, measured off the files (`game.ts`), not padded guesses. */
const BURST_MS: Record<Burst['kind'], number> = { missile: GRAVITY_IMPACT_GIF_MS, explosion: GRAVITY_EXPLOSION_GIF_MS };
const BURST_ART: Record<Burst['kind'], string> = { missile: impactMissileGif, explosion: explosionGif };

function GravityRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [, redraw] = useState(0);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const burstId = useRef(0);

  const gameRef = useRef<GravityGame | null>(null);
  if (!gameRef.current) gameRef.current = new GravityGame();
  const game = gameRef.current;

  /*
   * The referee's own lives, held back from the screen until the shot that
   * changed them has actually been watched — the referee decides a hit (and
   * broadcasts the new count) the instant a `gravity-shot` arrives, seconds
   * before the missile's own flight finishes animating on either phone. Read
   * straight from `state.lives`, the pips gave the result away mid-flight.
   * Reset only when a fresh match starts; every life lost within one is
   * revealed by `onFlightEnd` below, exactly when the flight is done.
   *
   * Indexed by seat, not player id — solo mode puts the same player in both
   * seats (see shared/protocol.ts's own `GravityShooterState` docblock).
   */
  const [displayedLives, setDisplayedLives] = useState<[number, number]>([GRAVITY_LIVES, GRAVITY_LIVES]);
  /** The match-ending GIF sequence is still playing — see `onFlightEnd`. */
  const [finaleRunning, setFinaleRunning] = useState(false);
  const [dying, setDying] = useState<DyingShip | null>(null);
  /** The last timed-out turn this phone has already reacted to, so a re-sent
   *  frame does not blow the same ship up twice. */
  const blownUpAt = useRef(-1);

  const addBurst = useCallback((kind: Burst['kind'], pos: { x: number; y: number }): void => {
    const id = ++burstId.current;
    setBursts((prev) => [...prev, { id, kind, x: Math.min(1, Math.max(0, pos.x)), y: Math.min(1, Math.max(0, pos.y)) }]);
    setTimeout(() => setBursts((prev) => prev.filter((b) => b.id !== id)), BURST_MS[kind]);
  }, []);

  const onGame = useCallback(
    (msg: ServerMessage) => {
      game.apply(msg);
      /**
       * A turn that ran out the shot clock (spec §2.4): the referee marks it
       * with a zero-strength `lastShot` and takes a life off the SHOOTER. There
       * is no flight to watch, so unlike a real shot there is nothing to hold
       * the news back for — the blast goes off on their own ship right now, and
       * the pips follow it immediately rather than waiting for an
       * `onFlightEnd` that will never come.
       */
      if (msg.t === 'gravity' && msg.d.lastShot?.strength === 0 && msg.d.shots !== blownUpAt.current) {
        blownUpAt.current = msg.d.shots;
        const victim = msg.d.lastShot.shooter;
        const at = viewTransform(game.mySeat ?? 0, shipPosition(victim));
        addBurst('missile', at);
        setDisplayedLives(msg.d.lives);
        // A shot clock that ends the match earns the same send-off a winning
        // shot gets, rather than cutting straight to the results panel.
        if (msg.d.phase === 'done') {
          setFinaleRunning(true);
          setTimeout(() => {
            addBurst('explosion', at);
            setDying({ seat: victim, startedAt: performance.now() });
          }, GRAVITY_IMPACT_GIF_MS);
          setTimeout(() => setFinaleRunning(false), GRAVITY_IMPACT_GIF_MS + GRAVITY_EXPLOSION_GIF_MS);
        }
      }
      redraw((n) => n + 1);
    },
    [game, addBurst],
  );

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;
  const roundId = game.state?.roundId;

  useEffect(() => {
    if (client && myId) game.identify(myId, () => client.now());
  }, [game, client, myId]);

  useEffect(() => {
    if (game.state) setDisplayedLives(game.state.lives);
    // A fresh match starts with nothing exploding and both ships intact.
    setFinaleRunning(false);
    setDying(null);
  }, [game, roundId]);

  const onFlightEnd = useCallback(
    (end: FlightEnd) => {
      // A shot swallowed by a planet gets the same impact GIF a ship hit
      // does, played where it was actually absorbed — a miss is still a
      // collision, just not with the ship it was aimed at.
      if (end.planetImpact) addBurst('missile', end.planetImpact);
      if (end.hit) {
        // `end.contact` — where the flight actually met the hull. Not
        // `end.local` (the simulation stops a hit radius out, floating above
        // the ship) and not `end.target` either (the ship's centre, which is
        // where the ship's own explosion belongs, not the missile's impact).
        addBurst('missile', end.contact);
        // The referee's own broadcast — which decides `phase`/`winner` — arrives
        // well before the flight animation finishes, so by the time the flight
        // ends `game.state` already knows whether this was the killing blow
        // (spec §4).
        const finished = game.state;
        if (finished?.phase === 'done' && finished.winner !== null) {
          /**
           * The match-ending sequence, played out in full before the result
           * panel appears (spec §4): the missile's own impact GIF where it
           * landed, then — once that has actually finished, not 200ms in — an
           * explosion centred on the ship that was destroyed, which fades out
           * underneath it. `finaleRunning` is what holds the results screen
           * back for the whole span; without it the panel replaced the board
           * the frame the flight ended, cutting both GIFs off.
           */
          const loser: Seat = finished.winner === 0 ? 1 : 0;
          setFinaleRunning(true);
          setTimeout(() => {
            addBurst('explosion', end.target);
            setDying({ seat: loser, startedAt: performance.now() });
          }, GRAVITY_IMPACT_GIF_MS);
          setTimeout(() => setFinaleRunning(false), GRAVITY_IMPACT_GIF_MS + GRAVITY_EXPLOSION_GIF_MS);
        }
      }
      // The flight this phone has been watching is over — only now does the
      // outcome it decided become visible.
      if (game.state) setDisplayedLives(game.state.lives);
    },
    [game, addBurst],
  );

  const onShoot = useCallback(
    (payload: { roundId: number; angle: number; strength: number; hit: boolean }) => {
      client?.send({ t: 'gravity-shot', d: payload });
      redraw((n) => n + 1);
    },
    [client],
  );

  const state = game.state;
  const players = room.room?.players ?? [];
  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  const avatarOf = (id: string): string => players.find((p) => p.id === id)?.avatar ?? '🙂';

  // A match-ending shot still has to be watched: the referee decides `phase:
  // 'done'` the instant the shot lands, but the missile carrying that news is
  // still flying (or the impact GIF is still playing) on this phone. Cutting
  // straight to the results screen would skip the very shot that won it.
  const stillAnimating = game.activeShot !== null || finaleRunning;

  if (state && state.phase === 'done' && !stillAnimating) {
    return (
      <GameOverScreen
        room={room}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        rows={state.seats.map((id, seat) => ({
          id,
          avatar: avatarOf(id),
          name: nameOf(id),
          value: seat === state.winner ? t.common.win : t.common.lose,
        }))}
        me={myId}
        winner={state.winner !== null ? state.seats[state.winner] : null}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'gravity', solo } })}
        canAct={room.isHost && enoughToStart(room.connected, [GRAVITY_MIN_PLAYERS, GRAVITY_MAX_PLAYERS], solo)}
      />
    );
  }

  if (state && (state.phase === 'running' || stillAnimating)) {
    const mySeat = game.mySeat;
    const myLives = mySeat !== null ? displayedLives[mySeat] : 0;
    const otherSeatIndex = mySeat === 0 ? 1 : 0;
    const opponentLives = mySeat !== null ? displayedLives[otherSeatIndex] : 0;
    const isMyTurn = game.isMyTurn;

    return (
      <div class="gravity" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          status={
            state.phase === 'done'
              ? text({ en: 'That was the winning shot…', fr: 'Voici le tir décisif…' })
              : isMyTurn
                ? text({ en: 'Your turn', fr: 'À vous' })
                : text({ en: 'Their turn', fr: 'Au tour adverse' })
          }
          title={card.title}
          concept={card.concept}
          rules={card.rules}
        />
        <p class="gravity__lives gravity__lives--them" aria-label={text({ en: 'Their lives', fr: 'Vies adverses' })}>
          {pips(opponentLives)}
        </p>
        <div class="gravity__board">
          <GravityCanvas game={game} onFlightEnd={onFlightEnd} onShoot={onShoot} dying={dying} />
          {bursts.map((b) => (
            <img
              key={b.id}
              src={BURST_ART[b.kind]}
              class={`gravity__gifburst gravity__gifburst--${b.kind}`}
              style={{ left: `${(b.x * 100).toFixed(2)}%`, top: `${(b.y * 100).toFixed(2)}%` }}
              alt=""
            />
          ))}
        </div>
        <p class="gravity__lives gravity__lives--me" aria-label={text({ en: 'Your lives', fr: 'Vos vies' })}>
          {pips(myLives)}
        </p>
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
      canStart={room.isHost && enoughToStart(room.connected, [GRAVITY_MIN_PLAYERS, GRAVITY_MAX_PLAYERS], solo)}
      startLabel={state ? t.common.playAgain : t.common.startRound}
      onStart={() => client?.send({ t: 'start', d: { mode: 'gravity', solo } })}
    />
  );
}

function pips(lives: number): JSX.Element {
  return (
    <span aria-hidden="true">
      {'●'.repeat(Math.max(0, lives))}
      {'○'.repeat(Math.max(0, GRAVITY_LIVES - lives))}
    </span>
  );
}
