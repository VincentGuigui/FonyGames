import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Merge Rush's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players`
 * and its own `art/` — the hub imports every card, so one import of this
 * game's runtime would put the whole game in the hub's chunk.
 */
export const CARD: GameCard = {
  slug: 'merge-rush',
  title: 'Merge Rush',
  pitch: 'Slide, merge, climb. Out-score the whole room',
  concept: 'Slide the tiles, merge equal numbers, and watch everyone else’s board climb beside yours.',
  rules: [
    'Swipe to slide every tile. Two equal tiles merge into their double.',
    'Everyone starts on the same board. A merge scores the new tile.',
    'Two minutes, or until you run out of moves. Highest score wins.',
  ],
  art: { src: art, alt: 'A four-by-four board of coloured tiles, some merged into brighter ones, an arrow sweeping across it' },
  fr: {
    pitch: 'Glissez, fusionnez, grimpez. Dépassez toute la salle',
    concept: 'Faites glisser les tuiles, fusionnez les nombres égaux et regardez les plateaux des autres grimper à côté du vôtre.',
    rules: [
      'Glissez pour déplacer toutes les tuiles. Deux tuiles égales fusionnent en leur double.',
      'Tout le monde part du même plateau. Une fusion rapporte la nouvelle tuile.',
      'Deux minutes, ou jusqu’à ce qu’il n’y ait plus de coup. Le meilleur score gagne.',
    ],
    art: { alt: 'Un plateau de quatre par quatre de tuiles colorées, certaines fusionnées en tuiles plus vives, une flèche qui le traverse' },
  },
  accent: '#F472B6',
  players: PLAYERS['merge-rush'],
  duration: '2 min',
  inputs: ['touch'],
  tags: ['party', 'arcade', 'strategy'],
  modes: [],
  status: 'live',
};
