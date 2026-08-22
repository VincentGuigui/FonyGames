/**
 * Solo test mode, from the browser's side.
 * Spec: docs/specs/backoffice.md §6 · the rules it relaxes: `enoughToStart` in
 * shared/players.ts
 *
 * The operator wants to open a game alone and look at it. That needs the referee to
 * accept a one-player start, and the referee only does so when the phone asks — so
 * something has to remember "this browser is allowed to ask".
 *
 * ## Why localStorage, set by the admin centre
 *
 * The admin centre is PHP on the same origin as the games, behind a magic-link
 * session; the game pages are static files talking to a Worker and have no session
 * of their own. There is no shared login to consult. What there IS, once you have
 * signed in, is *this browser* — so the admin page writes a key here and the game
 * pages read it.
 *
 * `localStorage` rather than `sessionStorage`: signing into the admin centre in one
 * tab and then opening a game in another is the whole workflow, and it should survive
 * closing the tab the way a preference does.
 *
 * ## It is not a permission
 *
 * Anyone can write this key from a console, and what they get is the ability to play
 * alone in their own room. Nothing is protected by it and nothing should be — the
 * same sentence is already true of the feature flags (shared/flags.ts). It is a
 * convenience for the person who runs the site, not a gate.
 */

const KEY = 'fony.solo';
const CHANGE = 'fony:solo-change';
let adminCheck: Promise<boolean> | null = null;

/** Is this browser allowed to start a round on its own? */
export function soloTesting(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // Private mode, or storage disabled. No solo, and certainly no exception
    // escaping into a lobby render.
    return false;
  }
}

/** Turn it on or off. Called by the admin centre, and only by it. */
export function setSoloTesting(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(CHANGE));
  } catch {
    /* nothing to do — see above */
  }
}

export function subscribeSoloTesting(refresh: () => void): () => void {
  window.addEventListener(CHANGE, refresh);
  window.addEventListener('storage', refresh);
  return () => { window.removeEventListener(CHANGE, refresh); window.removeEventListener('storage', refresh); };
}

/** The HttpOnly admin session can only be checked by asking the same-origin API. */
export function hasAdminSession(): Promise<boolean> {
  adminCheck ??= fetch('/api/index.php?a=state', { credentials: 'same-origin' })
    .then(async (response) => {
      if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json')) return false;
      const body = await response.json() as { flags?: unknown };
      return typeof body.flags === 'object' && body.flags !== null;
    })
    .catch(() => false);
  return adminCheck;
}
