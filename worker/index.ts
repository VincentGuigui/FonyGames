import { isRoomCode, normaliseRoomCode } from '../www/src/core/room/code';
import { Room } from './Room';

export { Room };

export type Env = {
  ROOM: DurableObjectNamespace<Room>;
  /**
   * Comma-separated origins allowed to open a socket. The hub is served from
   * the PHP host, so every game connection is cross-origin and we allow-list
   * rather than accept anything.
   */
  ALLOWED_ORIGINS: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true });
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

    // The whole reason for Durable Objects: this name always resolves to the
    // same object, anywhere in the world, with no routing table of our own.
    const id = env.ROOM.idFromName(code);
    const stub = env.ROOM.get(id);

    const forwarded = new URL(request.url);
    forwarded.searchParams.set('code', code);
    return stub.fetch(new Request(forwarded, request));
  },
};

export function originAllowed(origin: string | null, allowList: string): boolean {
  const allowed = allowList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // No Origin header: not a browser (curl, a native client, our own tests).
  // Browsers always send one for WebSocket, so this cannot be used to bypass
  // the check from a web page.
  if (origin === null) return true;
  return allowed.includes(origin);
}
