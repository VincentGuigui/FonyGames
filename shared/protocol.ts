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
  | {
      t: 'start';
      d: {
        mode: string;
        drag?: 'direct' | 'capped';
        /**
         * Solo test mode — start with one player, for looking at a game rather than
         * playing it. Set by a browser that has signed into the admin centre; the
         * two rules it relaxes are listed on `enoughToStart` in shared/players.ts.
         */
        solo?: boolean;
      };
    }
  /** Finger down, at the client's clock-corrected server time. */
  | { t: 'tap'; d: { at: number; roundId: number } }
  /** This phone felt a knock. The SERVER pairs two of these into a contact. */
  | { t: 'bump'; d: { at: number; roundId: number } }
  /** Touch fallback for a player without motion: pass to a chosen player. */
  | { t: 'pass'; d: { to: PlayerId; roundId: number } }
  /**
   * Steady Hand: my worst wobble this tick, and whether the phone is still held up.
   * A summary rather than a stream — the raw accelerometer never leaves the phone.
   */
  | { t: 'wobble'; d: { w: number; held: boolean; roundId: number } }
  /**
   * Shake Rush: how many shakes I felt since my last frame.
   *
   * An increment, never a position — the server owns where anyone is
   * (shake-rush.md §8), and a client that sends an absurd `n` is clipped to what
   * the elapsed time could physically hold rather than believed.
   */
  | { t: 'shake'; d: { n: number; roundId: number } }
  /**
   * Ghost Hunt: I locked target `index`, `ms` after it appeared.
   *
   * One message per find — the aim itself never crosses the wire (ghost-hunt.md
   * §6), so the server checks the only thing it can see, which is the clock.
   */
  | { t: 'found'; d: { roundId: number; index: number; ms: number } }
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
  | { t: 'move'; d: { roundId: number; x: number; y: number } }
  /**
   * Grid Attack: a finger landed on a cell.
   *
   * `side` rather than an owner id, because that is what the player did: they hit a cell on
   * their own half or on the other one. The referee resolves it against the seating, so a
   * phone cannot tap on somebody else's behalf by naming them.
   */
  | { t: 'grid-tap'; d: { roundId: number; cell: number; side: 'mine' | 'theirs' } }
  /** Grid Attack: this phone is fullscreen, sideways and looking at the board. */
  | { t: 'grid-ready'; d: { roundId: number } }
  /**
   * Squash Mosquitoes: a finger landed on grid cell `position`.
   *
   * A cell, not a pattern index — the client reports the physical fact, and the
   * referee is the only thing that knows whether a mosquito of ITS OWN was
   * there for this player (spec §6).
   */
  | { t: 'squash-tap'; d: { roundId: number; position: number } };

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
  /** Points in the current match, keyed by player id. */
  scores: Record<PlayerId, number>;
  /**
   * Who reached `DUEL_MATCH_TARGET` with this round, or null while the match runs.
   *
   * The scores in this same frame still show the winning tally, but the server has already
   * cleared what it stores — so the next round starts a new match, and this is how the
   * screen knows to say so.
   */
  matchWinnerId: PlayerId | null;
  /** True when nobody produced a valid tap. */
  noContest: boolean;
};

/**
 * Pass the Bomb: the match a round belongs to.
 *
 * A round is one bomb, from the first holder to the boom that ends it. A **match** is the
 * thing people actually sit down to play, and how many rounds that takes has two shapes
 * because two players and six players are not the same game:
 *
 * | | |
 * | --- | --- |
 * | **Two players** (`rounds: 3`) | A boom leaves nobody to pass to, so a round is one explosion. Three of those, tallied, decide it — odd, so it cannot end tied |
 * | **Three or more** (`rounds: 1`) | The round runs the classic way, players out one at a time — for the rest of the MATCH, not just that round — until one is left. One of those is the whole match |
 *
 * Carried from round to round by the referee and sent whole on every frame, so a phone that
 * joins late, reloads, or misses a frame draws the same standings as everyone else.
 */
export type BombMatch = {
  /** Which round is being played, 1-based. */
  round: number;
  /** How many rounds the match runs to — 3 for two players, 1 for three or more. */
  rounds: number;
  /** Rounds won per player — the survivor of each round takes one. */
  wins: Record<PlayerId, number>;
  /** Who took the match, once `done`. Null for a draw, or nobody at all. */
  champion: PlayerId | null;
  /** No further round will be played on these standings. */
  done: boolean;
};

