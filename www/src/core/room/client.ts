import type {
  ClientMessage,
  PlayerId,
  RoomSnapshot,
  ServerMessage,
} from '../../../../shared/protocol';

/**
 * The only thing in the app that opens a socket. Games never talk to the
 * network directly (docs/conventions/code-style.md).
 *
 * Handles the mobile realities from docs/multiplayer.md §5: the phone locks,
 * 4G hands over to WiFi, the tab is backgrounded. Every one of those drops the
 * socket, and every one must silently reclaim the same seat.
 */

export type RoomStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export type RoomEvents = {
  status: (status: RoomStatus) => void;
  presence: (room: RoomSnapshot) => void;
  error: (message: string) => void;
};

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];

export class RoomClient {
  #url: string;
  #code: string;
  #ws: WebSocket | null = null;
  #status: RoomStatus = 'closed';
  #attempt = 0;
  #closedByUs = false;
  #reconnectTimer: number | null = null;

  /** Our seat, replayed on reconnect so the server gives it back. */
  #playerId: PlayerId | null = null;
  /** Highest server sequence seen; late frames are ignored. */
  #seq = -1;
  /** serverTime - Date.now(), from the welcome handshake. */
  #clockOffset = 0;

  #handlers: Partial<RoomEvents> = {};

  constructor(baseUrl: string, code: string) {
    this.#url = baseUrl;
    this.#code = code;
  }

  on<K extends keyof RoomEvents>(event: K, fn: RoomEvents[K]): void {
    this.#handlers[event] = fn;
  }

  /** Server time in ms. Countdowns must use this, never a bare Date.now(). */
  now(): number {
    return Date.now() + this.#clockOffset;
  }

  get status(): RoomStatus {
    return this.#status;
  }

  get playerId(): PlayerId | null {
    return this.#playerId;
  }

  connect(profile?: { name?: string; avatar?: string }): void {
    this.#closedByUs = false;
    this.#open(profile);
  }

  close(): void {
    this.#closedByUs = true;
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#ws?.close(1000, 'client-close');
    this.#ws = null;
    this.#setStatus('closed');
  }

  send(msg: ClientMessage): void {
    if (this.#ws?.readyState !== WebSocket.OPEN) return;
    this.#ws.send(JSON.stringify(msg));
  }

  /* ---------------------------------------------------------------- */

  #open(profile?: { name?: string; avatar?: string }): void {
    this.#setStatus(this.#attempt === 0 ? 'connecting' : 'reconnecting');

    const url = new URL(this.#url);
    url.pathname = '/room';
    url.searchParams.set('code', this.#code);

    const ws = new WebSocket(url.toString());
    this.#ws = ws;

    ws.addEventListener('open', () => {
      this.#attempt = 0;
      const d: ClientMessage['d'] = { ...profile };
      // Replaying our id is what turns a reconnect into "same seat" rather
      // than "a new player appeared".
      if (this.#playerId) (d as { resume?: PlayerId }).resume = this.#playerId;
      this.send({ t: 'join', d } as ClientMessage);
    });

    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      this.#onMessage(msg);
    });

    ws.addEventListener('close', () => {
      this.#ws = null;
      if (this.#closedByUs) return;
      this.#scheduleReconnect(profile);
    });

    ws.addEventListener('error', () => {
      // 'close' always follows; reconnect is handled there.
    });
  }

  #onMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.#playerId = msg.d.you;
        this.#clockOffset = msg.d.serverTime - Date.now();
        this.#seq = msg.s;
        this.#setStatus('open');
        this.#handlers.presence?.(msg.d.room);
        return;

      case 'presence':
        // Out-of-order delivery would flicker the player list backwards.
        if (msg.s <= this.#seq) return;
        this.#seq = msg.s;
        this.#handlers.presence?.(msg.d);
        return;

      case 'pong':
        this.#clockOffset = msg.d.serverTime - Date.now();
        return;

      case 'error':
        this.#handlers.error?.(msg.d.message);
        // A full room or a bad code will not fix itself by retrying.
        if (msg.d.code === 'room-full' || msg.d.code === 'bad-room-code') {
          this.#closedByUs = true;
        }
        return;
    }
  }

  #scheduleReconnect(profile?: { name?: string; avatar?: string }): void {
    this.#setStatus('reconnecting');
    const delay = BACKOFF_MS[Math.min(this.#attempt, BACKOFF_MS.length - 1)] ?? 15000;
    this.#attempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#open(profile);
    }, delay) as unknown as number;
  }

  #setStatus(status: RoomStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#handlers.status?.(status);
  }
}
