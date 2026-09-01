import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Ghost Hunt's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'ghost-hunt',
  title: 'Ghost Hunt',
  pitch: 'Sweep the room for ghosts only your phone can see',
  concept: 'Only the radar can see them. Sweep the room until one shows up in it.',
  /*
   * Three rules, all of them things a player must DO. The traced outlines used to have
   * a line here and they are a visual effect, not a rule — knowing the radar draws
   * edges changes nothing about how you play, while "keep it in there" is the game.
   */
  rules: [
    'Hold your phone up and sweep the room.',
    'A ghost appears in the radar when you point the right way.',
    'Keep it in the radar for 4 seconds to catch it. 100 seconds, and the quicker the catch the more it scores.',
  ],
  art: { src: art, alt: 'A phone held up, its screen a bright radar of traced edges' },
  fr: {
    pitch: 'Balayez la pièce à la recherche de fantômes que seul votre téléphone voit',
    concept: 'Seul le radar peut les voir. Balayez la pièce jusqu’à ce qu’un fantôme y apparaisse.',
    rules: [
      'Levez votre téléphone et balayez la pièce.',
      'Un fantôme apparaît dans le radar quand vous visez la bonne direction.',
      'Gardez-le dans le radar pendant 4 secondes pour l’attraper. 100 secondes au total, et plus la capture est rapide, plus elle rapporte de points.',
    ],
    art: { alt: 'Un téléphone levé, son écran affichant un radar lumineux de contours tracés' },
  },
  accent: '#34D399',
  players: PLAYERS['ghost-hunt'],
  duration: '100 s',
  inputs: ['orientation', 'camera', 'touch'],
  tags: ['augmented-reality'],
  modes: [],
  status: 'live',
};
