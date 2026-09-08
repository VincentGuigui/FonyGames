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
  pitch: 'Your phone is the steering wheel. Turn it right round',
  concept: 'Turn the phone and the car turns with it, degree for degree.',
  rules: [
    'Forward is automatic. Turn the phone to steer.',
    'Past 100 it skids: the car slides wide of where it points.',
    'A rail costs speed. Reverse backs you out.',
  ],
  art: { src: art, alt: 'A small car dead centre on a track of red-kerbed corridors, turned hard into a bend with skid marks trailing out of it' },
  fr: {
    pitch: 'Votre téléphone est le volant. Tournez-le franchement',
    concept: 'Tournez le téléphone et la voiture tourne avec lui, degré pour degré.',
    rules: [
      'L’accélération est automatique. Tournez le téléphone pour diriger.',
      'Au-delà de 100, ça glisse : la voiture dérive à côté de son cap.',
      'Un rail coûte de la vitesse. La marche arrière vous dégage.',
    ],
    art: { alt: 'Une petite voiture au centre d’une piste aux bordures rouges, braquée dans un virage, traces de dérapage à la sortie' },
  },
  accent: '#E4572E',
  players: PLAYERS['tilt-race'],
  duration: '~100 s',
  inputs: ['orientation', 'touch'],
  /*
   * Fullscreen + a real portrait lock on Ready/Start (device-capabilities.md §5b). The
   * steering IS rolling the phone in its own plane (`roll.ts`) — exactly the motion a
   * phone's own auto-rotate watches for — so without an enforced lock, a hard turn mid
   * corner can flip the OS into landscape and reflow the whole board under the player's
   * thumbs. The CSS "turn it back" notice cannot catch this: the phone never leaves
   * portrait, the layout does.
   */
  screen: { orientation: 'portrait', fullscreen: true },
  tags: ['arcade', 'party', 'intense'],
  modes: [],
  status: 'live',
};
