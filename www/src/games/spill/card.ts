import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Spill's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'spill',
  title: 'Spill',
  pitch: 'Fling your water at the neighbours before they flood you',
  concept: 'The table is the board: flick towards someone and it lands on their phone.',
  rules: [
    'Phones flat, top edge towards the middle.',
    'Flick your water at a neighbour.',
    'Tap an incoming drop to catch it — it doubles.',
  ],
  art: { src: art, alt: 'Four phones flat in a square with a drop of water arcing between them' },
  accent: '#38BDF8',
  players: PLAYERS['spill'],
  duration: '1–3 min',
  inputs: ['touch'],
  modes: [
    { id: 'ring', name: 'Ring', blurb: 'Phones flat on the table, aim across the room' },
  ],
  // `new`: playable end to end, but the numbers in spec §12 are guesses
  // until a real table test.
  status: 'new',
};
