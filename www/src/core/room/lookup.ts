import { roomServerUrl, toHttpUrl } from './config';
import { isRoomCode, normaliseRoomCode } from './code';

/**
 * `CODE → game slug`. Spec: docs/specs/hub.md §4, docs/specs/join.md §1
 *
 * This is what lets the hub's code field route by code alone: someone who was
 * handed a code never has to know which game their friends picked. The mapping
 * can only come from the server, because the code *is* the room name and nothing
 * about it encodes the game.
 *
 * A plain GET, not a socket — looking up a code must not join a room, and must
 * not bring one into existence either.
 */
export type Lookup =
  | { found: true; game: string }
  | { found: false; reason: 'unknown' | 'unreachable' };

export async function lookupRoom(code: string): Promise<Lookup> {
  const wanted = normaliseRoomCode(code);
  if (!isRoomCode(wanted)) return { found: false, reason: 'unknown' };

  const url = new URL(toHttpUrl(roomServerUrl()));
  url.pathname = '/room/game';
  url.searchParams.set('code', wanted);

  try {
    const response = await fetch(url.toString());
    if (response.status === 404) return { found: false, reason: 'unknown' };
    // Anything else non-OK is our problem, not the player's, and saying "no such
    // room" would send them off to re-read a code that was fine.
    if (!response.ok) return { found: false, reason: 'unreachable' };

    const body = (await response.json()) as { game?: unknown };
    if (typeof body.game !== 'string' || body.game.length === 0) {
      return { found: false, reason: 'unreachable' };
    }
    return { found: true, game: body.game };
  } catch {
    // Offline, DNS, blocked — indistinguishable from here and all the same to
    // the player: the code might be perfect and we still cannot check it.
    return { found: false, reason: 'unreachable' };
  }
}
