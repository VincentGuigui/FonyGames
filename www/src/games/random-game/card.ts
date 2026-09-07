import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Random Game's hub card ("Surprise Me" / "Surprends-moi"). Contract:
 * docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * Not a game of its own — the first card in the grid, for the player who cannot pick
 * one. Tapping it lands in a genuinely random built game's own page, chosen client-side
 * by `random-game.tsx` (`shared/players.ts`'s `BUILT_GAMES`), the moment the page loads.
 *
 * `title` is translated here, which is otherwise deliberately never done
 * (docs/specs/i18n.md §2, "it is the game's name") — this card names an action, not a
 * game, the same way a button's label translates. The slug stays `random-game`
 * either way: it never appears in the UI and every internal reference to this card
 * (`HubGrid.tsx`, `scripts/ssr.mjs`, `api/lib/Page.php`) is by slug.
 */
export const CARD: GameCard = {
  slug: 'random-game',
  title: 'Surprise Me',
  pitch: "Can't decide? Let the dice choose for you",
  concept: 'One tap rolls the dice and drops you straight into a random game, ready to start.',
  rules: [
    'Tap the card to roll.',
    'You land in a random game, ready to start.',
  ],
  art: { src: art, alt: 'A die rolling over a dimmed mosaic of game illustrations' },
  fr: {
    title: 'Surprends-moi',
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
  // Kept for the hub's player-count filter (any group size matches), but never shown
  // on the card itself — it's not a real game's own promise, so it would read as one.
  showPlayerCount: false,
  duration: '< 5 s',
  showDuration: false,
  // Same reasoning as the two above: every card is tapped, so "touch" here says
  // nothing about the game it rolls — and next to a die that can land you in a
  // motion game, it says something untrue.
  inputs: ['touch'],
  showInputs: false,
  tags: ['luck'],
  modes: [],
  status: 'live',
};
