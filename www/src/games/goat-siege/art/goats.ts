import { art, type SpriteSheet } from '../../../core/art/sprites';

/**
 * The goat designs, and which one a given goat gets.
 * Contract: docs/design/illustrations.md
 *
 * **The folder is the list.** Dropping `goat-04.svg` into `goats/` is the whole job — no
 * code change, which is the point of art being art. `import.meta.glob` is safe here,
 * unlike for cards: only `render.ts` imports this module and no node-run test loads it.
 * Keep it that way.
 *
 * Sorted, so a file's index is stable across builds.
 *
 * **One set, not two.** Kids used to have their own folder and lost it: a kid is an adult
 * design blitted smaller, because `render.ts` scales it at `base` 16 against the adult's
 * 26. That is the maintainer's call and it costs something worth naming — the spec's
 * accessibility rule asked for adult and kid to differ in *shape and size*, and now only
 * size separates them. A 1.6x difference is legible and does not rely on colour, but it
 * is narrower than it was, and goat-siege.md §12 says so rather than pretending.
 */
const adults = import.meta.glob('./goats/*.svg', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const DESIGNS = Object.keys(adults)
  .sort()
  .map((k) => art(adults[k]!));

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
  if (DESIGNS.length === 0) return null;
  // A kid wears its PARENT's design, recovered from the seed.
  //
  // goatSiege.ts assigns a kid `parent.seed * 31 + i` with i under the kids per split,
  // so integer division takes it back. Without this a split produced two kids of some
  // unrelated breed, which reads as three different goats rather than one goat becoming
  // two — and the split is the whole mechanic.
  const key = kind === 'kid' ? Math.floor(seed / 31) : seed;
  const hash = Math.imul(key | 0, 2654435761) >>> 0;
  return DESIGNS[hash % DESIGNS.length] ?? null;
}
