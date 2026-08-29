import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useGameRoom } from '../../core/room/useRoom';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import { useSoloTesting } from '../../core/useSolo';
import { enoughToStart } from '../../../../shared/players';
import {
  FIGHT_COUNTDOWN_STEP_MS,
  FIGHT_COUNTDOWN_STEPS,
  FIGHT_VS_FADE_MS,
  FIGHT_VS_MS,
  FIGHTER_ACTIONS,
  REVEAL_LEAD_MS,
  type FighterAction,
  type FighterSeat,
} from '../../../../shared/tapFighter';
import type { Player, ServerMessage, TapFighterState } from '../../../../shared/protocol';
import { playOutcomeSound } from '../../core/audio/outcome';
import { StatusBar } from '../../core/ui/StatusBar';
import {
  ACTION_POSE,
  FIGHTER_COLORS,
  FIGHTER_POSES,
  FIGHTER_SPRITE_COLUMNS,
  FIGHTER_SPRITE_MIRRORED,
  FIGHTER_WINDUP_MS,
  idleWindupPose,
} from './game';
import { FightCanvas } from './FightCanvas';

/** How long a tapped move flashes in the big preview before settling back to idle. */
const POSE_FLASH_MS = 500;

const BLUE: FighterSeat = 'blue';
const GREEN: FighterSeat = 'green';

export function TapFighterRoom({ game }: { game: GameCard }): JSX.Element {
  return <RoomGate game={game}>{(code, card) => <Inner code={code} game={card} />}</RoomGate>;
}

function Inner({ code, game }: { code: string; game: GameCard }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [state, setState] = useState<TapFighterState | null>(null);
  const onGame = useCallback((message: ServerMessage) => { if (message.t === 'fighter') setState(message.d); }, []);
  const connection = useGameRoom(code, game, onGame);
  const room = connection.room;
  const players = room.room?.players ?? [];
  const me = room.me?.id ?? null;
  const client = room.client;
  const clock = useCallback(() => client?.now() ?? Date.now(), [client]);
  const start = () => client?.send({ t: 'start', d: { mode: 'fighter', solo } });

  if (!state) {
    return <GameLobby card={game} code={code} joinUrl={connection.joinUrl} room={room} copied={connection.copied} showQr={connection.showQr} onShare={connection.share} onToggleQr={connection.toggleQr}
      canStart={room.isHost && enoughToStart(room.connected, [2, 2], solo)} startLabel={t.common.startRound} onStart={start}
      note={room.isHost ? text({ en: 'Two fighters. Six secret moves each.', fr: 'Deux combattants. Six attaques secrètes chacun.' }) : text({ en: 'The host starts the match.', fr: 'L’hôte démarre le match.' })}
      playerTag={(id) => players.findIndex((player) => player.id === id) === 0 ? text({ en: 'Blue', fr: 'Bleu' }) : text({ en: 'Green', fr: 'Vert' })} />;
  }

  if (state.phase === 'match-over') {
    const winnerId = state.matchWinner ? state.seats[state.matchWinner] : null;
    return <GameOverScreen accent={game.accent} title={game.title} concept={game.concept} rules={game.rules} slug={game.slug} winner={winnerId}
      rows={seatRows(state, players, text)} me={me} onAgain={start} canAct={room.isHost} />;
  }

  if (state.phase === 'planning') {
    return <PlanScreen game={game} state={state} players={players} me={me} onLock={(seat, actions) => client?.send({ t: 'fighter-lock', d: { roundId: state.roundId, seat, actions } })} />;
  }

  return <FightScreen game={game} state={state} players={players} me={me} isHost={room.isHost} onNext={start} clock={clock} />;
}

