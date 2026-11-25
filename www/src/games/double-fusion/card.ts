import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Double Fusion's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players`
 * and its own `art/` — the hub imports every card, so one import of this
 * game's runtime would put the whole game in the hub's chunk.
 */
export const CARD: GameCard = {
  slug: 'double-fusion',
  title: 'Double Fusion',
  pitch: 'Swipe, merge, double and win!',
  concept: 'Slide the tiles, merge equal numbers, and watch everyone else’s board climb beside yours.',
  rules: [
    'Swipe to slide every tile. Two equal tiles merge into their double.',
    'Everyone starts on the same board. Tap a thumbnail to watch that player live.',
  ],
  art: { src: art, alt: 'A four-by-four board of numbered, coloured tiles, some of them merged into bigger ones' },
  fr: {
    pitch: 'Glissez, fusionnez, doublez et gagnez !',
    concept: 'Faites glisser les tuiles, fusionnez les nombres égaux et regardez les plateaux des autres grimper à côté du vôtre.',
    rules: [
      'Glissez pour déplacer toutes les tuiles. Deux tuiles égales fusionnent en leur double.',
      'Tout le monde part du même plateau. Touchez une miniature pour suivre ce joueur en direct.',
    ],
    art: { alt: 'Un plateau de quatre par quatre de tuiles numérotées et colorées, certaines fusionnées en tuiles plus grosses' },
  },
  accent: '#F472B6',
  players: PLAYERS['double-fusion'],
  duration: '3 min+',
  inputs: ['touch'],
  tags: ['party', 'arcade', 'strategy'],
  modes: [
    { id: 'race', name: 'Race to 2048', blurb: 'First to make the tile wins — 512 up to 8192, or endless' },
    { id: 'crescendo', name: 'Crescendo', blurb: 'Increasing difficulty levels' },
    { id: 'highlander', name: 'Highlander', blurb: 'Puzzle: there can be only one number left' },
  ],
  status: 'live',
};
