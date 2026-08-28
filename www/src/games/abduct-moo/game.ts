import type { AbductBarn, PlayerId, ServerMessage } from '../../../../shared/protocol';

/**
 * What the phone knows about the match. Spec: docs/specs/games/abduct-moo.md
 *
 * Unlike almost every other game here, this is a straight projection of the
 * referee's one broadcast frame — the whole match is public (spec §6), so
 * there is no private half to fold in and no per-player index to carry.
 */
export type AbductView = {
  roundId: number;
  round: number;
  phase: 'choosing' | 'revealing' | 'done';
  deadlineAt: number;
  barns: AbductBarn[];
  picks: Record<PlayerId, number | null>;
  target: number | null;
  abducted: PlayerId[];
  scores: Record<PlayerId, number>;
  winner: PlayerId | null;
  seq: number;
};

export type AbductState = AbductView | null;

/** Fold a server frame into the view. Same object back when nothing changed. */
export function applyAbduct(state: AbductState, msg: ServerMessage): AbductState {
  if (msg.t !== 'abduct') return state;
  if (state && msg.d.roundId < state.roundId) return state;
  const startingOver = !state || msg.d.roundId > state.roundId;
  if (!startingOver && state && msg.s <= state.seq) return state;

  return {
    roundId: msg.d.roundId,
    round: msg.d.round,
    phase: msg.d.phase,
    deadlineAt: msg.d.deadlineAt,
    barns: msg.d.barns,
    picks: msg.d.picks,
    target: msg.d.target,
    abducted: msg.d.abducted,
    scores: msg.d.scores,
    winner: msg.d.winner,
    seq: msg.s,
  };
}

/** This player's score. Zero for somebody who has not yet been credited any, which is honest. */
export function scoreOf(state: AbductView, id: PlayerId): number {
  return state.scores[id] ?? 0;
}

/** Everyone, best first: highest score. Ties keep room order, which is stable. */
export function ranking(state: AbductView, players: PlayerId[]): PlayerId[] {
  return [...players].sort((a, b) => scoreOf(state, b) - scoreOf(state, a));
}

/**
 * Who is winning, or null when nobody is.
 *
 * Null in two cases, the same two UFO Hunt's own `leaderOf` guards against:
 * nobody has scored at all, or the top two are level — a tie has no leader
 * (core/ui/Scoreboard.tsx). Used for the live in-round standing; `winner` on
 * the wire itself is the referee's own, final answer once `phase === 'done'`.
 */
export function leaderOf(state: AbductView, players: PlayerId[]): PlayerId | null {
  const [first, second] = ranking(state, players);
  if (first === undefined || scoreOf(state, first) === 0) return null;
  if (second !== undefined && scoreOf(state, second) === scoreOf(state, first)) return null;
  return first;
}

/**
 * The UFO's decorative drift above the five barns during choosing (spec §4, §8).
 *
 * Pure and deterministic in `elapsedMs` alone — it is never the referee's real
 * pick (drawn only at the choosing deadline, spec §2) and never scored, so two
 * phones do not even need to agree on it pixel-for-pixel (spec §8). Determinism
 * here is only so this file's own test can assert something about the shape of
 * the path, not a networking requirement.
 *
 * Returns `x` in `0..1` across the row of barns, sweeping back and forth just
 * inside the two end barns so the saucer never sits squarely over barn 0 or
 * barn 4 at rest — a UFO parked dead-center over an edge barn while it drifts
 * reads as a hint, which it must never be (spec §8).
 */
export function ufoDriftAt(elapsedMs: number): number {
  const PERIOD_MS = 4_000;
  const MARGIN = 0.12;
  const phase = (elapsedMs % PERIOD_MS) / PERIOD_MS;
  // A triangle wave, not a sine: constant speed reads as "patrolling," easing
  // in and out at the ends reads as "aiming," which this decoration must not.
  const t = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  return MARGIN + t * (1 - 2 * MARGIN);
}
