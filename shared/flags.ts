/**
 * Feature flags, shared by the hub and the room server.
 * Spec: docs/specs/backoffice.md §2b, §5
 *
 * A zero-import leaf, DOM-free, so it typechecks under `tsconfig.worker.json` and can be
 * read by the hub without dragging anything else in.
 *
 * ## Two fields, not one enum
 *
 * `availability` is what the **Worker enforces**. `isNew` only drives a badge. They are
 * separate because a game can be new *and* disabled, and folding novelty into the enum
 * would make `new` silently mean "playable" — presentation leaking into the one thing
 * that is a control.
 *
 * ## Fail open, on purpose
 *
 * An unknown slug, or `/flags` unreachable, means `active`. A Worker hiccup must not
 * blank the catalogue. The consequence is stated rather than discovered: **a flag is not
 * a security control.** For something genuinely dangerous, delete the game and deploy.
 */

export type FlagState = 'active' | 'disabled' | 'hidden';

export type GameFlag = {
  availability: FlagState;
  /** Runtime NEW badge, independent of build-time `status` in `card.ts`. */
  isNew: boolean;
  /** Shown beside a disabled card. Absent, not empty, when there is none. */
  reason?: string;
};

/** What `GET /flags` returns. Deliberately just the flags — no audit trail. */
export type PublicFlags = { flags: Record<string, GameFlag> };

export const DEFAULT_FLAG: GameFlag = { availability: 'active', isNew: false };

export function flagFor(flags: Record<string, GameFlag>, slug: string): GameFlag {
  return flags[slug] ?? DEFAULT_FLAG;
}

/**
 * May the Worker open a room for this game?
 *
 * **`occupied` is the in-flight rule.** Disabling blocks *new* rooms; a duel already
 * running is never interrupted (spec §2b), so a room that still has a connected player
 * keeps accepting them. Without this, flipping a flag would kick people out of a round
 * they were in the middle of — which is a different and much rarer thing to want.
 */
export function mayOpenRoom(
  flags: Record<string, GameFlag>,
  slug: string,
  occupied: boolean,
): boolean {
  if (occupied) return true;
  return flagFor(flags, slug).availability === 'active';
}

/**
 * How a card should present, given the flag and the build-time intent.
 *
 * **The stricter of the two wins** (spec §2b). `status` says how finished a game is;
 * the flag says whether it may be played now. A `soon` game that someone flipped to
 * `active` is still `soon` — the code does not exist yet, and a flag cannot conjure it.
 */
export function cardState(
  status: 'live' | 'new' | 'soon',
  flag: GameFlag,
  /** dev shows everything with a badge stating what prod would do (spec §2b). */
  showAll: boolean,
): { show: boolean; playable: boolean; badge: string | null } {
  if (status === 'soon') return { show: true, playable: false, badge: 'soon' };

  const isNew = flag.isNew || status === 'new';
  switch (flag.availability) {
    case 'active':
      return { show: true, playable: true, badge: isNew ? 'new' : null };
    case 'disabled':
      return {
        show: true,
        playable: showAll,
        badge: showAll ? 'disabled' : (flag.reason ?? 'paused'),
      };
    case 'hidden':
      return { show: showAll, playable: showAll, badge: 'hidden' };
  }
}
