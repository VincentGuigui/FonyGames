import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';
export const CARD: GameCard = {
  slug: 'tic-tac-tic-tac-toe', title: 'Tic-Tac-Tic-Tac-Toe',
  pitch: 'Win small boards to claim the big board.', concept: 'Choose a board, win it, and build three in a row.',
  rules: ['Each player keeps X or O for the whole game.', 'The chooser starts each small board.', 'Claim three meta cells to win.'],
  art: { src: art, alt: 'Nested tic-tac-toe grids with X and O marks' },
  fr: { pitch: 'Gagnez les petits plateaux pour remporter le grand.', concept: 'Choisissez un plateau, gagnez-le et alignez-en trois.', rules: ['Chaque joueur garde X ou O pendant toute la partie.', 'Le joueur qui choisit commence le petit plateau.', 'Alignez trois cases du grand plateau pour gagner.'], art: { alt: 'Grilles de morpion imbriquées avec des X et des O' } },
  accent: '#67E8F9', players: PLAYERS['tic-tac-tic-tac-toe'], duration: '1–5 min', inputs: ['touch'], modes: [], status: 'live',
};
