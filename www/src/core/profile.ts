import { sanitiseAvatar, sanitiseName } from '../../../shared/names';

/**
 * The player's chosen name and avatar, remembered between visits so they do
 * not have to set them up again every time.
 *
 * **localStorage**, not a cookie: the server never reads this, so a cookie
 * would be sent on every single request to the site for no benefit.
 *
 * Note the deliberate contrast with `core/room/seat.ts`, which uses
 * *session*Storage. Different lifetimes on purpose:
 *   profile -> localStorage   -> survives closing the tab; it is who you are
 *   seat    -> sessionStorage -> dies with the tab; it is where you are sitting
 *
 * This lives on the player's own device only. It is never stored by the room
 * server beyond the life of a room.
 */

const KEY = 'fony:profile';

export type Profile = {
  name?: string;
  avatar?: string;
};

export function loadProfile(): Profile {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Safari private mode and some webviews throw rather than returning null.
    return {};
  }
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};

    // Re-validated on read: storage is user-editable, and this string is
    // rendered on other players' phones.
    const name = sanitiseName((parsed as Profile).name);
    const avatar = sanitiseAvatar((parsed as Profile).avatar);

    const out: Profile = {};
    if (name) out.name = name;
    if (avatar) out.avatar = avatar;
    return out;
  } catch {
    return {};
  }
}

export function saveProfile(profile: Profile): void {
  const merged = { ...loadProfile(), ...profile };
  try {
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    // Storage unavailable — the player just gets a fresh name next visit.
  }
}
