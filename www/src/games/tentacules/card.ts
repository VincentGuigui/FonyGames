import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Tentacules' hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players`
 * and its own `art/` — the hub imports every card, so one import of this
 * game's runtime would put the whole game in the hub's chunk.
 */
export const CARD: GameCard = {
  slug: 'tentacules',
  title: 'Tentacules',
  pitch: 'Climb a wall of pegs, one tentacle at a time',
  concept: 'Drag your octopus’s tentacles from peg to peg and climb higher than everyone else on the same reef wall.',
  rules: [
    'Drag a tentacle onto a peg to climb; drop it on empty space to let go. Keep at least two holding.',
    'Holding by two spread wide, pull the octopus back and let go to leap. One tentacle alone gives way after 3 s.',
    'A peg holds one tentacle — but one a rival has sat on for 3 s can be taken.',
  ],
  art: { src: art, alt: 'A cute coral octopus climbing a reef wall, four tentacles curled round pegs and one reaching for a higher one' },
  fr: {
    pitch: 'Escaladez un mur de plots, une tentacule à la fois',
    concept: 'Faites passer les tentacules de votre pieuvre de plot en plot et grimpez plus haut que tout le monde sur le même mur de récif.',
    rules: [
      'Glissez une tentacule sur un plot pour grimper ; lâchez-la dans le vide pour la décrocher. Gardez-en au moins deux accrochées.',
      'Tenue par deux tentacules bien écartées, tirez la pieuvre en arrière puis lâchez pour bondir. Une seule tentacule lâche au bout de 3 s.',
      'Un plot ne porte qu’une tentacule — mais celui qu’un rival occupe depuis 3 s peut lui être pris.',
    ],
    art: { alt: 'Une pieuvre corail toute mignonne qui escalade un mur de récif, quatre tentacules enroulées sur des plots et une qui en vise un plus haut' },
  },
  accent: '#FF7F6E',
  players: PLAYERS.tentacules,
  duration: '1–2 min',
  inputs: ['touch'],
  tags: ['party', 'arcade'],
  modes: [
    { id: 'trial', name: 'Time trial', blurb: 'Climb as high as you can in one minute' },
    { id: 'summit', name: 'Summit', blurb: 'First to the 25 m line wins' },
  ],
  status: 'live',
};
