import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Gravity Shooter's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'gravity-shooter',
  title: 'Gravity Shooter',
  pitch: 'Bend your shot around a planet and blow up their ship',
  concept: 'Two ships, two planets between them — point above your ship, let go, and let gravity curve your missile onto their hull.',
  rules: [
    'Touch above your own ship to aim toward your finger, release to fire — the planets bend the shot.',
    'Land a hit and the other ship loses a life. Five lives each.',
    'Turns alternate. First ship out of lives loses.',
  ],
  art: { src: art, alt: 'A missile curving hard around a planet toward a distant starship' },
  fr: {
    pitch: 'Courbez votre tir autour d’une planète pour détruire leur vaisseau',
    concept: 'Deux vaisseaux, deux planètes entre eux — visez au-dessus de votre vaisseau, lâchez, et laissez la gravité courber votre missile.',
    rules: [
      'Touchez au-dessus de votre vaisseau pour viser vers votre doigt, lâchez pour tirer — les planètes courbent le tir.',
      'Touchez et l’autre vaisseau perd une vie. Cinq vies chacun.',
      'Les tours alternent. Le premier vaisseau à court de vies perd.',
    ],
    art: { alt: 'Un missile courbant fortement autour d’une planète vers un vaisseau lointain' },
  },
  accent: '#818CF8',
  players: PLAYERS['gravity-shooter'],
  duration: '1–3 min',
  inputs: ['touch'],
  modes: [],
  status: 'live',
};
