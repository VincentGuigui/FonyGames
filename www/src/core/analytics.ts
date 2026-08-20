import { loadProfile } from './profile';

/**
 * Reporting what a player did, to our own endpoint.
 * Spec: docs/specs/analytics.md §4
 *
 * Deliberately small and deliberately unreliable. Every call is fire-and-forget: nothing
 * here returns a promise anybody awaits, nothing retries, and a failure is swallowed. An
 * analytics call must never be the reason a round does not start, so the only acceptable
 * failure mode is a missing row.
 *
 * ## What this file does NOT send
 *
 * - **No timestamp.** The server stamps it. Half the phones in a room have a clock that
 *   is minutes out, and the other half could lie on purpose.
 * - **No visitor id.** PHP mints it into an HttpOnly cookie, so this code cannot read it,
 *   choose it, or accidentally put it somewhere else.
 * - **No location.** The server turns the connection's address into a city and drops the
 *   address. Asking the browser for GPS to fill in a country would be absurd, and the
 *   permission prompt alone would be worse than having no analytics at all.
 *
 * So the wire payload is four fields, and three of them are optional.
 */

/**
 * The six things worth knowing, and the same six strings `Analytics::ACTIONS` allows in
 * `api/lib/Analytics.php`. The two lists are checked against each other by
 * `api/tests/analytics_test.php` — a rename on one side is an event that silently stops
 * being recorded, which is exactly the failure that test exists to catch.
 */
export type AnalyticsAction =
  /** The hub was opened. */
  | 'hub_nav'
  /** A game's own page was opened — the card was tapped, or a link was followed. */
  | 'game_select'
  /** A room was created from the chooser. */
  | 'room_create'
  /** A room was entered that this player did not create. */
  | 'room_join'
  /** A round began. */
  | 'game_start'
  /** A round finished and the result is on screen. */
  | 'game_played';

/*
 * The `.php` is not optional. There is no rewrite rule for extensionless routes
 * (`dist/.htaccess` only handles `sitemap.xml` → `sitemap.php`), so this matches
 * `worker/plays.ts`'s literal `/api/played.php` rather than inventing a prettier URL
 * that 404s in production while working under a dev server's implicit fallbacks.
 */
const ENDPOINT = '/api/analytics.php';

/**
 * Respect a browser that has asked not to be tracked.
 *
 * `globalPrivacyControl` is the current one and legally load-bearing in some places;
 * `doNotTrack` is the older one that Safari and Firefox still set. Neither is required
 * of us by anything technical — this is a choice, and it is the same choice the rest of
 * this project makes about sensor data (docs/device-capabilities.md).
 *
 * A player who has set either gets no rows at all, which means the numbers undercount.
 * That is the intended trade and it is written down in the spec so nobody later reads a
 * dip in the dashboard as a bug.
 *
 * Takes the signal explicitly rather than reading `navigator` itself, so the rule is
 * testable without faking a global.
 */
export function isRefused(signal: { globalPrivacyControl?: boolean; doNotTrack?: string | null }): boolean {
  return signal.globalPrivacyControl === true || signal.doNotTrack === '1';
}

/**
 * The referrer worth reporting, or none.
 *
 * Same-origin referrers are dropped: "the player came from our own hub" is already
 * knowable from the events themselves, and it would swamp the column with our own
 * domain. An unparseable value (some browsers send a bare string, not a URL) is treated
 * the same as none, rather than thrown.
 */
export function externalReferrer(raw: string, origin: string): string | undefined {
  if (raw === '') return undefined;
  try {
    return new URL(raw).origin === origin ? undefined : raw;
  } catch {
    return undefined;
  }
}

/**
 * Report one action. Never throws, never awaits, never retries.
 *
 * `sendBeacon` first, because the interesting events happen next to a navigation —
 * tapping a card, leaving a finished round — and a `fetch` started as the page unloads
 * is cancelled. `keepalive` on the fallback buys the same property where `sendBeacon`
 * is missing.
 */
export function track(action: AnalyticsAction, object?: string): void {
  if (isRefused(navigator)) return;

  /*
   * Read fresh each call rather than cached at import time: `document.referrer` never
   * changes after the document loads — `pushState` does not touch it — so there is
   * nothing to gain from caching it, and reading it here is what keeps this module
   * importable (and its pure helpers testable) without a DOM.
   */
  const referrer = externalReferrer(document.referrer, location.origin);

  const body = JSON.stringify({
    action,
    ...(object === undefined ? {} : { object }),
    ...(referrer === undefined ? {} : { referrer }),
    // Whatever name the player has set on this device, if any. Read at send time, not
    // at load: they may have just typed it into the lobby's Change sheet.
    ...(() => {
      const name = loadProfile().name;
      return name === undefined ? {} : { nickname: name };
    })(),
  });

  try {
    /*
     * `text/plain` rather than `application/json`, and this is not an oversight: a
     * `sendBeacon` with a JSON content type is a CORS-preflighted request, and a
     * preflight during page unload is exactly the thing that does not happen. PHP reads
     * the raw body with `file_get_contents('php://input')` and does its own decoding, so
     * the declared type is irrelevant at the other end.
     */
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
      return;
    }

    void fetch(ENDPOINT, {
      method: 'POST',
      body,
      keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    }).catch(() => {
      // Nothing to do and nobody to tell. A lost event is the designed failure.
    });
  } catch {
    // `sendBeacon` throws on an over-large payload in some browsers. Ours never is,
    // and a counter is still not worth an exception reaching a player.
  }
}
