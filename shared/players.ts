/**
 * Per-game player limits, in one place.
 *
 * The hub card promises a range and the referee enforces one. While those were two
 * separate literals — `players: [2, 8]` in the registry and `SPILL_MIN_PLAYERS` in
 * protocol.ts — they could drift, and a card promising "2–8 players" over a room
 * that admits ten is the product lying to the player.
 *
 * ## Why this is its own file and not part of protocol.ts
 *
 * Every game's `card.ts` reads these, and the hub imports every card
 * (docs/design/illustrations.md §3). `protocol.ts` is hundreds of lines with helper
 * functions and module-scope state, so importing it from a card would put the whole
 * wire protocol in the hub's import graph for the sake of two numbers. Rollup would
 * *probably* shake it back out; "probably" is not a rule when the failure mode is a
 * silently heavier hub.
 *
 * So: **this file imports nothing, and must keep importing nothing.**
 *
 * It also has to typecheck under `tsconfig.worker.json`, so nothing here may touch
 * the DOM.
 */

/** `[min, max]` — inclusive at both ends. */
export type PlayerLimits = readonly [min: number, max: number];

/**
 * One row per game in the catalogue, keyed by slug.
 *
 * `as const` rather than a plain object so `PLAYERS.spill[0]` is `2` and not
 * `number | undefined` under `noUncheckedIndexedAccess`. `satisfies` still checks
 * every row is a well-formed pair.
 *
 * `www/src/games/cards.test.ts` asserts these keys match the game folders exactly,
 * so a game added without limits — or limits left behind after a game is deleted —
 * fails `npm test`.
 */
export const PLAYERS = {
  'tap-duel': [2, 8],
  spill: [2, 4],
  'pass-the-bomb': [3, 8],
  'goat-siege': [2, 4],
  'sling-puck': [2, 2],
  'cat-and-mouse': [2, 6],
  'shake-rush': [2, 8],
  'tilt-arena': [2, 6],
  'steady-hand': [2, 8],
  'ghost-tag': [3, 10],
  'zone-rush': [2, 10],
  'compass-hunt': [2, 10],
  'scream-meter': [2, 8],
} as const satisfies Record<string, PlayerLimits>;

export type GameSlug = keyof typeof PLAYERS;
