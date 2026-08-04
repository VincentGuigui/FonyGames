import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Zone Rush's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'zone-rush',
  title: 'Zone Rush',
  pitch: 'Claim real streets by standing on them longer than your rivals',
  concept: 'Ground is claimed by standing on it, not by tapping.',
  rules: [
    'Stand in a zone to start claiming it.',
    'Hold it longer than anyone else.',
  ],
  art: { src: art, alt: 'A grid of squares, half of them claimed' },
  accent: '#FB7185',
  players: PLAYERS['zone-rush'],
  duration: '10 min',
  inputs: ['gps'],
  modes: [],
  status: 'soon',
};
