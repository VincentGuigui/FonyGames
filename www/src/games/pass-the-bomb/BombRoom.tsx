import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  BOMB_CLASSIC_ROUNDS,
  BOMB_MAX_PLAYERS,
  BOMB_MIN_PLAYERS,
  type BombMatch,
  type Player,
  type PlayerId,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { soloTesting } from '../../core/solo';
import { useRoom, useShareRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { detectBumps } from '../../core/sensors/bump';
import { motionSupport, requestMotion, type MotionSupport } from '../../core/sensors/motion';
import { applyBomb, type BombState } from './game';
import { BombScreen } from './BombScreen';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { BOOM_MS } from './shockwave';

/**
 * Pass the Bomb's room screen. Spec: docs/specs/games/pass-the-bomb.md
 *
 * The first game in the catalogue that needs a **sensor permission**, so it is also the first
 * that has to ask for one without being obnoxious about it. Two rules shape this file:
 *
 * 1. `requestMotion()` must be called straight out of a tap handler — iOS refuses it otherwise,
 *    and refuses it silently after an `await` (docs/device-capabilities.md §2). So the primer is
 *    a button, and the request is the first thing its handler does.
 * 2. Nothing is asked for on arrival. The lobby explains the game and the safety line first; the
 *    permission is requested when the player opts in, and the game is fully playable if they
 *    never do (spec §5, §11).
 */
export function BombRoom(props: { game: GameCard }): JSX.Element {
  return (
    <RoomGate game={props.game}>
      {(code, card) => <BombRoomInner game={card} code={code} />}
    </RoomGate>
  );
}

function BombRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const [state, setState] = useState<BombState>(null);
  /** Server time until which our bumps are being ignored, from a `calm-down` frame. */
  const [mutedUntil, setMutedUntil] = useState(0);
  const [support] = useState<MotionSupport>(motionSupport);
  const [motionOn, setMotionOn] = useState(false);
  const [motionAsked, setMotionAsked] = useState(false);

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'calm-down') {
      setMutedUntil(msg.d.untilServerTime);
      return;
    }
    setState((prev) => applyBomb(prev, msg, Date.now()));
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

  /*
   * The round is over — hold the explosion before dropping to the lobby.
   *
   * Without this the room switched on `running` alone, so the boom that ENDED a round was
   * never drawn: the phase flipped and the standings appeared in the same frame the bomb
   * went off. In a multi-player round that hid the last explosion; in a solo round it hid
   * the only one, which is how this was noticed.
   *
   * Computed from the clock rather than held in state, so the first render after the
   * final boom already knows to stay — a `useEffect` that sets a flag would show one
   * frame of the lobby first, which is exactly the flicker being fixed.
   */
  const finalBoomAt = state?.phase === 'over' ? (state.lastBoom?.at ?? null) : null;
  const [, tickBoom] = useState(0);
  useEffect(() => {
    if (finalBoomAt === null) return;
    const left = BOOM_MS - (Date.now() - finalBoomAt);
    if (left <= 0) return;
    const timer = setTimeout(() => tickBoom((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [finalBoomAt]);
  const holdingBoom = finalBoomAt !== null && Date.now() - finalBoomAt < BOOM_MS;
  const iAmAlive = !!myId && !!state && state.alive.includes(myId);

  /*
   * The motion listener exists only while this phone is actually in a live round (spec §5). A
   * leaked `devicemotion` listener drains a battery for nothing, and `onMotion` already drops it
   * while the tab is hidden.
   *
   * `clientRef` rather than `client` in the dependency list: re-running this effect would build a
   * new detector, and a detector's first job is to establish what "calm" looks like — restarting
   * it mid-round would swallow the next bump.
   */
  const clientRef = useRef(client);
  clientRef.current = client;
  const roundRef = useRef(state?.roundId ?? 0);
  roundRef.current = state?.roundId ?? 0;

  useEffect(() => {
    if (!motionOn || !running || !iAmAlive) return;

    const detector = detectBumps((at) => {
      const c = clientRef.current;
      if (!c) return;
      /*
       * The sensor stamps a bump with `performance.now()`; the referee pairs bumps in server
       * time within ±250 ms. Converting through the elapsed-since-the-spike offset keeps the
       * *interval* intact, which is the only thing pairing depends on — sending a raw
       * `performance.now()` would land tens of thousands of seconds in the past and never pair.
       */
      const serverAt = c.now() - (performance.now() - at);
      c.send({ t: 'bump', d: { at: serverAt, roundId: roundRef.current } });

      // Confirms the phone felt it, on a screen you are not looking at. Absent on iOS, where
      // spec §5 leaves the tension to sound and the flash.
      navigator.vibrate?.(30);
    });

    return () => detector.stop();
  }, [motionOn, running, iAmAlive]);

  /** Straight out of the tap: see rule 1 in the file docblock. */
  async function enableMotion(): Promise<void> {
    setMotionAsked(true);
    const granted = await requestMotion();
    setMotionOn(granted);
    if (!granted) {
      room.setError('No motion access — you can still pass with a tap.');
    }
  }

  const muted = mutedUntil > (client?.now() ?? Date.now());

  if (state && (running || holdingBoom)) {
    return (
      <BombScreen
        state={state}
        players={room.room?.players ?? []}
        myId={myId}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        accent={card.accent}
        canBump={motionOn}
        muted={muted}
        onPass={(to: PlayerId) =>
          client?.send({ t: 'pass', d: { to, roundId: state.roundId } })
        }
      />
    );
  }

  /*
   * The result, once the explosion has been seen.
   *
   * It comes AFTER the `holdingBoom` branch above on purpose: the bomb going off is the
   * ending, and cutting to a scoreboard over the top of it is what this game spent a fix
   * on already.
   *
   * What the column says is the MATCH, not the round — rounds won, whether that is out of
   * three short ones or the single long one. The round it just played is on the headline
   * ("Ana takes the round"), and the standings are the thing anyone actually leans over to
   * read.
   */
  if (state && state.phase === 'over') {
    const players = room.room?.players ?? [];
    const m = state.match;
    const standing = (id: PlayerId): number => m.wins[id] ?? 0;
    // Best first, and stable within a tie so the room order shows through rather than the
    // list reshuffling itself between rounds for no reason.
    const ranked = [...players].sort((a, b) => standing(b.id) - standing(a.id));
    const start = (): void => void client?.send({ t: 'start', d: { mode: 'bomb', solo } });
    const another = !m.done;
    // The single long round for three or more IS the elimination — everyone it leaves
    // behind was out for the rest of the match, not just that trip round the circle, so
    // the end panel says so. A duel's round-loser stays in for the next of the three.
    const eliminates = m.rounds === BOMB_CLASSIC_ROUNDS;

    return (
      <GameOverScreen
        room={room}
        readyBlocked={support !== 'unsupported' && !motionAsked}
        onReadySetup={enableMotion}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        /*
         * No word on the bar. It said "Boom", which arrived a beat after two seconds of
         * full-screen explosion had said the same thing louder — the one always-visible
         * slot spent restating what the player had just watched. Empty rather than
         * removed: `StatusBar` skips the line when there is nothing to say and keeps the
         * gear menu, which is the half of the bar that has to stay reachable.
         */
        status=""
        rows={ranked.map((p) => {
          const n = standing(p.id);
          return {
            id: p.id,
            avatar: p.avatar,
            name: p.name,
            value: n,
            unit: n === 1 ? 'round' : 'rounds',
            ...(eliminates && !state.alive.includes(p.id) ? { out: true } : {}),
          };
        })}
        me={myId}
        winner={another ? state.winner : m.champion}
        headline={another ? roundHeadline(state.winner, myId, players) : undefined}
        note={matchNote(m)}
        {...(another
          ? { onNext: start, nextLabel: t.common.nextRound }
          : { onAgain: start })}
        canAct={room.isHost && enoughToStart(room.connected, [BOMB_MIN_PLAYERS, BOMB_MAX_PLAYERS], solo)}
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
      canStart={room.isHost && enoughToStart(room.connected, [BOMB_MIN_PLAYERS, BOMB_MAX_PLAYERS], solo)}
      startLabel={state ? t.common.playAgain : t.common.startRound}
      onStart={() => client?.send({ t: 'start', d: { mode: 'bomb', solo } })}
      readyBlocked={support !== 'unsupported' && !motionAsked}
      note={note(room.isHost, room.connected, solo)}
      playerTag={(id) => {
        if (!state) return null;
        if (state.winner === id) return 'won';
        return state.alive.includes(id) ? null : 'out';
      }}
      extras={
        <>
          {/*
            Spec §9 requires the safety line in the lobby, and it has to be VISIBLE there.
            It started life in the `aside` slot, which renders inside How to play — a panel that
            now arrives collapsed for whoever came through the chooser, so the one instruction
            that keeps people from cracking their phones together was hidden behind a tap. It
            lives in its own always-open panel, above the primer, as the spec orders it.
          */}
          <section class="panel safety" role="note">
            <h2 class="panel__heading">Before you start</h2>
            <p class="safety__body">
              Tap phones <strong>gently</strong>, corner to corner. Keep your cases on. Stand
              still — no running, no throwing.
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
 * The permission primer, and the honest version of what happens if you say no.
 *
 * Never auto-requested. A prompt that appears before the player knows what the game is gets
 * denied, and on iOS a denial is remembered — so asking early costs the permission permanently
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
  if (support === 'unsupported') {
    return (
      <section class="panel primer">
        <h2 class="panel__heading">Passing the bomb</h2>
        <p class="primer__body">
          This phone has no motion sensor, so bumping won't register. You can still play — the
          bomb passes with a tap, and the round works the same way.
        </p>
      </section>
    );
  }

  if (on) {
    return (
      <section class="panel primer">
        <h2 class="panel__heading">Passing the bomb</h2>
        <p class="primer__body primer__body--on">
          Bumping is on. Knock your phone gently against someone else's to pass it.
        </p>
      </section>
    );
  }

  return (
    <section class="panel primer">
      <h2 class="panel__heading">Passing the bomb</h2>
      <p class="primer__body">
        {asked
          ? 'Motion was turned down, so bumping is off. Tap-to-pass still works — or allow motion in your browser settings and reload.'
          : 'Bumping needs permission to read this phone’s motion. Nothing is recorded — the only thing sent is “a bump happened”, never the readings themselves.'}
      </p>
      <button class="btn btn--primary primer__enable" type="button" onClick={onEnable}>
        {asked ? 'Try again' : 'Turn on bumping'}
      </button>
      <p class="primer__opt-out">Rather not? Tap-to-pass is always available in the round.</p>
    </section>
  );
}

/**
 * The line over a mid-match panel.
 *
 * Deliberately not "X won": the panel under it is showing the MATCH, and a player who has
 * just taken the second of five rounds has not won anything yet. Two words of difference,
 * and it is the difference between a scoreboard that reads and one that misleads.
 */
function roundHeadline(winner: PlayerId | null, me: PlayerId | undefined, players: Player[]): string {
  if (winner === null) return 'Nobody survived that one';
  if (winner === me) return 'You take the round';
  return `${players.find((p) => p.id === winner)?.name ?? 'Someone'} takes the round`;
}

/** Where the match is up to, under the standings. */
function matchNote(m: BombMatch): string {
  if (m.done) return m.rounds === BOMB_CLASSIC_ROUNDS ? 'Last one standing' : `${m.rounds} rounds played`;
  return `Round ${m.round} of ${m.rounds}`;
}

function note(isHost: boolean, connected: number, solo: boolean): string {
  if (!solo && connected < BOMB_MIN_PLAYERS) {
    const missing = BOMB_MIN_PLAYERS - connected;
    return `Need ${missing} more player${missing === 1 ? '' : 's'} — it takes ${BOMB_MIN_PLAYERS} to pass a bomb around.`;
  }
  if (connected > BOMB_MAX_PLAYERS) {
    return `${BOMB_MAX_PLAYERS} players is the most this one takes.`;
  }
  if (!isHost) return 'The host starts the round.';
  return 'Stand in a circle, arms out. The fuse is hidden.';
}
