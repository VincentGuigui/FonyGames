/**
 * Which colour a player's avatar tints their sprite. Contract: docs/design/illustrations.md §4
 *
 * `/avatar-colors.json` (`www/public/`, shipped as a static file) is one flat
 * `{ avatar: hex }` map — a **config file, not a build-time constant**: it is
 * fetched at runtime, so retuning a colour is a file edit, not a rebuild.
 *
 * **Fails open, the same rule `flags.json`'s own reader follows** (`flagGate.ts`):
 * an unreachable host, a non-200, or a malformed body leaves every avatar
 * without a colour rather than throwing — a sprite with no tint is still a
 * sprite (AGENTS.md §4, degrade never dead-end).
 *
 * **Nothing is awaited**, the same rule `core/art/sprites.ts` follows: `colorFor`
 * returns `null` while the fetch is in flight or if it never resolves, so a
 * render loop calls it inside the frame and draws untinted on `null` rather
 * than blocking the first frame on a network round trip.
 *
 * A factory (`createAvatarColorStore`) rather than bare module state, purely so
 * a test can hold two independent stores at once — every real caller wants
 * the one shared `avatarColors` instance below.
 */

export type AvatarColorStore = {
  /** Start the fetch. Idempotent — call at module scope in a room or canvas
   *  file, the same "starts when the game's chunk executes" rule `art()`
   *  states for its own loads, so the map is usually ready well before a
   *  first frame asks for it. */
  load: () => void;
  /** This avatar's tint, or `null` while loading, on failure, or for an
   *  avatar the config file does not mention. */
  colorFor: (avatar: string) => string | null;
};

function isColorMap(body: unknown): body is Record<string, string> {
  return (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    Object.values(body).every((v) => typeof v === 'string')
  );
}

export function createAvatarColorStore(url = '/avatar-colors.json'): AvatarColorStore {
  let colors: Record<string, string> | null = null;
  let fetching: Promise<void> | null = null;

  return {
    load: () => {
      fetching ??= fetch(url)
        .then((res) => (res.ok ? res.json() : null))
        .then((body: unknown) => {
          colors = isColorMap(body) ? body : {};
        })
        .catch(() => {
          colors = {};
        });
    },
    colorFor: (avatar) => colors?.[avatar] ?? null,
  };
}

const avatarColors = createAvatarColorStore();

export const loadAvatarColors = avatarColors.load;
export const colorFor = avatarColors.colorFor;
