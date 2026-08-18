import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Squash Mosquitoes' hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'squash-mosquitoes',
  title: 'Squash Mosquitoes',
  pitch: 'Squash all 66 before anyone else does',
  concept: 'The same 66 hiding spots as everyone else. Squash one and two more appear.',
  rules: [
    'Squash a mosquito to make two more appear.',
    'Squashed mosquitoes stay put, so the board fills with red.',
    'Halfway through, the swarm starts flying. First to 66 wins.',
  ],
  art: { src: art, alt: 'A purple mosquito silhouette crossed out inside a red no-entry circle' },
  accent: '#8A6DC9',
  players: PLAYERS['squash-mosquitoes'],
  duration: '1–2 min',
  inputs: ['touch'],
  modes: [],
  status: 'live',
};
