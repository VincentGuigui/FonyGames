import { RUSH_DISTANCE, type PlayerId, type ServerMessage } from '../../../../shared/protocol';

/**
 * What the phone knows about the race. Spec: docs/specs/games/shake-rush.md
 *
 * The referee (`worker/shakeRush.ts`) owns every position; this folds its two
 * frames into something a track can render.
 *
 * Nothing here is predicted. A local runner that moves on your own shakes and
 * then snaps back when the server disagrees is worse than one that lags by a
 * tenth of a second, because the snap is the frame you notice.
 */
export type RushView = {
  roundId: number;
  endsAt: number;
  at: Record<PlayerId, number>;
  /** Finish order so far, first to last. */
  finished: PlayerId[];
  /** Runners whose phone has gone quiet. */
  away: PlayerId[];
  phase: 'running' | 'over';
  /** Final placing, once the round is over. */
  order: PlayerId[];
  seq: number;
};

export type RushState = RushView | null;

/**
 * Fold a server frame into the view.
 *
 * Returns the same object when a frame changes nothing, so a caller can skip a
 * render — at 10 Hz across 8 lanes that is worth having.
 */
export function applyRush(state: RushState, msg: ServerMessage): RushState {
  switch (msg.t) {
    case 'rush': {
      // Same ordering guard as every other sequenced frame: a late one must not
      // drag a runner backwards down the track.
      if (state && msg.d.roundId < state.roundId) return state;
      const startingOver = !state || msg.d.roundId > state.roundId;
      if (!startingOver && state && msg.s <= state.seq) return state;

      return {
        roundId: msg.d.roundId,
        endsAt: msg.d.endsAt,
        at: msg.d.at,
        finished: msg.d.finished,
        away: msg.d.away,
        phase: 'running',
        order: [],
        seq: msg.s,
      };
    }

    case 'rush-end': {
      if (!state || msg.d.roundId !== state.roundId) return state;
      if (msg.s <= state.seq) return state;
      return {
        ...state,
        at: msg.d.at,
        phase: 'over',
        order: msg.d.order,
        seq: msg.s,
      };
    }

    default:
      return state;
  }
}

/**
 * How far along the track a runner is, 0…1.
 *
 * Clamped, and a nonsense distance reads as the start rather than as a win: a
 * runner drawn off the end of the track looks like a rendering bug, and one drawn
 * past the line looks like a result.
 */
export function progress(at: number | undefined): number {
  if (!Number.isFinite(at) || (at ?? 0) < 0) return 0;
  return Math.min(1, (at as number) / RUSH_DISTANCE);
}

/** Shakes left for a runner. The screen counts down, because "37 to go" beats a bar. */
export function toGo(at: number | undefined): number {
  if (!Number.isFinite(at) || (at ?? 0) < 0) return RUSH_DISTANCE;
  return Math.max(0, RUSH_DISTANCE - (at as number));
}

/**
 * Everyone in track order: furthest first, and finishers ahead of everyone.
 *
 * Finish order beats distance because two runners can both be sitting on
 * `RUSH_DISTANCE` and only one of them won.
 */
export function standings(state: RushView, players: PlayerId[]): PlayerId[] {
  const placed = state.phase === 'over' ? state.order : state.finished;
  const rest = players.filter((id) => !placed.includes(id));
  rest.sort((a, b) => (state.at[b] ?? 0) - (state.at[a] ?? 0));
  return [...placed.filter((id) => players.includes(id)), ...rest];
}
