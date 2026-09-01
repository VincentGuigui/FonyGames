import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Tilt Arena's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'tilt-arena',
  title: 'Tilt Arena',
  pitch: 'Tilt to steer, crash to win',
  concept: 'Everyone shares one board, and only tilt steers you.',
  rules: [
    'Tilt your phone to steer.',
    'Shove everyone else off the board.',
  ],
  art: { src: art, alt: 'A phone tilted inside a dashed circle' },
  accent: '#38BDF8',
  players: PLAYERS['tilt-arena'],
  duration: '2 min',
  inputs: ['orientation'],
  tags: ['physical'],
  modes: [],
  status: 'soon',
};
