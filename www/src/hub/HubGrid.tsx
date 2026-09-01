import { Fragment, type JSX } from 'preact';
import { catalogue } from '../games/registry';
import { GameCardTile } from './GameCardTile';
import { flagFor, gameOfWeek, hottest, hubSections, type GameFlag } from '../../../shared/flags';
import { localizeCard } from '../core/i18n/localizeCard';
import type { Locale } from '../core/i18n/locale';
import type { GameTag } from '../core/types';

/**
 * The card grid, on its own.
 * Spec: docs/specs/hub.md §2 · docs/specs/seo.md §4
 *
 * Separate from `Hub` for one reason: the **build renders each card in isolation**, once
 * per flag state, so `index.php` can pick finished strings at request time and never
 * author markup of its own (seo.md §4). A grid glued into `Hub` could not be rendered a
 * card at a time.
 *
 * Four tiers: `hubSections` (issue #4) supplies the first three — the week's spotlight
 * and the hottest game pinned at the top, then every NEW-flagged game alphabetically,
 * then everything else alphabetically — and a `soon` tier trails behind them, every
 * not-yet-live game in its curated `registry.ts` order, exactly where it always sat.
 * `hubSections` only ever sees `live` games: a `soon` card cannot be hot, spotlighted,
 * or NEW, so it has no business in that sort. A `.hub__spacer` separates every pair of
 * non-empty tiers **except pinned→fresh**: hot/week and NEW are both "look at this
 * one" tiers, and a rule between them read as a boundary that was not there for any
 * other adjacent pair. Never a dangling spacer at the very top or bottom either. Flags
 * still decide only *which* cards appear.
 *
 * `index.php` applies the same rule to the same numbers before it serves the page
 * (`Page::grid`), which is what keeps hydration exact — a grid the server ordered one
 * way and the client another is a mismatch on every card after the first.
 *
 * The week's own spotlighted game (`gameOfWeek`) is computed from the **unlocalized**
 * catalogue — before `localizeCard` runs, on purpose, so a French visitor and an
 * English one are shown the same game rather than two different alphabetical orders of
 * two different sets of titles. The same alphabetical list also decides the NEW and
 * "everything else" tiers, so there is only ever the one sort to keep in step.
 *
 * `tag`/`players`, unlike everything above, are a purely client-side narrowing:
 * neither ever changes which tier a slug belongs to (so hot/week/NEW stay stable
 * while a filter changes), only whether that slug is skipped when a tier renders.
 * Both start `null` on the server's shell render and the client's first paint —
 * hydration is unaffected — and only ever change after a visitor picks something
 * in `HubFilters.tsx`'s selects (`Hub.tsx` owns the state).
 */
export function HubGrid({
  flags,
  plays,
  showAll,
  /**
   * Defaults to English so `scripts/ssr.mjs`'s build-time render — which has no
   * browser to detect a preference from — stays exactly what it always was; the
   * client re-renders with the real locale once `LocaleProvider` mounts.
   */
  locale = 'en',
  /** The type select's value (`HubFilters.tsx`). `null` means no filter. */
  tag,
  /** The player-count select's value. `null` means no filter, any count shows. */
  players,
}: {
  flags: Record<string, GameFlag>;
  /** Rounds played per slug, from the published file. Absent until something is counted. */
  plays?: Record<string, number> | undefined;
  showAll: boolean;
  locale?: Locale;
  tag?: GameTag | null;
  players?: number | null;
}): JSX.Element {
  const raw = catalogue();
  const games = raw.map((g) => localizeCard(g, locale));
  const bySlug = new Map(games.map((g) => [g.slug, g]));

  const alphabetical = raw
    .filter((g) => g.status === 'live')
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((g) => g.slug);
  const hot = hottest(plays, alphabetical);
  const week = gameOfWeek(alphabetical, new Date());
  const { pinned, fresh, rest } = hubSections(alphabetical, flags, hot, week);
  const soon = raw.filter((g) => g.status !== 'live').map((g) => g.slug);

  const matchesFilter = (slug: string): boolean => {
    const game = bySlug.get(slug);
    if (!game) return true;
    const tagOk = !tag || game.tags.includes(tag);
    const playersOk = !players || (game.players[0] <= players && players <= game.players[1]);
    return tagOk && playersOk;
  };

  const tile = (slug: string): JSX.Element | null => {
    const game = bySlug.get(slug);
    if (!game) return null;
    return (
      <GameCardTile
        key={slug}
        game={game}
        flag={flagFor(flags, slug)}
        showAll={showAll}
        hot={slug === hot}
        week={slug === week}
      />
    );
  };

  const tiers = (
    [
      { key: 'pinned', slugs: pinned },
      { key: 'fresh', slugs: fresh },
      { key: 'rest', slugs: rest },
      { key: 'soon', slugs: soon },
    ] as const
  )
    .map((tier) => ({ ...tier, slugs: tier.slugs.filter(matchesFilter) }))
    .filter((tier) => tier.slugs.length > 0);

  return (
    <ul class="hub__grid">
      {tiers.map((tier, index) => {
        // The one adjacency with no spacer: hot/week leading straight into NEW.
        const previous = tiers[index - 1];
        const spacer = index > 0 && !(tier.key === 'fresh' && previous?.key === 'pinned');
        return (
          <Fragment key={tier.slugs[0]}>
            {spacer && <li class="hub__spacer" aria-hidden="true" />}
            {tier.slugs.map(tile)}
          </Fragment>
        );
      })}
    </ul>
  );
}
