import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Maximum Jump's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players`
 * and its own `art/` — the hub imports every card, so one import of this
 * game's runtime would put the whole game in the hub's chunk.
 */
export const CARD: GameCard = {
  slug: 'maximum-jump',
  title: 'Maximum Jump',
  pitch: 'Sprint, hit the line, fly. Longest jump wins',
  concept: 'Alternate your two legs to build speed, take off on the line, then hammer the button in the air.',
  rules: [
    'Left and right buttons are your legs. Alternate them, in rhythm.',
    'Take off on the line for the best angle. Past it is a faceplant.',
    'In the air, tap fast to stay aerodynamic. Three attempts each.',
  ],
  art: { src: art, alt: 'A jumper mid-flight over a sand pit, the take-off board behind them' },
  fr: {
    pitch: 'Sprintez, visez la planche, envolez-vous. Le plus long gagne',
    concept: 'Alternez vos deux jambes pour prendre de la vitesse, sautez sur la planche, puis martelez le bouton en l’air.',
    rules: [
      'Les boutons gauche et droit sont vos jambes. Alternez, en rythme.',
      'Sautez sur la planche pour le meilleur angle. Au-delà, c’est la gamelle.',
      'En l’air, tapez vite pour rester aérodynamique. Trois essais chacun.',
    ],
    art: { alt: 'Un sauteur en plein vol au-dessus d’une fosse de sable, la planche d’appel derrière lui' },
  },
  accent: '#EAB308',
  players: PLAYERS['maximum-jump'],
  duration: '1–2 min',
  inputs: ['touch'],
  // Landscape and locked to it on Ready/Start (device-capabilities.md §5b):
  // the run-up is the screen's long axis and the game does not exist in
  // portrait.
  screen: { orientation: 'landscape', fullscreen: true },
  tags: ['party', 'arcade', 'intense'],
  modes: [],
  status: 'live',
};
