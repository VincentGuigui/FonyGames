import { PLAYERS } from '../../../shared/players';

// One per game. `?url&no-inline` is mandatory: without it Vite base64-inlines
// anything under 4096 bytes straight into this chunk, which is the budget rule in
// docs/architecture.md §4 broken silently. See docs/design/illustrations.md §2.
import art_bump_relay from './bump-relay/art/card.svg?url&no-inline';
import art_goat_siege from './goat-siege/art/card.svg?url&no-inline';
import art_sling_puck from './sling-puck/art/card.svg?url&no-inline';
import art_cat_and_mouse from './cat-and-mouse/art/card.svg?url&no-inline';
import art_shake_sprint from './shake-sprint/art/card.svg?url&no-inline';
import art_tilt_arena from './tilt-arena/art/card.svg?url&no-inline';
import art_steady_hand from './steady-hand/art/card.svg?url&no-inline';
import art_ghost_tag from './ghost-tag/art/card.svg?url&no-inline';
import art_zone_rush from './zone-rush/art/card.svg?url&no-inline';
import art_compass_hunt from './compass-hunt/art/card.svg?url&no-inline';
import art_scream_meter from './scream-meter/art/card.svg?url&no-inline';
import { CARD as TAP_DUEL_CARD } from './tap-duel/card';
import { CARD as SPILL_CARD } from './spill/card';
import type { GameCard } from '../core/types';

/**
 * The hub catalogue. Ordered deliberately: `live` first, then `beta`, then
 * `soon` (see docs/specs/hub.md §2).
 *
 * Entries live here while a game is still `soon`. When a game is actually
 * built, its card moves to `games/<slug>/card.ts` next to the code and this
 * file imports it — the hub keeps reading one list either way.
 *
 * Pitches are copied verbatim from docs/specs/README.md. Changing one here
 * without changing the spec is a bug.
 */
