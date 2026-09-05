import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import type { PlayerId, ServerMessage, TttState } from '../../../../shared/protocol';
import { useSoloTesting } from '../../core/useSolo';
import { enoughToStart } from '../../../../shared/players';
import { TttGame, TTT_PULSE_MS, TTT_STAMP_MS, finaleLine, finaleStage, type TttFinaleStage } from './game';
import { GameSwitcher } from '../../lobby/GameSwitcher';
import './ttt.css';

export function TttRoom({ game }: { game: GameCard }): JSX.Element {
  return <RoomGate game={game}>{(code, card) => <Inner code={code} game={card} />}</RoomGate>;
}

function Inner({ code, game }: { code: string; game: GameCard }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [, redraw] = useState(0);
  const ref = useRef(new TttGame());
  const model = ref.current;
  const onGame = useCallback((message: ServerMessage) => {
    model.apply(message);
    redraw((n) => n + 1);
  }, [model]);
  const room = useGameRoom(code, game, onGame);
  const client = room.room.client;
  const me = room.room.me?.id ?? null;
  const state = model.state;
  const players = room.room.room?.players ?? [];
  const [swap, setSwap] = useState(false);
  const [transitionNow, setTransitionNow] = useState(Date.now());
  /**
   * The winning finale (spec §4). Started the first time this phone sees a
   * won match rather than from a server clock: it is cosmetic, it is the same
   * length for everybody, and a phone that arrives late should see it from
   * where it arrived rather than miss it or catch the tail.
   */
  const [beat, setBeat] = useState<TttFinaleStage>('done');
  const line = state ? finaleLine(state) : null;
  // Keyed on the round NUMBER, not on the state object: a re-sent frame would
  // otherwise re-run this effect, and its own cleanup would clear the timers
  // that were about to end the finale — leaving the results panel behind a
  // celebration that never finishes.
  const finaleRound = state && line ? state.roundId : null;
  useEffect(() => {
    if (finaleRound === null) return;
    setBeat(finaleStage(0));
    const toLine = window.setTimeout(() => setBeat('line'), TTT_STAMP_MS);
    const toDone = window.setTimeout(() => setBeat('done'), TTT_STAMP_MS + TTT_PULSE_MS);
    return () => {
      window.clearTimeout(toLine);
      window.clearTimeout(toDone);
    };
  }, [finaleRound]);
  const stage: TttFinaleStage = finaleRound === null ? 'done' : beat;
  const ids = players.map((player) => player.id);
  const x = swap ? ids[1] : ids[0];
  const o = swap ? ids[0] : ids[1];
  const chooser = swap ? o : x;
  const symbol = (id: PlayerId | null) => id && state?.symbols[id] ? state.symbols[id].toUpperCase() : '';
  const playerName = (id: PlayerId | null) => players.find((player) => player.id === id)?.name ?? text({ en: 'Player', fr: 'Joueur' });
  const start = () => client?.send({ t: 'start', d: { mode: 'tttt', solo, symbols: { x: x ?? '', o: o ?? '', chooser: chooser ?? '' } } });
  useEffect(() => {
    if (!state?.reopenedAt) return;
    setTransitionNow(client?.now() ?? Date.now());
    const timer = window.setTimeout(() => setTransitionNow(client?.now() ?? Date.now()), 1_000);
    return () => window.clearTimeout(timer);
  }, [state?.reopenedAt, client]);

  if (state && line && stage !== 'done') {
    return <main class="tttt-game">
      <h1>{game.title}</h1>
      <p>{text({ en: `${playerName(state.winner)} wins the whole thing`, fr: `${playerName(state.winner)} remporte la partie` })}</p>
      <Finale state={state} stage={stage} line={line} />
    </main>;
  }
  if (state?.phase === 'over') {
    return <GameOverScreen accent={game.accent} title={game.title} concept={game.concept} rules={game.rules} slug={game.slug} winner={state.winner}
      rows={players.map((player) => ({ id: player.id, name: player.name, avatar: player.avatar, value: symbol(player.id) }))}
      me={me} onAgain={start} canAct={room.room.isHost} />;
  }
  if (state) {
    return <main class="tttt-game">
      <GameSwitcher />
      <h1>{game.title}</h1>
      <p>{state.phase === 'choosing' ? `${playerName(state.chooser)} (${symbol(state.chooser)}) ${text({ en: 'chooses a board', fr: 'choisit le plateau' })}` : `${playerName(state.turn)} (${symbol(state.turn)}) ${text({ en: 'plays', fr: 'joue' })}`}</p>
      <Board state={state} now={transitionNow} onSelect={(cell) => client?.send({ t: 'tttt-select', d: { roundId: state.roundId, metaCell: cell } })} onTap={(cell) => client?.send({ t: 'tttt-tap', d: { roundId: state.roundId, smallCell: cell } })} />
    </main>;
  }

  const assignment = ids.length === 2
    ? text({ en: `${players[swap ? 1 : 0]?.name ?? 'Player 1'} is X and starts first, ${players[swap ? 0 : 1]?.name ?? 'Player 2'} is O`, fr: `${players[swap ? 1 : 0]?.name ?? 'Joueur 1'} est X et commence, ${players[swap ? 0 : 1]?.name ?? 'Joueur 2'} est O` })
    : null;
  return <GameLobby card={game} code={code} joinUrl={room.joinUrl} room={room.room} copied={room.copied} showQr={room.showQr} onShare={room.share} onToggleQr={room.toggleQr}
    canStart={room.room.isHost && enoughToStart(ids.length, [2, 2], solo)} startLabel={t.common.startRound} onStart={start}
    extras={room.room.isHost && ids.length === 2 ? <div class="tttt-assignment"><span>{assignment}</span><button class="tttt-change" type="button" onClick={() => setSwap(!swap)}>{text({ en: 'Change', fr: 'Changer' })}</button></div> : null} />;
}

