import { CARD as TAP_DUEL_CARD } from './tap-duel/card';
import { CARD as SPILL_CARD } from './spill/card';
import { CARD as GOAT_SIEGE_CARD } from './goat-siege/card';
import { CARD as SLING_PUCK_CARD } from './sling-puck/card';
import { CARD as BUMP_RELAY_CARD } from './pass-the-bomb/card';
import { CARD as CAT_AND_MOUSE_CARD } from './cat-and-mouse/card';
import { CARD as SHAKE_SPRINT_CARD } from './shake-rush/card';
import { CARD as TILT_ARENA_CARD } from './tilt-arena/card';
import { CARD as STEADY_HAND_CARD } from './steady-hand/card';
import { CARD as GHOST_TAG_CARD } from './ghost-tag/card';
import { CARD as ZONE_RUSH_CARD } from './zone-rush/card';
import { CARD as COMPASS_HUNT_CARD } from './ghost-hunt/card';
import { CARD as SCREAM_METER_CARD } from './scream-meter/card';
import { CARD as GRID_ATTACK_CARD } from './grid-attack/card';
import { CARD as SQUASH_MOSQUITOES_CARD } from './squash-mosquitoes/card';
import type { GameCard } from '../core/types';

/**
 * The hub catalogue: one import per game, and nothing else.
 *
 * Every card lives in its own `games/<slug>/card.ts` beside the game — including
 * the ones still `soon`, whose folder holds only a card and its art. So adding or
 * removing a game touches one directory plus one line here
 * (docs/design/illustrations.md §1).
 *
 * The imports are **written out** rather than discovered with `import.meta.glob`.
 * A glob is a Vite-only transform, so it would break any node-run test that
 * imports this file; it is untyped; and it would throw away the curated order
 * below, which docs/specs/hub.md §2 requires.
 */
export const GAMES: GameCard[] = [
  TAP_DUEL_CARD,
  SPILL_CARD,
  BUMP_RELAY_CARD,
  GOAT_SIEGE_CARD,
  SLING_PUCK_CARD,
  CAT_AND_MOUSE_CARD,
  SHAKE_SPRINT_CARD,
  TILT_ARENA_CARD,
  STEADY_HAND_CARD,
  GHOST_TAG_CARD,
  ZONE_RUSH_CARD,
  COMPASS_HUNT_CARD,
  GRID_ATTACK_CARD,
  SQUASH_MOSQUITOES_CARD,
  SCREAM_METER_CARD,
];

/** Display order by status. One entry per value of `GameCard['status']`. */
const ORDER = { live: 0, soon: 1 } as const;

/** Catalogue in display order. */
export function catalogue(): GameCard[] {
  return [...GAMES].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}
