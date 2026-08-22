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
import { TttGame } from './game';
import './ttt.css';

export function TttRoom({ game }: { game: GameCard }): JSX.Element { return <RoomGate game={game}>{(code, card) => <Inner code={code} game={card} />}</RoomGate>; }
function Inner({ code, game }: { code: string; game: GameCard }): JSX.Element {
  const t = useT(); const text = useGameText(); const [, redraw] = useState(0); const ref = useRef(new TttGame()); const model = ref.current;
  const onGame = useCallback((m: ServerMessage) => { model.apply(m); redraw((n) => n + 1); }, [model]);
  const r = useGameRoom(code, game, onGame); const client = r.room.client; const me = r.room.me?.id ?? null; const state = model.state; const players = r.room.room?.players ?? [];
  const [swap, setSwap] = useState(false);
  const ids = players.map((p) => p.id); const x = swap ? ids[1] : ids[0]; const o = swap ? ids[0] : ids[1]; const chooser = swap ? o : x;
  const symbol = (id: PlayerId | null) => id && state?.symbols[id] ? state.symbols[id].toUpperCase() : '';
  if (state?.phase === 'over') {
    const winner = state.winner; return <GameOverScreen accent={game.accent} title={game.title} concept={game.concept} rules={game.rules} slug={game.slug} winner={winner} rows={players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, value: symbol(p.id) }))} me={me} onAgain={() => client?.send({ t: 'start', d: { mode: 'tttt', symbols: { x: x ?? '', o: o ?? '', chooser: chooser ?? '' } } })} canAct={r.room.isHost} />;
  }
  if (state) return <main class="tttt-game"><h1>{game.title}</h1><p>{state.phase === 'choosing' ? `${symbol(state.chooser)} ${text({ en: 'chooses a board', fr: 'choisit un plateau' })}` : `${symbol(state.turn)} ${text({ en: 'plays', fr: 'joue' })}`}</p><Board state={state} onSelect={(i) => client?.send({ t: 'tttt-select', d: { roundId: state.roundId, metaCell: i } })} onTap={(i) => client?.send({ t: 'tttt-tap', d: { roundId: state.roundId, smallCell: i } })} /></main>;
  return <GameLobby card={game} code={code} joinUrl={r.joinUrl} room={r.room} copied={r.copied} showQr={r.showQr} onShare={r.share} onToggleQr={r.toggleQr} canStart={r.room.isHost && ids.length === 2} startLabel={t.common.startRound} onStart={() => client?.send({ t: 'start', d: { mode: 'tttt', symbols: { x: x ?? '', o: o ?? '', chooser: chooser ?? '' } } })} note={r.room.isHost ? text({ en: 'Choose the symbol assignment before starting.', fr: 'Choisissez les symboles avant de commencer.' }) : text({ en: 'The host starts the round.', fr: 'L’hôte démarre la manche.' })} extras={r.room.isHost && ids.length === 2 ? <button type="button" onClick={() => setSwap(!swap)}>{swap ? 'O starts • swap to X' : 'X starts • swap to O'}</button> : null} />;
}
function Board({ state, onSelect, onTap }: { state: TttState; onSelect: (i: number) => void; onTap: (i: number) => void }): JSX.Element {
  const mini = (cells: readonly (string | null)[], click?: (i: number) => void) => <div class="tttt-mini">{cells.map((v, i) => <button type="button" class="tttt-cell" disabled={!click || v !== null} onClick={() => click?.(i)}>{v?.toUpperCase() ?? ''}</button>)}</div>;
  return <section class={`tttt-board ${state.phase === 'playing' ? 'is-playing' : ''}`}>{state.phase === 'playing' ? mini(state.small, onTap) : state.meta.map((v, i) => <button type="button" class="tttt-meta" disabled={v !== null} onClick={() => onSelect(i)}>{mini(Array(9).fill(v === 'draw' ? '·' : v), undefined)}</button>)}</section>;
}
