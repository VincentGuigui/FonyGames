import { isRoomCode, normaliseRoomCode } from '../www/src/core/room/code';
import { gameSlug, originAllowed } from './router';
import { Room } from './Room';
import { FlagsObject } from './FlagsObject';
import type { FlagState } from '../shared/flags';

export { Room, FlagsObject };

export type Env = {
  ROOM: DurableObjectNamespace<Room>;
  /**
   * The singleton that holds feature flags and admin sessions
   * (docs/specs/backoffice.md §2b). One per Worker, so dev and prod are separate
   * by construction.
   */
  FLAGS: DurableObjectNamespace<FlagsObject>;
  /**
   * Comma-separated origins allowed to open a socket. The hub is served from
   * the PHP host, so every game connection is cross-origin and we allow-list
   * rather than accept anything.
   */
  ALLOWED_ORIGINS: string;
  /* Admin secrets. All optional: unset means "no admin", never "open admin". */
  ADMIN_EMAIL?: string;
  ADMIN_SESSION_KEY?: string;
  ADMIN_TOKEN?: string;
  MAIL_SECRET?: string;
  MAIL_ENDPOINT?: string;
  ADMIN_LINK_BASE?: string;
};

/** The singleton's name. One object, one Worker, one environment. */
const FLAGS_NAME = 'flags';

function flagsStub(env: Env) {
  return env.FLAGS.get(env.FLAGS.idFromName(FLAGS_NAME));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true });
    }

    const origin0 = request.headers.get('Origin');

    /*
     * The admin surface. Every one of these is origin-checked like a socket is, and
     * every write is bearer-checked inside the object — the hidden path is not the
     * control (docs/specs/backoffice.md §4).
     *
     * A preflight is genuinely required here, unlike for `/room/game`: these carry an
     * `Authorization` header, which makes them non-simple requests, so the browser asks
     * first. Without this branch every admin call fails CORS before it is sent.
     */
    if (url.pathname === '/flags' || url.pathname.startsWith('/admin/')) {
      if (request.method === 'OPTIONS') {
        return cors(
          new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Authorization, Content-Type',
              'Access-Control-Max-Age': '86400',
            },
          }),
          origin0,
        );
      }
      if (!originAllowed(origin0, env.ALLOWED_ORIGINS)) {
        return new Response('Forbidden origin', { status: 403 });
      }
      return cors(await admin(url, request, env), origin0);
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
     * Fail open. A hiccup reading the flags must not blank the catalogue, and a flag is
     * documented as not being a security control precisely so this line can exist.
     */
    let availability: FlagState = 'active';
    if (game) {
      try {
        availability = await flagsStub(env).availabilityOf(game);
      } catch {
        availability = 'active';
      }
    }

    // The whole reason for Durable Objects: this name always resolves to the
    // same object, anywhere in the world, with no routing table of our own.
    const id = env.ROOM.idFromName(code);
    const stub = env.ROOM.get(id);

    const forwarded = new URL(request.url);
    forwarded.searchParams.set('code', code);
    if (game) forwarded.searchParams.set('game', game);
    else forwarded.searchParams.delete('game');
    forwarded.searchParams.set('open', availability === 'active' ? '1' : '0');
    return stub.fetch(new Request(forwarded, request));
  },
};

/**
 * `/flags` and `/admin/*`.
 *
 * Kept out of `fetch` so the socket path stays readable. Reads are `GET`, writes are
 * `POST`, and everything except `/flags` needs a bearer.
 */
async function admin(url: URL, request: Request, env: Env): Promise<Response> {
  const stub = flagsStub(env);

  if (url.pathname === '/flags') {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    // Cacheable: the hub fetches this on every load and a flag changes rarely. 60 s is
    // the spec's number, and the hub paints before this arrives either way.
    return Response.json(await stub.flags(), {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  }

  if (request.method !== 'POST' && url.pathname !== '/admin/state') {
    return new Response('Method not allowed', { status: 405 });
  }

  /*
   * Ask for a magic link. **Always 204**, whatever happened — wrong address, rate
   * limited, or sent. A different answer for a wrong address would turn this into a way
   * to discover who the operator is (spec §4), and a different answer when rate limited
   * would say "you guessed right, try later".
   *
   * The one thing that does surface is a broken mailer, as a 502: that is a fault on our
   * side and hiding it would leave the operator staring at a link that never arrives.
   */
  if (url.pathname === '/admin/link') {
    const body = (await readJson(request)) as { email?: unknown };
    const email = typeof body.email === 'string' ? body.email : '';
    try {
      await stub.requestLink(email);
    } catch {
      return new Response('Mailer unavailable', { status: 502 });
    }
    return new Response(null, { status: 204 });
  }

  if (url.pathname === '/admin/session') {
    const body = (await readJson(request)) as { token?: unknown };
    const token = typeof body.token === 'string' ? body.token : '';
    const session = await stub.redeem(token);
    if (!session) return new Response('No', { status: 401 });
    return Response.json({ session });
  }

  // Everything below is privileged.
  if (!(await stub.check(request.headers.get('Authorization')))) {
    return new Response('No', { status: 401 });
  }

  if (url.pathname === '/admin/state') {
    return Response.json(await stub.fullState());
  }

  if (url.pathname === '/admin/flags') {
    const body = (await readJson(request)) as Record<string, unknown>;
    const slug = gameSlug(typeof body['slug'] === 'string' ? body['slug'] : null);
    // Sanitised with the same guard the socket path uses: this string is stored and
    // handed back to the hub, which turns it into a URL.
    if (!slug) return new Response('Bad slug', { status: 400 });

    const patch: { availability?: FlagState; isNew?: boolean; reason?: string } = {};
    const a = body['availability'];
    if (a === 'active' || a === 'disabled' || a === 'hidden') patch.availability = a;
    if (typeof body['isNew'] === 'boolean') patch.isNew = body['isNew'];
    if (typeof body['reason'] === 'string') patch.reason = body['reason'].slice(0, 120);

    return Response.json(await stub.set(slug, patch));
  }

  if (url.pathname === '/admin/mail-check') {
    return Response.json(await stub.mailCheck());
  }

  return new Response('Not found', { status: 404 });
}

/** A malformed body is an empty object, not a 500. */
async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const v = await request.json();
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

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
