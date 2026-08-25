import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * UFO Hunt's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'ufo-hunt',
  title: 'UFO Hunt',
  pitch: "One saucer, everyone's lasers. Highest score wins",
  concept: 'The saucer is shared — everyone chips the same health bar — but your score is only your own shots.',
  rules: [
    'Hold your phone up. The saucer hangs in your own sky.',
    'A crosshair sits at centre screen — tap to fire at it.',
    'Closer to centre hits harder. Highest score wins.',
  ],
  art: { src: art, alt: 'A crosshair centred on a flying saucer, laser bolts converging on it from below' },
  fr: {
    pitch: "Une soucoupe, les lasers de tous. Le meilleur score gagne",
    concept: 'La soucoupe est partagée — tout le monde entame la même barre de vie — mais votre score ne compte que vos propres tirs.',
    rules: [
      'Levez votre téléphone. La soucoupe plane dans votre propre ciel.',
      'Un viseur reste au centre de l’écran — tirez dessus.',
      'Plus le tir est centré, plus il fait mal. Le meilleur score gagne.',
    ],
    art: { alt: 'Un viseur centré sur une soucoupe volante, des tirs laser convergeant vers elle depuis le bas' },
  },
  accent: '#5EEAD4',
  players: PLAYERS['ufo-hunt'],
  duration: '2 min',
  inputs: ['orientation', 'camera', 'touch'],
  modes: [],
  status: 'live',
};
