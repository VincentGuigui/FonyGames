import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Rhino Spin's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players`
 * and its own `art/` — the hub imports every card, so one import of this
 * game's runtime would put the whole game in the hub's chunk.
 *
 * The safety line is in `rules` rather than only in the primer because the
 * card is where someone decides to play this (spec §9).
 */
export const CARD: GameCard = {
  slug: 'rhino-spin',
  title: 'Rhino Spin',
  pitch: 'Throw your phone. Count the spins. Mind the ceiling',
  concept: 'Throw your phone so it spins and catch it. Every full rotation is a point.',
  rules: [
    'Throw low, indoors, over something soft, and mind the ceiling.',
    'A point per full rotation, either way round. Thirty seconds of throws.',
    'Your rhino gets as dizzy as you spun. The winner is sick.',
  ],
  art: { src: art, alt: 'A phone tumbling through the air over a rhino whose eyes are already rolling' },
  fr: {
    pitch: 'Lancez votre téléphone. Comptez les tours. Attention au plafond',
    concept: 'Lancez votre téléphone en le faisant tourner, puis rattrapez-le. Chaque tour complet vaut un point.',
    rules: [
      'Lancez bas, à l’intérieur, au-dessus de quelque chose de mou, et attention au plafond.',
      'Un point par tour complet, dans un sens ou dans l’autre. Trente secondes de lancers.',
      'Votre rhinocéros a le tournis autant que vous. Le gagnant est malade.',
    ],
    art: { alt: 'Un téléphone qui culbute en l’air au-dessus d’un rhinocéros dont les yeux tournent déjà' },
  },
  accent: '#A78BFA',
  players: PLAYERS['rhino-spin'],
  duration: '30 s',
  inputs: ['orientation'],
  // Fullscreen + portrait lock on Ready/Start (device-capabilities.md §5b):
  // the phone is in the air, so an auto-rotate mid-throw would reflow the
  // board between leaving the hand and landing in it.
  screen: { orientation: 'portrait', fullscreen: true },
  tags: ['party', 'physical'],
  modes: [],
  status: 'live',
};
