import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Ghost Hunt's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'ghost-hunt',
  title: 'Ghost Hunt',
  pitch: 'Sweep the room for ghosts only your phone can see',
  concept: 'The ring shows the room as outlines — the ghost hides in there.',
  rules: [
    'Hold your phone up and sweep the room.',
    'The ring shows edges — find the ghost in it.',
    'Most ghosts in 90 seconds wins.',
  ],
  art: { src: art, alt: 'A phone held up, its screen a bright ring of traced edges' },
  accent: '#34D399',
  players: PLAYERS['ghost-hunt'],
  duration: '90 s',
  inputs: ['orientation', 'camera', 'touch'],
  modes: [],
  status: 'new',
};
