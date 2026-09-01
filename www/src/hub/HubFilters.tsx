import type { JSX } from 'preact';
import type { GameCard, GameTag } from '../core/types';
import { useT } from '../core/i18n/strings';

/**
 * The hub's two filter selects. Spec: docs/specs/hub.md §3
 *
 * Both are native `<select>` elements, not chips: a game is exactly one type at
 * a time in this filter (unlike the up-to-three tags a card itself carries) and
 * a player count is a single number, so a dropdown is the honest control for
 * either — no multi-select semantics to explain, and it is the one form control
 * every phone already renders as a native picker.
 *
 * Fixed tag order rather than however `GameTag` (`core/types.ts`) happens to be
 * declared, or discovered across the catalogue — an option that moves around
 * between renders, or between one game shipping and the next, would be the one
 * piece of chrome a returning visitor has to re-scan every time.
 *
 * Only options a **live** game actually earns are offered: a tag nobody has yet,
 * or a headcount nothing accepts, would be a choice that always empties the
 * grid. `game.status` rather than a flag, on purpose — a flag can black out a
 * whole tag temporarily and the option would flicker; `status` is the
 * build-time question of whether the code backing that game exists at all,
 * which is what deciding "is this worth offering" should turn on.
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
  tag,
  onTagChange,
  players,
  onPlayersChange,
}: {
  games: GameCard[];
  tag: GameTag | null;
  onTagChange: (tag: GameTag | null) => void;
  players: number | null;
  onPlayersChange: (players: number | null) => void;
}): JSX.Element | null {
  const t = useT();
  const live = games.filter((g) => g.status === 'live');
  const presentTags = TAG_ORDER.filter((candidate) => live.some((g) => g.tags.includes(candidate)));
  const maxPlayers = live.reduce((max, g) => Math.max(max, g.players[1]), 0);

  if (presentTags.length === 0 && maxPlayers === 0) return null;

  return (
    <div class="hub__filters">
      {presentTags.length > 0 && (
        <label class="hub__filter-field">
          <span class="hub__filter-label">{t.hub.filterLabel}</span>
          <select
            class="hub__filter-select"
            value={tag ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onTagChange(value === '' ? null : (value as GameTag));
            }}
          >
            <option value="">{t.hub.filterAll}</option>
            {presentTags.map((candidate) => (
              <option key={candidate} value={candidate}>
                {t.tag[candidate]}
              </option>
            ))}
          </select>
        </label>
      )}
      {maxPlayers > 0 && (
        <label class="hub__filter-field">
          <span class="hub__filter-label">{t.hub.playersLabel}</span>
          <select
            class="hub__filter-select"
            value={players ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onPlayersChange(value === '' ? null : Number(value));
            }}
          >
            <option value="">{t.hub.playersAny}</option>
            {Array.from({ length: maxPlayers }, (_, index) => index + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
