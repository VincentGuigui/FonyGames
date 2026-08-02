import { DurableObject } from 'cloudflare:workers';
import {
  MAX_FRAME_BYTES,
  MAX_PLAYERS,
  RATE_LIMIT_MSGS,
  RATE_LIMIT_WINDOW_MS,
  RECONNECT_GRACE_MS,
  isClientMessage,
  type ClientMessage,
  type Player,
  type PlayerId,
  type RoomSnapshot,
  type ServerMessage,
} from '../shared/protocol';
import {
  randomAvatar,
  randomName,
  sanitiseAvatar,
  sanitiseName,
} from '../shared/names';

/**
 * One Durable Object per room. `idFromName(roomCode)` guarantees every player
 * with the same code reaches this exact instance — that room affinity is the
 * reason we chose Durable Objects (docs/realtime-options.md §3.3).
 *
 * Uses the WebSocket **Hibernation** API: sockets stay open while the object is
 * evicted from memory, so an idle lobby costs no duration billing. That means
 * per-connection state cannot live in a field — it is attached to the socket
 * via serializeAttachment() and survives hibernation.
 */

type Attachment = {
  playerId: PlayerId;
};

/** Per-connection, non-durable. Rebuilt after hibernation; that is fine — it only rate-limits. */
type Bucket = { count: number; windowStart: number };

export class Room extends DurableObject {
  /** seq for server->client ordering; clients drop out-of-order state. */
  #seq = 0;
  #buckets = new WeakMap<WebSocket, Bucket>();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const code = new URL(request.url).searchParams.get('code') ?? '';
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // acceptWebSocket (not server.accept) is what enables hibernation.
    this.ctx.acceptWebSocket(server);
    await this.ctx.storage.put('code', code);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return; // protocol is JSON text only
    if (raw.length > MAX_FRAME_BYTES) return;
    if (!this.#allow(ws)) {
      this.#send(ws, {
        t: 'error',
        d: { code: 'rate-limited', message: 'Slow down.' },
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isClientMessage(parsed)) return;
    const msg = parsed as ClientMessage;

