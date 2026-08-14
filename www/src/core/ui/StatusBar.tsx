import type { ComponentChildren, JSX } from 'preact';
import { GameMenu } from './GameMenu';

/**
 * The one row across the top of every game screen.
 * Spec: docs/design/game-chrome.md §7
 *
 * Every game had grown its own: `.steady__bar`, `.rush__bar`, `.hunt__bar`,
 * `.spill__hud` — the same three things (where I stand, where my opponent stands,
 * the menu) in four arrangements, at four sizes, in four places. Learning your way
 * around one game's chrome taught you nothing about the next, and Spill put the
 * other player's score *nowhere near the top* in a two-player round because its
 * positional display is designed for a table of four.
 *
 * So the arrangement is fixed here and a game chooses only what to put in it:
 *
 *   [ my score / status ]                        [ ☰ ]
 *
 * ## Other players are NOT on this bar
 *
 * There used to be an opponent slot here, filled only in a two-player round because
 * with three or more a single "them" is a lie. That made the answer to "how am I
 * doing" arrive in one place at two players and somewhere else at three, and left
 * every screen computing which case it was in. Everyone's score now lives in one
 * panel that is the same at every head count — `core/ui/Scoreboard.tsx`.
 */

export type StatusScore = {
  /** The number that matters. A string so a game can pass "0.42" or "12s". */
  value: string | number;
  /** What it counts. Omitted when the number speaks for itself. */
  label?: string;
};

export function StatusBar({
  score,
  status,
  title,
  concept,
  rules,
  children,
}: {
  /*
   * `| undefined` on both, deliberately: `exactOptionalPropertyTypes` is on, and both
   * are COMPUTED by the caller — a status is conditional on the phase, a score is
   * absent in a game that has none. Without it each call site would have to spread
   * the prop in conditionally, which is noise around the one thing this component
   * exists to make uniform.
   */
  score?: StatusScore | undefined;
  /** Free text for a game whose state is not a number — "3 still in". */
  status?: string | undefined;
  title: string;
  concept: string;
  rules: string[];
  /** Extra panels inside the menu, e.g. Spill's seat map. */
  children?: ComponentChildren | undefined;
}): JSX.Element {
  return (
    <div class="statusbar">
      <div class="statusbar__mine">
        {score && (
          <p class="statusbar__score">
            <strong class="statusbar__value">{score.value}</strong>
            {score.label && <span class="statusbar__label">{score.label}</span>}
          </p>
        )}
        {status && <p class="statusbar__status">{status}</p>}
      </div>

      <GameMenu title={title} concept={concept} rules={rules}>
        {children}
      </GameMenu>
    </div>
  );
}
