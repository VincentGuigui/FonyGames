import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Random Game's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * Not a game of its own — the first card in the grid, for the player who cannot pick
 * one. Tapping it lands in a genuinely random built game's own page, chosen client-side
 * by `random-game.tsx` (`shared/players.ts`'s `BUILT_GAMES`), the moment the page loads.
 */
export const CARD: GameCard = {
  slug: 'random-game',
  title: 'Random game',
  pitch: "Can't decide? Let the dice choose for you",
  concept: 'One tap rolls the dice and drops you straight into a random game, ready to start.',
  rules: [
    'Tap the card to roll.',
    'You land in a random game, ready to start.',
  ],
  art: { src: art, alt: 'A die rolling over a dimmed mosaic of game illustrations' },
  fr: {
    pitch: 'Indécis ? Laissez les dés choisir pour vous',
    concept: 'Un tap lance les dés et vous dépose directement dans un jeu au hasard, prêt à démarrer.',
    rules: [
      'Tapez la carte pour lancer les dés.',
      'Vous atterrissez dans un jeu au hasard, prêt à démarrer.',
    ],
    art: { alt: 'Un dé qui roule sur une mosaïque assombrie d’illustrations de jeux' },
  },
  accent: '#F3E9D2',
  players: PLAYERS['random-game'],
  duration: '< 5 s',
  inputs: ['touch'],
  tags: ['luck'],
  modes: [],
  status: 'live',
};
