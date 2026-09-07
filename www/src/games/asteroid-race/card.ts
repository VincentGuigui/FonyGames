import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Asteroid Race's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'asteroid-race',
  title: 'Asteroid Race',
  pitch: 'Dodge the rocks, blast the rest, get there first',
  concept: 'Everyone flies the same asteroid field, alone — the race is who reads it best.',
  rules: [
    'Tilt to fly. Boost when the tube is clear.',
    'A wall with no gap needs the big rock shot open.',
    'Clip a rock: one life, one second lost. Five lives.',
  ],
  art: { src: art, alt: 'A starship threading a corridor of grey asteroids that fade into black' },
  fr: {
    pitch: 'Esquivez les rochers, pulvérisez le reste, arrivez le premier',
    concept: 'Tout le monde traverse le même champ d’astéroïdes, chacun de son côté — la course, c’est qui le lit le mieux.',
    rules: [
      'Inclinez pour voler. Boostez quand la voie est libre.',
      'Un mur sans passage : tirez sur le gros rocher.',
      'Un rocher touché : une vie et une seconde. Cinq vies.',
    ],
    art: { alt: 'Un vaisseau se faufilant dans un couloir d’astéroïdes gris qui s’effacent dans le noir' },
  },
  accent: '#A3E635',
  players: PLAYERS['asteroid-race'],
  duration: '1–2 min',
  inputs: ['motion', 'touch'],
  tags: ['arcade', 'intense', 'party'],
  modes: [],
  status: 'live',
};
