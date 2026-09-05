import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  STEADY_MAX_PLAYERS,
  STEADY_MIN_PLAYERS,
  STEADY_TICK_MS,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { useSoloTesting } from '../../core/useSolo';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { detectSteady } from '../../core/sensors/steady';
import { motionSupport, requestMotion, type MotionSupport } from '../../core/sensors/motion';
import { applySteady, type SteadyState } from './game';
import { SteadyScreen } from './SteadyScreen';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import { PermissionPrimer } from '../../core/ui/PermissionPrimer';

/**
 * Steady Hand's room screen. Spec: docs/specs/games/steady-hand.md
 *
 * The second game to need a motion permission. Nothing is requested on arrival, and
 * `requestMotion()` is the first thing the handler does — iOS refuses the prompt
 * outside a user gesture and remembers a denial.
 *
 * Where it differs from Pass the Bomb is that there is **no fallback** (spec §5).
 * "Hold a phone still" has no touch equivalent, so a player without motion access
 * spectates — and because there is nothing to choose between, **the prompt rides on
 * Ready (or Start, for the host) rather than on a button of its own**. A separate
 * primer button in front of a permission you have no alternative to is a tap that
 * only ever delays the same answer (issue #29, device-capabilities.md §2). The panel
 * stays; only its button is gone, so the explanation still arrives first.
 */
export function SteadyRoom(props: { game: GameCard }): JSX.Element {
  return (
    <RoomGate game={props.game}>
      {(code, card) => <SteadyRoomInner game={card} code={code} />}
    </RoomGate>
  );
}

function SteadyRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const [state, setState] = useState<SteadyState>(null);
  const [support] = useState<MotionSupport>(motionSupport);
  const [motionOn, setMotionOn] = useState(false);
  const [motionAsked, setMotionAsked] = useState(false);

  const onGame = useCallback((msg: ServerMessage) => {
    setState((prev) => applySteady(prev, msg, Date.now()));
  }, []);

  /*
   * Read once per render rather than per click: it changes only when the admin
   * centre writes it, which cannot happen while this page is open.
   */
  const solo = useSoloTesting();

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;

  const running = state?.phase === 'running';
  const iAmAlive = !!myId && !!state && state.alive.includes(myId);

  const clientRef = useRef(client);
  clientRef.current = client;
  const roundRef = useRef(state?.roundId ?? 0);
  roundRef.current = state?.roundId ?? 0;

  /*
   * One detector and one interval for the whole round.
   *
   * The detector accumulates the *worst* wobble between reads, so the reporting rate is
   * decoupled from the sensor rate: the accelerometer fires at 60 Hz and we send 5
   * messages a second, each carrying the worst thing that happened in its window. A
   * flinch cannot slip between two samples.
   *
   * `clientRef` rather than `client` in the deps: rebuilding the detector mid-round
   * would throw away the window it is part-way through measuring.
   *
   * An EMPTY window is not sent. A window with no samples has a wobble of zero, which
   * looks like a flawless hold, and sending it refreshes the referee's `lastSeen` — so
   * a phone whose sensor has stopped would report a perfect score forever and never be
   * reaped for silence. Saying nothing is the honest answer, and the referee already
   * knows what to do with it.
   */
  useEffect(() => {
    if (!motionOn || !running || !iAmAlive) return;

    const detector = detectSteady();
    const timer = setInterval(() => {
      const c = clientRef.current;
      if (!c) return;
      const { w, held, samples } = detector.read();
      if (samples === 0) return;
      c.send({ t: 'wobble', d: { w, held, roundId: roundRef.current } });
    }, STEADY_TICK_MS);

    return () => {
      clearInterval(timer);
      detector.stop();
    };
  }, [motionOn, running, iAmAlive]);

  /** Straight out of the tap — see the file docblock. */
  async function enableMotion(): Promise<void> {
    setMotionAsked(true);
    const granted = await requestMotion();
    setMotionOn(granted);
    if (!granted) room.setError(text({ en: 'No motion access — you can watch, but not play this one.', fr: 'Pas d’accès au mouvement — vous pouvez regarder, mais pas jouer.' }));
  }

  /**
   * What Ready and Start hang the permission on. Always resolves true: a refusal is a
   * spectator seat here, not a locked door (spec §5), so it must not swallow the tap
   * — and asking a second time would spend the one re-ask device-capabilities.md §2
   * allows on somebody who has already said no.
   */
  async function ensureMotion(): Promise<boolean> {
    if (motionAsked || support === 'unsupported') return true;
    await enableMotion();
    return true;
  }

  /*
   * The result, on the shared end screen (core/ui/GameOver.tsx). Steady Hand used to drop
   * straight back to the lobby with the times hidden in the player list's tags, so the
   * answer to "how long did I last" was a badge beside somebody's avatar in a joining
   * screen.
   */
  if (state && state.phase === 'over') {
    const players = room.room?.players ?? [];
    // Longest survival first — the winner is whoever was still holding when the rest fell.
    const ranked = [...players].sort((a, b) => (state.times[b.id] ?? 0) - (state.times[a.id] ?? 0));
    return (
      <GameOverScreen
        room={room}
        onBeforeReady={ensureMotion}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        rows={ranked.map((p) => ({
          id: p.id,
          avatar: p.avatar,
          name: p.name,
          value: ((state.times[p.id] ?? 0) / 1000).toFixed(1),
          unit: text({ en: 's held', fr: 's tenues' }),
          // Struck through only for the ones actually knocked out, not for everyone who
          // is not the winner: a round can end with more than one hand still steady.
          ...(state.alive.includes(p.id) ? {} : { out: true }),
        }))}
        me={myId}
        winner={state.winner}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'steady', solo } })}
        canAct={room.isHost && enoughToStart(room.connected, [STEADY_MIN_PLAYERS, STEADY_MAX_PLAYERS], solo)}
      />
    );
  }

  if (state && running) {
    return (
      <SteadyScreen
        state={state}
        players={room.room?.players ?? []}
        myId={myId}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        accent={card.accent}
        now={() => client?.now() ?? Date.now()}
      />
    );
  }

  const enoughPlayers = enoughToStart(room.connected, [STEADY_MIN_PLAYERS, STEADY_MAX_PLAYERS], solo);

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
      canStart={room.isHost && enoughPlayers}
      startLabel={state ? t.common.playAgain : t.common.startRound}
      onStart={() => client?.send({ t: 'start', d: { mode: 'steady', solo } })}
      onBeforeReady={ensureMotion}
      playerTag={(id) => {
        if (!state) return null;
        if (state.winner === id) return text({ en: 'won', fr: 'gagnant' });
        const held = state.times[id];
        if (held === undefined) return null;
        return `${Math.round(held / 1000)}s`;
      }}
      extras={
        <>
          {/*
            The rule that eliminates people has to be read BEFORE the round, not
            discovered by being knocked out for it (spec §2.3). Its own visible panel,
            not folded into How to play, which now arrives collapsed for the host.
          */}
          <section class="panel steady-rule" role="note">
            <h2 class="panel__heading">{text({ en: 'The one rule', fr: 'La règle unique' })}</h2>
            <p class="steady-rule__body">
              {text({ en: 'Hold the phone ', fr: 'Tenez le téléphone ' })}<strong>{text({ en: 'up', fr: 'levé' })}</strong>,{' '}
              {text({ en: 'screen towards you. Resting it on a table or your lap ends your round — that is the one thing the game can tell you are doing.', fr: 'écran vers vous. Le poser sur une table ou sur vos genoux termine votre manche — c’est la seule chose que le jeu peut détecter.' })}
            </p>
          </section>

          <MotionPrimer
            support={support}
            on={motionOn}
            asked={motionAsked}
            isHost={room.isHost}
          />
        </>
      }
    />
  );
}

