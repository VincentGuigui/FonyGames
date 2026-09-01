/**
 * Feature flags, shared by the hub and the room server.
 * Spec: docs/specs/backoffice.md §2b, §5
 *
 * A zero-import leaf, DOM-free, so it typechecks under `tsconfig.worker.json` and can be
 * read by the hub without dragging anything else in.
 *
 * ## One state, not two fields
 *
 * A game is exactly one of `new` / `active` / `soon` / `hidden` — never two of these at
 * once. This supersedes an earlier design (superseded 2026-09-01) that kept `isNew` as a
 * second, independent boolean specifically so a game could be "new and disabled" at the
 * same time; the operator asked for the simpler mental model instead, at the cost of that
 * combination. `soon` also replaces the old `disabled` — the same runtime "not playable
 * right now" state, renamed to read the same as the build-time "not built yet" one
 * (`GameCard.status`), which the stricter-of-the-two rule in `cardState` already treated
 * as the same kind of caveat to a player.
 *
 * ## Fail open, on purpose
 *
 * An unknown slug, or `/flags` unreachable, means `active`. A Worker hiccup must not
 * blank the catalogue. The consequence is stated rather than discovered: **a flag is not
 * a security control.** For something genuinely dangerous, delete the game and deploy.
 */

export type FlagState = 'new' | 'active' | 'soon' | 'hidden';

export type GameFlag = {
  state: FlagState;
  /** Shown beside a `soon` card. Absent, not empty, when there is none. */
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

export const DEFAULT_FLAG: GameFlag = { state: 'active' };

export function flagFor(flags: Record<string, GameFlag>, slug: string): GameFlag {
  return flags[slug] ?? DEFAULT_FLAG;
}

/** `new` is cosmetic-plus-playable, same as `active` — the badge is the only
 *  difference between the two. */
export function isPlayable(state: FlagState): boolean {
  return state === 'active' || state === 'new';
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
  return isPlayable(flagFor(flags, slug).state);
}

/**
 * How a card should present, given the flag and the build-time intent.
 *
 * **The stricter of the two wins** (spec §2b). `status` says how finished a game is;
 * the flag says whether it may be played now. A `soon` game that someone flipped to
 * `active` is still `soon` — the code does not exist yet, and a flag cannot conjure it.
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
   * saying nothing. It never applies to `soon` or `hidden` — the other states' badges
   * are caveats, and a paused game announcing how popular it is would be a joke at the
   * player's expense.
   */
  hot = false,
  /**
   * Is this the week's own spotlighted game (`gameOfWeek`)? Ranked below HOT — a real
   * signal (people are actually playing this) always outranks a scheduled one — and
   * above NEW, so the rotation stays visible rather than quietly buried behind every
   * game that also happens to be flagged new.
   */
  week = false,
): { show: boolean; playable: boolean; badge: string | null } {
  if (status === 'soon') return { show: true, playable: false, badge: 'soon' };

  switch (flag.state) {
    case 'new':
      return { show: true, playable: true, badge: hot ? 'hot' : week ? 'week' : 'new' };
    case 'active':
      return { show: true, playable: true, badge: hot ? 'hot' : week ? 'week' : null };
    case 'soon':
      return {
        show: true,
        playable: showAll,
        badge: showAll ? 'soon' : (flag.reason ?? 'soon'),
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
 * The hub's three tiers (issue #4): the week's spotlight and the hottest game
 * pinned at the top, then every NEW-flagged game alphabetically, then
 * everything else alphabetically. Three separate lists rather than one
 * ordered array, so a caller can put a visual break between them (a fresh
 * grid section, on both the client and the server-rendered page) instead of
 * guessing the boundary back out of a flat order.
 *
 * `slugsAlphabetical` is every live game sorted by (English) title — the
 * same list `gameOfWeek` itself already requires, reused here so neither
 * `fresh` nor `rest` needs a second sort, and so a French visitor and an
 * English one still land on the same three groups.
 *
 * `hot` and `week` can be the same slug (the week's own spotlight also
 * happens to be the most played) — `pinned` de-duplicates rather than
 * showing one card twice, keeping WEEK's own rank (it is listed first in
 * the call below) since the badge itself already ranks HOT above WEEK
 * (`cardState`) independently of where the card sits.
 */
export function hubSections(
  slugsAlphabetical: string[],
  flags: Record<string, GameFlag>,
  hot: string | null,
  week: string | null,
): { pinned: string[]; fresh: string[]; rest: string[] } {
  const pinned = [...new Set([week, hot].filter((slug): slug is string => slug !== null))];
  const pinnedSet = new Set(pinned);
  const unpinned = slugsAlphabetical.filter((slug) => !pinnedSet.has(slug));
  return {
    pinned,
    fresh: unpinned.filter((slug) => flagFor(flags, slug).state === 'new'),
    rest: unpinned.filter((slug) => flagFor(flags, slug).state !== 'new'),
  };
}

/**
 * ISO-8601 week number (1–53) of `now`, evaluated in UTC.
 *
 * UTC on both sides, not local time: a visitor's own timezone — and the server's —
 * must never be able to make the client and the server-rendered page disagree about
 * which week it is. Weeks start Monday; week 1 is the week containing the year's
 * first Thursday. The same rule PHP's `gmdate('W')` already applies natively
 * (`Flags::isoWeek` in `api/lib/Flags.php`), so this is the one side that has to
 * hand-implement it.
 */
export function isoWeek(now: Date): number {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0 .. Sunday = 6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // the nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / 604_800_000);
}

/**
 * The week's own spotlighted game — automatic, from nothing but the calendar and the
 * catalogue.
 * Spec: docs/specs/hub.md §2
 *
 * `slugsAlphabetical` is every **live** game, sorted by title — the caller's job, not
 * this one's. That split matters for one reason: the client (fresh from `catalogue()`)
 * and the PHP build (`weekOrder()` in `scripts/ssr.mjs`, baked into `cards.php` once,
 * at build time) each supply their own copy of the identical list, and neither has to
 * agree with the other about *how* to sort — only that the list, once made, is the
 * same. Sorted by the game's own (English) title, never a locale's translation of it:
 * `HubGrid.tsx` computes this before `localizeCard`, so a French visitor is shown the
 * same spotlighted game an English one is.
 *
 * The index into that list is nothing cleverer than the ISO week number: no year
 * offset, no shuffle. The same slug returns on the same calendar week every year,
 * which is what makes it "automatic" rather than a schedule someone has to maintain —
 * asked for directly, in exactly those words.
 */
export function gameOfWeek(slugsAlphabetical: string[], now: Date): string | null {
  if (slugsAlphabetical.length === 0) return null;
  const index = (isoWeek(now) - 1) % slugsAlphabetical.length;
  return slugsAlphabetical[index] ?? null;
}
