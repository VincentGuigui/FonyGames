import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Cat and Mouse's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'cat-and-mouse',
  title: 'Cat and Mouse',
  pitch: 'One cat, a floor full of mice, and nowhere to hide',
  concept: 'One shared floor. Your mouse moves only while you are moving it.',
  rules: [
    'Drag your own icon. Let go and it stops dead.',
    'The cat only has to touch you once.',
    'Three lives each. Outlast the clock and the mice win.',
  ],
  art: { src: art, alt: 'A cat lunging after two mice running away' },
  fr: {
    pitch: 'Un chat, une pièce pleine de souris, et aucun endroit où se cacher',
    concept: 'Une pièce partagée. Votre souris ne bouge que pendant que vous la faites bouger.',
    rules: [
      'Faites glisser votre icône. Relâchez et elle s’arrête net.',
      'Le chat n’a besoin de vous toucher qu’une fois.',
      'Trois vies chacun. Survivez au chrono et les souris gagnent.',
    ],
    art: { alt: 'Un chat qui bondit sur deux souris qui s’échappent' },
  },
  accent: '#C084FC',
  players: PLAYERS['cat-and-mouse'],
  duration: '60–90 s',
  inputs: ['touch'],
  modes: [
    { id: 'chase', name: 'Chase', blurb: 'One cat, three lives each, beat the clock' },
  ],
  // Built, and new enough to shout about. It ships with no tap-only fallback and
  // says so in the lobby rather than in a doc — a deliberate decision, not a gap
  // (spec §12).
  status: 'live',
};
