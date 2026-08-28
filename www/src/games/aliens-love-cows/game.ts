import type { AbductBarn, PlayerId, ServerMessage } from '../../../../shared/protocol';

/**
 * What the phone knows about the match. Spec: docs/specs/games/aliens-love-cows.md
 *
 * Unlike almost every other game here, this is a straight projection of the
 * referee's one broadcast frame — the whole match is public (spec §6), so
 * there is no private half to fold in and no per-player index to carry.
 */
export type AbductView = {
  roundId: number;
  round: number;
  phase: 'waiting' | 'countdown' | 'revealing' | 'done';
  deadlineAt: number;
  barns: AbductBarn[];
  picks: Record<PlayerId, number | null>;
  target: number | null;
  abducted: PlayerId[];
  /** Every player ever abducted — permanently out, across the whole match. */
  out: PlayerId[];
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
    out: msg.d.out,
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
 * A triangle wave in `0..1`, sweeping back and forth just inside `margin` of
 * either end rather than touching it — shared shape behind `ufoDriftAt` and
 * `ufoHoverAt` below, the only difference between them being how fast it runs.
 *
 * A triangle, not a sine: constant speed reads as "patrolling," easing in and
 * out at the ends reads as "aiming," which neither of this UFO's own pre-reveal
 * decorations must ever do (spec §8).
 */
function triangleWave(elapsedMs: number, periodMs: number, margin: number): number {
  const phase = (elapsedMs % periodMs) / periodMs;
  const t = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  return margin + t * (1 - 2 * margin);
}

/**
 * The UFO's decorative drift above the five barns during choosing (spec §4, §8).
 *
 * Pure and deterministic in `elapsedMs` alone — it is never the referee's real
 * pick (drawn the instant choosing opens, but withheld from the wire until that
 * round's own reveal, spec §2, §8) and never scored, so two phones do not even
 * need to agree on it pixel-for-pixel. Determinism here is only so this file's
 * own test can assert something about the shape of the path, not a networking
 * requirement.
 *
 * Returns `x` in `0..1` across the row of barns, staying just inside the two
 * end barns so the saucer never sits squarely over barn 0 or barn 4 at rest —
 * a UFO parked dead-center over an edge barn while it drifts reads as a hint.
 */
export function ufoDriftAt(elapsedMs: number): number {
  return triangleWave(elapsedMs, 4_000, 0.12);
}

/**
 * The UFO's own faster sweep during the first `ABDUCT_HOVER_MS` of a reveal
 * (spec §4) — "hovers faster above all barns" before it commits to flying in
 * on the real target. Same shape as `ufoDriftAt`, just a shorter period; still
 * pure decoration, still nothing a client needs to agree on with another.
 */
export function ufoHoverAt(elapsedMs: number): number {
  return triangleWave(elapsedMs, 1_100, 0.12);
}

/**
 * Where cow number `index` (0-based) sits among `count` cows sharing one barn,
 * as a grid below it (spec — "clarify the timing" message, the grid table).
 * `col` is centred at 0 (negative = left, positive = right); a caller turns it
 * into pixels by multiplying by its own column gap. `row` counts down from 0.
 *
 * The grid is 1 column wide for up to 3 cows (stacked, so there is never a
 * side-by-side pair to misread as two different picks) and 2 columns beyond
 * that. When the count is odd and 2 columns wide, the last cow is alone in its
 * own row — centred (`col: 0`) rather than pinned to the left column, which is
 * what `(col - (cols - 1) / 2)` gives for free once that last cow is treated as
 * sitting between both columns (`col: 0.5` before centring).
 */
export function cowGridSlot(index: number, count: number): { col: number; row: number } {
  const cols = count <= 3 ? 1 : 2;
  const rows = Math.ceil(count / cols);
  const isLoneLastRow = cols === 2 && count % 2 === 1 && index === count - 1;

  const col = isLoneLastRow ? 0.5 : index % cols;
  const row = isLoneLastRow ? rows - 1 : Math.floor(index / cols);
  return { col: cols > 1 ? col - (cols - 1) / 2 : 0, row };
}
