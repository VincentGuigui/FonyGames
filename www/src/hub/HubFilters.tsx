import type { JSX } from 'preact';
import type { GameCard, GameTag } from '../core/types';
import { useT } from '../core/i18n/strings';

/**
 * The hub's filter chip row. Spec: docs/specs/hub.md §3
 *
 * Fixed order rather than however `tags` happens to be declared on `GameTag`
 * (`core/types.ts`) or discovered across the catalogue — a chip that moves
 * around between renders, or between one game shipping and the next, would be
 * the one piece of chrome a returning visitor has to re-scan every time.
 *
 * Only chips a **live** game actually carries are shown: a tag nobody has yet
 * would be a filter that always empties the grid. `game.status` rather than a
 * flag, on purpose — a flag can black out a whole tag temporarily and the chip
 * would flicker; `status` is the build-time question of whether the code
 * backing that game exists at all, which is what deciding "is this tag worth
 * offering" should turn on.
 */
const TAG_ORDER: readonly GameTag[] = [
  'party',
  'duel',
  'physical',
  'outdoors',
  'strategy',
  'arcade',
  'augmented-reality',
  'luck',
  'music',
  'intense',
];

export function HubFilters({
  games,
  selected,
  onToggle,
  onClear,
}: {
  games: GameCard[];
  selected: ReadonlySet<GameTag>;
  onToggle: (tag: GameTag) => void;
  onClear: () => void;
}): JSX.Element | null {
  const t = useT();
  const present = TAG_ORDER.filter((tag) => games.some((g) => g.status === 'live' && g.tags.includes(tag)));
  if (present.length === 0) return null;

  return (
    <div class="hub__filters" role="group" aria-label={t.hub.filterLabel}>
      <button
        type="button"
        class={`hub__filter-chip${selected.size === 0 ? ' is-on' : ''}`}
        aria-pressed={selected.size === 0}
        onClick={onClear}
      >
        {t.hub.filterAll}
      </button>
      {present.map((tag) => (
        <button
          key={tag}
          type="button"
          class={`hub__filter-chip${selected.has(tag) ? ' is-on' : ''}`}
          aria-pressed={selected.has(tag)}
          onClick={() => onToggle(tag)}
        >
          {t.tag[tag]}
        </button>
      ))}
    </div>
  );
}
