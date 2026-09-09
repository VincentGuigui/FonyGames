import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Crowd Race's hub card. Contract: docs/design/illustrations.md
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
  slug: 'crowd-race',
  title: 'Crowd Race',
  pitch: 'Tilt through the crowd. First up the street wins',
  concept: 'You walk up the street automatically. Tilt to steer.',
  rules: [
    'Forward is automatic. Tilt to weave — upside down walks you backward.',
    'Clip someone and you both bounce. Pile-ups cascade.',
    'Bicycles stop you cold for two seconds. Trees never move.',
  ],
  art: { src: art, alt: 'A busy street from above, an avatar weaving between pedestrians and a bicycle, trees down both sides' },
  fr: {
    pitch: 'Slalomez dans la foule. Premier en haut de la rue',
    concept: 'Vous avancez automatiquement dans la rue. Inclinez pour diriger.',
    rules: [
      'L’avancée est automatique. Inclinez pour slalomer — à l’envers, vous reculez.',
      'Frôlez quelqu’un et vous rebondissez tous les deux. Les carambolages s’enchaînent.',
      'Les vélos vous arrêtent net pendant deux secondes. Les arbres ne bougent jamais.',
    ],
    art: { alt: 'Une rue animée vue du dessus, un avatar slalomant entre des piétons et un vélo, des arbres des deux côtés' },
  },
  accent: '#3EC1A6',
  players: PLAYERS['crowd-race'],
  duration: '1–2 min',
  inputs: ['orientation'],
  // Fullscreen + a portrait lock on Ready/Start (device-capabilities.md §5b):
  // the whole control is tilting the phone, and an accidental auto-rotate
  // mid-round would reflow the board under the player's thumbs the same way
  // it would for Tilt Race's own rotation.
  screen: { orientation: 'portrait', fullscreen: true },
  tags: ['party', 'arcade', 'physical'],
  modes: [],
  status: 'live',
};