/**
 * The permission explanation, and the honest version of a refusal.
 *
 * No button of its own: this game has no fallback, so the prompt is fired by Ready or
 * Start instead (the file docblock, issue #29). The panel is still here and still
 * arrives first, because the rule that survives is the one that matters — a player
 * reads what the sensor is for BEFORE the system prompt lands on them. Never
 * auto-requested either: a prompt before the player knows what the game is gets
 * denied, and on iOS a denial is remembered, so asking early spends the permission
 * for good (docs/device-capabilities.md §2).
 */
function MotionPrimer({
  support,
  on,
  asked,
  isHost,
}: {
  support: MotionSupport;
  on: boolean;
  asked: boolean;
  isHost: boolean;
}): JSX.Element {
  const text = useGameText();
  const heading = text({ en: 'Holding still', fr: 'Rester immobile' });
  if (support === 'unsupported' || (asked && !on)) {
    return (
      <PermissionPrimer heading={heading} body={`${support === 'unsupported'
        ? text({ en: 'This phone has no motion sensor, so it cannot measure how still you are holding it.', fr: 'Ce téléphone n’a pas de capteur de mouvement et ne peut pas mesurer son immobilité.' })
        : text({ en: 'Motion was turned down, so this phone cannot measure how still you are holding it.', fr: 'L’accès au mouvement a été refusé, le téléphone ne peut donc pas mesurer son immobilité.' })} ${text(
        { en: 'There is no tap version of this one — holding a phone still is the whole game — so you can watch the round, and the meters are worth watching.', fr: 'Il n’existe pas de version tactile — tenir le téléphone immobile est le jeu — mais vous pouvez regarder la manche et ses jauges.' },
      )}`} />
    );
  }

  if (on) {
    return <PermissionPrimer heading={heading} enabled body={text(
      { en: 'Ready. Hold the phone up in front of you and try not to breathe.', fr: 'Prêt. Tenez le téléphone devant vous et essayez de ne plus respirer.' })} />;
  }

  return (
    <PermissionPrimer heading={heading}
      body={`${text({ en: 'Measuring how still you are holding the phone needs permission to read its motion. Nothing is recorded — the only thing sent is one number per fifth of a second, never the readings themselves.', fr: 'Mesurer l’immobilité du téléphone nécessite l’accès à son mouvement. Rien n’est enregistré — seul un nombre est envoyé cinq fois par seconde, jamais les mesures.' })} ${isHost
        ? text({ en: 'Start the round and your phone will ask.', fr: 'Démarrez la manche et votre téléphone vous le demandera.' })
        : text({ en: 'Tap Ready and your phone will ask.', fr: 'Touchez Prêt et votre téléphone vous le demandera.' })}`} />
  );
}
