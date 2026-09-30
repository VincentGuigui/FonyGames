import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Blink Tapper's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players`
 * and its own `art/` — the hub imports every card, so one import of this
 * game's runtime would put the whole game in the hub's chunk.
 *
 * The flashing warning is the first rule because the card is where someone
 * decides to play this (spec §9).
 */
export const CARD: GameCard = {
  slug: 'blink-tapper',
  title: 'Blink Tapper',
  pitch: 'Catch the blink. Miss it and lose the point',
  concept: 'Tap the light while it is lit. It starts slow and ends faster than any thumb.',
  rules: [
    'This game flashes fast. Do not play if flashing lights can trigger a seizure for you.',
    'Tap the lit light for a point. A dark light, or a blink you let go, costs one.',
    'It speeds up to 30 blinks a second. Most points wins.',
  ],
  art: { src: art, alt: 'A bulb mid-flash with a finger closing in on it, a second bulb dark beside it' },
  fr: {
    pitch: 'Attrapez le clignotement. Ratez-le et perdez le point',
    concept: 'Tapez la lumière quand elle est allumée. Lente au début, plus rapide que n’importe quel pouce à la fin.',
    rules: [
      'Ce jeu clignote vite. N’y jouez pas si les lumières clignotantes peuvent vous provoquer une crise.',
      'Tapez la lumière allumée pour un point. Une lumière éteinte, ou un clignotement raté, en coûte un.',
      'Ça accélère jusqu’à 30 clignotements par seconde. Le plus de points gagne.',
    ],
    art: { alt: 'Une ampoule en plein flash avec un doigt qui s’en approche, une seconde ampoule éteinte à côté' },
  },
  accent: '#FFC400',
  players: PLAYERS['blink-tapper'],
  duration: '30 s–2 min',
  inputs: ['touch'],
  tags: ['party', 'arcade', 'intense'],
  modes: [],
  status: 'live',
};
