import type { PlayerId, ServerMessage, TapFighterState } from '../shared/protocol';
import { REVEAL_LEAD_MS, resolveFight, validFighterPlan, type FighterAction, type FighterSeat } from '../shared/tapFighter';

const PLAN_CAP_MS = 75_000;
/** Six 2.5 s beats; the room client adds the shared 0.5 s board-only result hold. */
const FIGHT_MS = 15_000;
const MATCH_TARGET = 3;

export type TapFighter = TapFighterState & {
  plans: Partial<Record<FighterSeat, FighterAction[]>>;
  planningEndsAt: number;
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<TapFighter | null>;
  save(state: TapFighter): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

export function nextDeadline(state: TapFighter): number {
  if (state.phase === 'planning') return state.planningEndsAt;
  if (state.phase === 'fighting') return state.endsAt;
  return Infinity;
}

export function toState(state: TapFighter): TapFighterState {
  const { plans, planningEndsAt: _planningEndsAt, ...publicState } = state;
  return { ...publicState, actions: state.phase === 'planning' ? null : { blue: plans.blue ?? [], green: plans.green ?? [] } };
}

function emit(ctx: Ctx, state: TapFighter): void {
  ctx.broadcast({ t: 'fighter', s: ctx.nextSeq(), d: toState(state) });
}

export async function startTapFighter(ctx: Ctx, roundId: number, connected: PlayerId[], solo = false): Promise<boolean> {
  if ((!solo && connected.length !== 2) || (solo && connected.length !== 1)) return false;
  const blue = connected[0];
  const green = solo ? blue : connected[1];
  if (!blue || !green) return false;
  const previous = await ctx.load();
  const roundWins = previous && previous.phase === 'round-over' ? previous.roundWins : { blue: 0, green: 0 };
  const now = ctx.now();
  const state: TapFighter = {
    roundId,
    matchRound: previous && previous.phase === 'round-over' ? previous.matchRound + 1 : 1,
    phase: 'planning',
    seats: { blue, green },
    ready: { blue: false, green: false },
    actions: null,
    beats: [],
    roundWins: { ...roundWins },
    startsAt: 0,
    endsAt: now + PLAN_CAP_MS,
    planningEndsAt: now + PLAN_CAP_MS,
    roundWinner: null,
    matchWinner: null,
    draw: false,
    solo,
    plans: {},
  };
  await ctx.save(state);
  emit(ctx, state);
  await ctx.setAlarm(nextDeadline(state));
  return true;
}

function seatFor(state: TapFighter, playerId: PlayerId, requested?: FighterSeat): FighterSeat | null {
  if (state.solo) return requested === 'blue' || requested === 'green' ? requested : null;
  if (state.seats.blue === playerId) return 'blue';
  if (state.seats.green === playerId) return 'green';
  return null;
}

export async function onFighterLock(ctx: Ctx, playerId: PlayerId, roundId: number, actions: unknown, requested?: FighterSeat): Promise<void> {
  const state = await ctx.load();
  if (!state || state.phase !== 'planning' || state.roundId !== roundId || !validFighterPlan(actions)) return;
  const seat = seatFor(state, playerId, requested);
  if (!seat || state.seats[seat] !== playerId || state.ready[seat]) return;
  state.plans[seat] = [...actions];
  state.ready[seat] = true;
  if (state.ready.blue && state.ready.green) {
    const result = resolveFight(state.plans.blue ?? [], state.plans.green ?? []);
    state.beats = result.beats;
    state.roundWinner = result.winner;
    state.draw = result.draw;
    if (result.winner) state.roundWins[result.winner] += 1;
    state.matchWinner = result.winner && state.roundWins[result.winner] >= MATCH_TARGET ? result.winner : null;
    state.phase = 'fighting';
    state.startsAt = ctx.now() + REVEAL_LEAD_MS;
    state.endsAt = state.startsAt + FIGHT_MS;
  }
  await ctx.save(state);
  emit(ctx, state);
  await ctx.setAlarm(nextDeadline(state));
}

export async function tick(ctx: Ctx): Promise<void> {
  const state = await ctx.load();
  if (!state || ctx.now() < nextDeadline(state)) return;
  if (state.phase === 'fighting') {
    state.phase = state.matchWinner ? 'match-over' : 'round-over';
  } else if (state.phase === 'planning') {
    const winner: FighterSeat | null = state.ready.blue === state.ready.green ? null : state.ready.blue ? 'blue' : 'green';
    state.roundWinner = winner;
    state.draw = winner === null;
    if (winner) state.roundWins[winner] += 1;
    state.matchWinner = winner && state.roundWins[winner] >= MATCH_TARGET ? winner : null;
    state.phase = state.matchWinner ? 'match-over' : 'round-over';
    state.endsAt = ctx.now();
  }
  await ctx.save(state);
  emit(ctx, state);
  await ctx.setAlarm(Infinity);
}
