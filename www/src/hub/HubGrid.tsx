import type { JSX } from 'preact';
import { catalogue } from '../games/registry';
import { GameCardTile } from './GameCardTile';
import { flagFor, hottest, promote, type GameFlag } from '../../../shared/flags';

/**
 * The card grid, on its own.
 * Spec: docs/specs/hub.md §2 · docs/specs/seo.md §4
 *
 * Separate from `Hub` for one reason: the **build renders each card in isolation**, once
 * per flag state, so `index.php` can pick finished strings at request time and never
 * author markup of its own (seo.md §4). A grid glued into `Hub` could not be rendered a
 * card at a time.
 *
 * The order is the curated one from `catalogue()`, with **one** exception: the most-played
 * game is pulled to the front and wears HOT (`hottest`/`promote` in shared/flags.ts).
 * Flags still decide only *which* cards appear.
 *
 * `index.php` applies the same two rules to the same numbers before it serves the page
 * (Page::grid), which is what keeps hydration exact — a grid the server ordered one way
 * and the client another is a mismatch on every card after the first.
 */
export function HubGrid({
  flags,
  plays,
  showAll,
}: {
  flags: Record<string, GameFlag>;
  /** Rounds played per slug, from the published file. Absent until something is counted. */
  plays?: Record<string, number> | undefined;
  showAll: boolean;
}): JSX.Element {
  const games = catalogue();
  const hot = hottest(plays, games.map((g) => g.slug));
  const order = promote(games.map((g) => g.slug), hot);
  const bySlug = new Map(games.map((g) => [g.slug, g]));

  return (
    <ul class="hub__grid">
      {order.map((slug) => {
        const game = bySlug.get(slug);
        if (!game) return null;
        return (
          <GameCardTile
            key={slug}
            game={game}
            flag={flagFor(flags, slug)}
            showAll={showAll}
            hot={slug === hot}
          />
        );
      })}
    </ul>
  );
}
