import { art, type SpriteSheet } from '../../../core/art/sprites';

/**
 * The goat designs, and which one a given goat gets.
 * Contract: docs/design/illustrations.md §4
 *
 * **The folder is the list.** Dropping `goat-03.svg` into `goats/` is the whole job —
 * no code change, which is the point of art being art. `import.meta.glob` is safe
 * here, unlike for cards: only `render.ts` imports this module and no node-run test
 * loads it. Keep it that way.
 *
 * Sorted, so a file's index is stable across builds.
 */
const adults = import.meta.glob('./goats/*.svg', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const kids = import.meta.glob('./kids/*.svg', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const ADULTS = Object.keys(adults)
  .sort()
  .map((k) => art(adults[k]!));
const KIDS = Object.keys(kids)
  .sort()
  .map((k) => art(kids[k]!));

/**
 * Every sprite is a square box `SPRITE_SPAN × r`, centred on the drawing origin, so a
 * caller blits it with no offset arithmetic. 2.8 is the widest the goat gets, nose to
 * tail, in the units `drawGoat` already works in.
 */
export const SPRITE_SPAN = 2.8;

/**
 * Which design this goat wears, from the **server-assigned** `seed`.
 *
 * Two reasons, and one non-reason worth writing down so nobody repeats it:
 *
 * - **Stable across frames.** A `Math.random()` at the draw site would pick a new
 *   design every frame and the goat would strobe.
 * - **Stable across a refresh.** The seed is part of the round state, so a player who
 *   reloads mid-flight sees the same goat they were already looking at.
 * - *Not* for cross-phone agreement, tempting though that sounds: in this game a goat
 *   has exactly one viewer, because `view()` keeps only the ones whose victim is you.
 *   The seed would give that for free in a game where two people watch one object —
 *   Cat and Mouse would need it — but here it buys nothing.
 *
 * Hashed rather than `seed % n`, because `seed` is a plain counter and the modulo
 * would walk the designs in visible order. And deliberately not the golden-ratio step
 * `laneFrom()` uses, or a goat's design would predict the lane it lands in.
 */
export function goatSprite(kind: 'adult' | 'kid', seed: number): SpriteSheet | null {
  const set = kind === 'adult' ? ADULTS : KIDS;
  if (set.length === 0) return null;
  const hash = Math.imul(seed | 0, 2654435761) >>> 0;
  return set[hash % set.length] ?? null;
}
