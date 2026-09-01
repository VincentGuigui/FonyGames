import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Goat Siege's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'goat-siege',
  title: 'Goat Siege',
  pitch: "Shoo the neighbours' goats before they eat your cabbages",
  concept: 'Shooing is not free — one tap becomes two problems.',
  rules: [
    'Tap a neighbour to lob a goat at them.',
    'Tap incoming goats to shoo them.',
    'A shooed goat splits into two kids.',
  ],
  art: { src: art, alt: 'A goat sailing over a fence towards a row of cabbages' },
  fr: {
    pitch: 'Chassez les chèvres des voisins avant qu’elles ne mangent vos choux',
    concept: 'Chasser n’est pas gratuit — un tap devient deux problèmes.',
    rules: [
      'Tapez sur un voisin pour lui envoyer une chèvre.',
      'Tapez sur les chèvres qui arrivent pour les chasser.',
      'Une chèvre chassée se divise en deux chevreaux.',
    ],
    art: { alt: 'Une chèvre qui vole par-dessus une clôture vers une rangée de choux' },
  },
  accent: '#4ADE80',
  players: PLAYERS['goat-siege'],
  duration: '2–3 min',
  inputs: ['touch'],
  tags: ['party'],
  modes: [
    { id: 'patch', name: 'Patch', blurb: 'Six cabbages each, last garden standing' },
  ],
  // `new`: playable, but §11 of the spec lists real balance questions.
  status: 'live',
};