/**
 * Grid Attack: one cell of somebody's four-by-four.
 *
 * Deliberately NOT carrying how far anybody has got with their taps. Tap progress is
 * private to the finger making it: the whole game is that a cell gives its owner no warning
 * until it is armed, and two taps' worth of "somebody is working on this one" would hand
 * the defender the second they need. The tapper sees their own progress locally, and the
 * referee is the only thing that counts.
 */
export type GridCell = {
  /** Burst and gone. A hole in the grid, and it never comes back. */
  gone: boolean;
  /**
   * Server time this cell blows, or 0 when nothing is happening to it.
   *
   * The only thing a phone needs to draw the pulse: the animation is a function of how
   * much of `GRID_FUSE_MS` is left, so a phone that missed a frame catches up correctly
   * rather than starting its own two seconds late.
   */
  burstAt: number;
};

/** Grid Attack: the whole board, which is small enough to send whole on every change. */
export type GridState = {
  roundId: number;
  /** Sixteen cells per player, row-major. */
  grids: Record<PlayerId, GridCell[]>;
  lives: Record<PlayerId, number>;
  /**
   * Who has said they are fullscreen and sideways.
   *
   * The round does not run until both have, because the first two seconds of a game you
   * cannot see yet are two seconds of being attacked. `startsAt` is the moment the wait
   * ended — 0 while it is still on.
   */
  ready: Record<PlayerId, boolean>;
  startsAt: number;
  /** The safety cap, as every other game has. */
  endsAt: number;
  winner: PlayerId | null;
  phase: 'waiting' | 'running' | 'done';
};

/**
 * Squash Mosquitoes: one player's own board — private, and never sent to anyone
 * else (spec §6, §9).
 *
 * Both arrays hold **pattern indices**, not grid positions: the position a given
 * index lives at is the same for every player (`SquashState.pattern`), so there is
 * nothing to gain by repeating it per board.
 */
export type SquashBoard = {
  /** Spawned and not yet squashed — draw a mosquito at `pattern[i]` for each. */
  active: number[];
  /** Squashed. Never removed — draw the blood mark at `pattern[i]` for each. */
  squashed: number[];
};

/**
 * Squash Mosquitoes: the shared, public half of the round.
 *
 * `scores` is a squashed **count**, not a board — the one number every other
 * player's screen is allowed to see (spec §6). Your own board arrives separately,
 * as `squash-board`, and only to you.
 */
