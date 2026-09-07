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
  pitch: 'Ten seconds. Loudest wins. Mind the neighbours',
  concept: 'Your loudest three seconds is the score — a bark cannot fake it.',
  rules: [
    'Everybody screams at once for ten seconds.',
    'Your best three seconds is what counts.',
    'Phone away from your face. Mind the neighbours.',
  ],
  art: { src: art, alt: 'A wide-open mouth mid-scream with sound arcing out of it into a meter whose needle is buried in the red' },
  fr: {
    pitch: 'Dix secondes. Le plus fort gagne. Pensez aux voisins',
    concept: 'Ce sont vos trois secondes les plus fortes qui comptent — un simple aboiement ne suffit pas.',
    rules: [
      'Tout le monde crie en même temps pendant dix secondes.',
      'Vos trois meilleures secondes font le score.',
      'Téléphone loin du visage. Pensez aux voisins.',
    ],
    art: { alt: 'Une bouche grande ouverte en train de crier, le son en arcs vers un cadran dont l’aiguille est dans le rouge' },
  },
  accent: '#FB4D3D',
  players: PLAYERS['scream-meter'],
  duration: '30 s',
  inputs: ['mic'],
  tags: ['party', 'physical', 'intense'],
  modes: [],
  status: 'live',
};
