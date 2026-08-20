import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Tap Duel's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'tap-duel',
  title: 'Tap Duel',
  pitch: 'The fastest thumb in the room takes the round',
  concept: 'One signal, every screen at once. A target is drifting — hit it first, ten times.',
  rules: [
    'A target drifts around your screen. Follow it with your thumb.',
    'It stops and lights up on the signal. Tap it.',
    'Tap before it lights up and you lose the round.',
    'First to 10 points wins. The target drifts faster with every point.',
  ],
  art: { src: art, alt: 'A phone with an archery target on its screen' },
  fr: {
    pitch: 'Le pouce le plus rapide de la salle remporte la manche',
    concept: 'Un seul signal, tous les écrans en même temps. Une cible dérive — touchez-la en premier, dix fois.',
    rules: [
      'Une cible dérive sur votre écran. Suivez-la avec votre pouce.',
      'Elle s’arrête et s’allume au signal. Tapez-la.',
      'Tapez avant qu’elle ne s’allume et vous perdez la manche.',
      'Premier à 10 points gagne. La cible dérive plus vite à chaque point.',
    ],
    art: { alt: 'Un téléphone avec une cible de tir à l’arc sur son écran' },
  },
  accent: '#FFC93C',
  players: PLAYERS['tap-duel'],
  duration: '1 min',
  inputs: ['touch'],
  modes: [
    { id: 'pistol', name: 'Pistol', blurb: 'Tap on the signal — false start loses' },
    { id: 'sprint', name: 'Sprint', blurb: 'Most taps before the buzzer' },
    { id: 'simon', name: 'Simon', blurb: 'Repeat the sequence, faster each round' },
  ],
  // `new`: pistol mode is playable; sprint and simon are not built yet.
  status: 'live',
};
