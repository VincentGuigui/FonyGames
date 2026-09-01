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
  pitch: 'Switch off every lamp as fast as you can',
  concept: 'A hundred lamps to switch off — no time to lose.',
  rules: [
    'Tap a lamp to switch it off.',
    'Tap anything else and you fall back to your last checkpoint of ten.',
    'First to switch off all 100 lamps wins.',
  ],
  art: {
    src: art,
    alt: 'A 10×10 grid of small circles, most hollow, five glowing orange across the grid',
  },
  fr: {
    pitch: 'Éteignez toutes les lampes le plus vite possible',
    concept: 'Cent lampes à éteindre sans perdre de temps.',
    rules: [
      'Toucher une lampe pour l’éteindre.',
      'Touchez autre chose et vous retombez à votre dernier palier de dix.',
      'Le premier à éteindre les 100 lampes gagne.',
    ],
    art: { alt: 'Une grille de 10×10 petits cercles, la plupart creux, cinq allumés en orange dans la grille' },
  },
  accent: '#FB923C',
  players: PLAYERS['tap-tap-music'],
  duration: '30 s – 2 min',
  inputs: ['touch'],
  tags: ['music', 'intense'],
  modes: [],
  status: 'live',
};
