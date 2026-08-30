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
import { useGameText, type GameText } from '../../core/i18n/gameText';
import { GravityGame } from './game';
import { GravityCanvas, type FlightEnd } from './GravityCanvas';
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

const BURST_MS: Record<Burst['kind'], number> = { missile: 580, explosion: 1000 };
const BURST_ART: Record<Burst['kind'], string> = { missile: impactMissileGif, explosion: explosionGif };

function GravityRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const [, redraw] = useState(0);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const burstId = useRef(0);

  const gameRef = useRef<GravityGame | null>(null);
  if (!gameRef.current) gameRef.current = new GravityGame();
  const game = gameRef.current;

  const onGame = useCallback(
    (msg: ServerMessage) => {
      game.apply(msg);
      redraw((n) => n + 1);
    },
    [game],
  );

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;

  useEffect(() => {
    if (client && myId) game.identify(myId, () => client.now());
  }, [game, client, myId]);

  const addBurst = useCallback((kind: Burst['kind'], pos: { x: number; y: number }): void => {
    const id = ++burstId.current;
    setBursts((prev) => [...prev, { id, kind, x: Math.min(1, Math.max(0, pos.x)), y: Math.min(1, Math.max(0, pos.y)) }]);
    setTimeout(() => setBursts((prev) => prev.filter((b) => b.id !== id)), BURST_MS[kind]);
  }, []);

  const onFlightEnd = useCallback(
    (end: FlightEnd) => {
      if (!end.hit) return;
      addBurst('missile', end.local);
      // The referee's own broadcast — which decides `phase`/`winner` — arrives
      // well before a 3-second flight animation finishes, so by the time the
      // flight ends `game.state` already knows whether this was the killing
      // blow (spec §4).
      if (game.state?.phase === 'done') {
        setTimeout(() => addBurst('explosion', end.local), 200);
      }
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

  if (state && state.phase === 'done') {
    return (
      <GameOverScreen
        room={room}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        rows={state.seats.map((id) => ({
          id,
          avatar: avatarOf(id),
          name: nameOf(id),
          value: id === state.winner ? t.common.win : t.common.lose,
        }))}
        me={myId}
        winner={state.winner}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'gravity' } })}
        canAct={room.isHost && room.connected === GRAVITY_MAX_PLAYERS}
      />
    );
  }

  if (state && state.phase === 'running') {
    const mySeat = game.mySeat;
    const myLives = mySeat !== null ? (state.lives[state.seats[mySeat]] ?? 0) : 0;
    const otherSeatIndex = mySeat === 0 ? 1 : 0;
    const opponentLives = mySeat !== null ? (state.lives[state.seats[otherSeatIndex]] ?? 0) : 0;
    const isMyTurn = game.isMyTurn;

    return (
      <div class="gravity" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          status={isMyTurn ? text({ en: 'Your turn', fr: 'À vous' }) : text({ en: 'Their turn', fr: 'Au tour adverse' })}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
        />
        <p class="gravity__lives gravity__lives--them" aria-label={text({ en: 'Their lives', fr: 'Vies adverses' })}>
          {pips(opponentLives)}
        </p>
        <div class="gravity__board">
          <GravityCanvas game={game} onFlightEnd={onFlightEnd} onShoot={onShoot} />
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
      canStart={room.isHost && enoughToStart(room.connected, [GRAVITY_MIN_PLAYERS, GRAVITY_MAX_PLAYERS], false)}
      startLabel={state ? t.common.playAgain : t.common.startRound}
      onStart={() => client?.send({ t: 'start', d: { mode: 'gravity' } })}
      note={note(room.isHost, room.connected, text)}
      soloSupported={false}
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

function note(isHost: boolean, connected: number, text: GameText): string {
  if (!isHost) return text({ en: 'The host starts the match.', fr: "L’hôte démarre la partie." });
  if (connected < GRAVITY_MAX_PLAYERS) return text({ en: 'Waiting for your opponent…', fr: 'En attente de votre adversaire…' });
  if (connected > GRAVITY_MAX_PLAYERS) return text({ en: 'Gravity Shooter is exactly two players.', fr: 'Gravity Shooter se joue exactement à deux.' });
  return text({ en: 'Pull back from your ship, let go, and let the planets bend your shot.', fr: 'Tirez sur votre vaisseau, lâchez, et laissez les planètes courber votre tir.' });
}
