import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Steady Hand's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'steady-hand',
  title: 'Steady Hand',
  pitch: 'Hold your phone perfectly still. Longer than everyone else',
  concept: 'The opposite of every other game here: do as little as possible.',
  rules: [
    'Hold your phone as still as you can.',
    'The last one still steady wins.',
  ],
  art: { src: art, alt: 'A phone held perfectly level, a target centred on it' },
  fr: {
    pitch: 'Tenez votre téléphone parfaitement immobile. Plus longtemps que tout le monde',
    concept: 'L’opposé de tous les autres jeux ici : faites le moins possible.',
    rules: ['Tenez votre téléphone aussi immobile que possible.', 'Le dernier encore immobile gagne.'],
    art: { alt: 'Un téléphone tenu parfaitement à plat, une cible centrée sur lui' },
  },
  accent: '#C084FC',
  players: PLAYERS['steady-hand'],
  duration: '1 min',
  inputs: ['motion'],
  modes: [],
  status: 'live',
};