export type SquashState = {
  roundId: number;
  startsAt: number;
  /** The safety cap, as every other game has. */
  endsAt: number;
  /** The 66 grid positions, in spawn order. Identical for every player. */
  pattern: number[];
  scores: Record<PlayerId, number>;
  winner: PlayerId | null;
  phase: 'running' | 'done';
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
        /**
         * How fast the target drifts this round — see `driftSpeed`.
         *
         * Sent rather than derived, even though every phone could compute it from the
         * scores it has: a phone that joined mid-match has not seen those results, and a
         * target moving at a different speed on one screen hands that player either an
         * easier round or an impossible one. Everything about this target is on the wire
         * for exactly that reason (spec §4).
         */
        speed: number;
      };
    }
  /** Only the offender is told, and only they see it. */
  | { t: 'false-start'; d: { roundId: number } }
  | { t: 'result'; s: number; d: RoundResult }
  /** Pass the Bomb: the bomb is now here. Late frames with a lower `s` are dropped. */
  | {
      t: 'bomb';
      s: number;
      d: { roundId: number; holder: PlayerId; alive: PlayerId[]; match: BombMatch };
    }
  /** Pass the Bomb: the fuse expired on `victim`. */
  | {
      t: 'boom';
      s: number;
      d: {
        roundId: number;
        victim: PlayerId;
        alive: PlayerId[];
        /**
         * Whether that was the end of the round.
         *
         * The phone used to work this out for itself — "a boom that leaves one player or
         * none" — which was right for the elimination rounds and wrong for the other two
         * ways a round ends: a two-player round finishes after a single boom with nobody
         * left to pass to, and the five-minute safety cap finishes one with a whole circle
         * left. Both looked to the phone like the round carrying on.
         */
        over: boolean;
        match: BombMatch;
      };
    }
  /** Grid Attack: the board, whole. Late frames with a lower `s` are dropped. */
  | { t: 'grid'; s: number; d: GridState }
  /** Squash Mosquitoes: the shared state — pattern, everyone's count, phase, winner. */
  | { t: 'squash'; s: number; d: SquashState }
  /**
   * Squash Mosquitoes: sent to **one player only** — their own board.
   *
   * Never broadcast. Everyone else's screen only ever learns this player's
   * squashed *count*, carried in `squash` instead (spec §6, §9).
   */
  | { t: 'squash-board'; s: number; d: { roundId: number; board: SquashBoard } }
  /** Pass the Bomb: too many bumps too fast — this player's bumps are muted briefly. */
  | { t: 'calm-down'; d: { untilServerTime: number } }
  /** Steady Hand: the state of the room. `w` is everyone's last wobble, for the meters. */
  | {
      t: 'steady';
      s: number;
      d: {
        roundId: number;
        tolerance: number;
        startsAt: number;
        endsAt: number;
        alive: PlayerId[];
        lives: Record<PlayerId, number>;
        w: Record<PlayerId, number>;
      };
    }
  /** Steady Hand: somebody flinched and spent a life. */
  | {
      t: 'steady-hit';
      s: number;
      d: { roundId: number; victim: PlayerId; lives: number; graceUntil: number };
    }
  /** Steady Hand: somebody spent their last life, or put the phone down. */
  | {
      t: 'steady-out';
      s: number;
      d: { roundId: number; victim: PlayerId; reason: 'moved' | 'parked' | 'left'; alive: PlayerId[] };
    }
  /** Steady Hand: round over. `times` is survival in ms, per player. */
  | {
      t: 'steady-end';
      s: number;
      d: { roundId: number; winner: PlayerId | null; times: Record<PlayerId, number> };
    }
  /** Ghost Hunt: the shared sequence, and how far down it everyone has got. */
  | {
      t: 'hunt';
      s: number;
      d: {
        roundId: number;
        /**
         * The ghosts, in order, in DEGREES — and relative to each player's OWN
         * forward, not to north. Everyone hunts the same sequence, so it is a fair
         * race, but each reads it against their own calibration (ghost-hunt.md §3).
         *
         * The whole sequence rather than just the live one, because progress is
         * PER PLAYER: a fast player must not yank the ghost off somebody else's
         * screen mid-sweep, and two people finding the same ghost both score
         * (spec §7).
         */
        targets: { azimuth: number; elevation: number }[];
        /** Which target each player is on. A `found` for any other index is stale. */
        index: Record<PlayerId, number>;
        endsAt: number;
        /** How many ghosts each player has caught. */
        scores: Record<PlayerId, number>;
        /**
         * Time spent searching, per player, in ms.
         *
         * Cumulative across their finds and measured by the server, so it cannot be
         * beaten by a client with a generous clock. No longer the score — it is what the
         * score is computed FROM, and what the end screen turns into an average.
         */
        totals: Record<PlayerId, number>;
        /**
         * The score: `HUNT_POINTS_PER_FIND` a ghost, less the seconds each one took.
         *
         * Summed by the referee rather than derived here from `scores` and `totals`,
         * because the per-find floor is not something a total can be un-mixed back into.
         */
        points: Record<PlayerId, number>;
      };
    }
  /**
   * Ghost Hunt: round over, with everyone's find times.
   *
   * `fastest` and `slowest` are per player and in ms, `0` for anyone who caught nothing.
   * The average is not sent — it is `totals / scores`, and a number the receiver can
   * divide for itself is a number that cannot disagree with the two it came from.
   */
  | {
      t: 'hunt-end';
      s: number;
      d: {
        roundId: number;
        scores: Record<PlayerId, number>;
        totals: Record<PlayerId, number>;
        points: Record<PlayerId, number>;
        fastest: Record<PlayerId, number>;
        slowest: Record<PlayerId, number>;
      };
    }
  /** Shake Rush: where everyone is on the track, and who has finished. */
  | {
      t: 'rush';
      s: number;
      d: {
        roundId: number;
        endsAt: number;
        /** Shakes travelled, per player. `RUSH_DISTANCE` is the line. */
        at: Record<PlayerId, number>;
        /** Finish order so far, first to last. */
        finished: PlayerId[];
        /** Players whose phone has stopped reporting — their runner is frozen. */
        away: PlayerId[];
      };
    }
  /** Shake Rush: round over. `order` is the finish order, then the furthest of the rest. */
  | {
      t: 'rush-end';
      s: number;
      d: { roundId: number; order: PlayerId[]; at: Record<PlayerId, number> };
    }
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
/**
 * Points that take the match. First there wins it.
 *
 * A duel is one tap, so a single round is a coin toss between two quick people; ten of
 * them is a contest. The rounds themselves are unchanged — this is the number that says
 * when to stop.
 */
