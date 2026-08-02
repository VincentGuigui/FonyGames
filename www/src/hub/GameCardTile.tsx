import type { JSX } from 'preact';
import type { GameCard, GameInput } from '../core/types';
import { GameIllustration } from './GameIllustration';

/**
 * One card = one promise in a glance: one illustration, one catchy sentence.
 * No feature list, no "learn more" (docs/design/ui-guidelines.md §3).
 */

// Plain words, not emoji: 📳 and friends render as tofu boxes on devices
// missing those glyphs, and a broken box tells the player nothing.
const INPUT_LABEL: Record<GameInput, string> = {
  touch: 'touch',
  motion: 'motion',
  orientation: 'tilt',
  gps: 'GPS',
  compass: 'compass',
  mic: 'mic',
};

export function GameCardTile({ game }: { game: GameCard }): JSX.Element {
  const [min, max] = game.players;
  // `soon` cards are shown honestly and are not tappable (hub spec §2).
  const playable = game.status !== 'soon';

  const meta = `${min}–${max} players · ${game.duration} · ${game.inputs
    .map((i) => INPUT_LABEL[i])
    .join(' + ')}`;

  const inner = (
    <>
      <div class="game-card__art">
        <GameIllustration motif={game.motif} accent={game.accent} />
        {game.status !== 'live' && (
          <span class={`game-card__badge game-card__badge--${game.status}`}>
            {game.status === 'soon' ? 'soon' : 'beta'}
          </span>
        )}
      </div>
      <div class="game-card__body">
        <h2 class="game-card__title">{game.title}</h2>
        <p class="game-card__pitch">{game.pitch}</p>
        <p class="game-card__meta">{meta}</p>
      </div>
    </>
  );

  if (!playable) {
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
