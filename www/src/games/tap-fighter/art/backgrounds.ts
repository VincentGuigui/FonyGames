/**
 * The stage backdrops, and which one a given match shows.
 * Contract: docs/design/illustrations.md
 *
 * **The folder is the list.** Dropping `background3.jpg` into `art/` is the whole
 * job — no code change. `import.meta.glob` is safe here, the same reasoning
 * `goat-siege/art/goats.ts` already gives: only `TapFighterRoom.tsx` imports this
 * module and no node-run test loads it.
 *
 * Sorted, so a file's index is stable across builds.
 */
const files = import.meta.glob('./background*.jpg', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const BACKGROUND_URLS = Object.keys(files).sort().map((k) => files[k]!);

/**
 * Which backdrop a match shows, from the match's own `roundId` — already shared
 * protocol state, so both phones land on the identical photo without a dedicated
 * wire field. Stable across re-renders and a reconnect, and never `Math.random()`
 * at the draw site, which would strobe a new photo in every frame.
 *
 * Hashed rather than `roundId % n`: `roundId` is a plain counter, and the modulo
 * would walk the backdrops in visible order round after round.
 */
export function backgroundFor(roundId: number): string | null {
  if (BACKGROUND_URLS.length === 0) return null;
  const hash = Math.imul(roundId | 0, 2654435761) >>> 0;
  return BACKGROUND_URLS[hash % BACKGROUND_URLS.length] ?? BACKGROUND_URLS[0] ?? null;
}