/**
 * The two beats of the finale (spec §4), drawn from the same pieces the live
 * board uses so the win is shown on the board it happened on.
 *
 * `stamp` keeps the child grid that was just won on screen with the winner's
 * symbol over it; `line` returns to the meta grid with the three aligned
 * symbols pulsing. Neither is interactive — this is a replay of what just
 * happened, and a stray tap on it should do nothing at all.
 */
function Finale({ state, stage, line }: { state: TttState; stage: TttFinaleStage; line: readonly [number, number, number] }): JSX.Element {
  if (stage === 'stamp') {
    const mark = state.miniWinner === 'x' || state.miniWinner === 'o' ? state.miniWinner : null;
    return <section class="tttt-board tttt-board--stamp">
      <div class="tttt-stamp">
        <div class="tttt-mini">
          {state.small.map((value) => <span class="tttt-cell" aria-hidden="true">{value?.toUpperCase() ?? ''}</span>)}
        </div>
        {mark && <span class="tttt-stamp__mark">{mark.toUpperCase()}</span>}
      </div>
    </section>;
  }
  return <section class="tttt-board">
    {state.meta.map((value, cell) => <div
      class={`tttt-meta ${value === 'x' || value === 'o' ? 'tttt-meta--claimed' : ''} ${line.includes(cell) ? 'tttt-meta--winning' : ''}`}
      aria-hidden="true"
    >{value === 'x' || value === 'o' ? value.toUpperCase() : ''}</div>)}
  </section>;
}

function Board({ state, now, onSelect, onTap }: { state: TttState; now: number; onSelect: (cell: number) => void; onTap: (cell: number) => void }): JSX.Element {
  const reopened = state.reopened ?? [];
  const reopenedAt = state.reopenedAt ?? 0;
  const mini = (cells: readonly (string | null)[], click?: (cell: number) => void) => <div class="tttt-mini">{cells.map((value, cell) => click ? <button type="button" class="tttt-cell" disabled={value !== null} onClick={() => click(cell)}>{value?.toUpperCase() ?? ''}</button> : <span class="tttt-cell" aria-hidden="true">{value?.toUpperCase() ?? ''}</span>)}</div>;
  return <section class={`tttt-board ${state.phase === 'playing' ? 'is-playing' : ''}`}>
    {state.phase === 'playing' ? mini(state.small, onTap) : state.meta.map((value, cell) => value === 'x' || value === 'o'
      ? <div class="tttt-meta tttt-meta--claimed">{value.toUpperCase()}</div>
      : <button type="button" class={`tttt-meta ${reopened.includes(cell) && now < reopenedAt + 1_000 ? 'tttt-meta--reopened' : ''}`} disabled={value !== null || (reopened.includes(cell) && now < reopenedAt + 1_000)} onClick={() => onSelect(cell)}>{value === 'draw' ? <span class="tttt-draw">·</span> : <>{mini(Array(9).fill(null), undefined)}{reopened.includes(cell) && <span class="tttt-reopening-dot">·</span>}</>}</button>)}
  </section>;
}
