import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Pass the Bomb's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'pass-the-bomb',
  title: 'Pass the Bomb',
  pitch: 'Smash phones together to pass the bomb before it blows',
  concept: 'The fuse is hidden, so nobody knows how long they dare hold it.',
  rules: [
    'One phone holds the bomb.',
    'Knock phones together to pass it on.',
    'Holding it when the fuse ends puts you out.',
  ],
  art: { src: art, alt: 'Two phones knocking together, a bomb jumping between them' },
  accent: '#FF5A36',
  players: PLAYERS['pass-the-bomb'],
  duration: '1–2 min',
  inputs: ['motion', 'touch'],
  modes: [
    { id: 'classic', name: 'Classic', blurb: 'One bomb, one loser at a time' },
    { id: 'double', name: 'Double', blurb: 'Two bombs, half the mercy' },
    { id: 'hot-hands', name: 'Hot Hands', blurb: 'Hold it too long and it speeds up' },
    { id: 'teams', name: 'Teams', blurb: 'Two colours, one bomb, zero trust' },
  ],
  status: 'live',
};
