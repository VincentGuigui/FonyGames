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
  COMBO_STREAK,
  comboStreak,
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
import { playFighterCue, prepareFighterSfx, startFighterMusic, stopFighterMusic } from './sfx';
import { StatusBar } from '../../core/ui/StatusBar';
import {
  ACTION_BEAT_MS,
  ACTION_LUNGE_FADE_END_MS,
  ACTION_POSE,
  FIGHTER_COLORS,
  FIGHTER_POSES,
  FIGHTER_SPRITE_COLUMNS,
  FIGHTER_SPRITE_MIRRORED,
  FIGHTER_WINDUP_MS,
  idleWindupPose,
  lossLoopPose,
} from './game';
import { FightCanvas } from './FightCanvas';
import { backgroundFor } from './art/backgrounds';

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
  useEffect(() => { prepareFighterSfx(); }, []);
  /**
   * The match's own loop plays for as long as a match is in progress — planning
   * through round-over, across every round — and fades out the moment the match
   * ends or this phone leaves the room. `startFighterMusic` is a no-op while
   * already playing, so this firing again on every round's phase change just
   * lets the same loop keep going rather than restarting it beat to beat.
   */
  useEffect(() => {
    if (!state || state.phase === 'match-over') { stopFighterMusic(); return; }
    startFighterMusic();
  }, [state?.phase]);
  useEffect(() => () => stopFighterMusic(), []);

  if (!state) {
    // No seat-colour tag in the players list (issue #3).
    return <GameLobby card={game} code={code} joinUrl={connection.joinUrl} room={room} copied={connection.copied} showQr={connection.showQr} onShare={connection.share} onToggleQr={connection.toggleQr}
      canStart={room.isHost && enoughToStart(room.connected, [2, 2], solo)} startLabel={t.common.startRound} onStart={start}
      note={room.isHost ? text({ en: 'Two fighters. Six secret moves each.', fr: 'Deux combattants. Six attaques secrètes chacun.' }) : text({ en: 'The host starts the match.', fr: 'L’hôte démarre le match.' })} />;
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
  /**
   * Every beat opens with `FIGHTER_WINDUP_MS` of idle 1-2-1-2, THEN `ACTION_BEAT_MS`
   * (`game.ts`) split into two equal halves for action/reaction — the wind-up is
   * prepended, not carved out of it. Whoever's action landed this beat shows their
   * hit pose for the second half; whoever wasn't hit just keeps the pose their own
   * action left them in — there is no separate "settle back to idle" step mid-beat,
   * only at the very start (the wind-up) of the next one.
   */
  const beatMs = FIGHTER_WINDUP_MS + ACTION_BEAT_MS;
  const halfBeat = ACTION_BEAT_MS / 2;
  // Negative while the reveal (VS, countdown, FIGHT) plays: no beat has landed yet.
  const beatIndex = elapsed < 0 || state.beats.length === 0 ? -1 : Math.min(state.beats.length - 1, Math.floor(elapsed / beatMs));
  const beat = beatIndex >= 0 ? state.beats[beatIndex] : undefined;
  const withinBeat = elapsed >= 0 ? elapsed % beatMs : 0;
  // Time since the wind-up ended — negative during it, then 0…ACTION_BEAT_MS,
  // exactly what `withinBeat` used to mean before the wind-up existed.
  const actionElapsed = withinBeat - FIGHTER_WINDUP_MS;
  const contact = elapsed >= 0 && actionElapsed >= halfBeat;
  const previous = beatIndex > 0 ? state.beats[beatIndex - 1] : undefined;
  const health = state.phase === 'fighting' && !contact ? { blue: previous?.blueHealth ?? 100, green: previous?.greenHealth ?? 100 } : { blue: beat?.blueHealth ?? 100, green: beat?.greenHealth ?? 100 };
  // K.O. above whoever's health hit exactly zero; a "loser" who reached round-over
  // with health still above zero lost on points, not a knockout, and gets the
  // sobbing loss loop instead of the `defeated` pose (issue #3). Both read the
  // same `beats` the referee already resolved — no separate wire state. A draw
  // can itself be a mutual knockout (both hit zero on the same beat) or a points
  // draw with both fighters still standing — the latter sobs too, on both sides,
  // since neither one won. `finalBeat.blueHealth` alone tells the two apart on a
  // draw, because a draw's own definition (`resolveFight`) is equal health.
  const finalBeat = state.beats.at(-1);
  const loser: FighterSeat | null = state.roundWinner ? (state.roundWinner === BLUE ? GREEN : BLUE) : null;
  const knockedOut = state.phase !== 'fighting' && (loser !== null || state.draw)
    && (loser !== null ? finalBeat?.[loser === 'blue' ? 'blueHealth' : 'greenHealth'] : finalBeat?.blueHealth) === 0;
  const lossPose = useLossPose(state.phase !== 'fighting' && (loser !== null || state.draw) && !knockedOut);
  const pose = (seat: FighterSeat) => {
    if (state.phase !== 'fighting' && health[seat] <= 0) return FIGHTER_POSES.defeated;
    if (state.phase !== 'fighting' && (loser === seat || state.draw)) return lossPose;
    const action = beat?.[seat === 'blue' ? 'blueAction' : 'greenAction'];
    if (!action) {
      // The countdown (3-2-1-FIGHT, 4 steps) gets the same idle wind-up as every
      // beat, at the same speed — it just runs the whole time that phase does.
      if (elapsed < 0) {
        const sinceCountdownStart = elapsed + REVEAL_LEAD_MS - (FIGHT_VS_MS + FIGHT_VS_FADE_MS);
        if (sinceCountdownStart >= 0) return idleWindupPose(sinceCountdownStart);
      }
      return FIGHTER_POSES.idle1;
    }
    // Before the action itself: idle 1-2-1-2, the same wind-up every beat gets.
    if (withinBeat < FIGHTER_WINDUP_MS) return idleWindupPose(withinBeat);
    const reacting = contact && beat?.[seat === 'blue' ? 'blueHit' : 'greenHit'];
    return reacting ? FIGHTER_POSES.hit : ACTION_POSE[action];
  };
  /**
   * Contact is the one instant both phones already agree on without a message
   * (the same clock `pose` above reads), so it doubles as the cue to play a
   * beat's sound — once, not on every 50 ms tick `contact` keeps reading true
   * for: the effect only re-runs when `contact` or `beatIndex` actually change,
   * and `contact` is false for the whole wind-up at the top of every new beat.
   * `kick`'s own swing plays only for a landed-or-not KICK (no swing take was
   * recorded for a punch); `impact`/`avoid` cover either attack, on whichever
   * side actually threw one.
   */
  useEffect(() => {
    if (state.phase !== 'fighting' || !contact || beatIndex < 0) return;
    const currentBeat = state.beats[beatIndex];
    if (!currentBeat) return;
    if (currentBeat.blueAction === 'punch' || currentBeat.blueAction === 'kick') {
      if (currentBeat.blueAction === 'kick') playFighterCue('kick');
      playFighterCue(currentBeat.greenHit ? 'impact' : 'avoid');
    }
    if (currentBeat.greenAction === 'punch' || currentBeat.greenAction === 'kick') {
      if (currentBeat.greenAction === 'kick') playFighterCue('kick');
      playFighterCue(currentBeat.blueHit ? 'impact' : 'avoid');
    }
  }, [state.phase, contact, beatIndex]);
  // "Combo" reveals at the same instant the hit pose and health bar do — contact,
  // never the start of the beat — and only for as long as this exact beat is the
  // one showing (issue #9: three landed hits in a row with none received). Gated
  // on `fighting` so it cannot linger into round-over and collide with the K.O./
  // Perfect callouts below, which share the same floating-label spot.
  const comboActive = (seat: FighterSeat) => state.phase === 'fighting' && contact && beatIndex >= 0 && comboStreak(state.beats, beatIndex, seat) >= COMBO_STREAK;
  // Perfect above a winner who never took a hit across the whole (possibly
  // knockout-shortened) beat timeline (issue #3) — independent of K.O./loss
  // above, and can fire alongside either.
  const flawless = state.phase !== 'fighting' && state.roundWinner !== null
    && state.beats.every((oneBeat) => !oneBeat[state.roundWinner === 'blue' ? 'blueHit' : 'greenHit']);
  // The reveal: a VS callout, then 3-2-1, then FIGHT — computed straight from `elapsed`
  // so it can never drift from `REVEAL_LEAD_MS`, the same number the worker used to
  // decide when the first beat actually lands.
  const introStep = elapsed < 0 ? introStepAt(elapsed + REVEAL_LEAD_MS) : null;
  const nameOf = (seat: FighterSeat) => players.find((player) => player.id === state.seats[seat])?.name ?? text({ en: seat === 'blue' ? 'Blue' : 'Green', fr: seat === 'blue' ? 'Bleu' : 'Vert' });
  /**
   * `state.roundWins` already carries THIS round's own outcome the instant `phase`
   * becomes `fighting` — the referee resolves the fight and increments it in the same
   * update (`worker/tapFighter.ts`'s `onFighterLock`), before either phone has watched
   * a single beat. Showing it as-is spoiled the round: the pip count at the top of the
   * screen changed during the reveal countdown, seconds before the fight it is
   * supposedly the result of. Subtracting the pending win back out for as long as
   * `fighting` lasts holds the pips at the PREVIOUS round's tally until the round is
   * actually over, exactly like `roundHeadline`/`flawless`/the loss pose below already
   * withhold everything else about the outcome until then.
   */
  const displayedWins = (seat: FighterSeat) =>
    state.phase === 'fighting' && state.roundWinner === seat ? state.roundWins[seat] - 1 : state.roundWins[seat];
  const roundHeadline = state.draw ? text({ en: 'DRAW', fr: 'MATCH NUL' }) : text({ en: `${nameOf(state.roundWinner ?? 'blue')} wins`, fr: `${nameOf(state.roundWinner ?? 'blue')} gagne` });
  useEffect(() => {
    if (state.phase !== 'round-over' || !state.roundWinner || !me) return;
    playOutcomeSound(state.seats[state.roundWinner] === me ? 'win' : 'lose');
  }, [state.phase, state.roundWinner, me]);
  const backgroundUrl = backgroundFor(state.roundId);
  return <main class="fighter-game" style={{ '--fighter-blue': FIGHTER_COLORS.blue, '--fighter-green': FIGHTER_COLORS.green, ...(backgroundUrl ? { '--fighter-bg': `url(${backgroundUrl})` } : {}) } as JSX.CSSProperties}>
    <StatusBar status={text({ en: `Round ${state.matchRound}`, fr: `Manche ${state.matchRound}` })} title={game.title} concept={game.concept} rules={game.rules} />
    <div class="fighter-score"><span>{nameOf(BLUE)} {pips(displayedWins(BLUE))}</span><strong>{text({ en: 'ROUND', fr: 'MANCHE' })} {state.matchRound}</strong><span>{pips(displayedWins(GREEN))} {nameOf(GREEN)}</span></div>
    <section class="fighter-stage">
      <FightCanvas bluePose={pose(BLUE)} greenPose={pose(GREEN)} blueAttacking={Boolean(beat?.blueAction && actionElapsed >= 0 && actionElapsed < ACTION_LUNGE_FADE_END_MS)} greenAttacking={Boolean(beat?.greenAction && actionElapsed >= 0 && actionElapsed < ACTION_LUNGE_FADE_END_MS)} beatTime={actionElapsed} />
      <div class="fighter-side"><HealthBar value={health.blue} seat={BLUE} name={nameOf(BLUE)} /></div>
      {introStep?.kind === 'vs' && <div class="fighter-versus">{nameOf(BLUE)} {text({ en: 'VS', fr: 'VS' })} {nameOf(GREEN)}</div>}
      {introStep?.kind === 'count' && <div class="fighter-countdown" key={introStep.n}>{introStep.n}</div>}
      {introStep?.kind === 'fight' && <div class="fighter-go">{text({ en: 'FIGHT!', fr: 'COMBAT !' })}</div>}
      {comboActive(BLUE) && <div class="fighter-combo is-blue" key={beatIndex}>{text({ en: 'COMBO!', fr: 'COMBO !' })}</div>}
      {comboActive(GREEN) && <div class="fighter-combo is-green" key={beatIndex}>{text({ en: 'COMBO!', fr: 'COMBO !' })}</div>}
      {knockedOut && loser && <div class={`fighter-combo is-${loser}`}>{text({ en: 'K.O.!', fr: 'K.O. !' })}</div>}
      {flawless && state.roundWinner && <div class={`fighter-combo is-${state.roundWinner}`}>{text({ en: 'PERFECT', fr: 'PARFAIT' })}</div>}
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

/**
 * The "sobbing" loop for a round lost on points, not a knockout — its own
 * small timer, like the idle rhythm above, rather than the fight's
 * server-driven clock: purely cosmetic, so it never needs to agree between
 * devices. Keeps running for as long as `active` stays true — the loser
 * keeps sobbing through the whole round-over panel, not just its first
 * second, since a host can leave that panel open as long as they like
 * before starting the next round.
 */
function useLossPose(active: boolean): number {
  const [pose, setPose] = useState<number>(FIGHTER_POSES.loss1);
  useEffect(() => {
    if (!active) { setPose(FIGHTER_POSES.loss1); return; }
    const start = Date.now();
    const timer = window.setInterval(() => {
      setPose(lossLoopPose(Date.now() - start));
    }, 50);
    return () => window.clearInterval(timer);
  }, [active]);
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
  return (['blue', 'green'] as const).map((seat) => {
    const player = players.find((item) => item.id === state.seats[seat]);
    const n = state.roundWins[seat];
    return {
      id: state.seats[seat],
      avatar: player?.avatar ?? '🥊',
      name: player?.name ?? seat,
      value: n,
      unit: n === 1 ? text({ en: 'round', fr: 'manche' }) : text({ en: 'rounds', fr: 'manches' }),
    };
  });
}
