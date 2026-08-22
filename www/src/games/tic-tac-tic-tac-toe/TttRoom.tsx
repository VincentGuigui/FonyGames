import { useCallback, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import type { PlayerId, ServerMessage, TttState } from '../../../../shared/protocol';
import { soloTesting } from '../../core/solo';
import { enoughToStart } from '../../../../shared/players';
import { TttGame } from './game';
import './ttt.css';

export function TttRoom({ game }: { game: GameCard }): JSX.Element {
  return <RoomGate game={game}>{(code, card) => <Inner code={code} game={card} />}</RoomGate>;
}

function Inner({ code, game }: { code: string; game: GameCard }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = soloTesting();
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
  const ids = players.map((player) => player.id);
  const x = swap ? ids[1] : ids[0];
  const o = swap ? ids[0] : ids[1];
  const chooser = swap ? o : x;
  const symbol = (id: PlayerId | null) => id && state?.symbols[id] ? state.symbols[id].toUpperCase() : '';
  const start = () => client?.send({ t: 'start', d: { mode: 'tttt', solo, symbols: { x: x ?? '', o: o ?? '', chooser: chooser ?? '' } } });

  if (state?.phase === 'over') {
    return <GameOverScreen accent={game.accent} title={game.title} concept={game.concept} rules={game.rules} slug={game.slug} winner={state.winner}
      rows={players.map((player) => ({ id: player.id, name: player.name, avatar: player.avatar, value: symbol(player.id) }))}
      me={me} onAgain={start} canAct={room.room.isHost} />;
  }
  if (state) {
    return <main class="tttt-game">
      <h1>{game.title}</h1>
      <p>{state.phase === 'choosing' ? `${symbol(state.chooser)} ${text({ en: 'chooses a board', fr: 'choisit un plateau' })}` : `${symbol(state.turn)} ${text({ en: 'plays', fr: 'joue' })}`}</p>
      <Board state={state} onSelect={(cell) => client?.send({ t: 'tttt-select', d: { roundId: state.roundId, metaCell: cell } })} onTap={(cell) => client?.send({ t: 'tttt-tap', d: { roundId: state.roundId, smallCell: cell } })} />
    </main>;
  }

  const assignment = ids.length === 2
    ? text({ en: `${players[swap ? 1 : 0]?.name ?? 'Player 1'} is X and starts first, ${players[swap ? 0 : 1]?.name ?? 'Player 2'} is O`, fr: `${players[swap ? 1 : 0]?.name ?? 'Joueur 1'} est X et commence, ${players[swap ? 0 : 1]?.name ?? 'Joueur 2'} est O` })
    : null;
  return <GameLobby card={game} code={code} joinUrl={room.joinUrl} room={room.room} copied={room.copied} showQr={room.showQr} onShare={room.share} onToggleQr={room.toggleQr}
    canStart={room.room.isHost && enoughToStart(ids.length, [2, 2], solo)} startLabel={t.common.startRound} onStart={start}
    note={room.room.isHost ? text({ en: 'Choose the symbol assignment before starting.', fr: 'Choisissez les symboles avant de commencer.' }) : text({ en: 'The host starts the round.', fr: 'The host starts the round.' })}
    extras={room.room.isHost && ids.length === 2 ? <div class="tttt-assignment"><span>{assignment}</span><button class="tttt-change" type="button" onClick={() => setSwap(!swap)}>{text({ en: 'Change', fr: 'Changer' })}</button></div> : null} />;
}

function Board({ state, onSelect, onTap }: { state: TttState; onSelect: (cell: number) => void; onTap: (cell: number) => void }): JSX.Element {
  const mini = (cells: readonly (string | null)[], click?: (cell: number) => void) => <div class="tttt-mini">{cells.map((value, cell) => click ? <button type="button" class="tttt-cell" disabled={value !== null} onClick={() => click(cell)}>{value?.toUpperCase() ?? ''}</button> : <span class="tttt-cell" aria-hidden="true">{value?.toUpperCase() ?? ''}</span>)}</div>;
  return <section class={`tttt-board ${state.phase === 'playing' ? 'is-playing' : ''}`}>
    {state.phase === 'playing' ? mini(state.small, onTap) : state.meta.map((value, cell) => value === 'x' || value === 'o'
      ? <div class="tttt-meta tttt-meta--claimed" aria-label={`Cell ${value.toUpperCase()}`}>{value.toUpperCase()}</div>
      : <button type="button" class="tttt-meta" disabled={value !== null} onClick={() => onSelect(cell)}>{value === 'draw' ? <span class="tttt-draw">·</span> : mini(Array(9).fill(null), undefined)}</button>)}
  </section>;
}
