import type { GameCard } from '../../core/types';
import { PLAYERS } from '../../../../shared/players';
import art from './art/card.svg?url&no-inline';

/**
 * Abduct-Moo's hub card. Contract: docs/design/illustrations.md
 *
 * **This file is a leaf.** It may import only `core/types`, `shared/players` and its
 * own `art/`. The hub imports every card, so one import of this game's runtime would
 * put the whole game in the hub's chunk — `www/src/games/cards.test.mjs` enforces it.
 *
 * The pitch is copied verbatim from docs/specs/README.md; changing it here without
 * changing the spec is a bug.
 */
export const CARD: GameCard = {
  slug: 'abduct-moo',
  title: 'Abduct-Moo',
  pitch: 'Pick a barn. Dodge the beam',
  concept: 'Five barns, one UFO. Tap where your cow runs — the beam only ever picks one.',
  rules: [
    'Tap a barn to send your cow there. Change your mind as often as you like.',
    'When the countdown ends, the UFO beams up every cow at the barn it picks.',
    'Beamed up, you’re out for good. Last cow standing wins.',
  ],
  art: { src: art, alt: "A UFO's light cone over a barn, a cow mid-abduction" },
  fr: {
    pitch: 'Choisissez une grange. Évitez le rayon',
    concept: 'Cinq granges, une soucoupe. Touchez la grange où votre vache court — le rayon n’en choisit qu’une.',
    rules: [
      'Touchez une grange pour y envoyer votre vache. Changez d’avis autant que vous voulez.',
      'Quand le décompte se termine, la soucoupe enlève toutes les vaches de la grange choisie.',
      'Enlevée, votre vache est éliminée. La dernière vache debout gagne.',
    ],
    art: { alt: 'Le rayon lumineux d’une soucoupe au-dessus d’une grange, une vache en train d’être enlevée' },
  },
  accent: '#FACC15',
  players: PLAYERS['abduct-moo'],
  duration: '< 20 s',
  inputs: ['touch'],
  modes: [],
  status: 'live',
};
