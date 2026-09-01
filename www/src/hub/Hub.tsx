import type { JSX, VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { catalogue } from '../games/registry';
import { HubGrid } from './HubGrid';
import { HubFilters } from './HubFilters';
import { HubAdminPreview, useAdminPreview } from './HubAdminPreview';
import { cardState, flagFor, type GameFlag } from '../../../shared/flags';
import type { GameTag } from '../core/types';
import { JoinByCode } from '../core/ui/JoinByCode';
import { LocalePicker } from '../core/ui/LocalePicker';
import { useLocale } from '../core/i18n/LocaleContext';
import { useT } from '../core/i18n/strings';
import { track } from '../core/analytics';

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
  const { locale } = useLocale();
  const t = useT();
  const [selectedTag, setSelectedTag] = useState<GameTag | null>(null);
  const [selectedPlayers, setSelectedPlayers] = useState<number | null>(null);
  const { isAdmin, effectiveShowAll, previewProd, setPreviewProd } = useAdminPreview(showAll);

  // "Nothing is playable yet" has to account for the flags, not just build-time status:
  // with every built game disabled, the shell notice is the honest thing to show.
  const anyPlayable = games.some((g) => cardState(g.status, flagFor(flags, g.slug), effectiveShowAll).playable);

  /*
   * Once per real page load. This runs only on the client — Preact effects never fire
   * during `scripts/ssr.mjs`'s build-time `renderToString` — so a build never reports a
   * pageview, only a browser hydrating one does.
   */
  useEffect(() => {
    track('hub_nav');
  }, []);

  return (
    <div class="hub">
      <header class="hub__header">
        <LocalePicker />
        <h1 class="hub__wordmark">FonyGames</h1>
        <p class="hub__tagline">{t.hub.tagline}</p>
      </header>

      <JoinByCode />

      {/* Dev-only, admin-only — `useAdminPreview` never even asks on prod (§ its own doc). */}
      {isAdmin && <HubAdminPreview previewProd={previewProd} onChange={setPreviewProd} />}

      <HubFilters
        games={games}
        tag={selectedTag}
        onTagChange={setSelectedTag}
        players={selectedPlayers}
        onPlayersChange={setSelectedPlayers}
      />

      {!anyPlayable && <p class="hub__notice">{t.hub.shellNotice}</p>}

      {grid ?? (
        <HubGrid
          flags={flags}
          plays={plays}
          showAll={effectiveShowAll}
          locale={locale}
          tag={selectedTag}
          players={selectedPlayers}
        />
      )}

      <footer class="hub__footer">
        <p>{t.hub.privacy}</p>
        <p>
          <a href="https://github.com/VincentGuigui/FonyGames">{t.hub.sourceLink}</a>
        </p>
      </footer>
    </div>
  );
}
