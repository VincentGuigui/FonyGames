/**
 * What colour a tile is. Spec: docs/specs/games/double-fusion.md §2.2
 *
 * **The only place a tile's colour is decided.** The board and the thumbnails
 * both call these and nothing else, so retuning the palette is a change here
 * and nowhere else. A tile is its number — 2, 4, 8, … — and 0 is an empty cell.
 *
 * The rule: one step round the hue wheel per doubling, so a neighbour on the
 * board is never the same colour as the tile it could merge into.
 */

const HUE_AT_2 = 200;
const HUE_STEP = 34;

export const EMPTY_TILE = '#1c202b';

function hueOf(value: number): number {
  return (HUE_AT_2 + (Math.round(Math.log2(value)) - 1) * HUE_STEP) % 360;
}

export function tileColor(value: number): string {
  if (!(value > 0)) return EMPTY_TILE;
  return `hsl(${hueOf(value)} 72% 52%)`;
}

/** The number's colour on its tile: dark on the bright yellows and greens. */
export function tileTextColor(value: number): string {
  if (!(value > 0)) return 'transparent';
  const hue = hueOf(value);
  return hue >= 40 && hue <= 180 ? '#10131a' : '#ffffff';
}
