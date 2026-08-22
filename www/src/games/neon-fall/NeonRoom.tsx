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
import { useSoloTesting } from '../../core/useSolo';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { orientationSupport, requestOrientation, type OrientationSupport } from '../../core/sensors/orientation';
import { NeonGame } from './game';
import { NeonBoard } from './NeonBoard';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText, type GameText } from '../../core/i18n/gameText';
import { PermissionPrimer } from '../../core/ui/PermissionPrimer';

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
  const text = useGameText();
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

  const solo = useSoloTesting();
  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
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
      room.setError(text({ en: 'No tilt access — you can still be the protector, or drop back to tap zones as the glider.', fr: 'Pas d’accès à l’inclinaison — vous pouvez protéger, ou utiliser les zones tactiles comme planeur.' }));
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
        status={state.winner === state.gliderId ? text({ en: 'The glider made it down', fr: 'Le planeur a atteint le sol' })
          : text({ en: 'The glider was shot down', fr: 'Le planeur a été abattu' })}
        rows={rows.map((id) => ({
          id,
          avatar: byId.get(id)?.avatar ?? '🙂',
          name: byId.get(id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' }),
          value: id === state.gliderId ? text({ en: 'glider', fr: 'planeur' }) : text({ en: 'protector', fr: 'protecteur' }),
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
      note={note(room.isHost, room.connected, solo, text)}
      playerTag={(id) => {
        if (!roles) return null;
        if (id === roles.glider) return text({ en: 'glider', fr: 'planeur' });
        if (id === roles.protector) return text({ en: 'protector', fr: 'protecteur' });
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
  const text = useGameText();
  if (!a || !b) return null;
  const glider = swapped ? b.name : a.name;
  const protector = swapped ? a.name : b.name;
  return (
    <section class="panel neon-seats" role="note">
      <h2 class="panel__heading">{text({ en: "Who's who", fr: 'Qui fait quoi' })}</h2>
      <p class="neon-seats__row">
        <span class="neon-seats__role">🕹️ {text({ en: 'Glider', fr: 'Planeur' })}</span> {glider}
      </p>
      <p class="neon-seats__row">
        <span class="neon-seats__role">🎯 {text({ en: 'Protector', fr: 'Protecteur' })}</span> {protector}
      </p>
      <button class="btn neon-seats__swap" type="button" onClick={onSwap}>
        {text({ en: 'Swap', fr: 'Inverser' })}
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
  const text = useGameText();
  const heading = text({ en: 'Tilt to fly', fr: 'Incliner pour voler' });
  if (support === 'unsupported' || (asked && !on)) {
    return <PermissionPrimer heading={heading} body={`${support === 'unsupported'
      ? text({ en: 'This phone has no tilt sensor.', fr: 'Ce téléphone n’a pas de capteur d’inclinaison.' })
      : text({ en: 'Tilt was turned down.', fr: 'L’accès à l’inclinaison a été refusé.' })} ${text(
      { en: 'If you end up the glider, you will get two tap zones instead — hold either side to drift that way.', fr: 'Si vous êtes le planeur, deux zones tactiles remplaceront l’inclinaison — maintenez un côté pour vous déplacer.' },
    )}`} />;
  }

  if (on) {
    return <PermissionPrimer heading={heading} enabled body={text(
      { en: "Ready. If you're the glider, tilt left and right to drift between lanes.", fr: 'Prêt. Si vous êtes le planeur, inclinez à gauche et à droite pour changer de voie.' })} />;
  }

  return (
    <PermissionPrimer heading={heading}
      body={text({ en: 'If you end up the glider, tilting steers you. Nothing is recorded — only a single steering number ever leaves the phone, never the raw tilt.', fr: 'Si vous êtes le planeur, l’inclinaison vous dirige. Rien n’est enregistré — seul un nombre de direction quitte le téléphone, jamais l’inclinaison brute.' })}
      action={{ label: text({ en: 'Turn on tilt', fr: 'Activer l’inclinaison' }), onClick: onEnable }} />
  );
}

function note(isHost: boolean, connected: number, solo: boolean, text: GameText): string {
  if (!solo && connected < NEON_MIN_PLAYERS) return text({ en: 'Waiting for a second player…', fr: 'En attente d’un deuxième joueur…' });
  if (connected > NEON_MAX_PLAYERS) return text({ en: 'Neon Fall is exactly 2 players.', fr: 'Neon Fall se joue exactement à 2.' });
  if (!isHost) return text({ en: 'The host starts the round.', fr: "L’hôte démarre la manche." });
  return text({ en: 'Pick who flies and who shoots, then start.', fr: 'Choisissez qui vole et qui tire, puis démarrez.' });
}
