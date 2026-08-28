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
  'tap-fighter': [2, 2],
  spill: [2, 4],
  'pass-the-bomb': [2, 8],
  'goat-siege': [2, 4],
  'sling-puck': [2, 2],
  'cat-and-mouse': [2, 6],
  'shake-rush': [2, 8],
  'tilt-arena': [2, 6],
  'steady-hand': [2, 8],
  'ghost-tag': [3, 10],
  'zone-rush': [2, 10],
  'ghost-hunt': [2, 10],
  'grid-attack': [2, 2],
  'scream-meter': [2, 8],
  'squash-mosquitoes': [2, 8],
  'neon-fall': [2, 2],
  'tap-tap-music': [2, 8],
  'tic-tac-tic-tac-toe': [2, 2],
  'hundred-taps': [2, 8],
  'ufo-hunt': [2, 10],
  'aliens-love-cows': [2, 8],
} as const satisfies Record<string, PlayerLimits>;

export type GameSlug = keyof typeof PLAYERS;

/** Routes with implemented game pages; idea/soon cards cannot be switch targets. */
export const BUILT_GAMES = [
  'tap-duel', 'tap-fighter', 'spill', 'pass-the-bomb', 'goat-siege', 'sling-puck',
  'cat-and-mouse', 'shake-rush', 'steady-hand', 'ghost-hunt', 'grid-attack',
  'squash-mosquitoes', 'neon-fall', 'tap-tap-music', 'tic-tac-tic-tac-toe',
  'hundred-taps', 'ufo-hunt', 'aliens-love-cows',
] as const;

export type BuiltGame = typeof BUILT_GAMES[number];

/**
 * Whether a connected roster can be brought into a built game's new lobby.
 * The picker uses this for presentation; the Worker uses it for enforcement.
 */
export function canSwitchToGame(game: string, connected: number): game is BuiltGame {
  if (!(BUILT_GAMES as readonly string[]).includes(game)) return false;
  return enoughToStart(connected, PLAYERS[game as BuiltGame]);
}

/** Compatible destinations, excluding the room's current game. */
export function switchableGames(current: string, connected: number): readonly BuiltGame[] {
  return BUILT_GAMES.filter((game) => game !== current && canSwitchToGame(game, connected));
}

/**
 * Solo test mode: one operator, one phone, no game rules bent except the two that
 * make a solo round impossible to look at.
 * Spec: docs/specs/backoffice.md §6
 *
 * The admin centre turns this on for the browser that has signed in (`core/solo.ts`),
 * and the phone sends `solo: true` with `start`. It exists for one reason — seeing a
 * game **render** without rounding up a room full of people — and it changes exactly
 * two things, both stated here so nobody has to go looking:
 *
 * 1. **The minimum player count**, below. Every other limit still applies, including
 *    the maximum.
 * 2. **"Last one standing"** ends a round in Steady Hand, Pass the Bomb, Goat Siege
 *    and Spill. Alone you *are* the last one standing at kick-off, so the round would
 *    finish in the same tick it began and there would be nothing to look at. In a solo
 *    round the threshold drops to nobody left — see `lastStanding` below, which is
 *    where that distinction matters. The round's own time cap still ends it either way.
 *
 * Nothing else moves. No score, no timing, no elimination rule, no difficulty curve —
 * a solo round is the real game with one player in it, which is the only way looking
 * at it tells you anything true.
 *
 * **This is not a security control**, and the same is already written about the
 * feature flags: a crafted client can send `solo: true`, and what it gets is the
 * ability to play alone in its own room. There is nothing to protect.
 */
export function enoughToStart(connected: number, limits: PlayerLimits, solo = false): boolean {
  const [min, max] = limits;
  if (connected > max) return false;

  return connected >= (solo ? 1 : min);
}

/**
 * "Last one standing" — the second, and only other, thing solo mode moves.
 *
 * Ordinarily a round is over when one player is left: there is nobody to play against.
 * Alone that is true at kick-off, so the round would finish in the tick it started and
 * there would be nothing to look at — hence the relaxation.
 *
 * What it does **not** do is remove the condition. Solo lowers the threshold from one
 * to **zero**, so a round whose only player has been eliminated still ends. Writing it
 * as `!solo && left <= 1` instead — the obvious version — leaves a round with nobody
 * in it running to its cap, and in Pass the Bomb it then draws the next holder from an
 * empty list and hands the room an `undefined` player id.
 *
 * The cap always ends a round regardless; this is only the early exit.
 */
export function lastStanding(left: number, solo: boolean): boolean {
  return left <= (solo ? 0 : 1);
}