    switch (msg.t) {
      case 'join':
        await this.#onJoin(ws, msg.d);
        return;
      case 'set-profile':
        await this.#onSetProfile(ws, msg.d);
        return;
      case 'ping':
        this.#send(ws, {
          t: 'pong',
          d: { at: msg.d.at, serverTime: Date.now() },
        });
        return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.#onGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.#onGone(ws);
  }

  /** Fires when a dropped player's grace period expires. */
  async alarm(): Promise<void> {
    const players = await this.#players();
    const now = Date.now();
    let changed = false;

    for (const [id, p] of players) {
      if (!p.connected && now - (p.goneAt ?? 0) >= RECONNECT_GRACE_MS) {
        players.delete(id);
        changed = true;
      }
    }

    if (changed) {
      await this.#savePlayers(players);
      await this.#ensureHost(players);
      await this.#broadcastPresence();
    }

    // A room's state dies with the room (docs/architecture.md §1). Once nobody
    // is left and no socket is still attached, drop everything rather than
    // leave an abandoned room paying rent in storage forever.
    if (players.size === 0 && this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll();
      return;
    }

    await this.#scheduleReap(players);
  }

  /* ---------------------------------------------------------------- */

  async #onJoin(
    ws: WebSocket,
    d: { name?: string; avatar?: string; resume?: PlayerId },
  ): Promise<void> {
    const players = await this.#players();

    // Reclaiming a seat after a drop keeps the player's identity and, if they
    // were host, their host role.
    const resuming = d.resume ? players.get(d.resume) : undefined;

    let id: PlayerId;
    if (resuming) {
      id = resuming.id;
      resuming.connected = true;
      delete resuming.goneAt;
      if (d.name) resuming.name = sanitiseName(d.name) ?? resuming.name;
      if (d.avatar) resuming.avatar = sanitiseAvatar(d.avatar) ?? resuming.avatar;
    } else {
      const active = [...players.values()].filter((p) => p.connected).length;
      if (active >= MAX_PLAYERS) {
        this.#send(ws, {
          t: 'error',
          d: { code: 'room-full', message: 'This room is full.' },
        });
        ws.close(1008, 'room-full');
        return;
      }
      id = crypto.randomUUID();
      players.set(id, {
        id,
        name: sanitiseName(d.name) ?? randomName(),
        avatar: sanitiseAvatar(d.avatar) ?? randomAvatar(),
        connected: true,
      });
    }

    ws.serializeAttachment({ playerId: id } satisfies Attachment);
    await this.#savePlayers(players);
    await this.#ensureHost(players);

    const room = await this.#snapshot(players);
    this.#send(ws, {
      t: 'welcome',
      s: ++this.#seq,
      d: { you: id, serverTime: Date.now(), room },
    });
    await this.#broadcastPresence(ws);
  }

  async #onSetProfile(
    ws: WebSocket,
    d: { name?: string; avatar?: string },
  ): Promise<void> {
    const id = this.#idOf(ws);
    if (!id) return;
    const players = await this.#players();
    const me = players.get(id);
    if (!me) return;

    const name = sanitiseName(d.name);
    const avatar = sanitiseAvatar(d.avatar);
    if (!name && !avatar) return;
    if (name) me.name = name;
    if (avatar) me.avatar = avatar;

    await this.#savePlayers(players);
    await this.#broadcastPresence();
  }

  async #onGone(ws: WebSocket): Promise<void> {
    const id = this.#idOf(ws);
    if (!id) return;
    const players = await this.#players();
    const me = players.get(id);
    if (!me) return;

    // Not removed immediately: a phone that locked or switched network gets
    // RECONNECT_GRACE_MS to reclaim the same seat (docs/multiplayer.md §5).
    me.connected = false;
    me.goneAt = Date.now();

    await this.#savePlayers(players);
    await this.#ensureHost(players);
    await this.#broadcastPresence();
    await this.#scheduleReap(players);
  }

  /**
   * The host is a UI role only — the server owns round state — but it must
   * always point at someone present, so a host leaving never stalls the room.
   */
  async #ensureHost(players: Map<PlayerId, StoredPlayer>): Promise<void> {
    const current = (await this.ctx.storage.get<PlayerId>('hostId')) ?? null;
    const stillHere = current && players.get(current)?.connected;
    if (stillHere) return;

    const next = [...players.values()].find((p) => p.connected)?.id ?? null;
    if (next === current) return;
    if (next) await this.ctx.storage.put('hostId', next);
    else await this.ctx.storage.delete('hostId');
  }

  async #scheduleReap(players: Map<PlayerId, StoredPlayer>): Promise<void> {
    const pending = [...players.values()]
      .filter((p) => !p.connected)
      .map((p) => (p.goneAt ?? 0) + RECONNECT_GRACE_MS);

    if (pending.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.min(...pending));
  }

  async #broadcastPresence(except?: WebSocket): Promise<void> {
    const room = await this.#snapshot();
    const msg: ServerMessage = { t: 'presence', s: ++this.#seq, d: room };
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except) this.#send(ws, msg);
    }
  }

  async #snapshot(
    players?: Map<PlayerId, StoredPlayer>,
  ): Promise<RoomSnapshot> {
    const map = players ?? (await this.#players());
    const code = (await this.ctx.storage.get<string>('code')) ?? '';
    const hostId = (await this.ctx.storage.get<PlayerId>('hostId')) ?? null;
    const list: Player[] = [...map.values()].map(({ id, name, avatar, connected }) => ({
      id,
      name,
      avatar,
      connected,
    }));
    return { code, players: list, hostId };
  }

  #idOf(ws: WebSocket): PlayerId | null {
    const a = ws.deserializeAttachment() as Attachment | null;
    return a?.playerId ?? null;
  }

  #send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already gone; webSocketClose will clean up.
    }
  }

  #allow(ws: WebSocket): boolean {
    const now = Date.now();
    const b = this.#buckets.get(ws);
    if (!b || now - b.windowStart >= RATE_LIMIT_WINDOW_MS) {
      this.#buckets.set(ws, { count: 1, windowStart: now });
      return true;
    }
    b.count += 1;
    return b.count <= RATE_LIMIT_MSGS;
  }

  async #players(): Promise<Map<PlayerId, StoredPlayer>> {
    const raw = (await this.ctx.storage.get<StoredPlayer[]>('players')) ?? [];
    return new Map(raw.map((p) => [p.id, p]));
  }

  async #savePlayers(players: Map<PlayerId, StoredPlayer>): Promise<void> {
    await this.ctx.storage.put('players', [...players.values()]);
  }
}

/** Player plus the drop timestamp, which never goes on the wire. */
type StoredPlayer = Player & { goneAt?: number };