function PlanScreen({ game, state, players, me, onLock }: { game: GameCard; state: TapFighterState; players: Player[]; me: string | null; onLock: (seat: FighterSeat, actions: FighterAction[]) => void }): JSX.Element {
  const text = useGameText();
  const seat: FighterSeat = state.solo ? (!state.ready.blue ? 'blue' : 'green') : state.seats.blue === me ? 'blue' : 'green';
  const [actions, setActions] = useState<FighterAction[]>([]);
  useEffect(() => setActions([]), [state.roundId, seat]);
  const locked = state.ready[seat];
  const flashPose = usePoseFlash();
  const idlePose = useIdleRhythm();
  const opponent: FighterSeat = seat === 'blue' ? 'green' : 'blue';
  const name = players.find((player) => player.id === state.seats[seat])?.name ?? text({ en: 'Fighter', fr: 'Combattant' });
  const actionName = (action: FighterAction) => ({ punch: text({ en: 'Punch', fr: 'Poing' }), kick: text({ en: 'Kick', fr: 'Pied' }), jump: text({ en: 'Jump', fr: 'Saut' }), crouch: text({ en: 'Crouch', fr: 'Baisser' }) })[action];
  return <main class="fighter-plan" style={{ '--fighter-accent': seat === 'blue' ? FIGHTER_COLORS.blue : FIGHTER_COLORS.green } as JSX.CSSProperties}>
    <StatusBar status={text({ en: 'Planning', fr: 'Préparation' })} title={game.title} concept={game.concept} rules={game.rules} />
    <header><h1>{text({ en: `${name}, choose your moves`, fr: `${name}, choisissez vos actions` })}</h1><p>{locked ? text({ en: 'Locked in. Waiting for the other fighter…', fr: 'Séquence validée. En attente de l’autre combattant…' }) : text({ en: 'Build a secret sequence of six actions.', fr: 'Composez une séquence secrète de six actions.' })}</p></header>
    <FighterSprite seat={seat} pose={flashPose.pose ?? idlePose} />
    <ol class="fighter-sequence" aria-label={text({ en: 'Your six actions', fr: 'Vos six actions' })}>{Array.from({ length: 6 }, (_, index) => <li><button type="button" disabled={locked || actions[index] === undefined} aria-label={actions[index] ? actionName(actions[index]) : String(index + 1)} onClick={() => setActions(actions.filter((_, i) => i !== index))}>{actions[index] ? <FighterSprite seat={seat} pose={ACTION_POSE[actions[index]]} tiny /> : String(index + 1)}</button></li>)}</ol>
    <div class="fighter-actions">{FIGHTER_ACTIONS.map((action) => <button type="button" disabled={locked || actions.length >= 6} onClick={() => { setActions([...actions, action]); flashPose.show(ACTION_POSE[action]); }}><FighterSprite seat={seat} pose={ACTION_POSE[action]} small /><span>{actionName(action)}</span></button>)}</div>
    <button class="fighter-fight-button" type="button" disabled={locked || actions.length !== 6} onClick={() => onLock(seat, actions)}>{text({ en: 'FIGHT', fr: 'COMBAT' })}</button>
    <p class="fighter-opponent-state">{state.ready[opponent] ? text({ en: 'Opponent ready', fr: 'Adversaire prêt' }) : text({ en: 'Opponent choosing…', fr: 'Adversaire en réflexion…' })}</p>
  </main>;
}

