import type { JSX, VNode } from 'preact';
import { catalogue } from '../games/registry';
import { HubGrid } from './HubGrid';
import { cardState, flagFor, type GameFlag } from '../../../shared/flags';
import { JoinByCode } from '../core/ui/JoinByCode';

/**
 * The hub: a stranger should want to play something within ten seconds.
 * Spec: docs/specs/hub.md
 *
 * The hub is inert — no permission request, no sensor listener, no socket.
 * Those only ever happen inside a game lobby.
 */
export function Hub({
  flags = {},
  plays,
  showAll = false,
  grid,
}: {
  /** From the server-rendered page, inlined — never fetched (docs/specs/seo.md §4). */
  flags?: Record<string, GameFlag>;
  /** Rounds played per slug, inlined the same way. Orders the grid and picks HOT. */
  plays?: Record<string, number> | undefined;
  showAll?: boolean;
  /**
   * Replaces the grid. Used **only** by the build's shell render, which needs a page
   * with a marker where the cards go so `index.php` can splice them in per request.
   */
  grid?: VNode;
} = {}): JSX.Element {
  const games = catalogue();

  // "Nothing is playable yet" has to account for the flags, not just build-time status:
  // with every built game disabled, the shell notice is the honest thing to show.
  const anyPlayable = games.some((g) => cardState(g.status, flagFor(flags, g.slug), showAll).playable);

  return (
    <div class="hub">
      <header class="hub__header">
        <h1 class="hub__wordmark">FonyGames</h1>
        <p class="hub__tagline">
          Silly multiplayer games for the phone already in your pocket.
        </p>
      </header>

      <JoinByCode />

      {!anyPlayable && (
        <p class="hub__notice">
          Nothing is playable yet — this is the shell. Cards show what's coming.
        </p>
      )}

      {grid ?? <HubGrid flags={flags} plays={plays} showAll={showAll} />}

      <footer class="hub__footer">
        <p>
          No install, no account. Nothing you do is stored — positions and
          sensor readings never leave the room you're playing in.
        </p>
        <p>
          <a href="https://github.com/VincentGuigui/FonyGames">Source on GitHub</a>
        </p>
      </footer>
    </div>
  );
}
