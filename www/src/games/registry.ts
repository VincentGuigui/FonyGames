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
    concept: 'One signal, every screen at once — pure reflex, nothing else.',
    rules: [
      'Wait for the screen to change.',
      'Then tap as fast as you can.',
      'Tap too early and you lose the round.',
    ],
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
    concept: 'The table is the board: flick towards someone and it lands on their phone.',
    rules: [
      'Phones flat, top edge towards the middle.',
      'Flick your water at a neighbour.',
      'Tap an incoming drop to catch it — it doubles.',
    ],
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
    concept: 'The fuse is hidden, so nobody knows how long they dare hold it.',
    rules: [
      'One phone holds the bomb.',
      'Knock phones together to pass it on.',
      'Holding it when the fuse ends puts you out.',
    ],
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
    concept: 'Shooing is not free — one tap becomes two problems.',
    rules: [
      'Tap a neighbour to lob a goat at them.',
      'Tap incoming goats to shoo them.',
      'A shooed goat splits into two kids.',
    ],
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
    concept: 'Pure effort: the harder you shake, the faster you move.',
    rules: [
      'Shake to move down the track.',
      'First over the finish line wins.',
    ],
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
    concept: 'Everyone shares one board, and only tilt steers you.',
    rules: [
      'Tilt your phone to steer.',
      'Shove everyone else off the board.',
    ],
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
    concept: 'The opposite of every other game here: do as little as possible.',
    rules: [
      'Hold your phone as still as you can.',
      'The last one still steady wins.',
    ],
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
    concept: 'The map tells the ghost less than it tells you — and lies to nobody.',
    rules: [
      'One player is the ghost.',
      'The map only hints where they are.',
      'Get caught and you join the ghost.',
    ],
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
    concept: 'Ground is claimed by standing on it, not by tapping.',
    rules: [
      'Stand in a zone to start claiming it.',
      'Hold it longer than anyone else.',
    ],
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
    concept: 'Everyone gets the same arrow, so the race is the game.',
    rules: [
      'Follow the arrow to the treasure.',
      'Everyone else is following it too.',
    ],
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
    concept: 'One number, one lung-full, no strategy whatsoever.',
    rules: [
      'Make as much noise as you can.',
      'Loudest reading wins the round.',
    ],
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
