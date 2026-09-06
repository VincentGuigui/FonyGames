import type { JSX } from 'preact';
import { arrange, type BestIs, type Me, type ScoreRow } from './Scoreboard';

/**
 * Everyone's score across the bottom of the board, four to a line.
 * Spec: docs/design/game-chrome.md §6
 *
 * The corner `Scoreboard` is a **peripheral** panel: it tucks into a corner so
 * it does not eat a board that is the game. Some games have no such board —
 * the two colour games end a round with a number and nothing else to look at —
 * and there the scores are the thing worth the width, not furniture to be
 * tucked away.
 *
 * So this is the same component with a different footprint, not a different
 * component: it reuses `arrange()` for the ordering rules that make a
 * scoreboard readable (you are always first, the leader is bold and only when
 * there is one), and its stylesheet reuses the corner panel's own tokens. What
 * differs is the shape — full width, in the flow rather than fixed, and a grid
 * of up to four players a line so eight fit in two rows without scrolling.
 *
 * It renders for a lone player too, unlike the corner panel: a game whose whole
 * bottom third is the scoreboard looks broken with a hole in it, and a solo run
 * against a ladder still wants its own total in front of it.
 */
export function WideScoreboard({
  rows,
  me,
  unit,
  best = 'high',
  label,
}: {
  rows: ScoreRow[];
  me: Me;
  /** What the number counts. For screen readers — said once per row rather
   *  than drawn, exactly as the corner panel does it. */
  unit: string;
  best?: BestIs;
  label: string;
}): JSX.Element | null {
  if (rows.length === 0) return null;

  return (
    <ul class="wscores" aria-label={label}>
      {arrange(rows, me, best).map((r) => (
        <li
          key={r.id}
          class={
            'wscores__cell' +
            (r.me ? ' wscores__cell--me' : '') +
            (r.best ? ' wscores__cell--best' : '') +
            (r.out ? ' wscores__cell--out' : '')
          }
        >
          <span class="wscores__avatar" aria-hidden="true">
            {r.avatar}
          </span>
          <span class="wscores__name">{r.name}</span>
          <span class="wscores__value">
            {r.value}
            <span class="visually-hidden"> {unit}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
