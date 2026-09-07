import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Together in the Dark's hub card. Contract: docs/design/illustrations.md
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
  slug: 'together-in-the-dark',
  title: 'Together in the Dark',
  pitch: 'One match at a time, guide him out of the woods',
  concept: 'A step or a light, never both — and it is the team’s turn you are spending.',
  rules: [
    'On your turn: walk one cell, or light one cell.',
    'A light shows one cell, for one turn, then goes out.',
    'Light a monster and it wakes. Everybody wins together.',
  ],
  art: { src: art, alt: 'A single match-lit circle in a black forest with one small figure inside it, shapes half-suggested at its edge' },
  fr: {
    pitch: 'Une allumette à la fois, guidez-le hors des bois',
    concept: 'Un pas ou une lumière, jamais les deux — et c’est le tour de l’équipe que vous dépensez.',
    rules: [
      'À votre tour : avancez d’une case, ou éclairez une case.',
      'Une lumière montre une case, pour un tour, puis s’éteint.',
      'Éclairez un monstre et il se réveille. On gagne ensemble.',
    ],
    art: { alt: 'Un cercle éclairé par une allumette dans une forêt noire, une petite silhouette au centre et des formes devinées au bord' },
  },
  accent: '#F6B93B',
  players: PLAYERS['together-in-the-dark'],
  duration: '2–3 min',
  inputs: ['touch'],
  tags: ['strategy', 'party'],
  modes: [],
  status: 'live',
};
