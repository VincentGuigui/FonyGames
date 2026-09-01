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
import { useSoloTesting } from '../../core/useSolo';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { detectBumps } from '../../core/sensors/bump';
import { motionSupport, requestMotion, type MotionSupport } from '../../core/sensors/motion';
import { applyBomb, type BombState } from './game';
import { BombScreen } from './BombScreen';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { BOOM_MS } from './shockwave';
import { heartbeatBpm, prepareHeartbeatAudio, setSoundOn, soundOn, startHeartbeatLoop, stopHeartbeatLoop } from './heartbeat';
import { useGameText, type GameText } from '../../core/i18n/gameText';
import { PermissionPrimer } from '../../core/ui/PermissionPrimer';

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
  const text = useGameText();
  const [state, setState] = useState<BombState>(null);
  /** Server time until which our bumps are being ignored, from a `calm-down` frame. */
  const [mutedUntil, setMutedUntil] = useState(0);
  const [support] = useState<MotionSupport>(motionSupport);
  const [motionOn, setMotionOn] = useState(false);
  const [motionAsked, setMotionAsked] = useState(false);
  const [sound, setSound] = useState(soundOn);

  useEffect(() => {
    prepareHeartbeatAudio();
  }, []);

  useEffect(() => {
    setSoundOn(sound);
  }, [sound]);

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
  const solo = useSoloTesting();

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
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
   * The rising heartbeat (issue #12): starts at 60 BPM and climbs 15 BPM per pass, restarted
   * at the new tempo every time `passes` ticks up rather than left running — a `setInterval`
   * cannot change its own period, so a faster heartbeat means a new one. Silent once eliminated
   * (spec §2 step 4: a spectator is no longer in any danger the tension is for) or once the
   * round stops running at all.
   */
  const passes = state?.passes ?? 0;
  useEffect(() => {
    if (!running || !iAmAlive) {
      stopHeartbeatLoop();
      return;
    }
    startHeartbeatLoop(heartbeatBpm(passes));
    return () => stopHeartbeatLoop();
  }, [running, iAmAlive, passes, sound]);

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
      room.setError(text({ en: 'No motion access — you can still pass with a tap.', fr: 'Pas d’accès au mouvement — vous pouvez toujours passer la bombe en touchant l’écran.' }));
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
        sound={sound}
        onSound={setSound}
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
            unit: n === 1 ? text({ en: 'round', fr: 'manche' }) : text({ en: 'rounds', fr: 'manches' }),
            ...(eliminates && !state.alive.includes(p.id) ? { out: true } : {}),
          };
        })}
        me={myId}
        winner={another ? state.winner : m.champion}
        headline={another ? roundHeadline(state.winner, myId, players, text) : undefined}
        note={matchNote(m, text)}
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
      note={note(room.isHost, room.connected, solo, text)}
      playerTag={(id) => {
        if (!state) return null;
        if (state.winner === id) return text({ en: 'won', fr: 'gagnant' });
        return state.alive.includes(id) ? null : text({ en: 'out', fr: 'éliminé' });
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
            <h2 class="panel__heading">{text({ en: 'Before you start', fr: 'Avant de commencer' })}</h2>
            <p class="safety__body">
              {text({ en: 'Tap phones ', fr: 'Touchez les téléphones ' })}<strong>{text({ en: 'gently', fr: 'doucement' })}</strong>,{' '}
              {text({ en: 'corner to corner. Keep your cases on. Stand still — no running, no throwing.', fr: 'coin contre coin. Gardez les coques. Restez immobile — ne courez pas et ne lancez rien.' })}
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
  const text = useGameText();
  const heading = text({ en: 'Passing the bomb', fr: 'Passer la bombe' });
  if (support === 'unsupported') {
    return <PermissionPrimer heading={heading} body={text(
      { en: "This phone has no motion sensor, so bumping won't register. You can still play — the bomb passes with a tap, and the round works the same way.", fr: 'Ce téléphone n’a pas de capteur de mouvement. Vous pouvez quand même jouer — touchez l’écran pour passer la bombe.' })} />;
  }

  if (on) {
    return <PermissionPrimer heading={heading} enabled body={text(
      { en: "Bumping is on. Knock your phone gently against someone else's to pass it.", fr: 'Le contact est activé. Touchez doucement le téléphone de quelqu’un pour passer la bombe.' })} />;
  }

  return (
    <PermissionPrimer heading={heading}
      body={asked
        ? text({ en: 'Motion was turned down, so bumping is off. Tap-to-pass still works — or allow motion in your browser settings and reload.', fr: 'L’accès au mouvement a été refusé. Le passage tactile fonctionne toujours — ou autorisez le mouvement dans le navigateur puis rechargez.' })
        : text({ en: 'Bumping needs permission to read this phone’s motion. Nothing is recorded — the only thing sent is “a bump happened”, never the readings themselves.', fr: 'Le contact nécessite l’accès au mouvement du téléphone. Rien n’est enregistré — seul « un contact a eu lieu » est envoyé, jamais les mesures.' })}
      action={{ label: asked ? text({ en: 'Try again', fr: 'Réessayer' }) : text({ en: 'Turn on bumping', fr: 'Activer le contact' }), onClick: onEnable }}
      optOut={text({ en: 'Rather not? Tap-to-pass is always available in the round.', fr: 'Vous préférez éviter ? Le passage tactile reste disponible pendant la manche.' })} />
  );
}

/**
 * The line over a mid-match panel.
 *
 * Deliberately not "X won": the panel under it is showing the MATCH, and a player who has
 * just taken the second of five rounds has not won anything yet. Two words of difference,
 * and it is the difference between a scoreboard that reads and one that misleads.
 */
function roundHeadline(winner: PlayerId | null, me: PlayerId | undefined, players: Player[], text: GameText): string {
  if (winner === null) return text({ en: 'Nobody survived that one', fr: 'Personne n’a survécu' });
  if (winner === me) return text({ en: 'You take the round', fr: 'Vous remportez la manche' });
  const name = players.find((p) => p.id === winner)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  return text({ en: `${name} takes the round`, fr: `${name} remporte la manche` });
}

/** Where the match is up to, under the standings. */
function matchNote(m: BombMatch, text: GameText): string {
  if (m.done) return m.rounds === BOMB_CLASSIC_ROUNDS ? text({ en: 'Last one standing', fr: 'Dernier survivant' })
    : text({ en: `${m.rounds} rounds played`, fr: `${m.rounds} manches jouées` });
  return text({ en: `Round ${m.round} of ${m.rounds}`, fr: `Manche ${m.round} sur ${m.rounds}` });
}

function note(isHost: boolean, connected: number, solo: boolean, text: GameText): string {
  if (!solo && connected < BOMB_MIN_PLAYERS) {
    const missing = BOMB_MIN_PLAYERS - connected;
    return text({ en: `Need ${missing} more player${missing === 1 ? '' : 's'} — it takes ${BOMB_MIN_PLAYERS} to pass a bomb around.`, fr: `Il manque ${missing} joueur${missing === 1 ? '' : 's'} — il faut être ${BOMB_MIN_PLAYERS} pour faire circuler la bombe.` });
  }
  if (connected > BOMB_MAX_PLAYERS) {
    return text({ en: `${BOMB_MAX_PLAYERS} players is the most this one takes.`, fr: `${BOMB_MAX_PLAYERS} joueurs maximum.` });
  }
  if (!isHost) return text({ en: 'The host starts the round.', fr: "L’hôte démarre la manche." });
  return text({ en: 'Stand in a circle, arms out. The fuse is hidden.', fr: 'Placez-vous en cercle, bras tendus. La mèche est cachée.' });
}
