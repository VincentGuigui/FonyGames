import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

export const CARD: GameCard = {
  slug: 'tic-tac-tic-tac-toe',
  title: 'Tic-Tac-Tic-Tac-Toe',
  pitch: 'Play tic-tac-toe inside a giant tic-tac-toe.',
  concept: 'Win little boards to claim spaces on the giant board.',
  rules: [
    'Play tic-tac-toe inside one cell of a giant tic-tac-toe.',
    'Keep X or O for the whole match; the chooser starts each little board.',
    'Win three claimed spaces in a row on the giant board.',
  ],
  art: { src: art, alt: 'Nested tic-tac-toe grids with X and O marks' },
  fr: {
    pitch: 'Jouez au morpion dans un morpion géant.',
    concept: 'Gagnez les petits plateaux pour conquérir le grand.',
    rules: [
      'Jouez au morpion dans une case du morpion géant.',
      'Gardez X ou O pendant toute la partie ; le joueur qui choisit commence.',
      'Alignez trois cases conquises sur le grand plateau.',
    ],
    art: { alt: 'Grilles de morpion imbriquées avec des X et des O' },
  },
  accent: '#67E8F9',
  players: PLAYERS['tic-tac-tic-tac-toe'],
  duration: '1–5 min',
  inputs: ['touch'],
  modes: [],
  status: 'live',
};