export const DUEL_MATCH_TARGET = 10;

/**
 * How fast the target drifts, as a multiple of the base leg speed, given how many rounds
 * this match has already decided.
 *
 * **Slow at first and faster with every point scored.** The first duel of a match is
 * nearly a still target — a fair test of reaction and nothing else — and by the tenth the
 * thumb has to follow something that is genuinely moving. That ramp is the difficulty
 * curve of a match, and it costs nothing: the drift is a pure function of elapsed time
 * (`drift.ts`), so scaling the time scales the speed.
 *
 * Capped, because the walk is legs of a fixed length: past about twice speed the target
 * changes direction faster than a hand can react, which stops being harder and starts
 * being arbitrary.
 */
export const DRIFT_SPEED_START = 0.55;
export const DRIFT_SPEED_STEP = 0.15;
export const DRIFT_SPEED_MAX = 2.2;

export function driftSpeed(roundsDecided: number): number {
  const n = Number.isFinite(roundsDecided) && roundsDecided > 0 ? roundsDecided : 0;
  return Math.min(DRIFT_SPEED_MAX, DRIFT_SPEED_START + n * DRIFT_SPEED_STEP);
}

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
 * Two is a game.
 *
 * It was three, on the reasoning that two players is a duel rather than a party game. In
 * practice that is the number that stops a round happening at all: two phones on a table
 * is the commonest way this gets played, and refusing it sends people to another game.
 * With two, one boom ends the round — which is short, and short is fine.
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

/**
 * A two-player match: three short rounds, one boom each.
 *
 * With two people the first boom is also the last — there is nobody left to pass to — so a
 * round is over in one explosion, and one explosion is not an evening. Three of them, tallied
 * like any other round, decide it. Odd, so the match cannot end in a tie.
 */
export const BOMB_DUEL_ROUNDS = 3;

/**
 * A three-or-more match: one round, played to a last player standing.
 *
 * With three or more, a boom eliminates for the rest of the MATCH, not just the round in
 * progress — so the round already runs to a single survivor, and that survivor is the match.
 * A second round would just be repeating a game that already answered the only question it
 * asks.
 */
export const BOMB_CLASSIC_ROUNDS = 1;

/* ------------------------------------------------------------------ */
/* Grid Attack (docs/specs/games/grid-attack.md)                        */
/* ------------------------------------------------------------------ */

/** Four by four, per player. Sixteen cells to defend and sixteen to break. */
export const GRID_SIZE = 4;
export const GRID_CELLS = GRID_SIZE * GRID_SIZE;

/** Lives, and therefore how many of your cells may burst before you lose. */
export const GRID_LIVES = 5;

/**
 * Taps to arm a cell, and to save one. The same number both ways on purpose: attack and
 * defence cost the same, so the race is about noticing rather than about button mashing.
 */
export const GRID_TAPS = 3;

/**
 * How long a run of taps may take before it is a new run.
 *
 * Without this the game breaks completely rather than subtly: tap progress that never
 * decays lets an attacker leave two taps on all sixteen cells at leisure and then finish
 * them in one sweep, arming the whole grid at once against a defender who cannot possibly
 * save sixteen cells in two seconds. Three taps has to mean three taps *quickly*, which is
 * also what it means when a person says it.
 */
export const GRID_TAP_WINDOW_MS = 1_200;

/** From armed to burst. The pulse accelerates across exactly this. */
export const GRID_FUSE_MS = 2_000;

/**
 * How long the referee waits for both phones to say they are looking at the board.
 *
 * A backstop, not the rule — the rule is that both tap the fullscreen button. This stops
 * one person who put their phone down from stranding the other in a lobby that has already
 * started.
 */
export const GRID_READY_WAIT_MS = 30_000;

/** A round is hard-capped, like every other. */
export const GRID_ROUND_CAP_MS = 5 * 60_000;

