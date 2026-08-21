import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  NEON_EXPLOSION_MS,
  NEON_MAX_PLAYERS,
  NEON_MIN_PLAYERS,
  type PlayerId,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { soloTesting } from '../../core/solo';
import { useRoom, useShareRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { orientationSupport, requestOrientation, type OrientationSupport } from '../../core/sensors/orientation';
import { NeonGame } from './game';
import { NeonBoard } from './NeonBoard';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';

/**
 * Neon Fall's room screen. Spec: docs/specs/games/neon-fall.md
 *
 * Two things this game adds to the shared lobby template's `extras` slot, both
 * host-only, same reasoning as Cat and Mouse's drag-mode picker: a host
 * **setting**, not a vote, and orthogonal to `mode`.
 *
 *  - **The seat picker** (§4): who is the glider, who is the protector.
 *  - **The tilt primer** (§5): shown to both players, since either could end
 *    up in the glider's seat — the protector's own permission state is simply
 *    never read.
 */
export function NeonRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <NeonRoomInner game={card} code={code} />}</RoomGate>;
}

function NeonRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const gameRef = useRef<NeonGame | null>(null);
  if (!gameRef.current) gameRef.current = new NeonGame();
  const game = gameRef.current;

  const [, redraw] = useState(0);
  const [support] = useState<OrientationSupport>(orientationSupport);
  const [orientationOn, setOrientationOn] = useState(false);
  const [orientationAsked, setOrientationAsked] = useState(false);
  const [swapped, setSwapped] = useState(false);

  const onGame = useCallback(
    (msg: ServerMessage) => {
      game.apply(msg);
      redraw((n) => n + 1);
    },
    [game],
  );

  const solo = soloTesting();
  const room = useRoom(code, card.slug, onGame);
  const { joinUrl, copied, showQr, share, toggleQr } = useShareRoom(code, card.title, room.setError);
  const client = room.client;
  const myId = room.me?.id;

  useEffect(() => {
    game.identify(() => client?.now() ?? Date.now());
  }, [game, client]);

  /*
   * The death explosion holds the board on screen for NEON_EXPLOSION_MS after
   * the fatal hit before the results panel replaces it — mirrors Pass the
   * Bomb's `holdingBoom` in BombRoom.tsx, down to the re-render-on-timeout
   * trick: `explodedAt` alone would never re-render once it stops changing,
   * so a timer forces one right when the hold should end.
   */
  const [, tickExplosion] = useState(0);
  useEffect(() => {
    const at = game.explodedAt;
    if (at === null) return;
    const left = NEON_EXPLOSION_MS - ((client?.now() ?? Date.now()) - at);
    if (left <= 0) return;
    const timer = setTimeout(() => tickExplosion((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [game.explodedAt]);
  const holdingExplosion =
    game.explodedAt !== null && (client?.now() ?? Date.now()) - game.explodedAt < NEON_EXPLOSION_MS;

  async function enableTilt(): Promise<void> {
    setOrientationAsked(true);
    const granted = await requestOrientation();
    setOrientationOn(granted);
    if (!granted) {
      room.setError('No tilt access — you can still be the protector, or drop back to tap zones as the glider.');
    }
  }

  const state = game.state;
  const players = room.room?.players ?? [];
  const [a, b] = players;
  const roles =
    a && b ? (swapped ? { glider: b.id, protector: a.id } : { glider: a.id, protector: b.id }) : undefined;

  if (state && (state.phase === 'running' || holdingExplosion)) {
    return (
      <NeonBoard
        game={game}
        myId={myId}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        accent={card.accent}
        client={client}
        players={players}
        orientationOn={orientationOn}
      />
    );
  }

  if (state?.phase === 'done') {
    const byId = new Map(players.map((p) => [p.id, p]));
    const rows: PlayerId[] = [state.gliderId, state.protectorId];
    return (
      <GameOverScreen
        room={room}
        readyBlocked={support !== 'unsupported' && !orientationAsked}
        onReadySetup={enableTilt}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        status={state.winner === state.gliderId ? 'The glider made it down' : 'The glider was shot down'}
        rows={rows.map((id) => ({
          id,
          avatar: byId.get(id)?.avatar ?? '🙂',
          name: byId.get(id)?.name ?? 'Someone',
          value: id === state.gliderId ? 'glider' : 'protector',
          unit: '',
          ...(id === state.winner ? {} : { out: true }),
        }))}
        me={myId}
        winner={state.winner}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'neon', ...(roles ? { roles } : {}), solo } })}
        canAct={room.isHost && enoughToStart(room.connected, [NEON_MIN_PLAYERS, NEON_MAX_PLAYERS], solo)}
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
      canStart={room.isHost && enoughToStart(room.connected, [NEON_MIN_PLAYERS, NEON_MAX_PLAYERS], solo)}
      startLabel={state ? t.common.playAgain : t.common.startRound}
      onStart={() => client?.send({ t: 'start', d: { mode: 'neon', ...(roles ? { roles } : {}), solo } })}
      readyBlocked={support !== 'unsupported' && !orientationAsked}
      note={note(room.isHost, room.connected, solo)}
      playerTag={(id) => {
        if (!roles) return null;
        if (id === roles.glider) return 'glider';
        if (id === roles.protector) return 'protector';
        return null;
      }}
      extras={
        room.isHost ? (
          <>
            <SeatPicker a={a} b={b} swapped={swapped} onSwap={() => setSwapped((s) => !s)} />
            <TiltPrimer support={support} on={orientationOn} asked={orientationAsked} onEnable={enableTilt} />
          </>
        ) : (
          <TiltPrimer support={support} on={orientationOn} asked={orientationAsked} onEnable={enableTilt} />
        )
      }
    />
  );
}