function FightScreen({ game, state, players, me, isHost, onNext, clock }: { game: GameCard; state: TapFighterState; players: Player[]; me: string | null; isHost: boolean; onNext: () => void; clock: () => number }): JSX.Element {
  const text = useGameText();
  const now = useFightClock(state.phase === 'fighting', clock);
  const elapsed = Math.min(now - state.startsAt, Math.max(0, state.endsAt - state.startsAt - 1));
  const beatMs = 2_500;
  /**
   * Every beat plays in two equal halves: the action, then the reaction. Whoever's
   * action landed this beat shows their hit pose for the second half; whoever wasn't
   * hit just keeps the pose their own action left them in — there is no separate
   * "settle back to idle" step mid-beat, only at the very start of the next one.
   */
  const halfBeat = beatMs / 2;
  // Negative while the reveal (VS, countdown, FIGHT) plays: no beat has landed yet.
  const beatIndex = elapsed < 0 || state.beats.length === 0 ? -1 : Math.min(state.beats.length - 1, Math.floor(elapsed / beatMs));
  const beat = beatIndex >= 0 ? state.beats[beatIndex] : undefined;
  const withinBeat = elapsed >= 0 ? elapsed % beatMs : 0;
  const contact = elapsed >= 0 && withinBeat >= halfBeat;
  const previous = beatIndex > 0 ? state.beats[beatIndex - 1] : undefined;
  const health = state.phase === 'fighting' && !contact ? { blue: previous?.blueHealth ?? 100, green: previous?.greenHealth ?? 100 } : { blue: beat?.blueHealth ?? 100, green: beat?.greenHealth ?? 100 };
  const pose = (seat: FighterSeat) => {
    if (state.phase !== 'fighting' && health[seat] <= 0) return FIGHTER_POSES.defeated;
    const action = beat?.[seat === 'blue' ? 'blueAction' : 'greenAction'];
    if (!action) return FIGHTER_POSES.idle1;
    // Before the action itself: idle 1-2-1-2, the same wind-up every beat gets.
    if (withinBeat < FIGHTER_WINDUP_MS) return idleWindupPose(withinBeat);
    const reacting = contact && beat?.[seat === 'blue' ? 'blueHit' : 'greenHit'];
    return reacting ? FIGHTER_POSES.hit : ACTION_POSE[action];
  };
  // The reveal: a VS callout, then 3-2-1, then FIGHT — computed straight from `elapsed`
  // so it can never drift from `REVEAL_LEAD_MS`, the same number the worker used to
  // decide when the first beat actually lands.
  const introStep = elapsed < 0 ? introStepAt(elapsed + REVEAL_LEAD_MS) : null;
  const nameOf = (seat: FighterSeat) => players.find((player) => player.id === state.seats[seat])?.name ?? text({ en: seat === 'blue' ? 'Blue' : 'Green', fr: seat === 'blue' ? 'Bleu' : 'Vert' });
  const roundHeadline = state.draw ? text({ en: 'DRAW', fr: 'MATCH NUL' }) : text({ en: `${nameOf(state.roundWinner ?? 'blue')} wins`, fr: `${nameOf(state.roundWinner ?? 'blue')} gagne` });
  useEffect(() => {
    if (state.phase !== 'round-over' || !state.roundWinner || !me) return;
    playOutcomeSound(state.seats[state.roundWinner] === me ? 'win' : 'lose');
  }, [state.phase, state.roundWinner, me]);
  return <main class="fighter-game" style={{ '--fighter-blue': FIGHTER_COLORS.blue, '--fighter-green': FIGHTER_COLORS.green } as JSX.CSSProperties}>
    <StatusBar status={text({ en: `Round ${state.matchRound}`, fr: `Manche ${state.matchRound}` })} title={game.title} concept={game.concept} rules={game.rules} />
    <div class="fighter-score"><span>{nameOf(BLUE)} {pips(state.roundWins.blue)}</span><strong>{text({ en: 'ROUND', fr: 'MANCHE' })} {state.matchRound}</strong><span>{pips(state.roundWins.green)} {nameOf(GREEN)}</span></div>
    <section class="fighter-stage">
      <FightCanvas bluePose={pose(BLUE)} greenPose={pose(GREEN)} blueAttacking={Boolean(beat?.blueAction && withinBeat >= FIGHTER_WINDUP_MS && withinBeat < 1_750)} greenAttacking={Boolean(beat?.greenAction && withinBeat >= FIGHTER_WINDUP_MS && withinBeat < 1_750)} beatTime={withinBeat} />
      <div class="fighter-side"><HealthBar value={health.blue} seat={BLUE} name={nameOf(BLUE)} /></div>
      {introStep?.kind === 'vs' && <div class="fighter-versus">{nameOf(BLUE)} {text({ en: 'VS', fr: 'VS' })} {nameOf(GREEN)}</div>}
      {introStep?.kind === 'count' && <div class="fighter-countdown" key={introStep.n}>{introStep.n}</div>}
      {introStep?.kind === 'fight' && <div class="fighter-go">{text({ en: 'FIGHT!', fr: 'COMBAT !' })}</div>}
      <div class="fighter-side fighter-side--green"><HealthBar value={health.green} seat={GREEN} name={nameOf(GREEN)} /></div>
      {state.phase !== 'fighting' && <div class="fighter-round-overlay"><strong>{roundHeadline}</strong>{isHost ? <button type="button" onClick={onNext}>{text({ en: 'Next round', fr: 'Manche suivante' })}</button> : <p>{text({ en: 'Waiting for the host…', fr: 'En attente de l’hôte…' })}</p>}</div>}
    </section>
  </main>;
}

