import type { PlayerId, ServerMessage, UfoWave } from '../../../../shared/protocol';

/**
 * What the phone knows about the hunt. Spec: docs/specs/games/ufo-hunt.md
 *
 * Unlike Ghost Hunt's own view, there is no per-player index or find history to
 * carry — the whole round is public (spec §6), so this is a straight projection of
 * the referee's one broadcast frame.
 */
export type UfoHuntView = {
  roundId: number;
  startsAt: number;
  endsAt: number;
  wave: UfoWave;
  /** Running sum of each player's own shot damage. The score. */
  scores: Record<PlayerId, number>;
  /** Each player's own missile charge, 0…`UFOHUNT_MISSILE_CHARGE_GOAL` (spec §2.6). */
  missileCharge: Record<PlayerId, number>;
  winner: PlayerId | null;
  phase: 'running' | 'done';
  seq: number;
};

export type UfoHuntState = UfoHuntView | null;

/** Fold a server frame into the view. Same object back when nothing changed. */
export function applyUfoHunt(state: UfoHuntState, msg: ServerMessage): UfoHuntState {
  if (msg.t !== 'ufo-hunt') return state;
  if (state && msg.d.roundId < state.roundId) return state;
  const startingOver = !state || msg.d.roundId > state.roundId;
  if (!startingOver && state && msg.s <= state.seq) return state;

  return {
    roundId: msg.d.roundId,
    startsAt: msg.d.startsAt,
    endsAt: msg.d.endsAt,
    wave: msg.d.wave,
    scores: msg.d.scores,
    missileCharge: msg.d.missileCharge,
    winner: msg.d.winner,
    phase: msg.d.phase,
    seq: msg.s,
  };
}

/** This player's score. Zero for somebody who has not landed a shot, which is honest. */
export function scoreOf(state: UfoHuntView, id: PlayerId): number {
  return state.scores[id] ?? 0;
}

/** This player's own missile charge, 0…`UFOHUNT_MISSILE_CHARGE_GOAL`. */
export function missileChargeOf(state: UfoHuntView, id: PlayerId): number {
  return state.missileCharge[id] ?? 0;
}

/** Everyone, best first: highest score. Ties keep room order, which is stable. */
export function ranking(state: UfoHuntView, players: PlayerId[]): PlayerId[] {
  return [...players].sort((a, b) => scoreOf(state, b) - scoreOf(state, a));
}

/**
 * Who is winning, or null when nobody is.
 *
 * Null in two cases, the same two Ghost Hunt's own `leaderOf` guards against:
 * nobody has scored at all, or the top two are level — a tie has no leader
 * (core/ui/Scoreboard.tsx).
 */
export function leaderOf(state: UfoHuntView, players: PlayerId[]): PlayerId | null {
  const [first, second] = ranking(state, players);
  if (first === undefined || scoreOf(state, first) === 0) return null;
  if (second !== undefined && scoreOf(state, second) === scoreOf(state, first)) return null;
  return first;
}
