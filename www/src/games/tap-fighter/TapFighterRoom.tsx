import { useCallback, useEffect, useState } from 'preact/hooks';
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
import { FIGHTER_ACTIONS, type FighterAction, type FighterSeat } from '../../../../shared/tapFighter';
import type { Player, ServerMessage, TapFighterState } from '../../../../shared/protocol';
import { playOutcomeSound } from '../../core/audio/outcome';
import { StatusBar } from '../../core/ui/StatusBar';
import { ACTION_POSE, FIGHTER_COLORS, FIGHTER_POSES, RHYTHM_POSES } from './game';

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
  const rhythmPose = useRhythmPose();
  const opponent: FighterSeat = seat === 'blue' ? 'green' : 'blue';
  const name = players.find((player) => player.id === state.seats[seat])?.name ?? text({ en: 'Fighter', fr: 'Combattant' });
  const actionName = (action: FighterAction) => ({ punch: text({ en: 'Punch', fr: 'Poing' }), kick: text({ en: 'Kick', fr: 'Pied' }), jump: text({ en: 'Jump', fr: 'Saut' }), crouch: text({ en: 'Crouch', fr: 'Baisser' }) })[action];
  return <main class="fighter-plan" style={{ '--fighter-accent': seat === 'blue' ? FIGHTER_COLORS.blue : FIGHTER_COLORS.green } as JSX.CSSProperties}>
    <StatusBar status={text({ en: 'Planning', fr: 'Préparation' })} title={game.title} concept={game.concept} rules={game.rules} />
    <header><h1>{text({ en: `${name}, choose your moves`, fr: `${name}, choisissez vos actions` })}</h1><p>{locked ? text({ en: 'Locked in. Waiting for the other fighter…', fr: 'Séquence validée. En attente de l’autre combattant…' }) : text({ en: 'Build a secret sequence of six actions.', fr: 'Composez une séquence secrète de six actions.' })}</p></header>
    <FighterSprite seat={seat} pose={rhythmPose} />
    <ol class="fighter-sequence" aria-label={text({ en: 'Your six actions', fr: 'Vos six actions' })}>{Array.from({ length: 6 }, (_, index) => <li><button type="button" disabled={locked || actions[index] === undefined} onClick={() => setActions(actions.filter((_, i) => i !== index))}>{actions[index] ? actionName(actions[index]) : String(index + 1)}</button></li>)}</ol>
    <div class="fighter-actions">{FIGHTER_ACTIONS.map((action) => <button type="button" disabled={locked || actions.length >= 6} onClick={() => setActions([...actions, action])}><FighterSprite seat={seat} pose={ACTION_POSE[action]} small /><span>{actionName(action)}</span></button>)}</div>
    <button class="fighter-fight-button" type="button" disabled={locked || actions.length !== 6} onClick={() => onLock(seat, actions)}>{text({ en: 'FIGHT', fr: 'COMBAT' })}</button>
    <p class="fighter-opponent-state">{state.ready[opponent] ? text({ en: 'Opponent ready', fr: 'Adversaire prêt' }) : text({ en: 'Opponent choosing…', fr: 'Adversaire en réflexion…' })}</p>
  </main>;
}

function FightScreen({ game, state, players, me, isHost, onNext, clock }: { game: GameCard; state: TapFighterState; players: Player[]; me: string | null; isHost: boolean; onNext: () => void; clock: () => number }): JSX.Element {
  const text = useGameText();
  const rhythmPose = useRhythmPose();
  const now = useFightClock(state.phase === 'fighting', clock);
  const elapsed = Math.min(now - state.startsAt, Math.max(0, state.endsAt - state.startsAt - 1));
  const beatMs = 2_500;
  const beatIndex = state.beats.length === 0 ? -1 : Math.min(state.beats.length - 1, Math.max(0, Math.floor(elapsed / beatMs)));
  const beat = beatIndex >= 0 ? state.beats[beatIndex] : undefined;
  const withinBeat = elapsed >= 0 ? elapsed % beatMs : 0;
  const contact = elapsed >= 0 && withinBeat >= 1_500;
  const previous = beatIndex > 0 ? state.beats[beatIndex - 1] : undefined;
  const health = state.phase === 'fighting' && !contact ? { blue: previous?.blueHealth ?? 100, green: previous?.greenHealth ?? 100 } : { blue: beat?.blueHealth ?? 100, green: beat?.greenHealth ?? 100 };
  const pose = (seat: FighterSeat) => {
    if (state.phase !== 'fighting' && health[seat] <= 0) return FIGHTER_POSES.defeated;
    if (contact && beat?.[seat === 'blue' ? 'blueHit' : 'greenHit'] && withinBeat < 2_000) return 5;
    const action = beat?.[seat === 'blue' ? 'blueAction' : 'greenAction'];
    return action && withinBeat < 1_000 ? ACTION_POSE[action] : FIGHTER_POSES.idle1;
  };
  const displayPose = (seat: FighterSeat) => pose(seat) === FIGHTER_POSES.idle1 ? rhythmPose : pose(seat);
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
      <div class="fighter-side"><FighterSprite key={`b-${beatIndex}`} seat={BLUE} pose={displayPose(BLUE)} /><HealthBar value={health.blue} seat={BLUE} name={nameOf(BLUE)} /></div>
      <div class="fighter-versus">{nameOf(BLUE)} {text({ en: 'VS', fr: 'VS' })} {nameOf(GREEN)}</div>
      <div class="fighter-side fighter-side--green"><FighterSprite key={`g-${beatIndex}`} seat={GREEN} pose={displayPose(GREEN)} /><HealthBar value={health.green} seat={GREEN} name={nameOf(GREEN)} /></div>
      {state.phase !== 'fighting' && <div class="fighter-round-overlay"><strong>{roundHeadline}</strong>{isHost ? <button type="button" onClick={onNext}>{text({ en: 'Next round', fr: 'Manche suivante' })}</button> : <p>{text({ en: 'Waiting for the host…', fr: 'En attente de l’hôte…' })}</p>}</div>}
    </section>
  </main>;
}

function HealthBar({ value, seat, name }: { value: number; seat: FighterSeat; name: string }): JSX.Element {
  return <div class="fighter-health"><span>{name}</span><div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}><i class={`is-${seat}`} style={{ width: `${value}%` }} /></div><b>{Math.round(value)}%</b></div>;
}

function FighterSprite({ seat, pose, small = false }: { seat: FighterSeat; pose: number; small?: boolean }): JSX.Element {
  return <div class={`fighter-sprite is-${seat} ${small ? 'is-small' : ''} ${pose === FIGHTER_POSES.idle1 && !small ? 'is-rhythm' : ''}`} style={{ '--pose': pose } as JSX.CSSProperties} aria-hidden="true" />;
}

function useRhythmPose(): number {
  const [pose, setPose] = useState<number>(RHYTHM_POSES[0]);
  useEffect(() => {
    const timer = window.setInterval(() => setPose((current) => current === RHYTHM_POSES[0] ? RHYTHM_POSES[1] : RHYTHM_POSES[0]), 250);
    return () => window.clearInterval(timer);
  }, []);
  return pose;
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
