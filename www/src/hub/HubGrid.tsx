import { Fragment, type JSX } from 'preact';
import { catalogue } from '../games/registry';
import { GameCardTile } from './GameCardTile';
import { flagFor, gameOfWeek, hottest, hubSections, type GameFlag } from '../../../shared/flags';
import { localizeCard } from '../core/i18n/localizeCard';
import type { Locale } from '../core/i18n/locale';

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
 * non-empty tiers, never a dangling one at the very top or bottom. Flags still decide
 * only *which* cards appear.
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
}: {
  flags: Record<string, GameFlag>;
  /** Rounds played per slug, from the published file. Absent until something is counted. */
  plays?: Record<string, number> | undefined;
  showAll: boolean;
  locale?: Locale;
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

  const sections = [pinned, fresh, rest, soon].filter((section) => section.length > 0);

  return (
    <ul class="hub__grid">
      {sections.map((section, index) => (
        <Fragment key={section[0]}>
          {index > 0 && <li class="hub__spacer" aria-hidden="true" />}
          {section.map(tile)}
        </Fragment>
      ))}
    </ul>
  );
}