/** The host's seat picker: who is the glider, who is the protector. */
function SeatPicker({
  a,
  b,
  swapped,
  onSwap,
}: {
  a: { name: string } | undefined;
  b: { name: string } | undefined;
  swapped: boolean;
  onSwap: () => void;
}): JSX.Element | null {
  if (!a || !b) return null;
  const glider = swapped ? b.name : a.name;
  const protector = swapped ? a.name : b.name;
  return (
    <section class="panel neon-seats" role="note">
      <h2 class="panel__heading">Who's who</h2>
      <p class="neon-seats__row">
        <span class="neon-seats__role">🕹️ Glider</span> {glider}
      </p>
      <p class="neon-seats__row">
        <span class="neon-seats__role">🎯 Protector</span> {protector}
      </p>
      <button class="btn neon-seats__swap" type="button" onClick={onSwap}>
        Swap
      </button>
    </section>
  );
}

/**
 * The tilt permission primer. Shown to both players — either could be the
 * glider once the host picks — and the honest fallback: refused tilt is not
 * dead-ended, it drops to held tap zones (spec §5).
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
  if (support === 'unsupported' || (asked && !on)) {
    return (
      <section class="panel primer">
        <h2 class="panel__heading">Tilt to fly</h2>
        <p class="primer__body">
          {support === 'unsupported'
            ? 'This phone has no tilt sensor.'
            : 'Tilt was turned down.'}{' '}
          If you end up the glider, you will get two tap zones instead — hold either side to
          drift that way.
        </p>
      </section>
    );
  }

  if (on) {
    return (
      <section class="panel primer">
        <h2 class="panel__heading">Tilt to fly</h2>
        <p class="primer__body primer__body--on">
          Ready. If you're the glider, tilt left and right to drift between lanes.
        </p>
      </section>
    );
  }

  return (
    <section class="panel primer">
      <h2 class="panel__heading">Tilt to fly</h2>
      <p class="primer__body">
        If you end up the glider, tilting steers you. Nothing is recorded — only a single
        steering number ever leaves the phone, never the raw tilt.
      </p>
      <button class="btn btn--primary primer__enable" type="button" onClick={onEnable}>
        Turn on tilt
      </button>
    </section>
  );
}

function note(isHost: boolean, connected: number, solo: boolean): string {
  if (!solo && connected < NEON_MIN_PLAYERS) return 'Waiting for a second player…';
  if (connected > NEON_MAX_PLAYERS) return 'Neon Fall is exactly 2 players.';
  if (!isHost) return 'The host starts the round.';
  return 'Pick who flies and who shoots, then start.';
}
