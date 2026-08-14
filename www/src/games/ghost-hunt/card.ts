import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Ghost Hunt's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'ghost-hunt',
  title: 'Ghost Hunt',
  pitch: 'Sweep the room for ghosts only your phone can see',
  concept: 'Only the radar can see them. Sweep the room until one shows up in it.',
  /*
   * Three rules, all of them things a player must DO. The traced outlines used to have
   * a line here and they are a visual effect, not a rule — knowing the radar draws
   * edges changes nothing about how you play, while "keep it in there" is the game.
   */
  rules: [
    'Hold your phone up and sweep the room.',
    'A ghost appears in the radar when you point the right way.',
    'Keep it in the radar for 4 seconds to catch it. First to 5 ends it — fastest total wins.',
  ],
  art: { src: art, alt: 'A phone held up, its screen a bright radar of traced edges' },
  accent: '#34D399',
  players: PLAYERS['ghost-hunt'],
  duration: 'to 5 ghosts',
  inputs: ['orientation', 'camera', 'touch'],
  modes: [],
  status: 'live',
};
