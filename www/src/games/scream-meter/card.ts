import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Scream Meter's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and
 * its own `art/`. The hub imports every card, so one import of this game's runtime
 * would put the whole game in the hub's chunk — `www/src/games/cards.test.mjs`
 * enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'scream-meter',
  title: 'Scream Meter',
  pitch: 'Ten rounds. Loudest total wins. Mind the neighbours',
  concept: 'Ten short rounds — your loudest three seconds each time, added to a running total.',
  rules: [
    'Ten rounds. Everybody screams at once for ten seconds.',
    'Your best three seconds counts, added to your running total.',
    'Phone away from your face. Mind the neighbours.',
  ],
  art: { src: art, alt: 'A wide-open mouth mid-scream with sound arcing out of it into a meter whose needle is buried in the red' },
  fr: {
    pitch: 'Dix manches. Le plus fort au total gagne. Pensez aux voisins',
    concept: 'Dix manches courtes — vos trois secondes les plus fortes à chaque fois, cumulées dans un total.',
    rules: [
      'Dix manches. Tout le monde crie en même temps pendant dix secondes.',
      'Vos trois meilleures secondes comptent, ajoutées à votre total.',
      'Téléphone loin du visage. Pensez aux voisins.',
    ],
    art: { alt: 'Une bouche grande ouverte en train de crier, le son en arcs vers un cadran dont l’aiguille est dans le rouge' },
  },
  accent: '#FB4D3D',
  players: PLAYERS['scream-meter'],
  duration: '2–3 min',
  inputs: ['mic'],
  tags: ['party', 'physical', 'intense'],
  modes: [],
  status: 'live',
};
