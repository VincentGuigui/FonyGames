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
import { soloTesting } from '../../core/solo';
import { useRoom, useShareRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { detectSteady } from '../../core/sensors/steady';
import { motionSupport, requestMotion, type MotionSupport } from '../../core/sensors/motion';
import { applySteady, type SteadyState } from './game';
import { SteadyScreen } from './SteadyScreen';
import { GameOverScreen } from '../../core/ui/GameOver';

/**
 * Steady Hand's room screen. Spec: docs/specs/games/steady-hand.md
 *
 * The second game to need a motion permission, and it follows Pass the Bomb's pattern
 * exactly: nothing is requested on arrival, the primer is a button, and
 * `requestMotion()` is the first thing its handler does — iOS refuses the prompt
 * outside a user gesture and remembers a denial.
 *
 * Where it differs is that there is **no fallback** (spec §5). "Hold a phone still" has
 * no touch equivalent, so a player without motion access spectates, and the lobby says
 * so before anyone starts rather than after they are stuck.
 */
export function SteadyRoom(props: { game: GameCard }): JSX.Element {
  return (
    <RoomGate game={props.game}>
      {(code, card) => <SteadyRoomInner game={card} code={code} />}
    </RoomGate>
  );
}

function SteadyRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
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
  const solo = soloTesting();

  const room = useRoom(code, card.slug, onGame);
  const { joinUrl, copied, showQr, share, toggleQr } = useShareRoom(code, card.title, room.setError);
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
    if (!granted) room.setError('No motion access — you can watch, but not play this one.');
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
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        status="Round over"
        rows={ranked.map((p) => ({
          id: p.id,
          avatar: p.avatar,
          name: p.name,
          value: ((state.times[p.id] ?? 0) / 1000).toFixed(1),
          unit: 's held',
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
      startLabel={state ? 'Play again' : 'Start round'}
      onStart={() => client?.send({ t: 'start', d: { mode: 'steady', solo } })}
      note={note(room.isHost, room.connected, motionOn, solo)}
      playerTag={(id) => {
        if (!state) return null;
        if (state.winner === id) return 'won';
        const t = state.times[id];
        if (t === undefined) return null;
        return `${Math.round(t / 1000)}s`;
      }}
      extras={
        <>
          {/*
            The rule that eliminates people has to be read BEFORE the round, not
            discovered by being knocked out for it (spec §2.3). Its own visible panel,
            not folded into How to play, which now arrives collapsed for the host.
          */}
          <section class="panel steady-rule" role="note">
            <h2 class="panel__heading">The one rule</h2>
            <p class="steady-rule__body">
              Hold the phone <strong>up</strong>, screen towards you. Resting it on a table
              or your lap ends your round — that is the one thing the game can tell you
              are doing.
            </p>
          </section>

          <MotionPrimer
            support={support}
            on={motionOn}
            asked={motionAsked}
            onEnable={enableMotion}
          />
        </>
      }
    />
  );
}

/**
 * The permission primer, and the honest version of a refusal.
 *
 * Never auto-requested: a prompt before the player knows what the game is gets denied,
 * and on iOS a denial is remembered, so asking early spends the permission for good
 * (docs/device-capabilities.md §2).
 */
function MotionPrimer({
  support,
  on,
  asked,
  onEnable,
}: {
  support: MotionSupport;
  on: boolean;
  asked: boolean;
  onEnable: () => void;
}): JSX.Element {
  if (support === 'unsupported' || (asked && !on)) {
    return (
      <section class="panel primer">
        <h2 class="panel__heading">Holding still</h2>
        <p class="primer__body">
          {support === 'unsupported'
            ? 'This phone has no motion sensor, so it cannot measure how still you are holding it.'
            : 'Motion was turned down, so this phone cannot measure how still you are holding it.'}{' '}
          There is no tap version of this one — holding a phone still is the whole game — so
          you can watch the round, and the meters are worth watching.
        </p>
      </section>
    );
  }

  if (on) {
    return (
      <section class="panel primer">
        <h2 class="panel__heading">Holding still</h2>
        <p class="primer__body primer__body--on">
          Ready. Hold the phone up in front of you and try not to breathe.
        </p>
      </section>
    );
  }

  return (
    <section class="panel primer">
      <h2 class="panel__heading">Holding still</h2>
      <p class="primer__body">
        Measuring how still you are holding the phone needs permission to read its motion.
        Nothing is recorded — the only thing sent is one number per fifth of a second,
        never the readings themselves.
      </p>
      <button class="btn btn--primary primer__enable" type="button" onClick={onEnable}>
        Turn on the meter
      </button>
    </section>
  );
}

function note(isHost: boolean, connected: number, motionOn: boolean, solo: boolean): string {
  if (!solo && connected < STEADY_MIN_PLAYERS) {
    const missing = STEADY_MIN_PLAYERS - connected;
    return `Need ${missing} more player${missing === 1 ? '' : 's'} — being still alone proves nothing.`;
  }
  if (connected > STEADY_MAX_PLAYERS) return `${STEADY_MAX_PLAYERS} players is the most this one takes.`;
  if (!isHost) return 'The host starts the round.';
  if (!motionOn) return 'Turn on the meter above, or start and watch.';
  return 'Arms out. It gets harder the longer it goes on.';
}
