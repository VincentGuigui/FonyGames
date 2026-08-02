import type { PlayerId } from '../../../../shared/protocol';

/**
 * Remembers which seat this tab holds, so a page refresh rejoins as the same
 * player instead of appearing as a stranger.
 *
 * **sessionStorage, deliberately** — it survives a reload but dies with the
 * tab. That maps exactly onto what a player means:
 *   refresh          -> same tab  -> same seat
 *   close the tab    -> gone      -> seat released
 *   open a 2nd tab   -> new tab   -> genuinely a second player
 *
 * `localStorage` would resurrect an identity days later, which is wrong, and
 * would also make two tabs fight over one seat.
 *
 * Scoped per room code: resuming into a *different* room with a stale id would
 * be meaningless.
 */

const PREFIX = 'fony:seat:';

function key(code: string): string {
  return `${PREFIX}${location.pathname}#${code}`;
}

/**
 * Every access is guarded: Safari in private mode and some embedded webviews
 * throw on storage access rather than returning null. A player who cannot
 * store a seat should still be able to play — they just lose refresh-resume.
 */
export function loadSeat(code: string): PlayerId | null {
  try {
    return sessionStorage.getItem(key(code));
  } catch {
    return null;
  }
}

export function saveSeat(code: string, playerId: PlayerId): void {
  try {
    sessionStorage.setItem(key(code), playerId);
  } catch {
    // Storage unavailable — refresh will just create a new player.
  }
}

export function clearSeat(code: string): void {
  try {
    sessionStorage.removeItem(key(code));
  } catch {
    // Nothing to do.
  }
}
