import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Tilt Race's hub card. Contract: docs/design/illustrations.md
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
  slug: 'tilt-race',
  title: 'Tilt Race',
  pitch: 'The car holds still. Tilt the world around it',
  concept: 'The car never turns — tilting rotates the whole track around it.',
  rules: [
    'Forward is automatic. Tilt to swing the track.',
    'Past 100 it skids: the turn lags the tilt.',
    'A rail costs speed. Reverse backs you out.',
  ],
  art: { src: art, alt: 'A small car dead centre with the track and its red kerbs rotated hard around it, skid marks trailing out of the turn' },
  fr: {
    pitch: 'La voiture reste immobile. Inclinez le monde',
    concept: 'La voiture ne tourne jamais — l’inclinaison fait pivoter toute la piste autour d’elle.',
    rules: [
      'L’accélération est automatique. Inclinez pour faire pivoter la piste.',
      'Au-delà de 100, ça glisse : le virage suit avec du retard.',
      'Un rail coûte de la vitesse. La marche arrière vous dégage.',
    ],
    art: { alt: 'Une petite voiture au centre, la piste et ses bordures rouges pivotées autour d’elle, avec des traces de dérapage' },
  },
  accent: '#E4572E',
  players: PLAYERS['tilt-race'],
  duration: '~100 s',
  inputs: ['orientation', 'touch'],
  tags: ['arcade', 'party', 'intense'],
  modes: [],
  status: 'live',
};
