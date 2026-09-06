import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Color Hunt's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'color-hunt',
  title: 'Color Hunt',
  pitch: 'Hunt that exact colour down in the room around you',
  concept: 'Point your camera at something that really is the colour called.',
  rules: [
    'A colour is called. Find it in the room.',
    'The ring in the middle shows what you are really pointing at.',
    'Camera only — no camera, no hunt.',
  ],
  art: { src: art, alt: 'A phone viewport over a room corner, a ring magnifier filled with flat orange dead centre' },
  fr: {
    pitch: 'Débusquez cette couleur exacte dans la pièce autour de vous',
    concept: 'Visez avec la caméra quelque chose qui est vraiment la couleur annoncée.',
    rules: [
      'Une couleur est annoncée. Trouvez-la dans la pièce.',
      'L’anneau central montre ce que vous visez vraiment.',
      'Caméra obligatoire — sans caméra, pas de chasse.',
    ],
    art: { alt: 'Un cadre de téléphone sur un coin de pièce, une loupe circulaire orange en plein centre' },
  },
  accent: '#14B8A6',
  players: PLAYERS['color-hunt'],
  duration: '3–6 min',
  inputs: ['camera'],
  tags: ['augmented-reality', 'party', 'physical'],
  modes: [],
  status: 'live',
};
