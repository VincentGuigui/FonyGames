import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * 100 Taps' hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and
 * its own `art/`. The hub imports every card, so one import of this game's
 * runtime would put the whole game in the hub's chunk — `www/src/games/cards.test.mjs`
 * enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here
 * without changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'hundred-taps',
  title: '100 Taps',
  pitch: 'Find them in order. Fastest fingers win',
  concept: 'A hundred numbers, one shared shuffle. Every one visible — tap them in order.',
  rules: [
    'All 100 numbers are on the board — find the next one and tap it.',
    'Tap anything else and you fall back to your last checkpoint of ten.',
    'No score — just a clock. First to clear all 100 wins.',
  ],
  art: {
    src: art,
    alt: 'A 10×10 grid of small circles in a pink-to-violet gradient, a few marked with numbers',
  },
  fr: {
    pitch: 'Trouvez-les dans l’ordre. Les doigts les plus rapides gagnent',
    concept: 'Cent nombres, un seul mélange partagé. Tous visibles — touchez-les dans l’ordre.',
    rules: [
      'Les 100 nombres sont sur le plateau — trouvez le suivant et touchez-le.',
      'Touchez autre chose et vous retombez à votre dernier palier de dix.',
      'Pas de score — juste un chrono. Premier à effacer les 100 gagne.',
    ],
    art: { alt: 'Une grille de 10×10 petits cercles en dégradé rose-violet, quelques-uns marqués de chiffres' },
  },
  accent: '#7C3AED',
  players: PLAYERS['hundred-taps'],
  duration: '30 s – 2 min',
  inputs: ['touch'],
  tags: ['party', 'intense'],
  modes: [],
  status: 'live',
};
