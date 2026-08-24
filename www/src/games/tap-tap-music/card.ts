import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Tap Tap Music's hub card. Contract: docs/design/illustrations.md
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
  slug: 'tap-tap-music',
  title: 'Tap Tap Music',
  pitch: 'Five circles light up at once. A miss only costs the last ten',
  concept: 'A hundred circles, one shared order. Tap any of the five lit ones, in any order.',
  rules: [
    'Five circles are lit — tap any of them, in any order.',
    'Tap anything else and you fall back to your last checkpoint of ten.',
    'No score — just a clock. First to clear all 100 wins.',
  ],
  art: {
    src: art,
    alt: 'A 10×10 grid of small circles, most hollow, five glowing orange across the grid',
  },
  fr: {
    pitch: 'Cinq cercles s’allument à la fois. Une erreur ne coûte que les dix derniers',
    concept: 'Cent cercles, un seul ordre partagé. Touchez l’un des cinq allumés, dans l’ordre de votre choix.',
    rules: [
      'Cinq cercles sont allumés — touchez-en un, dans l’ordre de votre choix.',
      'Touchez autre chose et vous retombez à votre dernier palier de dix.',
      'Pas de score — juste un chrono. Premier à effacer les 100 gagne.',
    ],
    art: { alt: 'Une grille de 10×10 petits cercles, la plupart creux, cinq allumés en orange dans la grille' },
  },
  accent: '#FB923C',
  players: PLAYERS['tap-tap-music'],
  duration: '30 s – 2 min',
  inputs: ['touch'],
  modes: [],
  status: 'live',
};
