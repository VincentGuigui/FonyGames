import type { JSX } from 'preact';
import type { PlayerId } from '../../../../shared/protocol';

/**
 * Everyone else's score, along the top of a game screen.
 * Rules: docs/design/game-chrome.md §5
 *
 * Shared on purpose. Every game in the catalogue is a race against the other
 * players, so every game needs the same glance: *how am I doing against them?*
 * Written once, it also means the answer looks the same in each of them — a
 * per-game version drifted into three different shapes the first time it was
 * tried, which is the same reason the rules panel and the gear menu are shared.
 *
 * It renders **nothing** when there are no opponents, so a solo game or a
 * spectator gets no empty strip.
 */

export type OpponentScore = {
  id: PlayerId;
  /** Emoji. Decorative — the name carries the meaning. */
  avatar: string;
  name: string;
  score: number;
  /** Knocked out. Drawn dimmed *and* struck through, never by colour alone. */
  out?: boolean;
};

export function OpponentScores({
  scores,
  unit,
}: {
  scores: OpponentScore[];
  /**
   * What the number counts — "pucks", "cabbages". Read by screen readers and
   * shown once for the row, not repeated against every player: at this size the
   * repetition costs more room than it buys clarity.
   */
  unit: string;
}): JSX.Element | null {
  if (scores.length === 0) return null;

  return (
    <ul class="oppscores" aria-label={`Other players' ${unit}`}>
      {scores.map((s) => (
        <li key={s.id} class={`oppscores__item${s.out ? ' oppscores__item--out' : ''}`}>
          <span class="oppscores__avatar" aria-hidden="true">
            {s.avatar}
          </span>
          <span class="oppscores__name">{s.name}</span>
          <strong class="oppscores__score">
            {s.score}
            <span class="visually-hidden"> {unit}</span>
          </strong>
        </li>
      ))}
    </ul>
  );
}
