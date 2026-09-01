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
  pitch: '66 mosquitoes to squash. Faster wins',
  concept: '',
  rules: [
    'Tap to squash a mosquito.',
    'For every dead mosquito, two more appear.',
    'Be the first to kill the 66 mosquitoes.',
  ],
  art: { src: art, alt: 'The game’s own purple mosquito, wings and all, crossed out inside a red no-entry circle' },
  fr: {
    pitch: '66 moustiques à écraser. Le plus rapide gagne',
    concept: '',
    rules: [
      'Tapez pour écraser un moustique',
      'Chaque moustique écrasé attire 2 autres moustiques',
      'Soyez le premier à écraser les 66 moustiques.',
    ],
    art: { alt: 'Le moustique violet du jeu, ailes comprises, barré dans un cercle d’interdiction rouge' },
  },
  accent: '#8A6DC9',
  players: PLAYERS['squash-mosquitoes'],
  duration: '1–2 min',
  inputs: ['touch'],
  tags: ['party', 'arcade', 'intense'],
  modes: [],
  status: 'live',
};
