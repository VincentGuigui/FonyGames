import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Ghost Tag's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'ghost-tag',
  title: 'Ghost Tag',
  pitch: 'One ghost, a whole neighbourhood, and a map that only whispers',
  concept: 'The map tells the ghost less than it tells you — and lies to nobody.',
  rules: [
    'One player is the ghost.',
    'The map only hints where they are.',
    'Get caught and you join the ghost.',
  ],
  art: { src: art, alt: 'A ghost drifting upward on a dashed line' },
  accent: '#A3A3A3',
  players: PLAYERS['ghost-tag'],
  duration: '10 min',
  inputs: ['gps', 'motion'],
  tags: ['physical', 'outdoors'],
  modes: [],
  status: 'soon',
};
