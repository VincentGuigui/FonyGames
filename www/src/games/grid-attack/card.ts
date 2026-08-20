import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Grid Attack's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'grid-attack',
  title: 'Grid Attack',
  pitch: 'Break their grid before they break yours',
  concept: 'Two grids, sideways. Three taps to light one of theirs, three to put out one of yours.',
  rules: [
    // The colour marker is `{{#hex|word}}` — HowToPlay.tsx renders it in that colour and
    // strips the markup. The two colours are the halves' own border colours (grid.css),
    // named in words too, never colour alone (docs/design/ui-guidelines.md §2).
    'Attack their grid ({{#a3e635|green}}) while defending yours ({{#a78bfa|purple}}).',
    '{{#a3e635|Green}}: tap the enemy grid three times, fast, to light it.',
    '{{#a78bfa|Purple}}: a lit cell bursts in two seconds — three taps saves it.',
  ],
  art: { src: art, alt: 'Two grids of squares facing each other, one square lit and about to blow' },
  accent: '#A78BFA',
  players: PLAYERS['grid-attack'],
  duration: '1–2 min',
  inputs: ['touch'],
  modes: [],
  status: 'live',
};
