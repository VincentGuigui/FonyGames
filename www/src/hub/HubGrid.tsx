import { Fragment, type JSX } from 'preact';
import { catalogue } from '../games/registry';
import { GameCardTile } from './GameCardTile';
import { flagFor, gameOfWeek, hottest, hubSections, type GameFlag } from '../../../shared/flags';
import { localizeCard } from '../core/i18n/localizeCard';
import type { Locale } from '../core/i18n/locale';
import type { GameTag } from '../core/types';

/**
 * The one card that isn't a real game (`www/src/games/random-game/card.ts`) — kept
 * as a plain slug literal, mirrored by hand in `scripts/ssr.mjs`'s `weekOrder()` and
 * `api/lib/Page.php`, the same way a one-off exception is handled elsewhere in this
 * codebase (`worker/router.ts`'s slug pattern and `Flags::slug()`) rather than
 * inventing a cross-language constant for a single case.
 */
const RANDOM_GAME_SLUG = 'random-game';

/**
 * The card grid, on its own.
 * Spec: docs/specs/hub.md §2 · docs/specs/seo.md §4
 *
 * Separate from `Hub` for one reason: the **build renders each card in isolation**, once
 * per flag state, so `index.php` can pick finished strings at request time and never
 * author markup of its own (seo.md §4). A grid glued into `Hub` could not be rendered a
 * card at a time.
 *
 * Five tiers: **Random Game always leads**, when it's live, then `hubSections`
 * (issue #4) supplies the next three — the week's spotlight and the hottest game
 * pinned at the top, then every NEW-flagged game alphabetically, then everything else
 * alphabetically — and a `soon` tier trails behind them, every not-yet-live game in
 * its curated `registry.ts` order, exactly where it always sat. `hubSections` only
 * ever sees `live` games: a `soon` card cannot be hot, spotlighted, or NEW, so it has
 * no business in that sort. A `.hub__spacer` separates every pair of non-empty tiers
 * **except pinned→fresh** and **random→anything**: hot/week and NEW are both "look at
 * this one" tiers, and a rule between them read as a boundary that was not there for
 * any other adjacent pair; Random Game is chrome rather than a tier of games, so it
 * reads as part of the header, not a section with a boundary under it. Never a
 * dangling spacer at the very top or bottom either. Flags still decide only *which*
 * cards appear.
 *
 * **A live game an operator has flagged `soon` (runtime, from the admin centre) also
 * trails behind everything else**, exactly like a build-time `soon` game — moved out
 * of whichever of pinned/fresh/rest its alphabetical slot would have put it in and
 * appended after `soon`'s own curated order. `cardState` already renders it exactly
 * like a build-time `soon` card (unplayable, the same badge); leaving it in place
 * among live cards would be the one case where a caveat card does not sit with the
 * others. `hot`/`week` are passed through unchanged even for a demoted slug — a
 * `soon` flag makes `cardState` ignore both anyway, so there is nothing to null out.
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
 * `RANDOM_GAME_SLUG` is excluded from that alphabetical list entirely, not merely
 * pinned first afterwards — it never opens a room, so it can never honestly earn
 * HOT, and leaving it in the rotation would occasionally hand it the WEEK badge and
 * spotlight, and by chance rather than by design, bump every real game's own turn.
 * `scripts/ssr.mjs`'s `weekOrder()` carries the identical exclusion, since that list
 * is also what `Page::grid()` receives (`$weekOrder`) — the one list both sides sort
 * from, so this can't drift into two different rotations.
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
    .filter((g) => g.status === 'live' && g.slug !== RANDOM_GAME_SLUG)
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((g) => g.slug);
  const hot = hottest(plays, alphabetical);
  const week = gameOfWeek(alphabetical, new Date());
  const { pinned, fresh, rest } = hubSections(alphabetical, flags, hot, week);

  // Any live game an operator has flagged `soon` moves out of its alphabetical tier
  // and joins the bottom, after the build-time `soon` games — see the doc comment
  // above. Order of the three `keep` calls decides `demoted`'s own order.
  const demoted: string[] = [];
  const keep = (slugs: string[]): string[] =>
    slugs.filter((slug) => {
      if (flagFor(flags, slug).state !== 'soon') return true;
      demoted.push(slug);
      return false;
    });
  const pinnedLive = keep(pinned);
  const freshLive = keep(fresh);
  const restLive = keep(rest);
  const soon = [...raw.filter((g) => g.status !== 'live').map((g) => g.slug), ...demoted];
  const randomGameLive = raw.some((g) => g.slug === RANDOM_GAME_SLUG && g.status === 'live');

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
      { key: 'random', slugs: randomGameLive ? [RANDOM_GAME_SLUG] : [] },
      { key: 'pinned', slugs: pinnedLive },
      { key: 'fresh', slugs: freshLive },
      { key: 'rest', slugs: restLive },
      { key: 'soon', slugs: soon },
    ] as const
  )
    .map((tier) => ({ ...tier, slugs: tier.slugs.filter(matchesFilter) }))
    .filter((tier) => tier.slugs.length > 0);

  return (
    <ul class="hub__grid">
      {tiers.map((tier, index) => {
        // The two adjacencies with no spacer: Random Game leading into anything, and
        // hot/week leading straight into NEW.
        const previous = tiers[index - 1];
        const spacer =
          index > 0 &&
          previous?.key !== 'random' &&
          !(tier.key === 'fresh' && previous?.key === 'pinned');
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
