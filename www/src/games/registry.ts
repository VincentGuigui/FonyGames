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
  {
    slug: 'tap-duel',
    title: 'Tap Duel',
    pitch: 'The fastest thumb in the room takes the round',
    motif: 'tap',
    accent: '#FFC93C',
    players: [2, 8],
    duration: '1 min',
    inputs: ['touch'],
    modes: [
      { id: 'pistol', name: 'Pistol', blurb: 'Tap on the signal — false start loses' },
      { id: 'sprint', name: 'Sprint', blurb: 'Most taps before the buzzer' },
      { id: 'simon', name: 'Simon', blurb: 'Repeat the sequence, faster each round' },
    ],
    // `beta`: pistol mode is playable; sprint and simon are not built yet.
    status: 'beta',
  },
  {
    slug: 'spill',
    title: 'Spill',
    pitch: 'Fling your water at the neighbours before they flood you',
    motif: 'spill',
    accent: '#38BDF8',
    players: [2, 4],
    duration: '1–3 min',
    inputs: ['touch'],
    modes: [
      { id: 'ring', name: 'Ring', blurb: 'Phones flat on the table, aim across the room' },
    ],
    // `beta`: playable end to end, but the numbers in spec §12 are guesses
    // until a real table test.
    status: 'beta',
  },
  {
    slug: 'bump-relay',
    title: 'Bump Relay',
    pitch: 'Smash phones together to pass the bomb before it blows',
    motif: 'bump',
    accent: '#FF5A36',
    players: [3, 8],
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
    motif: 'goat',
    accent: '#4ADE80',
    players: [2, 4],
    duration: '2–3 min',
    inputs: ['touch'],
    modes: [
      { id: 'patch', name: 'Patch', blurb: 'Six cabbages each, last garden standing' },
    ],
    // `beta`: playable, but §11 of the spec lists real balance questions.
    status: 'beta',
  },
  {
    slug: 'shake-sprint',
    title: 'Shake Sprint',
    pitch: 'Shake like your life depends on it — first to the finish wins',
    motif: 'shake',
    accent: '#4ADE80',
    players: [2, 8],
    duration: '1 min',
    inputs: ['motion'],
    modes: [],
    status: 'soon',
  },
  {
    slug: 'tilt-arena',
    title: 'Tilt Arena',
    pitch: 'Tilt to steer, crash to win',
    motif: 'tilt',
    accent: '#38BDF8',
    players: [2, 6],
    duration: '2 min',
    inputs: ['orientation'],
    modes: [],
    status: 'soon',
  },
  {
    slug: 'steady-hand',
    title: 'Steady Hand',
    pitch: 'Hold your phone perfectly still. Longer than everyone else',
    motif: 'steady',
    accent: '#C084FC',
    players: [2, 8],
    duration: '1 min',
    inputs: ['motion'],
    modes: [],
    status: 'soon',
  },
  {
    slug: 'ghost-tag',
    title: 'Ghost Tag',
    pitch: 'One ghost, a whole neighbourhood, and a map that only whispers',
    motif: 'ghost',
    accent: '#A3A3A3',
    players: [3, 10],
    duration: '10 min',
    inputs: ['gps', 'motion'],
    modes: [],
    status: 'soon',
  },
  {
    slug: 'zone-rush',
    title: 'Zone Rush',
    pitch: 'Claim real streets by standing on them longer than your rivals',
    motif: 'zone',
    accent: '#FB7185',
    players: [2, 10],
    duration: '10 min',
    inputs: ['gps'],
    modes: [],
    status: 'soon',
  },
  {
    slug: 'compass-hunt',
    title: 'Compass Hunt',
    pitch: 'Follow the arrow to the treasure — so is everyone else',
    motif: 'compass',
    accent: '#FBBF24',
    players: [2, 10],
    duration: '10 min',
    inputs: ['compass', 'gps'],
    modes: [],
    status: 'soon',
  },
  {
    slug: 'scream-meter',
    title: 'Scream Meter',
    pitch: 'Loudest wins. Your neighbours will not be thanked',
    motif: 'scream',
    accent: '#F472B6',
    players: [2, 8],
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
