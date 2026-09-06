import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Color Match's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'color-match',
  title: 'Color Match',
  pitch: 'Match the colour. Three seconds. No second guesses',
  concept: 'A colour appears, and the palette gets harder every single level.',
  rules: [
    'Drag the wheel to the colour shown. Three seconds.',
    'Closer is worth more. Way off is worth nothing.',
    'Three levels with nobody scoring ends the run.',
  ],
  art: { src: art, alt: 'A colour wheel with a cursor just off a magenta target swatch, beside a luminance slider' },
  fr: {
    pitch: 'Trouvez la couleur. Trois secondes. Sans hésiter',
    concept: 'Une couleur apparaît, et la palette se complique à chaque niveau.',
    rules: [
      'Faites glisser la roue sur la couleur affichée. Trois secondes.',
      'Plus c’est proche, plus ça rapporte. Trop loin, rien du tout.',
      'Trois niveaux sans le moindre point et la partie s’arrête.',
    ],
    art: { alt: 'Une roue chromatique, un curseur à côté de la pastille magenta cible et un curseur de luminosité' },
  },
  accent: '#F472B6',
  players: PLAYERS['color-match'],
  duration: '2–5 min',
  inputs: ['touch'],
  tags: ['arcade', 'party', 'intense'],
  modes: [],
  status: 'live',
};
