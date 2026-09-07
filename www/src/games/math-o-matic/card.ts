import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Math-o-matic's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and
 * its own `art/`. The hub imports every card, so one import of this game's runtime
 * would put the whole game in the hub's chunk — `www/src/games/cards.test.mjs`
 * enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'math-o-matic',
  title: 'Math-o-matic',
  pitch: 'Four answers, one is right, three lives',
  concept: 'Everyone gets the same sum at the same time, and a wrong tap costs a life.',
  rules: [
    'Tap the answer you believe. Three lives each.',
    'No answer costs a life too — guessing beats silence.',
    'Last one still holding a life wins.',
  ],
  art: { src: art, alt: 'A chalk-style sum above four answer tiles, one of them lit, with two lives left' },
  fr: {
    pitch: 'Quatre réponses, une seule bonne, trois vies',
    concept: 'Tout le monde reçoit le même calcul en même temps, et une erreur coûte une vie.',
    rules: [
      'Touchez la réponse que vous croyez juste. Trois vies.',
      'Ne rien jouer coûte aussi une vie — mieux vaut tenter.',
      'Le dernier qui a encore une vie gagne.',
    ],
    art: { alt: 'Un calcul à la craie au-dessus de quatre réponses, dont une allumée, et deux vies restantes' },
  },
  accent: '#2DD4BF',
  players: PLAYERS['math-o-matic'],
  duration: '1–2 min',
  inputs: ['touch'],
  tags: ['party', 'duel', 'strategy'],
  modes: [],
  status: 'live',
};
