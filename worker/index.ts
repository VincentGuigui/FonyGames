import { isRoomCode, normaliseRoomCode } from '../www/src/core/room/code';
import { gameSlug, originAllowed } from './router';
import { Room } from './Room';
import { makeFlagsReader, timedFetch, type FlagsReader } from './flags';
import { isPlayable, type FlagState } from '../shared/flags';

export { Room };

export type Env = {
  ROOM: DurableObjectNamespace<Room>;
  /**
   * Comma-separated origins allowed to open a socket. The hub is served from
   * the PHP host, so every game connection is cross-origin and we allow-list
   * rather than accept anything.
   */
  ALLOWED_ORIGINS: string;
  /**
   * URL of `flags.json` on the web host — a plain var, not a secret: the file is
   * public and the Worker fails open if this is wrong
   * (docs/specs/backoffice.md §2b). Per environment, so the dev Worker reads dev's
   * flags.
   *
   * It is also where the play counter's URL comes from — `api/played.php` sits beside
   * this file on the same host, so it is derived rather than configured (`plays.ts`).
   */
  FLAGS_URL?: string;
  /**
   * Shared with the web host's `plays_token`, so only this Worker may count a finished
   * round (`worker/plays.ts`, `api/played.php`). **Optional**: unset means the counter
   * endpoint is open, which is a deliberate trade recorded in `api/played.php` — the
   * catalogue bounds the damage to which card wears HOT.
   *
   * The only secret this Worker has ever had, and it buys nothing but a badge. It is NOT
   * the admin token, which is break-glass access to everything.
   */
  PLAYS_TOKEN?: string;
};

/**
 * One reader per isolate, built lazily and kept — the whole point is a cache that
 * outlives a request. Keyed by URL so a config change cannot be served by a reader
 * holding the old host's answers.
 */
let reader: FlagsReader | null = null;
let readerUrl: string | undefined;

function flags(env: Env): FlagsReader {
  if (reader === null || readerUrl !== env.FLAGS_URL) {
    readerUrl = env.FLAGS_URL;
    reader = makeFlagsReader({
      url: env.FLAGS_URL,
      now: () => Date.now(),
      fetcher: timedFetch,
    });
  }
  return reader;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true });
    }

    /**
     * `CODE → slug`, so the hub's code field can route by code alone and a
     * player pasting a code never has to know which game their friends picked
     * (docs/specs/hub.md §4, docs/specs/join.md §1).
     *
     * A plain GET, not a socket: looking up a code must not join a room. The
     * object answers from storage and writes nothing, so an unknown code does
     * not leave an empty room behind.
     */
    if (url.pathname === '/room/game') {
      const origin = request.headers.get('Origin');
      if (!originAllowed(origin, env.ALLOWED_ORIGINS)) {
        return new Response('Forbidden origin', { status: 403 });
      }

      const wanted = normaliseRoomCode(url.searchParams.get('code') ?? '');
      if (!isRoomCode(wanted)) {
        return cors(new Response('Bad room code', { status: 400 }), origin);
      }

      const found = await env.ROOM.get(env.ROOM.idFromName(wanted)).fetch(
        new Request(`https://room/room/game?code=${wanted}`),
      );
      return cors(found, origin);
    }

    if (url.pathname !== '/room') {
      return new Response('Not found', { status: 404 });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    if (!originAllowed(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) {
      // A browser will not send a WebSocket preflight, so this is the only
      // place we can refuse an unknown site driving our rooms.
      return new Response('Forbidden origin', { status: 403 });
    }

    const code = normaliseRoomCode(url.searchParams.get('code') ?? '');
    if (!isRoomCode(code)) {
      return new Response('Bad room code', { status: 400 });
    }
    const game = gameSlug(url.searchParams.get('game'));

    /*
     * The flag gate. **Enforcement lives here, not on the hub**: hiding a card is
     * cosmetic and a bookmarked `/tap-duel/#AB2C` never consults the grid (spec §2b).
     *
     * The verdict is forwarded rather than acted on, because the in-flight rule needs
     * knowledge only the room has: disabling blocks *new* rooms and never interrupts a
     * round, so a room that still has a connected player keeps accepting them. The Room
     * is the only thing that knows whether it is occupied.
     *
     * Fail open, and no `try` around it: `stateOf` answers `active` for a dead
     * host, a 404, a truncated body or an unset URL, and `worker/flags.test.ts` asserts
     * each of those. A `catch` here would suggest the contract is weaker than it is.
     */
    const state: FlagState = game ? await flags(env).stateOf(game) : 'active';

    // The whole reason for Durable Objects: this name always resolves to the
    // same object, anywhere in the world, with no routing table of our own.
    const id = env.ROOM.idFromName(code);
    const stub = env.ROOM.get(id);

    const forwarded = new URL(request.url);
    forwarded.searchParams.set('code', code);
    if (game) forwarded.searchParams.set('game', game);
    else forwarded.searchParams.delete('game');
    forwarded.searchParams.set('open', isPlayable(state) ? '1' : '0');
    return stub.fetch(new Request(forwarded, request));
  },
};

/**
 * The hub is served from the PHP host, so a lookup from it is cross-origin and
 * needs this header or the browser hides the answer. A simple GET with no custom
 * headers, so there is no preflight to handle.
 */
function cors(response: Response, origin: string | null): Response {
  if (origin === null) return response;
  const out = new Response(response.body, response);
  out.headers.set('Access-Control-Allow-Origin', origin);
  out.headers.set('Vary', 'Origin');
  return out;
}
