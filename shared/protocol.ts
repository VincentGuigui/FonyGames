/**
 * The wire protocol, shared verbatim by the browser and the Durable Object.
 * Envelope shape is specified in docs/multiplayer.md §4.
 *
 * This file must stay dependency-free and DOM-free — the Worker has no DOM.
 */

export type PlayerId = string;

export type Player = {
  id: PlayerId;
  name: string;
  /** Single emoji. */
  avatar: string;
  /** False while they are dropped but still inside the reconnect grace period. */
  connected: boolean;
};

export type RoomSnapshot = {
  code: string;
  players: Player[];
  hostId: PlayerId | null;
};

/** Why the server closed or refused a connection. */
export type ErrorCode =
  | 'bad-room-code'
  | 'room-full'
  | 'rate-limited'
  | 'bad-message'
  | 'forbidden-origin';

/* ------------------------------------------------------------------ */
/* client -> server                                                     */
/* ------------------------------------------------------------------ */

export type ClientMessage =
  /** First message on every connection. `resume` re-claims a previous seat. */
  | { t: 'join'; d: { name?: string; avatar?: string; resume?: PlayerId } }
  | { t: 'set-profile'; d: { name?: string; avatar?: string } }
  /** Round-trip used to estimate the client's offset from server time. */
  | { t: 'ping'; d: { at: number } }
  /** Host only. Begins a duel. */
  | { t: 'start'; d: { mode: string } }
  /** Finger down, at the client's clock-corrected server time. */
  | { t: 'tap'; d: { at: number; roundId: number } };

/* ------------------------------------------------------------------ */
/* server -> client                                                     */
/* ------------------------------------------------------------------ */

/** One player's outcome in a duel. */
export type Reaction = {
  playerId: PlayerId;
  /** Milliseconds after the signal. Null when they false-started or never tapped. */
  ms: number | null;
  falseStart: boolean;
};

export type RoundResult = {
  roundId: number;
  /** Fastest valid reaction first; false starts and no-shows last. */
  ranking: Reaction[];
  winnerId: PlayerId | null;
  /** Cumulative points this session, keyed by player id. */
  scores: Record<PlayerId, number>;
  /** True when nobody produced a valid tap. */
  noContest: boolean;
};

export type ServerMessage =
  /** Sent once, immediately after a successful join. */
  | {
      t: 'welcome';
      s: number;
      d: { you: PlayerId; serverTime: number; room: RoomSnapshot };
    }
  /** Any change to the player list or the host. */
  | { t: 'presence'; s: number; d: RoomSnapshot }
  | { t: 'pong'; d: { at: number; serverTime: number } }
  /** A duel has begun. `fireAt` is server time — render it with client.now(). */
  | { t: 'arm'; s: number; d: { roundId: number; fireAt: number } }
  /** Only the offender is told, and only they see it. */
  | { t: 'false-start'; d: { roundId: number } }
  | { t: 'result'; s: number; d: RoundResult }
  | { t: 'error'; d: { code: ErrorCode; message: string } };

export const MAX_PLAYERS = 10;

/** Hard cap on an inbound frame; anything larger is dropped (docs/architecture.md §4). */
export const MAX_FRAME_BYTES = 8 * 1024;

/** Per-player inbound budget (docs/multiplayer.md §4). */
export const RATE_LIMIT_MSGS = 20;
export const RATE_LIMIT_WINDOW_MS = 1000;

/** How long a dropped player keeps their seat (docs/multiplayer.md §1). */
export const RECONNECT_GRACE_MS = 60_000;

/**
 * How long a dropped host keeps the host role before it passes to someone
 * else. Much shorter than the seat grace: a page refresh completes in ~1–2 s
 * and must not cost you the role, but a player who has genuinely walked off
 * must not block the room for a whole minute.
 */
export const HOST_GRACE_MS = 8_000;

/* ------------------------------------------------------------------ */
/* Tap Duel timing (docs/specs/games/tap-duel.md)                       */
/* ------------------------------------------------------------------ */

/** The signal fires somewhere in this window after the duel starts. */
export const FIRE_MIN_MS = 2_000;
export const FIRE_MAX_MS = 6_000;

/** No valid tap within this long after the signal → no contest. */
export const DUEL_TIMEOUT_MS = 5_000;

/**
 * Below this, it is not a human reflex — simple visual reaction is ~200 ms and
 * the record is around 100 ms. Anything faster is a scripted tap and is scored
 * as a false start (tap-duel.md §8).
 */
export const MIN_HUMAN_REACTION_MS = 80;

/** Tolerance for a client clock that runs slightly ahead of the server's. */
export const CLOCK_SKEW_TOLERANCE_MS = 250;

export const WIN_SCORE = 3;

const CLIENT_TYPES = new Set(['join', 'set-profile', 'ping', 'start', 'tap']);

export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return typeof t === 'string' && CLIENT_TYPES.has(t);
}
