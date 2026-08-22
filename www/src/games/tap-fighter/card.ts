import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

export const CARD: GameCard = {
  slug: 'tap-fighter',
  title: 'Tap Fighter',
  pitch: 'Pick six moves, then watch the fight unfold',
  concept: 'Program six secret moves. When both fighters lock in, the arcade battle plays itself.',
  rules: [
    'Choose six punches, kicks, jumps or crouches, then press Fight.',
    'Jump dodges a low kick; crouch dodges a high punch.',
    'Take fewer hits to win the round. First to three rounds wins.',
  ],
  art: { src: art, alt: 'Two original pixel-art fighters in blue and green trading a punch and kick' },
  fr: {
    pitch: 'Choisissez six coups, puis regardez le combat',
    concept: 'Programmez six actions secrètes. Dès que les deux combattants valident, le combat se déroule tout seul.',
    rules: [
      'Choisissez six coups de poing, coups de pied, sauts ou esquives basses, puis appuyez sur Combat.',
      'Sautez pour éviter un coup bas ; baissez-vous pour éviter un coup haut.',
      'Subissez moins d’impacts pour gagner la manche. Trois manches gagnées remportent le match.',
    ],
    art: { alt: 'Deux combattants originaux en pixel art, bleu et vert, échangent un coup de poing et un coup de pied' },
  },
  accent: '#F97316',
  players: PLAYERS['tap-fighter'],
  duration: '1–5 min',
  inputs: ['touch'],
  modes: [],
  status: 'live',
};
