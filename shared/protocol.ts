import { PLAYERS } from './players';

/**
 * The wire protocol, shared verbatim by the browser and the Durable Object.
 * Envelope shape is specified in docs/multiplayer.md §4.
 *
 * DOM-free — the Worker has no DOM. Its only import is `./players`, which is itself
 * a zero-import leaf: the per-game player limits live there rather than here so a
 * game's `card.ts` can read them without dragging the whole wire protocol into the
 * hub's bundle (docs/design/illustrations.md §3). Nothing else may be added.
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
  /**
   * Host only. Begins a round. `mode` selects the game.
   *
   * `drag` is Cat and Mouse's drag mode and is **orthogonal to `mode`** — it is a
   * host setting, not a game mode, and `hoard` or `blackout` would each want the
   * same choice (cat-and-mouse.md §6). Ignored by every other game.
   */
  | { t: 'start'; d: { mode: string; drag?: 'direct' | 'capped' } }
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
  | { t: 'cross'; d: { roundId: number; x: number; vx: number; vy: number } }
  /**
   * Cat and Mouse: where my icon is **now**, in board units (spec §5).
   *
   * The only input this game has, and it is the same message in both drag modes:
   * the client moves its own icon and reports the result, so `capped`'s walk and
   * `direct`'s finger-tracking are one wire format. The server clamps to the
   * floor and, in `capped`, truncates anything faster than the speed it knows
   * about (spec §9).
   *
   * Sent only while a finger is down. A still icon sends nothing, which is what
   * keeps the traffic near the floor rather than the worst case (spec §4).
   */
  | { t: 'move'; d: { roundId: number; x: number; y: number } };

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

/**
 * Cat and Mouse: one player on the floor.
 *
 * Position is in the isotropic board units of spec §5 — `x` 0..1, `y`
 * 0..`1 / CM_BOARD_ASPECT` — so every phone agrees where everyone is regardless
 * of its own shape.
 */
export type CatMouseActor = {
  playerId: PlayerId;
  x: number;
  y: number;
  /** Mice only. The cat has no lives; it cannot be caught. */
  lives: number;
  /**
   * Server time this mouse becomes catchable again, or 0.
   *
   * Sent rather than derived because the client draws the untouchable outline
   * from it (spec §7) and the server is the only thing that knows the deadline.
   */
  graceUntil: number;
  out: boolean;
};

