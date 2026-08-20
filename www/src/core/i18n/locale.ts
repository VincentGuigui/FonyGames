/**
 * Which language the player sees. Spec: docs/specs/i18n.md
 *
 * Two locales for now, matched against the browser's own preference list rather
 * than a server header: this is a static site with no per-request rendering for
 * game pages, so `navigator.languages` (which every browser fills from the same
 * `Accept-Language` it would have sent) is the only signal available client-side.
 */
export type Locale = 'en' | 'fr';

export const DEFAULT_LOCALE: Locale = 'en';
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'fr'];

/**
 * The first tag whose primary subtag ('fr' out of 'fr-CA') matches a locale we
 * support, in the order the browser prefers them. Anything unrecognised —
 * Spanish, German, a malformed tag, an empty list — falls back to English
 * rather than guessing.
 */
export function detectLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const primary = tag.slice(0, 2).toLowerCase();
    if ((SUPPORTED_LOCALES as readonly string[]).includes(primary)) return primary as Locale;
  }
  return DEFAULT_LOCALE;
}

/**
 * Remembered between visits, same lifetime as `core/profile.ts`'s name/avatar:
 * it is a fact about the player's device, not the room, so it survives closing
 * the tab and is never sent to the server.
 */
const KEY = 'fony:locale';

export function loadStoredLocale(): Locale | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Safari private mode and some webviews throw rather than returning null.
    return null;
  }
  return raw === 'en' || raw === 'fr' ? raw : null;
}

export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(KEY, locale);
  } catch {
    // Storage unavailable — the player just gets re-detected next visit.
  }
}
