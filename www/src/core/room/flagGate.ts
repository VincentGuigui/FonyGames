import hosts from '../../../../shared/hosts.json';
import { flagFor, isPlayable, type GameFlag, type PublicFlags } from '../../../../shared/flags';

/**
 * Direct-URL access to a `soon`/`hidden` game's room screen.
 * Spec: docs/specs/backoffice.md §2b
 *
 * Hiding or greying a card on the hub is cosmetic — a bookmarked or shared
 * `/tap-duel/#AB2C` skips the grid entirely and lands straight in the lobby. The
 * Worker refusing the connection is the real enforcement, but refusing only once the
 * lobby has already rendered reads as a broken game, not a blocked one. `useRoom`
 * calls `checkSlugPlayable` alongside connecting and redirects to the hub the moment
 * it resolves `false`, so a blocked game never gets the chance to look broken.
 *
 * **Never on the dev host.** Dev already shows every game as clickable
 * (backoffice.md §2b, "dev exists to try things") and `worker/index.ts`'s own gate
 * no longer blocks the connection there either (`DISABLE_FLAG_GATE`) — sending the
 * player back to the hub dev deliberately let them click into would contradict both.
 *
 * **Fails open**, the same rule every other reader of `flags.json` follows: an
 * unreachable host, a non-200, or a body that isn't the shape expected resolves
 * `true` rather than locking every game page behind a flaky fetch.
 */

/** The one place `isPlayable` actually decides — everything above is I/O around it. */
export function isSlugPlayable(flags: Record<string, GameFlag>, slug: string): boolean {
  return isPlayable(flagFor(flags, slug).state);
}

function isPublicFlags(body: unknown): body is PublicFlags {
  return typeof body === 'object' && body !== null && 'flags' in body && typeof (body as PublicFlags).flags === 'object';
}

/** Resolves once we know whether `slug` may actually be played right now. */
export async function checkSlugPlayable(slug: string, hostname: string = location.hostname): Promise<boolean> {
  if (hostname === hosts.environments.dev.site) return true;
  try {
    const res = await fetch('/flags.json');
    if (!res.ok) return true;
    const body: unknown = await res.json();
    return isPublicFlags(body) ? isSlugPlayable(body.flags, slug) : true;
  } catch {
    return true;
  }
}
