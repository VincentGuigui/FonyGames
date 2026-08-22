import { preroundFor, type PlayerId, type ServerMessage, type TttState } from '../shared/protocol';
import { tttFull, tttWinner } from '../shared/ticTacTicTacToe';

const CAP_MS = 5 * 60_000;

export type Ttt = TttState & { players: [PlayerId, PlayerId] };
export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<Ttt | null>;
  save(s: Ttt): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

export function nextDeadline(s: Ttt): number { return s.phase === 'over' ? Infinity : s.endsAt; }
export function toState(s: Ttt): TttState { const { players: _players, ...state } = s; return state; }
function emit(ctx: Ctx, s: Ttt): void { ctx.broadcast({ t: 'tttt', s: ctx.nextSeq(), d: toState(s) }); }

export async function startTttt(ctx: Ctx, roundId: number, players: PlayerId[], symbols: { x: PlayerId; o: PlayerId; chooser: PlayerId } | undefined, solo = false): Promise<boolean> {
  if (players.length !== 2 || (!solo && !symbols)) return false;
  const a = players[0]; const b = players[1];
  const x = symbols?.x ?? a ?? '';
  const o = symbols?.o ?? b ?? '';
  const chooser = symbols?.chooser ?? a ?? '';
  if (a === undefined || b === undefined || x === undefined || o === undefined || chooser === undefined || x === o || !players.includes(x) || !players.includes(o) || !players.includes(chooser)) return false;
  const now = ctx.now();
  const s: Ttt = {
    players: [a, b], roundId, phase: 'choosing', symbols: { [x]: 'x', [o]: 'o' },
    meta: Array(9).fill(null), small: Array(9).fill(null), selectedMeta: null,
    chooser, turn: null, miniWinner: null, winner: null, draw: false,
    startsAt: now + preroundFor(roundId), zoomAt: now + preroundFor(roundId), endsAt: now + preroundFor(roundId) + CAP_MS,
  };
  await ctx.save(s); emit(ctx, s); await ctx.setAlarm(nextDeadline(s)); return true;
}

export async function onSelect(ctx: Ctx, playerId: PlayerId, roundId: number, metaCell: number): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'choosing' || s.roundId !== roundId || s.chooser !== playerId || !Number.isInteger(metaCell) || metaCell < 0 || metaCell > 8 || s.meta[metaCell] !== null) return;
  s.selectedMeta = metaCell; s.small = Array(9).fill(null); s.phase = 'playing'; s.turn = playerId; s.miniWinner = null; s.zoomAt = ctx.now();
  await ctx.save(s); emit(ctx, s);
}

export async function onTap(ctx: Ctx, playerId: PlayerId, roundId: number, smallCell: number): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'playing' || s.roundId !== roundId || s.turn !== playerId || s.selectedMeta === null || !Number.isInteger(smallCell) || smallCell < 0 || smallCell > 8 || s.small[smallCell] !== null) return;
  const mark = s.symbols[playerId]; if (!mark) return;
  s.small[smallCell] = mark;
  const mini = tttWinner(s.small);
  if (mini || tttFull(s.small)) {
    s.miniWinner = mini ?? 'draw';
    if (mini) s.meta[s.selectedMeta] = mini;
    else s.meta[s.selectedMeta] = 'draw';
    const metaWinner = tttWinner(s.meta);
    if (metaWinner) { s.phase = 'over'; s.winner = Object.entries(s.symbols).find(([, m]) => m === metaWinner)?.[0] ?? null; s.turn = null; s.draw = false; }
    else if (tttFull(s.meta)) { s.phase = 'over'; s.winner = null; s.turn = null; s.draw = true; }
    else { s.phase = 'choosing'; s.chooser = s.players.find((p) => p !== playerId) ?? null; s.turn = null; s.selectedMeta = null; }
  } else {
    s.turn = s.players.find((p) => p !== playerId) ?? null;
  }
  await ctx.save(s); emit(ctx, s); await ctx.setAlarm(nextDeadline(s));
}

export async function tick(ctx: Ctx): Promise<void> {
  const s = await ctx.load(); if (!s || s.phase === 'over' || ctx.now() < s.endsAt) return;
  s.phase = 'over'; s.winner = null; s.turn = null; s.draw = true; await ctx.save(s); emit(ctx, s); await ctx.setAlarm(Infinity);
}