function HealthBar({ value, seat, name }: { value: number; seat: FighterSeat; name: string }): JSX.Element {
  return <div class="fighter-health"><div role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}><i class={`is-${seat}`} style={{ width: `${value}%` }} /></div><b>{Math.round(value)}%</b></div>;
}

function FighterSprite({ seat, pose, small = false, tiny = false }: { seat: FighterSeat; pose: number; small?: boolean; tiny?: boolean }): JSX.Element {
  const column = pose % FIGHTER_SPRITE_COLUMNS;
  const poseX = FIGHTER_SPRITE_MIRRORED[seat] ? FIGHTER_SPRITE_COLUMNS - 1 - column : column;
  return <div class={`fighter-sprite is-${seat} ${small ? 'is-small' : ''} ${tiny ? 'is-tiny' : ''}`} style={{ '--pose': pose, '--pose-x': poseX, '--pose-y': Math.floor(pose / FIGHTER_SPRITE_COLUMNS) } as JSX.CSSProperties} aria-hidden="true" />;
}

/**
 * The big preview alternates idle poses until a move is tapped, then holds that
 * move's pose for `POSE_FLASH_MS` before settling back to the idle rhythm — a beat
 * of feedback for the tap, not a permanent stance change.
 */
function usePoseFlash(): { pose: number | null; show: (pose: number) => void } {
  const [pose, setPose] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const show = (next: number): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setPose(next);
    timer.current = window.setTimeout(() => { setPose(null); timer.current = null; }, POSE_FLASH_MS);
  };
  return { pose, show };
}

/** The idle breathing loop for the big preview — alternates the two idle frames. */
function useIdleRhythm(): number {
  const [pose, setPose] = useState<number>(FIGHTER_POSES.idle1);
  useEffect(() => {
    const timer = window.setInterval(
      () => setPose((current) => (current === FIGHTER_POSES.idle1 ? FIGHTER_POSES.idle2 : FIGHTER_POSES.idle1)),
      250,
    );
    return () => window.clearInterval(timer);
  }, []);
  return pose;
}

type IntroStep = { kind: 'vs' } | { kind: 'count'; n: number } | { kind: 'fight' };

/** Which step of the reveal is showing, `sincePhaseStart` ms after both plans locked in. */
function introStepAt(sincePhaseStart: number): IntroStep {
  if (sincePhaseStart < FIGHT_VS_MS + FIGHT_VS_FADE_MS) return { kind: 'vs' };
  const countdownEnds = FIGHT_VS_MS + FIGHT_VS_FADE_MS + FIGHT_COUNTDOWN_STEP_MS * FIGHT_COUNTDOWN_STEPS;
  if (sincePhaseStart < countdownEnds) {
    const stepsElapsed = Math.floor((sincePhaseStart - FIGHT_VS_MS - FIGHT_VS_FADE_MS) / FIGHT_COUNTDOWN_STEP_MS);
    return { kind: 'count', n: FIGHT_COUNTDOWN_STEPS - stepsElapsed };
  }
  return { kind: 'fight' };
}

function useFightClock(running: boolean, clock: () => number): number {
  const [now, setNow] = useState(clock());
  useEffect(() => { if (!running) return; const timer = window.setInterval(() => setNow(clock()), 50); return () => window.clearInterval(timer); }, [running, clock]);
  return now;
}

function pips(value: number): string { return `${'●'.repeat(value)}${'○'.repeat(Math.max(0, 3 - value))}`; }
function seatRows(state: TapFighterState, players: Player[], text: ReturnType<typeof useGameText>) {
  return (['blue', 'green'] as const).map((seat) => { const player = players.find((item) => item.id === state.seats[seat]); return { id: state.seats[seat], avatar: player?.avatar ?? '🥊', name: player?.name ?? seat, value: state.roundWins[seat], unit: text({ en: 'rounds', fr: 'manches' }) }; });
}
