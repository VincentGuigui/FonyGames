import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Tiles Surfer's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'tiles-surfer',
  title: 'Tiles Surfer',
  pitch: 'Tap the tile the instant it hits the line',
  concept: 'Five lanes, your own board — land the timing and it speeds up, miss it and you lose a life.',
  rules: [
    'Tiles fall down five lanes. Tap the lane the instant one hits the line.',
    'A long tile is held — keep your finger down to bank every beat.',
    'Press with nothing there and it still costs a life. Five lives.',
  ],
  art: { src: art, alt: 'A dark lane of glowing pavement tiles falling toward a bright line' },
  fr: {
    pitch: "Tapez la tuile pile quand elle touche la ligne",
    concept: 'Cinq voies, votre propre plateau — visez juste et ça accélère, ratez et vous perdez une vie.',
    rules: [
      'Des tuiles tombent sur cinq voies. Tapez la voie pile quand une tuile touche la ligne.',
      'Une tuile longue se maintient — gardez le doigt posé pour tout encaisser.',
      'Appuyer dans le vide coûte aussi une vie. Cinq vies.',
    ],
    art: { alt: 'Une voie sombre de tuiles lumineuses tombant vers une ligne brillante' },
  },
  accent: '#F0ABFC',
  players: PLAYERS['tiles-surfer'],
  duration: '1–5 min',
  inputs: ['touch'],
  tags: ['arcade', 'music'],
  modes: [],
  status: 'live',
};
