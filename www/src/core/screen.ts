import { useEffect } from 'preact/hooks';

/**
 * Two things a phone does mid-game that a phone game does not want.
 * Rules: docs/device-capabilities.md §5
 *
 * **It dims and locks.** Every game in the catalogue is played with the phone in a hand and
 * the thumbs busy elsewhere — turning on the spot in Ghost Hunt, holding still in Steady
 * Hand, watching a bomb in somebody else's hands. None of that is "user activity" as far as
 * an idle timer is concerned, so the screen goes dark in the middle of a round.
 *
 * **It rotates.** These are portrait layouts: a full-bleed PASS IT, a radar sized against
 * the screen's width, a track of lanes. Turning a phone sideways during a game is almost
 * always the phone deciding, not the player, and landscape is a layout none of them was
 * drawn for.
 *
 * Both are handled here rather than in each game, and both are **best effort by design**:
 * the answer to "this browser will not do it" is to carry on, because a round that refuses
 * to start over a wake lock would be a far worse bug than a screen that dims.
 */

/**
 * What we need from `navigator`, and nothing more.
 *
 * Narrowed by hand rather than pulled from the DOM lib so the logic can be exercised
 * against a fake — the interesting behaviour here is *re-acquisition*, which needs a
 * scriptable visibility state and a sentinel that can be made to vanish.
 */
export type WakeLockish = {
  wakeLock?: {
    request: (type: 'screen') => Promise<{ release: () => Promise<void> }>;
  };
};

export type Visibility = {
  visibilityState: DocumentVisibilityState;
  addEventListener: (type: 'visibilitychange', fn: () => void) => void;
  removeEventListener: (type: 'visibilitychange', fn: () => void) => void;
};

/**
 * Hold a screen wake lock for as long as the caller wants it, and return the release.
 *
 * ## Re-acquiring is the whole job
 *
 * A wake lock is **released by the browser whenever the page stops being visible** — every
 * tab switch, every notification shade, every glance at another app. It is not restored on
 * the way back. So a one-shot `request()` keeps the screen alive exactly until the first
 * interruption and then quietly stops working, which is the version of this feature that
 * looks implemented and is not. The `visibilitychange` listener is what makes it real.
 *
 * Failure is silent and total: no `wakeLock` (Safari before 16.4, any browser over plain
 * HTTP), a refused request, a lock dropped by the system — all of them mean the screen
 * behaves as it did before this existed.
 */
export function keepAwake(nav: WakeLockish, doc: Visibility): () => void {
  let live = true;
  let sentinel: { release: () => Promise<void> } | null = null;

  async function acquire(): Promise<void> {
    if (!live || sentinel || doc.visibilityState !== 'visible' || !nav.wakeLock) return;
    try {
      const held = await nav.wakeLock.request('screen');
      // The await gives the caller time to have stopped, or the page to have been hidden;
      // holding a lock nobody asked for any more is exactly the leak this guards.
      if (!live) {
        void held.release();
        return;
      }
      sentinel = held;
    } catch {
      // Refused, unsupported, or the document was not visible after all. Nothing to say.
    }
  }

  function onVisible(): void {
    if (doc.visibilityState === 'visible') void acquire();
    // Going hidden needs no action: the browser has already released it, and calling
    // `release()` on a dead sentinel throws.
    else sentinel = null;
  }

  void acquire();
  doc.addEventListener('visibilitychange', onVisible);

  return () => {
    live = false;
    doc.removeEventListener('visibilitychange', onVisible);
    const held = sentinel;
    sentinel = null;
    if (held) void held.release().catch(() => {});
  };
}

export type Orientationish = {
  orientation?: {
    lock?: (orientation: 'portrait') => Promise<void>;
    unlock?: () => void;
  };
};

/**
 * Ask for portrait, and shrug if the answer is no.
 *
 * **This works where it works.** Android Chrome honours it for an installed app and for a
 * page in fullscreen, and rejects it otherwise; iOS Safari has no `orientation.lock` at all
 * and never has. So the API is the cheap half of "stay upright" and cannot be the whole of
 * it — the other half is CSS, which asks the player to turn the phone back and is the only
 * thing that works on an iPhone (`.upright` in theme.css).
 *
 * Returns the unlock, so leaving a game hands the orientation back to the player rather
 * than pinning their phone for the rest of the session.
 */
export function lockUpright(scr: Orientationish): () => void {
  // `lock()` rejects rather than throwing, and an unhandled rejection in a browser that
  // refuses it would be a console error on every game page.
  void scr.orientation?.lock?.('portrait').catch(() => {});
  return () => {
    try {
      scr.orientation?.unlock?.();
    } catch {
      // Unlocking something that was never locked is not a problem worth reporting.
    }
  };
}

/**
 * Both, for as long as this component is mounted.
 *
 * Called once, from `RoomGate` — the one component every game page passes through, lobby
 * and round alike. Per game it would be nine copies of the same two lines and a tenth game
 * that forgot; per round screen it would drop the lock in the lobby, which is exactly where
 * a phone sits untouched on a table waiting for friends to join.
 */
export function useHeldPhone(): void {
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof document === 'undefined') return;
    const wake = keepAwake(navigator as WakeLockish, document);
    const upright = lockUpright(screen as Orientationish);
    return () => {
      wake();
      upright();
    };
  }, []);
}
