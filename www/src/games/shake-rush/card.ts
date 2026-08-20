import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Shake Rush's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'shake-rush',
  title: 'Shake Rush',
  pitch: 'Shake like your life depends on it — first to the finish wins',
  concept: 'Pure effort: every change of direction moves you one step down the track.',
  rules: [
    'Shake to move down the track.',
    'It counts changes of direction, not force — shaking harder does not help.',
    'First over the finish line wins.',
  ],
  art: { src: art, alt: 'A phone shaking, motion lines either side of it' },
  fr: {
    pitch: 'Secouez comme si votre vie en dépendait — premier à la ligne d’arrivée gagne',
    concept: 'Pur effort : chaque changement de direction vous fait avancer d’un pas sur la piste.',
    rules: [
      'Secouez pour avancer sur la piste.',
      'Ça compte les changements de direction, pas la force — secouer plus fort ne sert à rien.',
      'Premier à franchir la ligne d’arrivée gagne.',
    ],
    art: { alt: 'Un téléphone qui vibre, des lignes de mouvement de chaque côté' },
  },
  accent: '#4ADE80',
  players: PLAYERS['shake-rush'],
  duration: '1 min',
  inputs: ['motion'],
  modes: [],
  status: 'live',
};
