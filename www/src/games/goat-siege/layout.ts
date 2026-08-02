/**
 * Where things sit on the patch, as fractions of the canvas height.
 *
 * Shared by `render.ts` (which draws them) and `game.ts` (which hit-tests
 * against them) so a tap lands on the goat you can actually see.
 *
 * The bottom third is left clear: the canvas is full-bleed behind the lob bar
 * and the hint, and cabbages drawn down there end up underneath a button.
 */

/** Top of the ground — the fence line goats come over. */
export const GROUND_Y = 0.6;

/** Where the cabbage row sits. */
export const CABBAGE_Y = 0.7;

/** How far down a goat travels before it lands. */
export const LANDING_Y = 0.66;