/** Derived from players.ts, so a card and its referee cannot disagree. */
export const GRID_MIN_PLAYERS = PLAYERS['grid-attack'][0];
export const GRID_MAX_PLAYERS = PLAYERS['grid-attack'][1];

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
 * Aim tolerance as a fraction of the half-gap between seats (spec §2).
 *
 * Below 1 there is always a sliver you can miss through — and a miss now costs
 * you the throw, so that sliver is what makes aiming a skill rather than a
 * formality.
 *
 * It said 0.7 of the half-gap for a long time while `aimTolerance` actually
 * computed 0.7 of the *whole* gap: 1.40× the half-gap, so the windows overlapped
 * and `aimSeat` delivered 95% of every forward flick at a table of four. There
 * was nothing to aim at, and players did the rational thing and stopped aiming.
 * `spillGeometry.test.ts` now pins the window under the half-gap so this cannot
 * come back.
 */
export const SPILL_AIM_FRACTION = 0.9;

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

/**
 * `capped` only. Board widths per second.
 *
 * Raised from 0.55, which crossed the board in about one and four-fifths seconds and read
 * as a trudge rather than a chase — the mode is the default now, so this is the speed the
 * game has, not a speed one setting has. The cat's factor is untouched: the asymmetry was
 * never the problem, the pace was.
 */
export const CM_MOUSE_SPEED = 0.7;

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

/* ------------------------------------------------------------------ */
/* Squash Mosquitoes (docs/specs/games/squash-mosquitoes.md)            */
/* ------------------------------------------------------------------ */

/** The invisible grid every mosquito hides on. 117 possible spots. */
export const SQUASH_GRID_COLS = 9;
export const SQUASH_GRID_ROWS = 13;
export const SQUASH_GRID_CELLS = SQUASH_GRID_COLS * SQUASH_GRID_ROWS;

/** The pattern is this many of the grid's cells, no duplicates (spec §2). */
export const SQUASH_TOTAL = 66;

/**
 * Mosquito **N** (1-indexed) in the pattern flies once N reaches this. A property
 * of the pattern position, not a clock or a running count — so whether a given
 * mosquito flies is fixed the moment the pattern is dealt, and both ends of the
 * wire can derive it from the same array without a flag travelling per mosquito
 * (spec §2.2).
 */
export const SQUASH_STATIC_COUNT = 33;

/** A flying mosquito, and its hitbox, at this fraction of a static one's size. */
export const SQUASH_FLY_SCALE = 1 / 2;

/** A round is capped like every other, so a swarm nobody can finish still ends. */
export const SQUASH_ROUND_CAP_MS = 3 * 60_000;

/** Derived from players.ts, so a card and its referee cannot disagree. */
export const SQUASH_MIN_PLAYERS = PLAYERS['squash-mosquitoes'][0];
export const SQUASH_MAX_PLAYERS = PLAYERS['squash-mosquitoes'][1];

/** Is pattern position `index` (0-based) one of the flying half? */
export function squashFlies(index: number): boolean {
  return index >= SQUASH_STATIC_COUNT;
}

const CLIENT_TYPES = new Set([
  'join',
  'set-profile',
  'ping',
  'start',
  'tap',
  'bump',
  'pass',
  'wobble',
  'shake',
  'found',
  'fling',
  'catch',
  'lob',
  'shoo',
  'cross',
  'move',
  'grid-tap',
  'grid-ready',
  'squash-tap',
]);

export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return typeof t === 'string' && CLIENT_TYPES.has(t);
}

/* ------------------------------------------------------------------ */
/* Steady Hand (docs/specs/games/steady-hand.md)                       */
/* ------------------------------------------------------------------ */

/** How often a phone reports its wobble. 5 messages/s per player. */
export const STEADY_TICK_MS = 200;

/**
 * The tolerance, and how it closes in.
 *
 * It **must** tighten, or the round never ends: a phone that is not moving never
 * wobbles, so two careful players would stand there until the cap. Same
 * structural trick as the shrinking fuse in Pass the Bomb (spec §2.2).
 */
export const WOBBLE_START = 1.2;
export const WOBBLE_FLOOR = 0.25;
export const TIGHTEN_EVERY_MS = 10_000;
export const TIGHTEN_FACTOR = 0.8;

/**
 * Three lives, and a second of grace after each one is spent.
 *
 * The grace is not a kindness, it is required. Wobble arrives every
 * `STEADY_TICK_MS`, and the flinch that costs a life is still in progress on the
 * next tick — without it, one twitch spends all three lives in 600 ms and the
 * whole mode does nothing (spec §2.4).
 */
export const STEADY_LIVES = 3;
export const STEADY_GRACE_MS = 1_000;

