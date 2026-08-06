import type { JSX } from 'preact';
import { catalogue } from '../games/registry';
import { GameCardTile } from './GameCardTile';
import { flagFor, type GameFlag } from '../../../shared/flags';

/**
 * The card grid, on its own.
 * Spec: docs/specs/hub.md §2 · docs/specs/seo.md §4
 *
 * Separate from `Hub` for one reason: the **build renders each card in isolation**, once
 * per flag state, so `index.php` can pick finished strings at request time and never
 * author markup of its own (seo.md §4). A grid glued into `Hub` could not be rendered a
 * card at a time.
 *
 * The order is the curated one from `catalogue()`, unchanged — the flags decide *which*
 * cards appear, never in what order.
 */
export function HubGrid({
  flags,
  showAll,
}: {
  flags: Record<string, GameFlag>;
  showAll: boolean;
}): JSX.Element {
  return (
    <ul class="hub__grid">
      {catalogue().map((game) => (
        <GameCardTile key={game.slug} game={game} flag={flagFor(flags, game.slug)} showAll={showAll} />
      ))}
    </ul>
  );
}
