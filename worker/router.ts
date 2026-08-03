/**
 * The router's pure guards.
 *
 * Separate from `index.ts` for the same reason the game logic is separate from
 * `Room.ts`: `index.ts` re-exports the Durable Object, so importing it drags in
 * `cloudflare:workers` and cannot run on plain Node. These are arithmetic over
 * strings, so keeping them here is what lets `worker/router.test.ts` exercise
 * them directly (docs/testing.md §1.1).
 *
 * Both are security checks, not conveniences.
 */

/**
 * The game slug a connection claims to be for, sanitised.
 *
 * Normalised rather than trusted: it is stored against the room code and later
 * handed back to the hub, which turns it into a URL to navigate to. A slug is a
 * kebab-case name and nothing else — that is what stops `../`, `//host` or a
 * full URL from turning the hub's join field into an open redirect.
 */
export function gameSlug(raw: string | null): string | null {
  if (!raw) return null;
  return /^[a-z][a-z0-9-]{0,31}$/.test(raw) ? raw : null;
}

/**
 * Whether a browser at `origin` may drive our rooms.
 *
 * Exact match against the list, never a substring: `evil-fonygames.guigui.fr`
 * and `fonygames.guigui.fr.evil.test` both contain an allowed origin.
 */
export function originAllowed(origin: string | null, allowList: string): boolean {
  const allowed = allowList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // No Origin header: not a browser (curl, a native client, our own tests).
  // Browsers always send one for WebSocket, so this cannot be used to bypass
  // the check from a web page.
  if (origin === null) return true;
  return allowed.includes(origin);
}