/**
 * How far off vertical the phone may be before it counts as put down.
 *
 * Flat on a table wins the game trivially, so lying flat for
 * `STEADY_PARKED_MS` eliminates outright — bypassing lives, because lives
 * forgive a flinch and this is not a flinch (spec §2.3).
 */
export const STEADY_HOLD_CONE_DEG = 35;
export const STEADY_PARKED_MS = 1_000;

/** A settle window before anything counts, so nobody is out before they are ready. */
export const STEADY_SETTLE_MS = 3_000;

/** Derived from players.ts, so a card and its referee cannot disagree. */
export const STEADY_MIN_PLAYERS = PLAYERS['steady-hand'][0];
export const STEADY_MAX_PLAYERS = PLAYERS['steady-hand'][1];

/** Hard cap, per the safety rules in the spec. */
export const STEADY_CAP_MS = 2 * 60_000;

/* ------------------------------------------------------------------ */
/* Shake Rush (docs/specs/games/shake-rush.md)                         */
/* ------------------------------------------------------------------ */

/**
 * A shake is a **direction reversal**, not a magnitude, and the whole game rests
 * on that choice (spec §2.1).
 *
 * Summing acceleration rewards violence: the harder you swing, the bigger the
 * number, so the winning strategy becomes swinging a phone as hard as a human
 * can — which is how a phone leaves a hand and hits a wall. Counting reversals
 * makes a gentle fast shake beat a wild slow one, and it equalises phones, since
 * peak magnitude varies with mass and case while a count does not.
 */
export const SHAKE_THRESHOLD = 14;
export const SHAKE_REFRACTORY_MS = 90;

/** How often a phone reports its count. Batched, not one message per shake. */
export const RUSH_TICK_MS = 150;

/** The server's own broadcast tick, ~10 Hz. */
export const RUSH_BROADCAST_MS = 100;

/**
 * The ceiling on a believable rate, in shakes per second.
 *
 * This is the real anti-cheat (spec §8) — a batch is clipped to what the elapsed
 * time could physically hold, so reporting 500 shakes in one frame advances you
 * by the same amount as shaking hard. It doubles as the safety rule: there is no
 * reward for shaking harder than is sensible.
 */
export const SHAKE_RATE_CAP = 8;

/**
 * The finish line, in shakes.
 *
 * A hundred: roughly twenty seconds of honest shaking, and the length the tune is cut to
 * — the song runs twice through in a hundred and eight notes, so a runner crossing the
 * line is eight notes from the end and hears those played for them (spec §5b).
 */
export const RUSH_DISTANCE = 100;

/** Derived from players.ts, so a card and its referee cannot disagree. */
export const RUSH_MIN_PLAYERS = PLAYERS['shake-rush'][0];
export const RUSH_MAX_PLAYERS = PLAYERS['shake-rush'][1];

/** Hard cap. Nobody wants a shake-off that never ends. */
export const RUSH_CAP_MS = 90_000;

/** No frames for this long and a runner is marked `away` and frozen (spec §7). */
export const RUSH_AWAY_MS = 3 * RUSH_TICK_MS;

/* ------------------------------------------------------------------ */
/* Ghost Hunt (docs/specs/games/ghost-hunt.md)                         */
/* ------------------------------------------------------------------ */

/**
 * How wide the radar sees, how far a ghost roams, and how long you must hold it.
 *
 * The radar is a **window**, not a crosshair: a ghost whose direction is within
 * `RADAR_FOV_DEG` of your aim is drawn inside the radar disc, at its own place in
 * there, and the hunt is keeping it in that disc for `GHOST_HOLD_MS` (spec §2).
 *
 * `GHOST_ROAM_DEG` is deliberately **larger than the radar's radius**. That one
 * inequality is the whole game: a ghost roams further than the radar can hold, so
 * a phone parked on the direction where the ghost started loses it, and following
 * a slow drift for four seconds is the skill being asked for. Make the roam
 * smaller than the radius and pointing once and standing still wins.
 */
export const RADAR_FOV_DEG = 20;
export const GHOST_HOLD_MS = 4_000;
export const GHOST_ROAM_DEG = 26;

/** How long the roam takes to come back on itself, for a player's FIRST ghost. */
export const GHOST_ROAM_MS = 11_000;

