import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Compass Hunt's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'compass-hunt',
  title: 'Compass Hunt',
  pitch: 'Follow the arrow to the treasure — so is everyone else',
  concept: 'Everyone gets the same arrow, so the race is the game.',
  rules: [
    'Follow the arrow to the treasure.',
    'Everyone else is following it too.',
  ],
  art: { src: art, alt: 'A compass needle pointing north' },
  accent: '#FBBF24',
  players: PLAYERS['compass-hunt'],
  duration: '10 min',
  inputs: ['compass', 'gps'],
  modes: [],
  status: 'soon',
};
