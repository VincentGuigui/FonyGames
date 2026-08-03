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
  | { t: 'tap'; d: { at: number; roundId: number } }
  /** This phone felt a knock. The SERVER pairs two of these into a contact. */
  | { t: 'bump'; d: { at: number; roundId: number } }
  /** Touch fallback for a player without motion: pass to a chosen player. */
  | { t: 'pass'; d: { to: PlayerId; roundId: number } }
  /**
   * Spill: flick water off your screen. `angle` is radians clockwise from
   * screen-up; `speed` is in **screen heights per second**, so the server never
   * has to know how big anyone's phone is. `dropId` re-flings a caught drop.
   */
  | { t: 'fling'; d: { angle: number; speed: number; roundId: number; dropId?: string } }
  /** Spill: grab an incoming drop during its approach window. */
  | { t: 'catch'; d: { dropId: string; roundId: number } }
  /** Goat Siege: lob a goat at a neighbour's patch. */
  | { t: 'lob'; d: { to: PlayerId; roundId: number } }
  /** Goat Siege: tap an incoming goat to shoo it. */
  | { t: 'shoo'; d: { goatId: string; roundId: number } }
  /**
   * Sling Puck: a puck left my half through the gap, described **in my own
   * frame** — x across my board 0..1, velocity in board-heights per second. The
   * server rotates it for the receiver, so no client needs to know which way
   * round the other phone is lying (spec §5).
   */
  | { t: 'cross'; d: { roundId: number; x: number; vx: number; vy: number } };

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

/** Spill: one projectile, described once and animated locally from then on. */
export type SpillDrop = {
  dropId: string;
  /** Seat index it left. */
  from: number;
  /** Seat index it is heading for; null when the flick missed the table. */
  to: number | null;
  /**
   * The screen angle it was flicked at, clamped and echoed back. The thrower
   * animates it leaving along this; the target animates it arriving from their
   * own bearing to `from`, which is what makes the aiming legible in both
   * directions.
   */
  angle: number;
  /** 1 for a normal drop, doubling with every catch. */
  size: number;
  launchedAt: number;
  /** Server time it clears the thrower's screen — also their launch lock. */
  leavesAt: number;
  /** Server time it lands. Everything is animated against this. */
  arrivesAt: number;
};

/** Spill: the whole round, as a client needs it after a join or a refresh. */
export type SpillState = {
  roundId: number;
  /** Server time play actually begins — the rules panel owns the time before. */
  startsAt: number;
  /** Player at each seat; the index **is** the physical position. */
  seats: PlayerId[];
  levels: Record<PlayerId, number>;
  /** Players who reached SPILL_LOSE_LEVEL and are now spectating. */
  out: PlayerId[];
  air: SpillDrop[];
  phase: 'running' | 'done';
};

/**
 * Goat Siege: one goat, described once and animated locally from then on.
 *
 * The whole flight is a deterministic arc, so a single message covers it — no
 * position streaming. `lane` is where it crosses the fence (0..1 across the
 * patch) and `seed` fixes the split direction, so every phone draws the same
 * thing without any of them deciding it (spec §5).
 */
export type Goat = {
  goatId: string;
  /** Whose patch it is falling into. */
  victim: PlayerId;
  /** Who lobbed it; null for a kid, which comes from a split, not a player. */
  from: PlayerId | null;
  kind: 'adult' | 'kid';
  lane: number;
  launchedAt: number;
  arrivesAt: number;
  seed: number;
};

export type GoatState = {
  roundId: number;
  /** Server time play actually begins — the rules panel owns the time before. */
  startsAt: number;
  players: PlayerId[];
  cabbages: Record<PlayerId, number>;
  out: PlayerId[];
  air: Goat[];
  phase: 'running' | 'done';
};

/**
 * Sling Puck: the round as the server sees it — which is only the **counts**.
 *
 * There is deliberately no puck geometry here. Each phone simulates its own half
 * and nobody else can see it, so positions are private to a client and the only
 * shared fact is how many pucks are on each side (spec §4).
 */
