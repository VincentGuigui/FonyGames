/**
 * Which room server this page talks to.
 *
 * Deliberately a static map rather than a build-time variable: the site is
 * built in Vite's `production` mode on *both* the dev and prod branches, so a
 * single `.env.production` could not tell the two hosts apart. Keeping the
 * mapping in the repo also makes it reviewable and testable instead of
 * invisible CI configuration.
 *
 * Worker names and environments: docs/realtime-server.md §6
 */

const BY_HOSTNAME: Record<string, string> = {
  'fonygames.guigui.fr': 'wss://fonygames-worker.vincent-f02.workers.dev',
  'fonygames-dev.guigui.fr': 'wss://fonygames-worker-dev.vincent-f02.workers.dev',
};

/** Local `wrangler dev`. */
const LOCAL = 'ws://127.0.0.1:8787';

export function roomServerUrl(hostname: string = location.hostname): string {
  // Escape hatch: lets a phone on the LAN point at a laptop running
  // `wrangler dev` without editing this file.
  const override = import.meta.env.VITE_ROOM_URL;
  if (typeof override === 'string' && override.length > 0) return override;

  return BY_HOSTNAME[hostname] ?? LOCAL;
}

/**
 * `new WebSocket()` needs a ws:/wss: URL. The values above already use wss:,
 * but a hand-set VITE_ROOM_URL of `https://…` is an easy mistake and would
 * throw a SyntaxError at connect time, so upgrade it here instead.
 */
export function toWebSocketUrl(url: string): string {
  return url.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
}

/** The other direction, for the plain-HTTP endpoints (`/health`, `/room/game`). */
export function toHttpUrl(url: string): string {
  return url.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
}
