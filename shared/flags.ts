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

/**
 * What the published `flags.json` holds. Deliberately no audit trail.
 *
 * `plays` is beside the flags rather than inside a `GameFlag`, and that separation is the
 * point: a flag is a **decision the operator made**, a play count is something that
 * happened. Folding a counter into the flag would mean every reader that validates a flag
 * has to know about a field it must not act on — and the Worker, which enforces
 * availability, has no business seeing how popular a game is.
 */
export type PublicFlags = {
  flags: Record<string, GameFlag>;
  /** Rounds finished with a winner, per slug. Absent on a host that has never counted. */
  plays?: Record<string, number>;
};

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
 *
 * ## NEW is a flag and ONLY a flag
 *
 * This used to read `flag.isNew || status === 'new'`, and the `||` made the admin's
 * NEW toggle a no-op for every game whose card said `status: 'new'`: turning the flag
 * off left the badge on, because the build-time half of the OR still held. Nothing in
 * the admin could ever clear it — the only way was a deploy.
 *
 * A badge that says "look at this" is a *merchandising* decision that changes every
 * few weeks, so it belongs to the operator, not to a constant compiled into a bundle.
 * `status` now only says whether a game exists yet.
 */
export function cardState(
  status: 'live' | 'soon',
  flag: GameFlag,
  /** dev shows everything with a badge stating what prod would do (spec §2b). */
  showAll: boolean,
  /**
   * Is this the most-played game? It wears HOT **instead of** NEW.
   *
   * One badge slot, so the two have to be ranked rather than stacked, and HOT wins: NEW
   * says nobody has tried this yet, HOT says everybody has. A card claiming both is
   * saying nothing. It applies only to an `active` game — the other states' badges are
   * caveats, and a paused game announcing how popular it is would be a joke at the
   * player's expense.
   */
  hot = false,
): { show: boolean; playable: boolean; badge: string | null } {
  if (status === 'soon') return { show: true, playable: false, badge: 'soon' };

  switch (flag.availability) {
    case 'active':
      return { show: true, playable: true, badge: hot ? 'hot' : flag.isNew ? 'new' : null };
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

/**
 * Which game is HOT: the one that has been played most.
 * Spec: docs/specs/hub.md §2
 *
 * **A unique maximum, or nothing.** A tie means there is no single most-played game, and
 * inventing one — by slug order, by catalogue position — would make the badge move for a
 * reason no player could see. Same rule as the score panel's leader (`core/ui/Scoreboard`),
 * and for the same reason: a superlative that is not true of exactly one thing is noise.
 *
 * Zero plays is never hot. On a fresh host nothing has been played, and the catalogue's
 * curated order is the honest answer.
 *
 * `slugs` bounds the answer to games that actually exist. Counts outlive a deleted game —
 * the table is keyed by slug and nothing prunes it — and promoting a slug the build does
 * not know about would silently drop the badge and reorder nothing.
 */
export function hottest(plays: Record<string, number> | undefined, slugs: string[]): string | null {
  if (!plays) return null;

  let best: string | null = null;
  let top = 0;
  let tied = false;

  for (const slug of slugs) {
    const n = plays[slug];
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue;
    if (n > top) {
      top = n;
      best = slug;
      tied = false;
    } else if (n === top) {
      tied = true;
    }
  }

  return tied ? null : best;
}

/**
 * The catalogue order with the hot game pulled to the front.
 *
 * Only the one card moves. The rest keep the curated order from `catalogue()`, because
 * sorting the whole grid by popularity would bury every new game at the bottom forever —
 * the shelf would stop being curated and start being a chart.
 */
export function promote(order: string[], hot: string | null): string[] {
  if (hot === null || !order.includes(hot)) return order;
  return [hot, ...order.filter((slug) => slug !== hot)];
}
