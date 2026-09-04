import type { JSX } from 'preact';
import type { GameCard, GameInput } from '../core/types';
import { GameIllustration } from './GameIllustration';
import { cardState, DEFAULT_FLAG, type GameFlag } from '../../../shared/flags';
import { useT } from '../core/i18n/strings';

/**
 * One card = one promise in a glance: one illustration, one catchy sentence.
 * No feature list, no "learn more" (docs/design/ui-guidelines.md §3).
 *
 * ## Presentation is decided by `cardState`, not here
 *
 * Whether a card shows, whether it is tappable and what badge it wears comes from
 * `cardState()` in `shared/flags.ts` — the same function the admin centre uses to answer
 * "what does a player see" and the same one the build calls when it renders these cards
 * for `index.php` (docs/specs/seo.md §4). Three readers, one rule: a second copy of it
 * here is how the hub and the server-rendered page would come to disagree.
 */

// Plain words, not emoji: 📳 and friends render as tofu boxes on devices
// missing those glyphs, and a broken box tells the player nothing.
const INPUT_LABEL: Record<GameInput, string> = {
  touch: 'touch',
  motion: 'motion',
  orientation: 'tilt',
  gps: 'GPS',
  compass: 'compass',
  camera: 'camera',
  mic: 'mic',
};

export function GameCardTile({
  game,
  flag = DEFAULT_FLAG,
  showAll = false,
  hot = false,
  week = false,
}: {
  game: GameCard;
  flag?: GameFlag;
  /** dev shows every game with a badge stating what prod would do (spec §2b). */
  showAll?: boolean;
  /** The most-played game. Decided by the grid, not here — see `hottest`. */
  hot?: boolean;
  /** The week's own spotlighted game. Decided by the grid, not here — see `gameOfWeek`. */
  week?: boolean;
}): JSX.Element | null {
  const t = useT();
  const view = cardState(game.status, flag, showAll, hot, week);

  // A hidden game is not rendered at all — not hidden with CSS, which would still put
  // its title and its link in the document for anyone who looked.
  if (!view.show) return null;

  const [min, max] = game.players;

  // A game with a fixed player count reads "2 players", not "2–2 players".
  const who = min === max ? `${min} players` : `${min}–${max} players`;
  const meta = [
    game.showPlayerCount === false ? null : who,
    game.showDuration === false ? null : game.duration,
    game.showInputs === false ? null : game.inputs.map((i) => INPUT_LABEL[i]).join(' + '),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  /*
   * Which badge, and why it is one field rather than two.
   *
   * `view.badge` already folds together build-time `status` and the runtime flag state
   * on the stricter reading — a `soon` game says `soon` whatever the flag says, and a
   * `soon`-state game with a reason says the reason instead. The class only needs to
   * know whether to shout: HOT and NEW are invitations, the rest are caveats, so a
   * custom reason gets the same visual treatment as the literal word "soon".
   */
  const badgeKind =
    view.badge === 'hot'
      ? 'hot'
      : view.badge === 'week'
        ? 'week'
        : view.badge === 'new'
          ? 'new'
          : view.badge === 'hidden'
            ? 'hidden'
            : 'soon';

  /*
   * `hot`/`week`/`new`/`soon`/`hidden` are the fixed tokens `cardState` can return, and
   * each has a translation. Anything else is a `soon`-state game's own reason
   * (`flag.reason`) — the operator's free text, not a constant, so it passes through as-is
   * rather than through this table.
   */
  const badgeText =
    view.badge === null
      ? null
      : view.badge === 'hot' ||
          view.badge === 'week' ||
          view.badge === 'new' ||
          view.badge === 'soon' ||
          view.badge === 'hidden'
        ? t.badge[view.badge]
        : view.badge;

  const inner = (
    <>
      <div class="game-card__art">
        <GameIllustration art={game.art} accent={game.accent} />
        {badgeText !== null && (
          <span class={`game-card__badge game-card__badge--${badgeKind}`}>{badgeText}</span>
        )}
      </div>
      <div class="game-card__body">
        <h2 class="game-card__title">{game.title}</h2>
        <p class="game-card__pitch">{game.pitch}</p>
        <p class="game-card__meta">{meta}</p>
      </div>
    </>
  );

  if (!view.playable) {
    // No `<a>` at all, rather than a disabled-looking one: a link that navigates to a
    // lobby the Worker will refuse is a worse experience than no link.
    return (
      <li class="game-card game-card--soon" aria-disabled="true">
        {inner}
      </li>
    );
  }

  return (
    <li class="game-card">
      <a
        class="game-card__link"
        href={`/${game.slug}/`}
        style={{ '--card-accent': game.accent } as JSX.CSSProperties}
      >
        {inner}
      </a>
    </li>
  );
}
