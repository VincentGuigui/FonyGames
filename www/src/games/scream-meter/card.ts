import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Scream Meter's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'scream-meter',
  title: 'Scream Meter',
  pitch: 'Loudest wins. Your neighbours will not be thanked',
  concept: 'One number, one lung-full, no strategy whatsoever.',
  rules: [
    'Make as much noise as you can.',
    'Loudest reading wins the round.',
  ],
  art: { src: art, alt: 'A phone with sound waves rippling out of it' },
  accent: '#F472B6',
  players: PLAYERS['scream-meter'],
  duration: '1 min',
  inputs: ['mic'],
  tags: ['physical'],
  modes: [],
  status: 'soon',
};
