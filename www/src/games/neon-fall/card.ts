import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Neon Fall's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 *
 * Verified end to end in the browser: lobby, seat picker, tilt primer and its
 * tap-zone fallback, the canvas round, both win paths, and the results screen
 * (docs/specs/games/neon-fall.md).
 */
export const CARD: GameCard = {
  slug: 'neon-fall',
  title: 'Neon Fall',
  pitch: 'Dodge five lanes of neon fire, or shoot down what falls',
  concept: 'One glides down five lanes by tilting; the other has a trigger per lane.',
  rules: [
    'Glider: tilt your phone to drift between the five lanes.',
    'Protector: tap a lane to fire — three shots, then a short cooldown.',
    'A hit bounces the glider to a random lane, blinking, for 1.5s.',
    'The glider wins by reaching the floor with a life left; the protector wins by taking all three.',
  ],
  art: { src: art, alt: 'A cyan diamond glider falling between two magenta bolts' },
  fr: {
    pitch: 'Évitez cinq voies de tirs néon, ou abattez ce qui tombe',
    concept: 'L’un descend cinq voies en inclinant son téléphone ; l’autre possède une gâchette par voie.',
    rules: [
      'Planeur : inclinez le téléphone pour dériver entre les cinq voies.',
      'Protecteur : touchez une voie pour tirer — trois tirs, puis un court rechargement.',
      'Un impact renvoie le planeur sur une voie aléatoire et le fait clignoter pendant 1,5 s.',
      'Le planeur gagne en atteignant le sol avec une vie ; le protecteur gagne en prenant les trois.',
    ],
    art: { alt: 'Un planeur cyan en forme de losange tombe entre deux tirs magenta' },
  },
  accent: '#22D3EE',
  players: PLAYERS['neon-fall'],
  duration: '~30–60 s',
  inputs: ['orientation', 'touch'],
  tags: ['duel', 'arcade'],
  modes: [],
  status: 'live',
};
