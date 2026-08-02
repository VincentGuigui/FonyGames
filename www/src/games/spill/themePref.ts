import { DEFAULT_THEME_ID, themeById } from './themes';

/**
 * Which look the player picked, remembered between visits.
 *
 * `localStorage`, matching the D7 rule in docs/roadmap.md: name, avatar and
 * preferences persist; nothing about a game ever does. The value is re-checked
 * against the registry on read, so a theme that has been removed — or a hand-
 * edited value — falls back rather than throwing.
 */
const KEY = 'fony:spill:theme';

export function loadThemeId(): string {
  try {
    const raw = localStorage.getItem(KEY);
    return themeById(raw).id;
  } catch {
    // Private mode, or storage disabled. Not worth failing over.
    return DEFAULT_THEME_ID;
  }
}

export function saveThemeId(id: string): void {
  try {
    localStorage.setItem(KEY, themeById(id).id);
  } catch {
    // Ignored, as above.
  }
}
