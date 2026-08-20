import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Sling Puck's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'sling-puck',
  title: 'Sling Puck',
  pitch: 'Sling every puck onto their side before they sling them back',
  concept: 'One board, split across two phones. Empty your half.',
  rules: [
    'Drag a puck onto the elastic, pull back, let go.',
    'Pucks bounce off every wall except the gap.',
    'No turns. You are both slinging at once.',
  ],
  art: { src: art, alt: 'Two halves of a board, an elastic pulled back and a puck in the gap' },
  fr: {
    pitch: 'Envoyez tous les pucks de leur côté avant qu’ils ne vous les renvoient',
    concept: 'Un seul plateau, partagé entre deux téléphones. Videz votre moitié.',
    rules: [
      'Faites glisser un puck sur l’élastique, tirez en arrière, relâchez.',
      'Les pucks rebondissent sur tous les murs sauf l’ouverture.',
      'Pas de tours de jeu. Vous tirez tous les deux en même temps.',
    ],
    art: { alt: 'Deux moitiés d’un plateau, un élastique tiré en arrière et un puck dans l’ouverture' },
  },
  accent: '#FB7185',
  players: PLAYERS['sling-puck'],
  duration: '30 s – 2 min',
  inputs: ['touch'],
  modes: [
    { id: 'classic', name: 'Classic', blurb: 'Five pucks each, first side clear wins' },
  ],
  // `new`: playable, but §14 of the spec has the puck count and gap width
  // down as open questions, and only a play test settles either.
  status: 'live',
};
