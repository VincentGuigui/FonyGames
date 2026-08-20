import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Tap Tap Revolution's hub card. Contract: docs/design/illustrations.md
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
  slug: 'tap-tap-revolution',
  title: 'Tap Tap Revolution',
  pitch: 'Chase the lit circle. A miss only costs the last ten',
  concept: 'A hundred circles, one shared order. Tap the lit one, or fall back to the last checkpoint.',
  rules: [
    'Tap the one lit circle and the next one lights up.',
    'Tap anything else and you fall back to your last checkpoint of ten.',
    'No score — just a clock. First to clear all 100 wins.',
  ],
  art: {
    src: art,
    alt: 'A 10×10 grid of small circles, most hollow, one glowing orange mid-grid',
  },
  fr: {
    pitch: 'Poursuivez le cercle allumé. Une erreur ne coûte que les dix derniers',
    concept: 'Cent cercles, un seul ordre partagé. Touchez celui qui est allumé, ou retombez au dernier palier.',
    rules: [
      'Touchez le seul cercle allumé et le suivant s’allume.',
      'Touchez autre chose et vous retombez à votre dernier palier de dix.',
      'Pas de score — juste un chrono. Premier à effacer les 100 gagne.',
    ],
    art: { alt: 'Une grille de 10×10 petits cercles, la plupart creux, un allumé en orange au milieu' },
  },
  accent: '#FB923C',
  players: PLAYERS['tap-tap-revolution'],
  duration: '30 s – 2 min',
  inputs: ['touch'],
  modes: [],
  status: 'live',
};
