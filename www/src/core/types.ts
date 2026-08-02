/** Input a game relies on. Drives the icons on the hub card. */
export type GameInput =
  | 'touch'
  | 'motion'
  | 'orientation'
  | 'gps'
  | 'compass'
  | 'mic';

/** Motif used by the placeholder illustrations until real art exists. */
export type GameMotif =
  | 'bump'
  | 'shake'
  | 'tilt'
  | 'steady'
  | 'tap'
  | 'ghost'
  | 'zone'
  | 'compass'
  | 'scream'
  | 'spill'
  | 'goat';

export type GameMode = {
  id: string;
  name: string;
  blurb: string;
};

/**
 * Everything the hub needs to sell a game, and nothing else — the hub must not
 * know how a game works. See docs/architecture.md §3.
 */
export type GameCard = {
  /** kebab-case; matches the URL, the spec filename and the code folder. */
  slug: string;
  title: string;
  /** ONE catchy sentence, <= 60 chars, no trailing period. */
  pitch: string;
  motif: GameMotif;
  /** Accent colour, from the game's spec. */
  accent: string;
  players: [min: number, max: number];
  /** Human-readable, e.g. "1–2 min". */
  duration: string;
  inputs: GameInput[];
  modes: GameMode[];
  status: 'live' | 'beta' | 'soon';
};