/**
 * And how much quicker it drifts for each ghost that player has already caught.
 *
 * The hunt gets harder as you win it. A first ghost drifts at the pace above; a player on
 * their fifth is tracking one moving nearly twice as fast, so the four-second hold that was
 * a matter of standing reasonably still becomes a matter of following.
 *
 * **This deliberately breaks the rule that everyone's ghost moves identically.** That rule
 * existed for fairness — a race where one player's ghost bolted while another's sat still
 * is not a race — and the fairness is preserved in the form that matters: the speed is a
 * pure function of *your own count*, so two players on their third ghost get exactly the
 * same path, and nobody is ever handed a harder ghost than someone else who has done as
 * well. What it stops is a runaway leader, which a fixed-length hunt otherwise rewards
 * twice over.
 *
 * Capped, because the roam has to stay slower than a player can follow: past about double
 * the ghost crosses the radar faster than the hold takes, and the game stops being winnable
 * rather than becoming hard.
 */
export const GHOST_SPEEDUP_PER_FIND = 0.18;
export const GHOST_SPEED_MAX = 2;

/**
 * Consecutive targets are never near each other, so a find always costs a
 * movement. Without it the sequence can put two ghosts a few degrees apart and
 * the second is free.
 *
 * It has to clear `RADAR_FOV_DEG + GHOST_ROAM_DEG` (46°) with room to spare, or a
 * ghost could roam into the radar of a phone that has not moved since the last
 * find and hand out a free point.
 */
export const TARGET_MIN_SEPARATION_DEG = 60;

/** Nothing at your feet, nothing behind your head — and see the safety note, §9. */
export const ELEVATION_MIN_DEG = -40;
export const ELEVATION_MAX_DEG = 70;

/**
 * The hunt is a hundred seconds long, and that is the whole rule.
 *
 * It was a race to five catches, with the clock as a backstop. Back to a window, and this
 * time with a score that makes the last seconds worth something — which was the objection
 * to a window the first time round. Under a bare count the closing seconds are dead: you
 * cannot finish a four-second hold, so nothing you do in them can change the result. Under
 * `HUNT_POINTS_PER_FIND` a late catch is still worth most of a hundred, and the player who
 * keeps hunting to the buzzer beats the one who stops.
 */
export const HUNT_ROUND_MS = 100_000;

/**
 * What a ghost is worth: a hundred, less the seconds it took to find it.
 *
 * One number instead of two facing opposite ways. The score used to be the *time* spent
 * searching, lowest wins, which is honest and awkward everywhere it is shown: a panel that
 * ranks low-is-good bolds whoever has played least, and a player with no catches has spent
 * no time, so their zero reads like a win. Points only go up.
 *
 * **The value is chosen against `HUNT_ROUND_MS`, not picked for roundness.** A whole ghost
 * has to outweigh any time difference, or a player who caught fewer could still come first:
 * with the hunt capped at 100 s, no total can span more than 100 s, so 100 points a ghost
 * makes "more catches" beat "quicker catches" every time — the exact ranking this game had
 * before, now expressed as one number. `ghost-hunt/game.test.ts` pins the inequality; if
 * the round ever grows past this, that test is the thing that fails.
 */
export const HUNT_POINTS_PER_FIND = 100;

/**
 * What the slowest possible catch is still worth.
 *
 * At the top of the round the arithmetic can reach zero — a ghost that took the entire 100 s
 * — and a catch worth nothing is indistinguishable from not catching it, which is wrong in
 * a game about catching them. The floor is small enough to keep a slow find clearly worse
 * and large enough to keep it clearly better than nothing.
 */
export const HUNT_POINTS_FLOOR = 5;

/**
 * The floor on a believable find, and the only thing the server can check.
 *
 * It cannot see where a phone is pointing, so a patched client could claim every
 * target instantly (spec §8). It can see the clock, and no honest find can beat
 * the hold.
 *
 * The floor sits just **under** `GHOST_HOLD_MS` rather than just over it. A ghost
 * can be inside the radar the moment it appears — the separation rule keeps its
 * *home* far away, but it roams — so the fastest honest find is the hold itself,
 * and a floor above it would reject the luckiest real player in the room.
 */
export const MIN_FIND_MS = GHOST_HOLD_MS - 200;

/** How often the room state goes out while a round runs. */
export const HUNT_TICK_MS = 500;

/** Derived from players.ts, so a card and its referee cannot disagree. */
export const HUNT_MIN_PLAYERS = PLAYERS['ghost-hunt'][0];
export const HUNT_MAX_PLAYERS = PLAYERS['ghost-hunt'][1];