export type CatMouseState = {
  roundId: number;
  /** Server time play begins. The rules panel owns the window before it. */
  startsAt: number;
  /** Whose turn it is to be the cat. Exactly one per round. */
  catId: PlayerId;
  /** Host's choice, echoed so every client renders and predicts the same game. */
  drag: 'direct' | 'capped';
  actors: CatMouseActor[];
  endsAt: number;
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
   *
   * `target` is where the thing to tap appears, as fractions of the viewport.
   * The **server** picks it, so it is the same spot on every screen — a target
   * drawn somewhere different for each player would hand the round to whoever
   * got the luckiest placement.
   */
  | {
      t: 'arm';
      s: number;
      d: {
        roundId: number;
        fireAt: number;
        startsAt: number;
        target: { x: number; y: number };
      };
    }
  /** Only the offender is told, and only they see it. */
  | { t: 'false-start'; d: { roundId: number } }
  | { t: 'result'; s: number; d: RoundResult }
  /** Pass the Bomb: the bomb is now here. Late frames with a lower `s` are dropped. */
  | { t: 'bomb'; s: number; d: { roundId: number; holder: PlayerId; alive: PlayerId[] } }
  /** Pass the Bomb: the fuse expired on `victim`. */
  | { t: 'boom'; s: number; d: { roundId: number; victim: PlayerId; alive: PlayerId[] } }
  /** Pass the Bomb: too many bumps too fast — this player's bumps are muted briefly. */
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
  /** Cat and Mouse: full state. Sent at round start and after any resync. */
  | { t: 'cm'; s: number; d: CatMouseState }
  /**
   * Cat and Mouse: one tick of positions (spec §4).
   *
   * Deliberately not the whole state — this goes out `CM_TICK_HZ` times a second
   * and lives and grace change only on a catch. `at` is the server time the tick
   * was taken, so clients interpolate against a real instant rather than against
   * their own arrival time.
   *
   * `pos` is keyed by player id, each `[x, y]` — a tuple rather than an object
   * because this is the one message whose size is multiplied by the tick rate.
   */
  | {
      t: 'cm-frame';
      s: number;
      d: { roundId: number; at: number; pos: Record<PlayerId, [number, number]> };
    }
  /** Cat and Mouse: the cat touched a mouse. Only the server decides this (spec §9). */
  | {
      t: 'cm-catch';
      s: number;
      d: {
        roundId: number;
        victim: PlayerId;
        lives: number;
        /** Server time the victim is catchable again. */
        graceUntil: number;
        out: boolean;
        /** Where the victim reappears — the centre of the floor (spec §6). */
        x: number;
        y: number;
      };
    }
  /** Cat and Mouse: round over. `catWins` when every mouse ran out of lives. */
  | {
      t: 'cm-over';
      s: number;
      d: {
        roundId: number;
        catWins: boolean;
        /** Mice still alive at the end. Empty when the cat won. */
        survivors: PlayerId[];
        /** How long the mice lasted, in ms — what the result screen shows. */
        lastedMs: number;
      };
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

/**
 * Where the target may appear, as fractions of the viewport.
 *
 * Inset from every edge so it is never half off-screen, and kept clear of the
 * top-right corner where the gear lives — a target under the menu button would
 * be a target you cannot tap without opening the menu.
 */
export const TARGET_MIN_X = 0.2;
export const TARGET_MAX_X = 0.8;
export const TARGET_MIN_Y = 0.3;
export const TARGET_MAX_Y = 0.78;

/** Pick a target position. Server-side, so every screen gets the same one. */
export function randomTarget(): { x: number; y: number } {
  return {
    x: TARGET_MIN_X + Math.random() * (TARGET_MAX_X - TARGET_MIN_X),
    y: TARGET_MIN_Y + Math.random() * (TARGET_MAX_Y - TARGET_MIN_Y),
  };
}

/* ------------------------------------------------------------------ */
/* Pass the Bomb (docs/specs/games/pass-the-bomb.md)                          */
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

/**
 * Pass the Bomb needs three players to be a game rather than a duel.
 *
 * These per-game limits are **derived from `players.ts`**, which is the one place
 * they are written, so a card and its referee cannot promise different numbers.
 * Indexed reads rather than `export const [MIN, MAX] = …`: a destructured export
 * makes Rollup conservative about tree-shaking.
 */
export const BOMB_MIN_PLAYERS = PLAYERS['pass-the-bomb'][0];
export const BOMB_MAX_PLAYERS = PLAYERS['pass-the-bomb'][1];

/** A round is hard-capped, per the safety rules in the spec. */
export const BUMP_ROUND_CAP_MS = 5 * 60_000;

/* ------------------------------------------------------------------ */
/* Spill (docs/specs/games/spill.md)                                    */
/* ------------------------------------------------------------------ */

/** Two is a duel; above four the ring gets too crowded to aim (spec §12). */
export const SPILL_MIN_PLAYERS = PLAYERS.spill[0];
export const SPILL_MAX_PLAYERS = PLAYERS.spill[1];

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

export const SIEGE_MIN_PLAYERS = PLAYERS['goat-siege'][0];
export const SIEGE_MAX_PLAYERS = PLAYERS['goat-siege'][1];

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
export const SLING_PLAYERS = PLAYERS['sling-puck'][0];

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

/**
 * Crossings accepted back to back before the floor above starts to bite.
 *
 * The floor was originally a hard one-per-`SLING_MIN_GAP_MS`, on the assumption
 * that "no human throws twice at once". A human does not have to: one shot can
 * knock a second puck through a few frames later, and knocking pucks through is
 * the whole point of the sling. Those crossings were refused silently, so the
 * sender lost a puck the server never counted.
 */
export const SLING_CROSS_BURST = 3;

/** Plausible arrival speed. A forged crossing cannot spawn a puck faster than this. */
export const SLING_SPEED_MAX = 2.5;

/** A round is capped like every other, so a stalemate cannot run forever. */
export const SLING_ROUND_CAP_MS = 3 * 60_000;

/* ------------------------------------------------------------------ */
/* Cat and Mouse (docs/specs/games/cat-and-mouse.md)                    */
/* ------------------------------------------------------------------ */

export const CM_MIN_PLAYERS = PLAYERS['cat-and-mouse'][0];
export const CM_MAX_PLAYERS = PLAYERS['cat-and-mouse'][1];

/**
 * Floor width ÷ height. Portrait, because the phone is (spec §5).
 *
 * The floor is letterboxed into whatever screen it lands on, so this number —
 * not the screen's own ratio — is what makes a diagonal run straight on every
 * phone.
 */
export const CM_BOARD_ASPECT = 0.75;

/** Bottom edge in board units. `x` is 0..1; `y` is 0..this. */
export const CM_BOARD_H = 1 / CM_BOARD_ASPECT;

/**
 * Broadcast rate. One frame per tick regardless of how many fingers are moving,
 * which is what bounds the cost of the catalogue's first position-streaming game
 * (spec §4). Clients interpolate, so this is not the frame rate they see.
 */
export const CM_TICK_HZ = 15;
export const CM_TICK_MS = Math.round(1000 / CM_TICK_HZ);

/*
 * The tunables below are all provisional until a play test — spec §13. The two
 * that matter most are CM_CAT_COOLDOWN_MS (does it kill scribbling without making
 * the cat feel broken?) and CM_LIVES against CM_ROUND_CAP_MS, which may want
 * different values per drag mode.
 */

/** How near your own icon a touch counts as grabbing it, in board widths. */
export const CM_GRAB_SLOP = 0.09;

/** `capped` only. Board widths per second. */
export const CM_MOUSE_SPEED = 0.55;

/**
 * The cat's speed as a multiple of a mouse's.
 *
 * One base speed and a factor, rather than an absolute per role: the asymmetry
 * is the interesting number, and a single factor cannot drift out of step with
 * itself the way two absolutes can (spec §6).
 */
export const CM_CAT_SPEED_FACTOR = 1.2;

/** How close counts as a touch, in board widths. */
export const CM_CATCH_RADIUS = 0.055;

/** The anti-scribble lever. Applies to both drag modes (spec §6). */
export const CM_CAT_COOLDOWN_MS = 1_200;

/** A fresh mouse cannot be caught for this long, and can move the whole time. */
export const CM_GRACE_MS = 2_000;

export const CM_LIVES = 3;

export const CM_ROUND_CAP_MS = 75_000;

/**
 * `direct` only, and it is not a fairness rule.
 *
 * `direct` has no speed to clamp to — a real flick crosses the board in about
 * 150 ms, so a teleport and a fast thumb are indistinguishable (spec §9). This
 * sits far above any human flick: it never touches real play, and it stops a
 * client that simply writes coordinates.
 */
export const CM_SANITY_SPEED = 5;

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
  'move',
]);

export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return typeof t === 'string' && CLIENT_TYPES.has(t);
}