export type SlingState = {
  roundId: number;
  /** Server time play actually begins — the rules panel owns the time before. */
  startsAt: number;
  /** Exactly two, in seat order. */
  players: PlayerId[];
  pucks: Record<PlayerId, number>;
  phase: 'running' | 'done';
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
  /**
   * A duel has begun. `fireAt` is server time — render it with client.now().
   * `startsAt` is when the rules panel clears; `fireAt` is always after it, so
   * the signal can never fire behind a covered screen. Sent explicitly rather
   * than derived, because `fireAt` carries a random spread on top.
   */
  | { t: 'arm'; s: number; d: { roundId: number; fireAt: number; startsAt: number } }
  /** Only the offender is told, and only they see it. */
  | { t: 'false-start'; d: { roundId: number } }
  | { t: 'result'; s: number; d: RoundResult }
  /** Bump Relay: the bomb is now here. Late frames with a lower `s` are dropped. */
  | { t: 'bomb'; s: number; d: { roundId: number; holder: PlayerId; alive: PlayerId[] } }
  /** Bump Relay: the fuse expired on `victim`. */
  | { t: 'boom'; s: number; d: { roundId: number; victim: PlayerId; alive: PlayerId[] } }
  /** Bump Relay: too many bumps too fast — this player's bumps are muted briefly. */
  | { t: 'calm-down'; d: { untilServerTime: number } }
  /** Spill: full state. Sent at round start and after any resync. */
  | { t: 'spill'; s: number; d: SpillState }
  /**
   * Spill: something is in the air. Carries `levels` because flinging is the
   * one thing that empties your phone — without it your own counter would sit
   * unchanged until the drop landed a second and a half later.
   *
   * `replaces` is the id of the caught drop this one was thrown *from*, so the
   * thrower knows the payload has left their hands. Without it the client keeps
   * a phantom hold forever and every later flick is rejected server-side.
   */
  | {
      t: 'drop';
      s: number;
      d: SpillDrop & { levels: Record<PlayerId, number>; replaces?: string };
    }
  /** Spill: `by` grabbed it mid-approach; it is now theirs to re-fling. */
  | { t: 'caught'; s: number; d: { dropId: string; by: PlayerId; size: number; soaksAt: number } }
  /** Spill: it landed. `on` is null when the flick missed the table entirely. */
  | {
      t: 'land';
      s: number;
      d: {
        dropId: string;
        on: PlayerId | null;
        size: number;
        levels: Record<PlayerId, number>;
        out: PlayerId[];
      };
    }
  /** Spill: round over. `winnerId` emptied their phone, or was last standing. */
  | {
      t: 'spill-over';
      s: number;
      d: { roundId: number; winnerId: PlayerId | null; levels: Record<PlayerId, number> };
    }
  /** Goat Siege: full state. Sent at round start and after any resync. */
  | { t: 'siege'; s: number; d: GoatState }
  /** Goat Siege: a goat is in the air. */
  | { t: 'goat'; s: number; d: Goat }
  /** Goat Siege: shooed — it becomes these kids, which must each be tapped. */
  | { t: 'split'; s: number; d: { goatId: string; by: PlayerId; kids: Goat[] } }
  /** Goat Siege: a goat landed and ate. */
  | { t: 'chomp'; s: number; d: { goatId: string; victim: PlayerId; cabbages: Record<PlayerId, number>; out: PlayerId[] } }
  /** Goat Siege: round over. */
  | {
      t: 'siege-over';
      s: number;
      d: { roundId: number; winnerId: PlayerId | null; cabbages: Record<PlayerId, number> };
    }
  /** Sling Puck: full state. Sent at round start and after any resync. */
  | { t: 'sling'; s: number; d: SlingState }
  /**
   * Sling Puck: a puck arrived. **Already rotated into the receiver's frame**,
   * so `x` and the velocity can be handed straight to the local simulation.
   *
   * `at` is the server time it crossed; the receiver advances it by the time
   * since, so a puck does not visibly stall for the length of the trip. `pucks`
   * rides along because a crossing is the only thing that changes the score.
   */
  | {
      t: 'puck';
      s: number;
      d: {
        from: PlayerId;
        to: PlayerId;
        x: number;
        vx: number;
        vy: number;
        at: number;
        pucks: Record<PlayerId, number>;
      };
    }
  /** Sling Puck: round over. `winnerId` cleared their side, or had fewest at the cap. */
  | {
      t: 'sling-over';
      s: number;
      d: { roundId: number; winnerId: PlayerId | null; pucks: Record<PlayerId, number> };
    }
  | { t: 'error'; d: { code: ErrorCode; message: string } };

export const MAX_PLAYERS = 10;

/**
 * How long the rules panel holds the screen at the top of every round.
 *
 * The server knows about it rather than it being pure decoration: Tap Duel
 * pushes `fireAt` past it so the signal cannot land behind the panel, and Spill
 * and Goat Siege reject input until it has elapsed. A window the client alone
 * respected would just be a head start for anyone who skipped it.
 */
export const PREROUND_MS = 4_000;

/**
 * How long the rules panel holds the screen for round `roundId` of a room.
 *
 * **Only the first round gets one.** "Play again" means everybody has just read
 * the rules and played a round of the thing, so showing them again is four
 * seconds of being told what you already know — and it lands right when the room
 * is keenest to go again.
 *
 * The window collapses to zero rather than the panel merely being hidden: a
 * silent four-second wait on a live-looking board is worse than the panel it
 * replaced. Deciding it here, from a number the server owns, is what keeps the
 * client's panel and the server's input gate agreeing.
 */
export function preroundFor(roundId: number): number {
  return roundId <= 1 ? PREROUND_MS : 0;
}

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

/* ------------------------------------------------------------------ */
/* Bump Relay (docs/specs/games/bump-relay.md)                          */
/* ------------------------------------------------------------------ */

/** First fuse is drawn in this window; both bounds shrink after each boom. */
export const FUSE_MIN_MS = 8_000;
export const FUSE_MAX_MS = 25_000;
export const FUSE_SHRINK = 0.85;
export const FUSE_FLOOR_MIN_MS = 5_000;
export const FUSE_FLOOR_MAX_MS = 12_000;

/** Two bumps this close together, from different players, are one contact. */
export const BUMP_PAIR_WINDOW_MS = 250;

/** Per-player bump budget; exceeding it mutes their bumps briefly. */
export const BUMP_QUOTA = 6;
export const BUMP_QUOTA_WINDOW_MS = 10_000;
export const BUMP_MUTE_MS = 3_000;

/** Bump Relay needs three players to be a game rather than a duel. */
export const BUMP_RELAY_MIN_PLAYERS = 3;

/** A round is hard-capped, per the safety rules in the spec. */
export const BUMP_ROUND_CAP_MS = 5 * 60_000;

/* ------------------------------------------------------------------ */
/* Spill (docs/specs/games/spill.md)                                    */
/* ------------------------------------------------------------------ */

/** Two is a duel; above four the ring gets too crowded to aim (spec §12). */
export const SPILL_MIN_PLAYERS = 2;
export const SPILL_MAX_PLAYERS = 4;

/** Start half full; reach the ceiling and you are out (spec §3). */
export const SPILL_START_LEVEL = 20;
export const SPILL_LOSE_LEVEL = 40;

/**
 * Flick speed is clamped rather than rejected: a fast screen and a cheat look
 * identical from here, and silently capping is better UX than an accusation
 * (spec §9). Units are screen heights per second.
 */
export const SPILL_SPEED_MIN = 0.5;
export const SPILL_SPEED_MAX = 6;

/** Bounds on how long a drop takes to clear the thrower's screen (spec §4). */
export const SPILL_LOCK_MIN_MS = 250;
export const SPILL_LOCK_MAX_MS = 1_200;

/** Time spent over the table, visible to nobody. */
export const SPILL_GAP_MS = 200;

/** How long a drop is visible to its target before it lands — the catch window. */
export const SPILL_APPROACH_MS = 900;

/** Hold a caught drop longer than this and it soaks in, doubled (spec §5). */
export const SPILL_HOLD_MS = 2_500;

/**
 * Aim tolerance as a fraction of the half-gap between seats. Below 1 there is
 * always a sliver you can miss through, which is what keeps a wild flick a real
 * (and sometimes deliberate) way to shed water.
 */
export const SPILL_AIM_FRACTION = 0.7;

/** A round is capped like every other, so a stalemate cannot run forever. */
export const SPILL_ROUND_CAP_MS = 5 * 60_000;

/* ------------------------------------------------------------------ */
/* Goat Siege (docs/specs/games/goat-siege.md)                          */
/* ------------------------------------------------------------------ */

export const SIEGE_MIN_PLAYERS = 2;
export const SIEGE_MAX_PLAYERS = 4;

/** All provisional until a play test — spec §3. */
export const SIEGE_CABBAGES = 6;
export const SIEGE_ADULT_FLIGHT_MS = 2_500;
export const SIEGE_KID_FLIGHT_MS = 1_200;
export const SIEGE_KIDS_PER_SPLIT = 2;
export const SIEGE_LOB_COOLDOWN_MS = 1_500;

/** A round is capped like every other, so a stalemate cannot run forever. */
export const SIEGE_ROUND_CAP_MS = 5 * 60_000;

/* ------------------------------------------------------------------ */
/* Sling Puck (docs/specs/games/sling-puck.md)                          */
/* ------------------------------------------------------------------ */

/** Two phones nose to nose. Not a range — the board is the join between them. */
export const SLING_PLAYERS = 2;

/** Starting pucks per side. Mirrors `SLING_PUCKS` in the client physics (spec §6). */
export const SLING_START_PUCKS = 5;

/**
 * Floor on how fast crossings may arrive from one player.
 *
 * Not a fairness rule — a good human throw takes over a second, so this never
 * touches real play. It is the cheap half of the anti-cheat in spec §10: it caps
 * how fast a modified client can empty its side, and it costs nothing.
 */
export const SLING_MIN_GAP_MS = 250;

/** Plausible arrival speed. A forged crossing cannot spawn a puck faster than this. */
export const SLING_SPEED_MAX = 2.5;

/** A round is capped like every other, so a stalemate cannot run forever. */
export const SLING_ROUND_CAP_MS = 3 * 60_000;

const CLIENT_TYPES = new Set([
  'join',
  'set-profile',
  'ping',
  'start',
  'tap',
  'bump',
  'pass',
  'fling',
  'catch',
  'lob',
  'shoo',
  'cross',
]);

export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return typeof t === 'string' && CLIENT_TYPES.has(t);
}