export const GAMES: GameCard[] = [
  TAP_DUEL_CARD,
  SPILL_CARD,
  {
    slug: 'bump-relay',
    title: 'Bump Relay',
    pitch: 'Smash phones together to pass the bomb before it blows',
    concept: 'The fuse is hidden, so nobody knows how long they dare hold it.',
    rules: [
      'One phone holds the bomb.',
      'Knock phones together to pass it on.',
      'Holding it when the fuse ends puts you out.',
    ],
    art: { src: art_bump_relay, alt: 'Two phones knocking together, a bomb jumping between them' },
    accent: '#FF5A36',
    players: PLAYERS['bump-relay'],
    duration: '1–2 min',
    inputs: ['motion', 'touch'],
    modes: [
      { id: 'classic', name: 'Classic', blurb: 'One bomb, one loser at a time' },
      { id: 'double', name: 'Double', blurb: 'Two bombs, half the mercy' },
      { id: 'hot-hands', name: 'Hot Hands', blurb: 'Hold it too long and it speeds up' },
      { id: 'teams', name: 'Teams', blurb: 'Two colours, one bomb, zero trust' },
    ],
    status: 'soon',
  },
  {
    slug: 'goat-siege',
    title: 'Goat Siege',
    pitch: "Shoo the neighbours' goats before they eat your cabbages",
    concept: 'Shooing is not free — one tap becomes two problems.',
    rules: [
      'Tap a neighbour to lob a goat at them.',
      'Tap incoming goats to shoo them.',
      'A shooed goat splits into two kids.',
    ],
    art: { src: art_goat_siege, alt: 'A goat sailing over a fence towards a row of cabbages' },
    accent: '#4ADE80',
    players: PLAYERS['goat-siege'],
    duration: '2–3 min',
    inputs: ['touch'],
    modes: [
      { id: 'patch', name: 'Patch', blurb: 'Six cabbages each, last garden standing' },
    ],
    // `beta`: playable, but §11 of the spec lists real balance questions.
    status: 'beta',
  },
  {
    slug: 'sling-puck',
    title: 'Sling Puck',
    pitch: 'Sling every puck onto their side before they sling them back',
    concept: 'One board, split across two phones. Empty your half.',
    rules: [
      'Drag a puck onto the elastic, pull back, let go.',
      'Pucks bounce off every wall except the gap.',
      'No turns. You are both slinging at once.',
    ],
    art: { src: art_sling_puck, alt: 'Two halves of a board, an elastic pulled back and a puck in the gap' },
    accent: '#FB7185',
    players: PLAYERS['sling-puck'],
    duration: '30 s – 2 min',
    inputs: ['touch'],
    modes: [
      { id: 'classic', name: 'Classic', blurb: 'Five pucks each, first side clear wins' },
    ],
    // `beta`: playable, but §14 of the spec has the puck count and gap width
    // down as open questions, and only a play test settles either.
    status: 'beta',
  },
  {
    slug: 'cat-and-mouse',
    title: 'Cat and Mouse',
    pitch: 'One cat, a floor full of mice, and nowhere to hide',
    concept: 'One shared floor. Your mouse moves only while you are moving it.',
    rules: [
      'Drag your own icon. Let go and it stops dead.',
      'The cat is faster, and only has to touch you.',
      'Three lives each. Outlast the clock and the mice win.',
    ],
    art: { src: art_cat_and_mouse, alt: 'A cat lunging after two mice running away' },
    accent: '#C084FC',
    players: PLAYERS['cat-and-mouse'],
    duration: '60–90 s',
    inputs: ['touch'],
    modes: [
      { id: 'chase', name: 'Chase', blurb: 'One cat, three lives each, beat the clock' },
    ],
    // Specced, not built: docs/specs/games/cat-and-mouse.md is a draft awaiting
    // the maintainer's go-ahead, and it needs an accessible fallback first (§12).
    status: 'soon',
  },
  {
    slug: 'shake-sprint',
    title: 'Shake Sprint',
    pitch: 'Shake like your life depends on it — first to the finish wins',
    concept: 'Pure effort: the harder you shake, the faster you move.',
    rules: [
      'Shake to move down the track.',
      'First over the finish line wins.',
    ],
    art: { src: art_shake_sprint, alt: 'A phone shaking, motion lines either side of it' },
    accent: '#4ADE80',
    players: PLAYERS['shake-sprint'],
    duration: '1 min',
    inputs: ['motion'],
    modes: [],
    status: 'soon',
  },
  {
    slug: 'tilt-arena',
    title: 'Tilt Arena',
    pitch: 'Tilt to steer, crash to win',
    concept: 'Everyone shares one board, and only tilt steers you.',
    rules: [
      'Tilt your phone to steer.',
      'Shove everyone else off the board.',
    ],
    art: { src: art_tilt_arena, alt: 'A phone tilted inside a dashed circle' },
    accent: '#38BDF8',
    players: PLAYERS['tilt-arena'],
    duration: '2 min',
    inputs: ['orientation'],
    modes: [],
    status: 'soon',
  },
  {
    slug: 'steady-hand',
    title: 'Steady Hand',
    pitch: 'Hold your phone perfectly still. Longer than everyone else',
    concept: 'The opposite of every other game here: do as little as possible.',
    rules: [
      'Hold your phone as still as you can.',
      'The last one still steady wins.',
    ],
    art: { src: art_steady_hand, alt: 'A phone held perfectly level, a target centred on it' },
    accent: '#C084FC',
    players: PLAYERS['steady-hand'],
    duration: '1 min',
    inputs: ['motion'],
    modes: [],
    status: 'soon',
  },
  {
    slug: 'ghost-tag',
    title: 'Ghost Tag',
    pitch: 'One ghost, a whole neighbourhood, and a map that only whispers',
    concept: 'The map tells the ghost less than it tells you — and lies to nobody.',
    rules: [
      'One player is the ghost.',
      'The map only hints where they are.',
      'Get caught and you join the ghost.',
    ],
    art: { src: art_ghost_tag, alt: 'A ghost drifting upward on a dashed line' },
    accent: '#A3A3A3',
    players: PLAYERS['ghost-tag'],
    duration: '10 min',
    inputs: ['gps', 'motion'],
    modes: [],
    status: 'soon',
  },
  {
    slug: 'zone-rush',
    title: 'Zone Rush',
    pitch: 'Claim real streets by standing on them longer than your rivals',
    concept: 'Ground is claimed by standing on it, not by tapping.',
    rules: [
      'Stand in a zone to start claiming it.',
      'Hold it longer than anyone else.',
    ],
    art: { src: art_zone_rush, alt: 'A grid of squares, half of them claimed' },
    accent: '#FB7185',
    players: PLAYERS['zone-rush'],
    duration: '10 min',
    inputs: ['gps'],
    modes: [],
    status: 'soon',
  },
  {
    slug: 'compass-hunt',
    title: 'Compass Hunt',
    pitch: 'Follow the arrow to the treasure — so is everyone else',
    concept: 'Everyone gets the same arrow, so the race is the game.',
    rules: [
      'Follow the arrow to the treasure.',
      'Everyone else is following it too.',
    ],
    art: { src: art_compass_hunt, alt: 'A compass needle pointing north' },
    accent: '#FBBF24',
    players: PLAYERS['compass-hunt'],
    duration: '10 min',
    inputs: ['compass', 'gps'],
    modes: [],
    status: 'soon',
  },
  {
    slug: 'scream-meter',
    title: 'Scream Meter',
    pitch: 'Loudest wins. Your neighbours will not be thanked',
    concept: 'One number, one lung-full, no strategy whatsoever.',
    rules: [
      'Make as much noise as you can.',
      'Loudest reading wins the round.',
    ],
    art: { src: art_scream_meter, alt: 'A phone with sound waves rippling out of it' },
    accent: '#F472B6',
    players: PLAYERS['scream-meter'],
    duration: '1 min',
    inputs: ['mic'],
    modes: [],
    status: 'soon',
  },
];

const ORDER = { live: 0, beta: 1, soon: 2 } as const;

/** Catalogue in display order. */
export function catalogue(): GameCard[] {
  return [...GAMES].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}
