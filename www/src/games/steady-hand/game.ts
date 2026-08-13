import type { PlayerId, ServerMessage } from '../../../../shared/protocol';

/**
 * What the phone knows about the round. Spec: docs/specs/games/steady-hand.md
 *
 * The referee (`worker/steadyHand.ts`) owns the tolerance, the lives and the
 * eliminations; this folds its four frames into something a screen can render.
 *
 * Unlike Pass the Bomb, the tolerance here **is** shown — the whole game is watching
 * a limit close in on you. What is not shown is anyone else's remaining lives being
 * dressed up as a prediction: the meters are live values, not forecasts.
 */
export type SteadyView = {
  roundId: number;
  tolerance: number;
  /** Server time counting starts; before it, nothing is judged. */
  startsAt: number;
  endsAt: number;
  alive: PlayerId[];
  lives: Record<PlayerId, number>;
  /** Everyone's last reported wobble, for the meters. */
  w: Record<PlayerId, number>;
  phase: 'running' | 'over';
  /** The most recent life lost, and when — the screen flashes from this. */
  lastHit: { victim: PlayerId; lives: number; at: number } | null;
  /** Who went out last and why, for the elimination screen. */
  lastOut: { victim: PlayerId; reason: 'moved' | 'parked' | 'left'; at: number } | null;
  winner: PlayerId | null;
  times: Record<PlayerId, number>;
  seq: number;
};

export type SteadyState = SteadyView | null;

/**
 * Fold a server frame into the view.
 *
 * `now` is passed in rather than read from a clock so the reducer stays pure, and is
 * only used to stamp the moments a screen animates from.
 *
 * Returns the same object when a frame changes nothing, so a caller can skip a render.
 */
export function applySteady(state: SteadyState, msg: ServerMessage, now: number): SteadyState {
  switch (msg.t) {
    case 'steady': {
      // Same ordering guard as every other sequenced frame: a late one must not move
      // the tolerance backwards or resurrect a life somebody has already spent.
      if (state && msg.d.roundId < state.roundId) return state;
      const startingOver = !state || msg.d.roundId > state.roundId;
      if (!startingOver && state && msg.s <= state.seq) return state;

      return {
        roundId: msg.d.roundId,
        tolerance: msg.d.tolerance,
        startsAt: msg.d.startsAt,
        endsAt: msg.d.endsAt,
        alive: msg.d.alive,
        lives: msg.d.lives,
        w: msg.d.w,
        phase: 'running',
        lastHit: startingOver ? null : (state?.lastHit ?? null),
        lastOut: startingOver ? null : (state?.lastOut ?? null),
        winner: null,
        times: startingOver ? {} : (state?.times ?? {}),
        seq: msg.s,
      };
    }

    case 'steady-hit': {
      if (!state || msg.d.roundId !== state.roundId) return state;
      if (msg.s <= state.seq) return state;
      return {
        ...state,
        lives: { ...state.lives, [msg.d.victim]: msg.d.lives },
        lastHit: { victim: msg.d.victim, lives: msg.d.lives, at: now },
        seq: msg.s,
      };
    }

    case 'steady-out': {
      if (!state || msg.d.roundId !== state.roundId) return state;
      if (msg.s <= state.seq) return state;
      return {
        ...state,
        alive: msg.d.alive,
        lives: { ...state.lives, [msg.d.victim]: 0 },
        lastOut: { victim: msg.d.victim, reason: msg.d.reason, at: now },
        seq: msg.s,
      };
    }

    case 'steady-end': {
      if (!state || msg.d.roundId !== state.roundId) return state;
      if (msg.s <= state.seq) return state;
      return {
        ...state,
        phase: 'over',
        winner: msg.d.winner,
        times: msg.d.times,
        seq: msg.s,
      };
    }

    default:
      return state;
  }
}

/** Am I still in the round? */
export function isAlive(state: SteadyState, id: PlayerId | undefined): boolean {
  return !!id && !!state && state.alive.includes(id);
}

/**
 * How full the meter is, 0…1, against the current tolerance.
 *
 * Clamped at 1 rather than allowed to run off the end: past the limit the number stops
 * meaning anything useful, and a bar that overflows its track reads as a rendering bug
 * at exactly the moment the player is being told something important.
 */
export function meterFill(w: number, tolerance: number): number {
  if (!(tolerance > 0)) return 0;
  if (!Number.isFinite(w) || w < 0) return 1;
  return Math.min(1, w / tolerance);
}
