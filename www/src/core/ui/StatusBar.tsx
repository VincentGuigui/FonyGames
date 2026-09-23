import type { ComponentChildren, JSX } from 'preact';
import { GameMenu } from './GameMenu';
import { fullscreenSupported, goFullscreen } from '../screen';
import type { GameScreen } from '../types';
import { useT } from '../i18n/strings';

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
 *   [ my score / status ]                        [ ⛶ ] [ ☰ ]
 *
 * ## Other players are NOT on this bar
 *
 * An opponent slot here could only be filled in a two-player round, because with three
 * or more a single "them" is a lie — so the answer to "how am I doing" would arrive in
 * one place at two players and somewhere else at three, with every screen computing
 * which case it was in. Everyone's score lives in one panel that is the same at every
 * head count instead — `core/ui/Scoreboard.tsx`.
 *
 * ## The fullscreen button is CSS-shown, not state-shown
 *
 * A game that asked for fullscreen (`screen.fullscreen`) can find itself out of it
 * again without ever choosing to leave — the system back gesture, the Escape key, a
 * notification that took over the screen — and there is no event this component
 * needs to listen for to know that happened: `html:fullscreen .statusbar__fullscreen`
 * (game-chrome.css) hides the button exactly while `document.documentElement` is the
 * fullscreen element, and shows it the instant that stops being true, live, with no
 * `fullscreenchange` listener or re-render to keep in step. What IS decided here,
 * once, is whether the browser has the API at all (`fullscreenSupported`) — iPhone
 * Safari does not, and a button that can only ever tap into silence is worse than
 * none.
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
  screen,
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
  /** A game's fullscreen/orientation wishes (device-capabilities.md §5b) — only
   *  `fullscreen` matters here, for the re-entry button described above. Absent for
   *  the games that never asked, which is most of them, and the button is simply
   *  not there. */
  screen?: GameScreen | undefined;
  /** Extra panels inside the menu, e.g. Spill's seat map. */
  children?: ComponentChildren | undefined;
}): JSX.Element {
  const t = useT();
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

      {screen?.fullscreen && fullscreenSupported() && (
        <button
          class="statusbar__fullscreen"
          type="button"
          aria-label={t.common.fullscreen}
          onClick={() => void goFullscreen(document.documentElement)}
        >
          <ExpandIcon />
        </button>
      )}

      <GameMenu title={title} concept={concept} rules={rules}>
        {children}
      </GameMenu>
    </div>
  );
}

/** Four open corners — the standard "enter fullscreen" glyph, same stroke style as
 *  `GameMenu.tsx`'s gear and `CloseButton.tsx`'s cross. */
function ExpandIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
