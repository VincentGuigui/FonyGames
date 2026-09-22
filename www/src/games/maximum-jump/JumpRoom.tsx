import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  MAXJUMP_ATTEMPTS,
  MAXJUMP_JUMP_STEP,
  MAXJUMP_MAX_PLAYERS,
  MAXJUMP_MAX_SPEED,
  MAXJUMP_MIN_PLAYERS,
  MAXJUMP_RUNUP_CAP_MS,
  type MaximumJumpState,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { useGameRoom } from '../../core/room/useRoom';
import { useGameOrientation } from '../../core/screen';
import { useSoloTesting } from '../../core/useSolo';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { StatusBar } from '../../core/ui/StatusBar';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import { JumpCanvas } from './JumpCanvas';
import { pressJump, pressLeg, runFor, startAttempt, stepFlight, stepMs, tapRate, type Attempt, type Leg } from './jump';
import './maximum-jump.css';

/**
 * Maximum Jump's room screen. Spec: docs/specs/games/maximum-jump.md §4
 *
 * The physics is `jump.ts` and the drawing is `JumpCanvas.tsx`; this holds them
 * together and owns the one thing that reaches outside — the finished result
 * (spec §6). The attempt changes sixty times a second, so it lives in a ref and
 * the canvas reads it fresh each frame; Preact only re-renders when the *phase*
 * changes, which is a handful of times an attempt.
 */
export function JumpRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <JumpRoomInner game={card} code={code} />}</RoomGate>;
}

/** Where this phone is between attempts. */
type Stage = 'waiting' | 'running' | 'flying' | 'verdict' | 'spent';

function JumpRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [state, setState] = useState<MaximumJumpState | null>(null);

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'maximum-jump') setState(msg.d);
  }, []);

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const clientRef = useRef(room.client);
  clientRef.current = room.client;
  const myId = room.me?.id;

  // The lobby is portrait like every other; the board is sideways for as long
  // as a round is up. Grid Attack's own call, for the same reason (screen.ts).
  useGameOrientation(card.screen?.orientation, state !== null);

  const attemptRef = useRef<Attempt>(startAttempt());
  /**
   * The two leg buttons, written to directly by the frame loop.
   *
   * The whole run-up is timing against a beat the player cannot otherwise see —
   * the jumper's own leg animation is the cue, and at sprite size on a phone it
   * is not a cue at all. So the next leg's button fills up to the moment it is
   * due, which is the same information the animation carries, at a size a thumb
   * can act on (spec §4).
   */
  const legButtons = useRef<Record<Leg, HTMLButtonElement | null>>({ left: null, right: null });
  const tapsRef = useRef<number[]>([]);
  const sentRef = useRef(false);
  const [stage, setStage] = useState<Stage>('waiting');
  const [hud, setHud] = useState({ speed: 0, stepsLeft: MAXJUMP_JUMP_STEP, distance: 0 });
  const [nextLeg, setNextLeg] = useState<Leg>('left');
  const [verdict, setVerdict] = useState<string | null>(null);

  const roundId = state?.roundId;
  const phase = state?.phase;
  const mine = myId === undefined ? undefined : state?.jumpers[myId];
  const used = mine?.used ?? 0;

  /** Wind up for a fresh attempt. */
  const arm = useCallback(() => {
    attemptRef.current = startAttempt();
    tapsRef.current = [];
    sentRef.current = false;
    setNextLeg('left');
    setVerdict(null);
    setHud({ speed: 0, stepsLeft: MAXJUMP_JUMP_STEP, distance: 0 });
    setStage('running');
  }, []);

  // A fresh attempt whenever the round starts, and after each verdict clears.
  useEffect(() => {
    if (roundId === undefined || phase !== 'jumping') return;
    arm();
  }, [roundId, phase, arm]);

  /**
   * One frame. The run-up advances on its own — the legs buy speed, and the
   * speed is what carries the jumper — and the flight is stepped against the
   * live tap rate.
   */
  const onFrame = useCallback((dtMs: number) => {
    const a = attemptRef.current;
    const now = performance.now();

    if (a.phase === 'run') {
      const next = runFor(a, dtMs);
      attemptRef.current = next;
      setHud({ speed: next.speed, stepsLeft: Math.max(0, MAXJUMP_JUMP_STEP - next.atStep), distance: 0 });
      showBeat(next);
      // A jumper who never takes off fouls rather than holding the room up
      // (spec §7). Running past the line is already a foul; this is the one
      // who simply stops.
      if (next.t > MAXJUMP_RUNUP_CAP_MS) {
        attemptRef.current = { ...next, phase: 'foul', distance: 0 };
        finishAttempt();
      }
      return;
    }

    if (a.phase === 'flight') {
      const next = stepFlight(a, dtMs, tapRate(tapsRef.current, now));
      attemptRef.current = next;
      setHud((h) => ({ ...h, distance: next.x }));
      if (next.phase === 'landed') finishAttempt();
    }
  }, []);

  /** Fill the next leg's button up to the beat, and empty the other one. */
  const showBeat = useCallback((a: Attempt) => {
    const span = stepMs(a.speed);
    const left = Math.max(0, Math.min(1, a.lastLeg === null ? 1 : 1 - (a.beatAt - a.t) / span));
    const due: Leg = a.lastLeg === 'left' ? 'right' : 'left';
    for (const leg of ['left', 'right'] as const) {
      legButtons.current[leg]?.style.setProperty('--beat', `${(leg === due ? left : 0) * 100}%`);
    }
  }, []);

  /** Report the attempt and show what it was worth. */
  const finishAttempt = useCallback(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    const a = attemptRef.current;
    const s = stateRef.current;
    if (!s) return;

    clientRef.current?.send({
      t: 'jump-result',
      d: { roundId: s.roundId, attempt: (myIdRef.current ? s.jumpers[myIdRef.current]?.used ?? 0 : 0) + 1, speed: a.topSpeed, distance: a.distance },
    });
    setStage('verdict');
    setVerdict(
      a.phase === 'foul'
        ? text({ en: 'Over the line. Faceplant.', fr: 'Au-delà de la planche. Gamelle.' })
        : text({ en: `${a.distance.toFixed(2)} m`, fr: `${a.distance.toFixed(2)} m` }),
    );
  }, [text]);

  // Read inside the frame loop, which must not be rebuilt for every state.
  const stateRef = useRef(state);
  stateRef.current = state;
  const myIdRef = useRef(myId);
  myIdRef.current = myId;

  // The verdict holds for a beat, then the next attempt — or the wait for
  // everybody else's.
  useEffect(() => {
    if (stage !== 'verdict') return;
    const id = setTimeout(() => {
      if (used >= MAXJUMP_ATTEMPTS) setStage('spent');
      else arm();
    }, 1600);
    return () => clearTimeout(id);
  }, [stage, used, arm]);

  const legPress = useCallback((leg: Leg) => {
    const a = attemptRef.current;
    if (a.phase !== 'run') return;
    attemptRef.current = pressLeg(a, leg);
    setNextLeg(leg === 'left' ? 'right' : 'left');
  }, []);

  const jumpPress = useCallback(() => {
    const a = attemptRef.current;
    if (a.phase === 'run') {
      const next = pressJump(a);
      attemptRef.current = next;
      if (next.phase === 'foul') finishAttempt();
      else setStage('flying');
      return;
    }
    // In the air the same button is the flap: what holds the drag off.
    if (a.phase === 'flight') tapsRef.current.push(performance.now());
  }, [finishAttempt]);

  const players = room.room?.players ?? [];
  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  const avatarOf = (id: string): string => players.find((p) => p.id === id)?.avatar ?? '🙂';

  const start = useCallback(() => {
    clientRef.current?.send({ t: 'start', d: { mode: 'jump', solo } });
  }, [solo]);

  const canStart = room.isHost && enoughToStart(room.connected, [MAXJUMP_MIN_PLAYERS, MAXJUMP_MAX_PLAYERS], solo);

  if (state && state.phase === 'done') {
    const rows = Object.entries(state.jumpers)
      .sort((a, b) => b[1].best - a[1].best)
      .map(([id, j]) => ({
        id,
        avatar: avatarOf(id),
        name: nameOf(id),
        value: j.best > 0 ? `${j.best.toFixed(2)} m` : text({ en: 'no jump', fr: 'aucun saut' }),
        out: false,
      }));
    return (
      <GameOverScreen
        room={room}
        screen={card.screen}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        note={text({
          en: 'Best of three attempts. A faceplant still spends one.',
          fr: 'Le meilleur de trois essais. Une gamelle en consomme un quand même.',
        })}
        rows={rows}
        me={myId}
        winner={state.winner}
        onAgain={start}
        canAct={canStart}
      />
    );
  }

  if (state) {
    const now = clientRef.current?.now() ?? Date.now();
    const countdown = Math.max(0, Math.ceil((state.startsAt - now) / 1000));
    const attempt = Math.min(MAXJUMP_ATTEMPTS, used + 1);
    const airborne = stage === 'flying';
    const done = stage === 'spent';

    return (
      <div class="maxjump" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          status={text({ en: `Try ${attempt}/${MAXJUMP_ATTEMPTS}`, fr: `Essai ${attempt}/${MAXJUMP_ATTEMPTS}` })}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
        />

        <div class="maxjump__board">
          <JumpCanvas attempt={() => attemptRef.current} accent={card.accent} onFrame={onFrame} />

          <div class="maxjump__hud">
            <span class="maxjump__speed" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (hud.speed / MAXJUMP_MAX_SPEED) * 100)}%` }} />
            </span>
            <span>
              <b>{airborne ? hud.distance.toFixed(2) : Math.ceil(hud.stepsLeft)}</b>{' '}
              {airborne
                ? text({ en: 'm flown', fr: 'm parcourus' })
                : Math.ceil(hud.stepsLeft) === 1
                  ? text({ en: 'step to the line', fr: 'pas avant la planche' })
                  : text({ en: 'steps to the line', fr: 'pas avant la planche' })}
            </span>
            <span><b>{hud.speed.toFixed(1)}</b> {text({ en: 'm/s', fr: 'm/s' })}</span>
          </div>

          <div class="maxjump__controls">
            <button
              type="button"
              ref={(el) => { legButtons.current.left = el as HTMLButtonElement | null; }}
              class={`maxjump__btn ${nextLeg === 'left' && !airborne ? 'maxjump__btn--next' : ''}`}
              disabled={airborne || done}
              onPointerDown={() => legPress('left')}
            >
              <span>{text({ en: 'Left', fr: 'Gauche' })}</span>
            </button>
            <button
              type="button"
              class="maxjump__btn maxjump__btn--jump"
              disabled={done || stage === 'verdict'}
              onPointerDown={jumpPress}
            >
              {airborne ? text({ en: 'Tap! Tap!', fr: 'Tapez !' }) : text({ en: 'Jump', fr: 'Sauter' })}
            </button>
            <button
              type="button"
              ref={(el) => { legButtons.current.right = el as HTMLButtonElement | null; }}
              class={`maxjump__btn ${nextLeg === 'right' && !airborne ? 'maxjump__btn--next' : ''}`}
              disabled={airborne || done}
              onPointerDown={() => legPress('right')}
            >
              <span>{text({ en: 'Right', fr: 'Droite' })}</span>
            </button>
          </div>

          <p class="visually-hidden" aria-live="polite">
            {text({
              en: `${hud.speed.toFixed(1)} metres a second, ${Math.ceil(hud.stepsLeft)} steps to the line`,
              fr: `${hud.speed.toFixed(1)} mètres par seconde, ${Math.ceil(hud.stepsLeft)} pas avant la planche`,
            })}
          </p>

          {verdict && <p class="maxjump__verdict" aria-live="assertive">{verdict}</p>}
          {done && !verdict && (
            <p class="maxjump__verdict">{text({ en: 'Three done. Waiting for the rest.', fr: 'Trois essais faits. On attend les autres.' })}</p>
          )}
          {countdown > 0 && <p class="maxjump__countdown" aria-live="assertive">{countdown}</p>}
        </div>

        <div class="maxjump__ladder">
          {Object.entries(state.jumpers).map(([id, j]) => (
            <span key={id}>{avatarOf(id)} <b>{j.best > 0 ? text({ en: `${j.best.toFixed(2)} m`, fr: `${j.best.toFixed(2)} m` }) : '—'}</b></span>
          ))}
        </div>
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
      canStart={canStart}
      startLabel={t.common.startRound}
      onStart={start}
    />
  );
}
