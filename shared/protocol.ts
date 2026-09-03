import { PLAYERS } from './players';
import type { FighterAction, FighterBeat, FighterSeat } from './tapFighter';

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
  /**
   * Marked by the player themselves in the lobby. It stays true across rounds, so a
   * replay does not ask everyone to press Ready again; a newly joined seat starts false.
   * The host's own flag is never checked — see `#onStart`'s gate in worker/Room.ts.
   */
  ready: boolean;
};

export type RoomSnapshot = {
  code: string;
  players: Player[];
  hostId: PlayerId | null;
};

export type TttState = {
  roundId: number;
  phase: 'choosing' | 'playing' | 'over';
  symbols: Record<PlayerId, 'x' | 'o'>;
  meta: Array<'x' | 'o' | 'draw' | null>;
  small: Array<'x' | 'o' | null>;
  selectedMeta: number | null;
  chooser: PlayerId | null;
  turn: PlayerId | null;
  miniWinner: 'x' | 'o' | 'draw' | null;
  winner: PlayerId | null;
  draw: boolean;
  startsAt: number;
  zoomAt: number;
  reopened: number[];
  reopenedAt: number;
  endsAt: number;
};

export type TapFighterState = {
  roundId: number;
  matchRound: number;
  phase: 'planning' | 'fighting' | 'round-over' | 'match-over';
  seats: Record<FighterSeat, PlayerId>;
  ready: Record<FighterSeat, boolean>;
  actions: Record<FighterSeat, FighterAction[]> | null;
  beats: FighterBeat[];
  roundWins: Record<FighterSeat, number>;
  startsAt: number;
  endsAt: number;
  roundWinner: FighterSeat | null;
  matchWinner: FighterSeat | null;
  draw: boolean;
  solo: boolean;
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
  /**
   * The lobby's ready toggle — a non-host player marking (or unmarking)
   * themselves ready. `#onStart` refuses to begin a round until every
   * connected non-host player has sent `ready: true`.
   */
  | { t: 'set-ready'; d: { ready: boolean } }
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
         * Neon Fall's seat picks: who is the glider, who is the protector.
         * Orthogonal to `mode`, same reasoning as `drag` above. Ignored by every
         * other game; falls back to array order if missing or malformed
         * (`assignRoles` in worker/neonFall.ts).
         */
        roles?: { glider: PlayerId; protector: PlayerId };
        /** Tic-Tac-Tic-Tac-Toe's fixed symbol assignment and first chooser. */
        symbols?: { x: PlayerId; o: PlayerId; chooser: PlayerId };
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
  | { t: 'squash-tap'; d: { roundId: number; position: number } }
  /**
   * Neon Fall: the glider's calibrated, filtered tilt (or tap-zone) intent,
   * −1..1. A velocity, not a position — the referee integrates it into an
   * actual lane every tick, at a speed only it knows, so a modified client
   * can ask to drift but never claim to already be somewhere safe (spec §8).
   */
  | { t: 'neon-steer'; d: { roundId: number; steer: number } }
  /** Neon Fall: the protector fired lane `lane`'s trigger. */
  | { t: 'neon-shoot'; d: { roundId: number; lane: number } }
  /**
   * Tap Tap Music: a finger landed on grid cell `cell`.
   *
   * A cell, not "the lit one" — the referee is the only thing that knows
   * whether this was this player's own lit cell (spec §8), the same
   * reasoning Squash Mosquitoes' `squash-tap` already established.
   */
  | { t: 'taptap-tap'; d: { roundId: number; cell: number } }
  /**
   * 100 Taps: a finger landed on grid cell `cell`.
   *
   * Same shape as `taptap-tap` — the referee is the only thing that knows
   * whether `cell` is the exact next number in this player's own count
   * (spec §8), even though the number printed on it is visible to everyone.
   */
  | { t: 'taps100-tap'; d: { roundId: number; cell: number } }
  /**
   * UFO Hunt: I fired at my own current aim, in degrees, against wave `roundId`
   * is currently on. The referee, not this message, decides what the shot was
   * worth: it recomputes the saucer's true position from the same deterministic
   * roam the client rendered with and scores the angle between (spec §8).
   */
  | { t: 'ufo-shoot'; d: { roundId: number; aimAz: number; aimEl: number } }
  /**
   * UFO Hunt: the missile launch, only sendable once `missileCharge` (spec §2.6)
   * has reached `UFOHUNT_MISSILE_CHARGE_GOAL` — the referee, not the button's own
   * disabled state, is what actually enforces that (spec §8). Same shape as
   * `ufo-shoot`: still an aimed shot, just a much heavier one.
   */
  | { t: 'ufo-missile'; d: { roundId: number; aimAz: number; aimEl: number } }
  /** Tic-Tac-Tic-Tac-Toe: choose the next unresolved meta board. */
  | { t: 'tttt-select'; d: { roundId: number; metaCell: number } }
  /** Tic-Tac-Tic-Tac-Toe: play a move in the selected small board. */
  | { t: 'tttt-tap'; d: { roundId: number; smallCell: number } }
  | { t: 'fighter-lock'; d: { roundId: number; actions: FighterAction[]; seat?: FighterSeat } }
  /**
   * Aliens love cows: my cow now wants barn `barn` (0..ABDUCT_BARN_COUNT-1).
   * Sendable any number of times while `phase` is `'waiting'` or `'countdown'`;
   * the referee only ever keeps the latest one it received before the reveal
   * (spec §8).
   */
  | { t: 'abduct-pick'; d: { roundId: number; round: number; barn: number } }
  /**
   * Tiles Surfer: my own current run, sent at a 100-point checkpoint or the
   * instant my own lives reach 0 — never per tap (spec §6, §8). Deliberately
   * the one message in this whole file the referee does not validate against
   * anything of its own: there is no tap, no lane, no tile on the wire at all
   * for it to check this against.
   */
  | {
      t: 'tiles-report';
      d: { roundId: number; score: number; lives: number; perfects: number; longestStreak: number; avgReactionMs: number };
    }
  /**
   * Gravity Shooter: this turn's shot, and its own claimed outcome. The
   * referee trusts `hit` as reported — it holds everything a verification
   * would need (the planets it rolled itself, plus `angle`/`strength`) but
   * deliberately does not re-derive it, by direct instruction (spec §8).
   */
  | { t: 'gravity-shot'; d: { roundId: number; angle: number; strength: number; hit: boolean } }
  | { t: 'switch-game'; d: { game: string; bring: boolean } };

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

/** Neon Fall: a shot in flight, up one lane. Resolved server-side at `resolvesAt`. */
export type NeonBolt = {
  lane: number;
  /** Server time it reaches the glider's lane — sent the instant it is fired, so
   *  both screens can telegraph it for its full flight (spec §4). */
  resolvesAt: number;
};

/**
 * Neon Fall: the whole round, small enough to send whole every tick (same call as
 * `GridState`/`SquashState`). `lane` and `y` are the referee's own simulation, never
 * a client-reported position (spec §8) — the glider's phone only ever sends a steer
 * intent (`neon-steer`).
 */
export type NeonFallState = {
  roundId: number;
  startsAt: number;
  /** The safety cap — a defensive backstop; the fall is bounded by construction. */
  endsAt: number;
  gliderId: PlayerId;
  protectorId: PlayerId;
  /** 0..4, continuous — a lane centre is an integer, but the glider can sit between them. */
  lane: number;
  /** 0 (top) .. 1 (floor). Reaching 1 is how the glider wins. */
  y: number;
  lives: number;
  /** Server time the glider stops blinking and becomes hittable again. 0 when not bouncing. */
  bounceUntil: number;
  /** One entry per lane (spec §2.2): the server time it next becomes available
   *  to fire, 0 (or already past) meaning ready now. No shared ammo pool. */
  laneReadyAt: number[];
  bolts: NeonBolt[];
  winner: PlayerId | null;
  phase: 'running' | 'done';
};

/**
 * Tap Tap Music: the shared, public half of the round.
 *
 * Same split as `SquashState`/`SquashBoard`: `order` and `remaining` are
 * public — a shuffle everyone raced through, and a count, never which
 * cells — and each player's own cleared history arrives separately as
 * `taptap-progress`, to that player alone (spec §6).
 */
export type TapTapState = {
  roundId: number;
  startsAt: number;
  /** The safety cap — a defensive backstop for a round nobody finishes. */
  endsAt: number;
  /** The 100 grid cells, in lit-up order. Identical for every player. */
  order: number[];
  /** Cells not yet cleared, per player — 100 minus their own cleared count. */
  remaining: Record<PlayerId, number>;
  /** Server time each player finished, or null while still racing. */
  finishedAt: Record<PlayerId, number | null>;
  winner: PlayerId | null;
  phase: 'running' | 'done';
};

/**
 * The next `TAPTAP_WINDOW_SIZE` cells a player may correctly tap right now —
 * the earliest entries of `order` this player has not yet cleared, in order.
 *
 * Pure and shared between the referee (which decides whether a tap is
 * correct) and the client (which draws these as lit): both must compute the
 * identical window from the same two public/private facts — `order` and
 * this player's own `cleared` history — or a tap that looks correct on
 * screen could be refused by the referee, and vice versa.
 */
export function taptapWindow(order: readonly number[], cleared: readonly number[]): number[] {
  const done = new Set(cleared);
  const win: number[] = [];
  for (const cell of order) {
    if (done.has(cell)) continue;
    win.push(cell);
    if (win.length >= TAPTAP_WINDOW_SIZE) break;
  }
  return win;
}

/**
 * 100 Taps: the shared, public half of the round.
 *
 * Same shape as `TapTapState`, and reused on purpose (docs/specs/games/100-taps.md
 * §2.1): one shared `order`, dealt once, everyone's own progress a private cleared
 * count. What differs is what `order` MEANS here — cell `order[k]` carries the
 * printed number `k + 1` — and that nothing about it needs to stay implicit: every
 * number is already visible on screen, so there is no "lit window" to compute or
 * share, only which cells are gone.
 */
export type Taps100State = {
  roundId: number;
  startsAt: number;
  /** The safety cap — a defensive backstop for a round nobody finishes. */
  endsAt: number;
  /** Cell `order[k]` shows the printed number `k + 1`. Identical for every player. */
  order: number[];
  /** Cells not yet cleared, per player — 100 minus their own cleared count. */
  remaining: Record<PlayerId, number>;
  /** Server time each player finished, or null while still racing. */
  finishedAt: Record<PlayerId, number | null>;
  winner: PlayerId | null;
  phase: 'running' | 'done';
};

/**
 * UFO Hunt: one saucer, everyone's shared target (docs/specs/games/ufo-hunt.md §2).
 *
 * `homeAz`/`homeEl` plus `spawnedAt` are everything a client needs to compute the
 * saucer's own current position for itself — the same pure roam function the
 * referee uses to score a shot (spec §2.2, §8), so nothing about "where the
 * saucer actually is right now" is ever sent frame by frame.
 */
export type UfoWave = {
  /** 0 for the first saucer, incrementing on every kill — also what sets `maxHealth`. */
  index: number;
  /** Which of `UFOHUNT_KIND_COUNT` visual variants this saucer is. Decorative only. */
  kind: number;
  maxHealth: number;
  health: number;
  /** Degrees, relative to each player's OWN calibrated forward — Ghost Hunt's own convention. */
  homeAz: number;
  homeEl: number;
  /** Server time this wave spawned — the clock the roam is measured from. */
  spawnedAt: number;
};

/**
 * UFO Hunt: the shared, public round. Everyone shoots at the SAME saucer, so
 * unlike `Taps100State`/`TapTapState` above there is no private half to split off —
 * `scores` is the whole game (spec §6).
 */
export type UfoHuntState = {
  roundId: number;
  startsAt: number;
  /** The safety cap — a defensive backstop for a round nobody finishes. */
  endsAt: number;
  wave: UfoWave;
  /** Running sum of each player's own shot damage. The score. */
  scores: Record<PlayerId, number>;
  /**
   * Each player's own missile charge, 0…`UFOHUNT_MISSILE_CHARGE_GOAL` — one full
   * charge per landed ordinary shot (spec §2.6), reset to 0 the instant a missile
   * fires. Server-owned, same as `scores`: the missile button's own fill is read
   * straight off this rather than the client counting its own hits, so a
   * modified client cannot fire early.
   */
  missileCharge: Record<PlayerId, number>;
  winner: PlayerId | null;
  phase: 'running' | 'done';
};

/**
 * Aliens love cows: one barn's own state this round. `destroyed` turns true the
 * instant its round resolves — the UFO's own target, cows caught there or
 * not (spec §2.1) — and stays that way for the rest of the match. The match
 * itself never lets every barn go: the moment only one is left standing, the
 * UFO flees instead of drawing a round from it (spec §2, §8).
 */
export type AbductBarn = {
  destroyed: boolean;
};

/**
 * Aliens love cows: the whole match, fully public. Unlike every other game with a
 * "who picked what" mechanic, there is no private half at all here — a
 * player's own barn pick is something everyone else is explicitly meant to
 * see live (spec §6), so this is the entire wire protocol for the game.
 */
export type AbductState = {
  roundId: number;
  /** The match's own round counter, not the room's `roundId` — no fixed cap
   *  any more (spec §2): rounds repeat until one cow is left standing. */
  round: number;
  /**
   * `waiting` — barns open, tap one any time. `countdown` — everyone has a
   * barn (by choice or by the deadline's own random assignment) and the
   * final "3, 2, 1" is playing before the UFO commits. `revealing` — the
   * outcome is already decided; only the choreography is left to play.
   * `fleeing` — only one barn is left standing, so the UFO gives up and
   * leaves rather than force everyone onto the one barn left to dodge to
   * (spec §2, §7); the match ends the moment it is gone.
   */
  phase: 'waiting' | 'countdown' | 'revealing' | 'fleeing' | 'done';
  /** Server time the current phase ends. */
  deadlineAt: number;
  /**
   * Always ABDUCT_BARN_COUNT entries. A destroyed barn stays destroyed for the
   * rest of the match (spec §2.1) — this does NOT reset between rounds, and
   * never reaches every barn destroyed: the UFO flees once only one is left.
   */
  barns: AbductBarn[];
  /** Every connected, still-in player's current barn, or null before their
   *  first tap this round. */
  picks: Record<PlayerId, number | null>;
  /** The UFO's drawn target this round — null until that round's reveal. */
  target: number | null;
  /** This round's victims — [] until reveal, holds until the next round resets it. */
  abducted: PlayerId[];
  /** Every player ever abducted, across the whole match — permanently out
   *  (spec §2.2): once here, always here. */
  out: PlayerId[];
  /** +1 per round a player was connected, still in, and not abducted. */
  scores: Record<PlayerId, number>;
  /** Set only once `phase` is `'done'` — the sole player left in, or null if
   *  the last two went together, or the UFO fled instead (spec §7). */
  winner: PlayerId | null;
};

/**
 * Tiles Surfer: one player's own last-reported run (spec §6). Everything here
 * is exactly what a `tiles-report` claims — the referee stores it, clamped to
 * sane ranges, and never checks it against anything of its own (spec §8: this
 * game has no anti-cheat, by direct instruction).
 */
export type TilesSurferRun = {
  score: number;
  lives: number;
  perfects: number;
  longestStreak: number;
  /** Mean offset (ms) across every non-miss tap — a genuine reaction-time
   *  number, reported as-is rather than derived, since the referee never
   *  sees the raw per-tap history this would otherwise come from. */
  avgReactionMs: number;
};

/**
 * Tiles Surfer: the whole match, fully public — every player's own board runs
 * entirely on their own phone (spec §2), so there is nothing here that is
 * private to begin with, the same shape Aliens Love Cows' own state already
 * is for the same reason.
 */
export type TilesSurferState = {
  roundId: number;
  startsAt: number;
  /** The safety cap — a defensive backstop for a run nobody's own lives end (spec §7). */
  endsAt: number;
  /** Each player's own last-reported run. Absent until their first report. */
  scores: Record<PlayerId, TilesSurferRun>;
  winner: PlayerId | null;
  phase: 'running' | 'done';
};

/** Gravity Shooter: one of the two planets between the ships (spec §2.1).
 *  Rolled once by the referee at round start and never touched again. */
export type GravityPlanet = {
  /** World-normalized coordinates, shared by both viewers and the referee —
   *  the per-seat flip (spec §2.2) happens only at render time. */
  x: number;
  y: number;
  /** World-normalized radius, mapped from the spec's 20-100px range. */
  r: number;
  /** Which of the ~3 planet PNGs to draw. Decorative only. */
  art: number;
};

/** Gravity Shooter: the last shot fired, for the non-shooting client's own
 *  cosmetic replay (spec §2.3) — `hit` is trusted as reported (spec §8),
 *  never re-derived from this replay. `shooter` is a seat, not a player id
 *  (see `GravityShooterState.turn`) — solo mode puts the same player id in
 *  both `seats`, so only the seat says which ship actually fired. */
export type GravityShot = {
  shooter: 0 | 1;
  angle: number;
  strength: number;
  hit: boolean;
};

/**
 * Gravity Shooter: the whole match, fully public — both ships and both
 * planets are always visible to both players, so there is nothing here
 * private to begin with (spec §6).
 */
export type GravityShooterState = {
  roundId: number;
  startsAt: number;
  /**
   * Which player's ship sits at which end of the shared canonical board
   * (spec §2.2) — `seats[0]` at world `y = 1`, `seats[1]` at world `y = 0`.
   * Fixed for the whole match, so both clients' render-time flip and every
   * shot's own simulation agree on the same two fixed points without this
   * having to be re-derived from object key order or anything else implicit.
   *
   * In solo mode (`solo: true`) both entries are the same player id — the
   * one connected player takes both seats in turn — which is exactly why
   * every other per-side field below (`lives`, `turn`, `GravityShot.shooter`,
   * `winner`) is keyed by SEAT rather than by this id: a player id cannot
   * tell the two ships apart when there is only one of it.
   */
  seats: [PlayerId, PlayerId];
  /**
   * Rolled at round start and re-rolled every `GRAVITY_SHOTS_PER_MAP` resolved
   * shots (spec §2.1) — so the board both players are aiming at changes once
   * each of them has had a turn on it, never mid-exchange. The re-roll rides
   * the same frame that reports the shot which triggered it, which is why a
   * client replaying `lastShot` has to simulate against the planets it was
   * already showing rather than these (`game.ts`'s own `apply`).
   */
  planets: [GravityPlanet, GravityPlanet];
  /** Resolved shots so far, timeouts included — what the planet re-roll counts. */
  shots: number;
  lives: [number, number];
  turn: 0 | 1;
  /** Deadline for the current turn's `gravity-shot` — a silent shooter is
   *  resolved as a miss here rather than stalling the match (spec §2.4). */
  resolvesAt: number;
  lastShot: GravityShot | null;
  winner: 0 | 1 | null;
  phase: 'running' | 'done';
  /** One connected player takes both seats, alternating turns on one phone
   *  (`docs/specs/backoffice.md` §6) — same idiom as Tap Fighter's own. */
  solo: boolean;
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
  /** Neon Fall: the whole round, every tick. Late frames with a lower `s` are dropped. */
  | { t: 'neon'; s: number; d: NeonFallState }
  /** Tap Tap Music: the shared state — order, everyone's remaining count, phase, winner. */
  | { t: 'taptap'; s: number; d: TapTapState }
  /** 100 Taps: the shared state — the number-to-cell layout, remaining counts, phase, winner. */
  | { t: 'taps100'; s: number; d: Taps100State }
  /** UFO Hunt: the shared saucer and everyone's score. */
  | { t: 'ufo-hunt'; s: number; d: UfoHuntState }
  | { t: 'tttt'; s: number; d: TttState }
  | { t: 'fighter'; s: number; d: TapFighterState }
  /** Aliens love cows: the whole match — fully public, spec §6. */
  | { t: 'abduct'; s: number; d: AbductState }
  /** Tiles Surfer: everyone's last-reported numbers, fully public — spec §6. */
  | { t: 'tiles'; s: number; d: TilesSurferState }
  /** Gravity Shooter: the whole match — planets, lives, turn, phase, winner. */
  | { t: 'gravity'; s: number; d: GravityShooterState }
  | { t: 'room-redirect'; s: number; d: { code: string; game: string } }
  /**
   * Tap Tap Music: sent to **one player only** — their own cleared
   * cells, in the order they actually tapped them (spec §2, §6).
   *
   * A shrink from the last one sent IS the "you missed" signal — there is
   * no separate message for it, the same way Squash Mosquitoes has none for
   * a mosquito that was already squashed. `taptapWindow(order, cleared)`
   * derives the up-to-`TAPTAP_WINDOW_SIZE` lit cells from this and the
   * public `order` — nothing here says which cells are lit, only which are
   * already gone.
   */
  | { t: 'taptap-progress'; s: number; d: { roundId: number; cleared: number[] } }
  /**
   * 100 Taps: sent to **one player only** — their own cleared cells, in the
   * order they actually tapped them (spec §2, §6). Same shape as
   * `taptap-progress`; a shrink is the "you missed" signal here too.
   */
  | { t: 'taps100-progress'; s: number; d: { roundId: number; cleared: number[] } }
  /** Tic-Tac-Tic-Tac-Toe: the authoritative nested-board state. */
  | { t: 'tttt'; s: number; d: TttState }
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
export const FIRE_MIN_MS = 3_000;
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
export const DRIFT_SPEED_START = 0.8;
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

/** Mosquito **N** (1-indexed) in the pattern flies once N reaches this. */
export const SQUASH_STATIC_COUNT = 33;

/** The flying motion's hitbox fraction; visual size is rolled independently on each phone. */
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
  'set-ready',
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
  'neon-steer',
  'neon-shoot',
  'taptap-tap',
  'taps100-tap',
  'ufo-shoot',
  'ufo-missile',
  'tttt-select',
  'tttt-tap',
  'fighter-lock',
  'abduct-pick',
  'tiles-report',
  'gravity-shot',
  'switch-game',
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
export const RUSH_TICK_MS = 250;

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

/* ------------------------------------------------------------------ */
/* Neon Fall (docs/specs/games/neon-fall.md)                           */
/* ------------------------------------------------------------------ */

/** The five lanes the glider drifts across. Fixed by the pitch. */
export const NEON_LANES = 5;

/** The referee's own simulation tick — also the ≤ 20 Hz cap device-capabilities.md
 *  §4 puts on transmitting tilt, so a phone reporting at its limit still lines up
 *  with a broadcast. */
export const NEON_TICK_MS = 50;

/**
 * How fast the glider's lane position moves toward full steer, in lanes/second.
 *
 * A guess (spec §12): fast enough that tilting reads as smooth drifting, slow
 * enough that the five lanes stay legible rather than a blur. Needs a playtest.
 */
export const NEON_LANE_SPEED = 6;

/**
 * How strongly the glider is pulled toward the centre of whichever lane it is
 * currently closest to, in lanes/second per lane of offset — a spring, not a
 * fixed speed, so it settles into the lane rather than overshooting and
 * oscillating around it (spec §2.4). Overridden outright whenever `steer`
 * points toward a *different* lane past `NEON_STEER_DEADZONE`, which is what
 * lets a deliberate tilt actually cross a lane rather than being held back by
 * its own starting lane's pull. A guess (spec §12), needs a playtest.
 */
export const NEON_LANE_MAGNET_GAIN = 4;

/** Steer this small or smaller does not count as "pulling toward a different
 *  lane" (spec §2.4) — sensor noise near neutral must not cancel the magnet
 *  pull that centres an idle glider. */
export const NEON_STEER_DEADZONE = 0.15;

/**
 * Fall progress per second, 0 (top) .. 1 (floor). A guess (spec §12) tuned so a
 * hitless fall takes roughly 20 s — comfortably inside the round-length band in
 * AGENTS.md §4 even with a few bounces added on top.
 */
export const NEON_FALL_SPEED = 1 / 20;

export const NEON_LIVES = 3;

/** Every lane fires independently — no shared ammo pool (spec §2.2). A shot
 *  from lane N only ever waits on lane N's own cooldown. A guess (spec §12),
 *  "short" per the pitch, needs a playtest. */
export const NEON_LANE_COOLDOWN_MS = 1_000;

/** How many bolts may be in flight at once, across all five lanes combined —
 *  the real limiter now that each lane cools down on its own (spec §2.2):
 *  without it, five lanes firing on independent 1s cooldowns could keep the
 *  sky permanently full of bolts. */
export const NEON_MAX_BOLTS = 4;

/**
 * How long a fired bolt takes to reach the glider's lane.
 *
 * This is the real balance lever (spec §12): it is the glider's whole reaction
 * window to juke, telegraphed from the instant the bolt is fired. Too short and
 * dodging is unfair; too long and a protector who is paying attention cannot
 * land a shot. Raised from an initial 350 ms — that read as nearly instant, no
 * real dodge window at all. A guess even at this value, needs a playtest.
 */
export const NEON_BOLT_MS = 900;

export const NEON_BOUNCE_MS = 1_500;

/**
 * How long the glider's death explosion holds the screen before the results
 * panel replaces it (spec §4) — client-side only, timed from the instant a
 * phone first sees the fatal hit, the same way Pass the Bomb's own
 * `BOOM_MS` holds the round screen through its explosion.
 */
export const NEON_EXPLOSION_MS = 900;

/** How much fall progress a hit gives back — "a bit higher" per the pitch. A
 *  guess (spec §12). */
export const NEON_BOUNCE_RISE = 0.15;

/**
 * Defensive backstop, not the real ending. The fall is bounded by construction —
 * `NEON_LIVES` hits can only claw back `NEON_LIVES × NEON_BOUNCE_RISE` of
 * progress — so this only fires if the constants above are ever tuned into a
 * pathological corner. The glider survived to the cap, so the glider wins.
 */
export const NEON_ROUND_CAP_MS = 90_000;

/** Derived from players.ts, so a card and its referee cannot disagree. */
export const NEON_MIN_PLAYERS = PLAYERS['neon-fall'][0];
export const NEON_MAX_PLAYERS = PLAYERS['neon-fall'][1];

/* ------------------------------------------------------------------ */
/* Tap Tap Music (docs/specs/games/tap-tap-music.md)                    */
/* ------------------------------------------------------------------ */

/** The board: a 10×10 grid, a hundred cells, every one of them lit exactly once a round. */
export const TAPTAP_GRID_SIZE = 10;
export const TAPTAP_TOTAL = TAPTAP_GRID_SIZE * TAPTAP_GRID_SIZE;

/**
 * How many cells are live at once — tappable in any order, not just the
 * next one in `order`. `taptapWindow` below is what turns this number and
 * a player's own cleared history into the actual set of lit cells.
 */
export const TAPTAP_WINDOW_SIZE = 5;

/**
 * A wrong tap rewinds to the last completed multiple of this, not to zero.
 *
 * `TAPTAP_TOTAL` divides evenly by it on purpose — ten checkpoints, ten
 * cells apart, so the last one lands exactly on the 100th cell rather than
 * leaving an odd-sized final stretch (spec §2.2).
 */
export const TAPTAP_CHECKPOINT = 10;

/** Defensive backstop — ranked by cells remaining if nobody finishes in time. */
export const TAPTAP_ROUND_CAP_MS = 3 * 60_000;

/** Derived from players.ts, so a card and its referee cannot disagree. */
export const TAPTAP_MIN_PLAYERS = PLAYERS['tap-tap-music'][0];
export const TAPTAP_MAX_PLAYERS = PLAYERS['tap-tap-music'][1];

/* ------------------------------------------------------------------ */
/* 100 Taps (docs/specs/games/100-taps.md)                              */
/* ------------------------------------------------------------------ */

/**
 * The board: a hundred cells, every one of them numbered exactly once a round.
 *
 * Not a square grid — the physical layout (six cells, centred, top and bottom,
 * eight across for the eleven rows between) is a client-only presentation
 * concern, `TAPS100_ROW_COUNTS` in `www/src/games/hundred-taps/game.ts`. The
 * referee only ever deals with a flat `order` of `TAPS100_TOTAL` positions —
 * it does not know or care what shape they are drawn in.
 */
export const TAPS100_TOTAL = 100;

/**
 * A wrong tap rewinds to the last completed multiple of this, not to zero.
 * Same value, same reasoning as `TAPTAP_CHECKPOINT` (spec §2.2): it divides
 * `TAPS100_TOTAL` evenly, so the last checkpoint lands exactly on the 100th cell.
 */
export const TAPS100_CHECKPOINT = 10;

/** Defensive backstop — ranked by cells remaining if nobody finishes in time. */
export const TAPS100_ROUND_CAP_MS = 3 * 60_000;

/** Derived from players.ts, so a card and its referee cannot disagree. */
export const TAPS100_MIN_PLAYERS = PLAYERS['hundred-taps'][0];
export const TAPS100_MAX_PLAYERS = PLAYERS['hundred-taps'][1];

/* ------------------------------------------------------------------ */
/* UFO Hunt (docs/specs/games/ufo-hunt.md)                              */
/* ------------------------------------------------------------------ */

/**
 * How wide the scope sees, and how far the saucer roams.
 *
 * Unlike Ghost Hunt's radar, `UFOHUNT_SCOPE_DEG` is not just a visibility window —
 * it is also the denominator of the damage formula (`ufoImpact` below): a shot at
 * or beyond it scores zero, and everything inside interpolates linearly to a
 * dead-centre 10 (spec §2.2). `UFOHUNT_ROAM_DEG`/`_MS` are this game's own
 * constants, independently tunable from Ghost Hunt's `GHOST_ROAM_DEG`/`_MS` even
 * though the roam shape (`ufoPositionAt` below) is the same idea.
 */
export const UFOHUNT_SCOPE_DEG = 20;
export const UFOHUNT_ROAM_DEG = 18;
export const UFOHUNT_ROAM_MS = 9_000;

/** A first saucer's health, and how much tougher each one after it is. */
export const UFOHUNT_BASE_HEALTH = 50;
export const UFOHUNT_HEALTH_STEP = 50;

/**
 * How many visual variants a saucer's `kind` is drawn from. Decorative only —
 * `art/ufo.svg` recolours the same shape by a CSS variable keyed on it.
 */
export const UFOHUNT_KIND_COUNT = 4;

/** Nothing at your feet, nothing behind your head — same reasoning as Ghost Hunt's own (spec §9). */
export const UFOHUNT_ELEVATION_MIN_DEG = -30;
export const UFOHUNT_ELEVATION_MAX_DEG = 60;

/**
 * The missile: a heavier shot, earned rather than always available (spec §2.6).
 *
 * `UFOHUNT_MISSILE_CHARGE_GOAL` landed ordinary shots (`ufoImpact(offset) > 0`,
 * spec §2.2) fill it; firing consumes the whole charge regardless of whether the
 * missile itself lands. Unlike an ordinary shot, a missile that lands within
 * `UFOHUNT_SCOPE_DEG` does not interpolate by precision — it always removes
 * `UFOHUNT_MISSILE_DAMAGE_FRACTION` of the wave's own `maxHealth`, a flat
 * fraction of THIS saucer's toughness rather than a fixed number, so it stays
 * meaningful against a later, tougher wave instead of trailing off.
 */
export const UFOHUNT_MISSILE_CHARGE_GOAL = 10;
export const UFOHUNT_MISSILE_DAMAGE_FRACTION = 1 / 3;

/**
 * The floor between two shots from the same player — "the blaster recharges"
 * (spec §2, §8). The one rate-limit standing in for verifying a phone's real
 * orientation reading, which the referee has no way to do (spec §8).
 */
export const UFOHUNT_SHOT_COOLDOWN_MS = 200;

/** Defensive backstop — ranked by score if nobody's cleared enough waves by then. */
export const UFOHUNT_ROUND_CAP_MS = 120_000;

/** How often the room state goes out while a round runs. */
export const UFOHUNT_TICK_MS = 500;

/** Derived from players.ts, so a card and its referee cannot disagree. */
export const UFOHUNT_MIN_PLAYERS = PLAYERS['ufo-hunt'][0];
export const UFOHUNT_MAX_PLAYERS = PLAYERS['ufo-hunt'][1];

const UFO_DEG = Math.PI / 180;

/**
 * Fold an angle in degrees into −180…180.
 *
 * A byte-for-byte duplicate of `core/sensors/orientation.ts`'s own `wrapDeg`,
 * kept here instead of imported: that module reaches for `DeviceOrientationEvent`
 * and `window` at module scope, so importing even one pure function from it would
 * pull DOM types into a file that has to typecheck under `tsconfig.worker.json`
 * (no `dom` lib) as well as the browser's. Same reasoning as `worker/ghostHunt.ts`'s
 * own `separation()` — six lines of trigonometry is the cheaper duplication.
 */
function ufoWrapDeg(deg: number): number {
  const w = (((deg + 180) % 360) + 360) % 360;
  return w - 180;
}

/**
 * The angle between two directions on the sphere, in degrees. Spherical law of
 * cosines, same formula and same reasoning as `angleBetween` above.
 */
export function ufoAngleBetween(
  a: { azimuth: number; elevation: number },
  b: { azimuth: number; elevation: number },
): number {
  const e1 = a.elevation * UFO_DEG;
  const e2 = b.elevation * UFO_DEG;
  const dAz = ufoWrapDeg(a.azimuth - b.azimuth) * UFO_DEG;
  const cos = Math.sin(e1) * Math.sin(e2) + Math.cos(e1) * Math.cos(e2) * Math.cos(dAz);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / UFO_DEG;
}

/**
 * Where the saucer is, `ageMs` after this wave spawned.
 *
 * The same bounded-wander shape as Ghost Hunt's own `ghostAt` (`radar.ts`) — two
 * sine terms at incommensurable periods, phased by the wave's own `index` so
 * consecutive saucers never drift identically, azimuth corrected by
 * `cos(elevation)` so a degree of azimuth is not a smaller excursion up near the
 * top of the band. No `speed` term: unlike Ghost Hunt's ghost, nothing here
 * escalates the roam itself — only the health does (spec §2.1).
 *
 * A pure function of its inputs, exported from `shared/` rather than duplicated
 * into the worker and the client separately, because — unlike Ghost Hunt, which
 * never scores on aim at all — both sides here MUST agree on exactly where the
 * saucer is: the client renders it here, and the referee scores a shot against
 * this same position (spec §8). One shared copy is the only way they can't drift
 * apart from each other, the same job `taptapWindow` above already does for Tap
 * Tap Music's shared window.
 */
export function ufoPositionAt(
  homeAz: number,
  homeEl: number,
  index: number,
  ageMs: number,
): { azimuth: number; elevation: number } {
  const t = (ageMs / UFOHUNT_ROAM_MS) * 2 * Math.PI;
  const phase = index * 1.7;

  const u = Math.sin(t + phase);
  const v = Math.sin(t * 0.61 + phase * 2.3);

  const elevation = homeEl + v * UFOHUNT_ROAM_DEG * 0.6;
  const shrink = Math.max(0.25, Math.cos(elevation * UFO_DEG));

  return {
    azimuth: ufoWrapDeg(homeAz + (u * UFOHUNT_ROAM_DEG * 0.8) / shrink),
    elevation,
  };
}

/**
 * A shot's damage: `10` dead-centre, linear down to `0` at or beyond
 * `UFOHUNT_SCOPE_DEG` (spec §2.2). The one formula both the brief's "10 to 0",
 * "every perfect shot removes 10" and "out of scope shot is 0" all describe.
 */
export function ufoImpact(offsetDeg: number): number {
  return Math.min(10, Math.max(0, 10 * (1 - offsetDeg / UFOHUNT_SCOPE_DEG)));
}

/**
 * A missile's damage against a wave of `maxHealth`: 0 if the aim is beyond
 * `UFOHUNT_SCOPE_DEG` (same landing test as an ordinary shot), otherwise a flat
 * `UFOHUNT_MISSILE_DAMAGE_FRACTION` of that wave's own toughness regardless of
 * how close to dead-centre it landed — a missile does not reward precision the
 * way `ufoImpact` does, only landing it at all (spec §2.6).
 */
export function ufoMissileImpact(offsetDeg: number, maxHealth: number): number {
  return offsetDeg <= UFOHUNT_SCOPE_DEG ? maxHealth * UFOHUNT_MISSILE_DAMAGE_FRACTION : 0;
}

/* ------------------------------------------------------------------ */
/* Aliens love cows (docs/specs/games/aliens-love-cows.md)             */
/* ------------------------------------------------------------------ */

/** Barns across the middle of the screen, evenly spaced. */
export const ABDUCT_BARN_COUNT = 5;

/**
 * `waiting`'s own cap — the longest any barn stays open before the deadline
 * assigns a random one to anyone who never tapped (spec §2, §7). Ends early,
 * for everyone at once, the moment every connected, still-in player has a
 * barn of their own — the deadline is a ceiling, not a fixed wait.
 */
export const ABDUCT_WAIT_MS = 5_000;

/**
 * The final "3, 2, 1" once everyone has a barn (spec §2) — a beat of pure
 * tension before the UFO commits; nothing about the outcome changes here.
 */
export const ABDUCT_COUNTDOWN_MS = 3_000;

/**
 * How long the UFO's fly-in, light cone and abduction get to play out before the
 * next round's `waiting` phase opens. The referee has already decided everything
 * by the time this starts (spec §2, §8) — this window is pure presentation.
 *
 * Budgeted for the client's own choreography (spec §4): ~2 s hovering fast over
 * the whole row, ~0.7 s flying in to the target at low altitude, then however
 * long a staggered, one-by-one abduction of everyone caught there takes.
 */
export const ABDUCT_REVEAL_MS = 5_000;

/**
 * How long the UFO's own farewell gets to play before the match ends
 * (spec §2, §7) — triggered once only one barn is left standing, rather
 * than ever forcing everyone onto it.
 */
export const ABDUCT_FLEE_MS = 2_000;

/** Derived from players.ts, so a card and its referee cannot disagree. */
export const ABDUCT_MIN_PLAYERS = PLAYERS['aliens-love-cows'][0];
export const ABDUCT_MAX_PLAYERS = PLAYERS['aliens-love-cows'][1];

/* ------------------------------------------------------------------ */
/* Tiles Surfer (docs/specs/games/tiles-surfer.md)                      */
/* ------------------------------------------------------------------ */

/** Five lives, and how many lanes the board is split into. */
export const TILES_LIVES = 5;
export const TILES_TRACK_COUNT = 5;

/** Top-to-line time at the very start of a run (spec §2). */
export const TILES_INITIAL_FALL_MS = 2_000;

/**
 * The one thing that actually evolves: a multiplier on the base speed above,
 * not a duration (spec §2.3) — `fallMs = TILES_INITIAL_FALL_MS / speedMul`.
 * `SPEEDUP` on a landed tap, `MISS_MUL` (floored at the round's own starting
 * speed, never below it) on a miss.
 */
export const TILES_SPEEDUP_MUL = 1.02;
export const TILES_MISS_MUL = 0.8;

/** A tile is 1 lane-width wide, 2 lane-widths tall (spec §2.2, §4). */
export const TILES_HEIGHT_TRACKS = 2;

/** The line a tile has to be tapped against: half way down the screen, not a
 *  fixed pixel offset — it has to scale with the board (spec §2). */
export const TILES_LINE_FRACTION = 1 / 2;

/** A new tile every this many ms, regardless of the current fall speed
 *  (spec §12 — a stated default, not a number the brief itself gave). */
export const TILES_SPAWN_INTERVAL_MS = 600;

/** A `tiles-report` goes out every this many points, or the moment a
 *  player's own lives reach 0 (spec §6) — never per tap. */
export const TILES_REPORT_EVERY = 100;

/** Defensive backstop — ranked by score among whoever is still alive if
 *  nobody's own lives have run out by then (spec §7, §12). */
export const TILES_ROUND_CAP_MS = 5 * 60_000;

/** Derived from players.ts, so a card and its referee cannot disagree. */
export const TILES_MIN_PLAYERS = PLAYERS['tiles-surfer'][0];
export const TILES_MAX_PLAYERS = PLAYERS['tiles-surfer'][1];

/* ------------------------------------------------------------------ */
/* Gravity Shooter (docs/specs/games/gravity-shooter.md)                */
/* ------------------------------------------------------------------ */

export const GRAVITY_LIVES = 5;

/** Middle band a planet's own `y` is rolled into, so both sit between the
 *  two ships rather than crowding either one (spec §2.1). */
export const GRAVITY_PLANET_Y_MIN = 0.3;
export const GRAVITY_PLANET_Y_MAX = 0.7;
/** Edge margin a planet's own `x` is rolled into. */
export const GRAVITY_PLANET_X_MARGIN = 0.15;

/** The brief's 20-100px, mapped onto world-normalized radius via a fixed
 *  reference board width (spec §2.1) — mirrors Sling Puck's own board-unit
 *  normalization rather than assuming a screen size. */
export const GRAVITY_REFERENCE_BOARD_PX = 400;
export const GRAVITY_PLANET_R_MIN = 20 / GRAVITY_REFERENCE_BOARD_PX;
export const GRAVITY_PLANET_R_MAX = 100 / GRAVITY_REFERENCE_BOARD_PX;

/**
 * How different the two planets' own radii must be, as a fraction of the
 * larger one (issue #16) — two near-identical planets read as one shape
 * drawn twice, not two different things to curve a shot around.
 */
export const GRAVITY_PLANET_MIN_SIZE_DIFF_RATIO = 0.3;

/**
 * How far apart the two planets' own SURFACES must land — centre distance
 * minus both radii — never their centres alone (issue #16): two big planets
 * can have far-apart centres and still touch. Same px-then-normalized shape
 * as the radius range above.
 */
export const GRAVITY_PLANET_MIN_GAP_PX = 50;
export const GRAVITY_PLANET_MIN_GAP = GRAVITY_PLANET_MIN_GAP_PX / GRAVITY_REFERENCE_BOARD_PX;

/**
 * How far apart the two planets' own centres must sit vertically (issue
 * #16) — otherwise they can land on the same horizontal band and read as
 * one wide obstacle rather than two separate things to route between.
 */
export const GRAVITY_PLANET_MIN_Y_DIFF_PX = 100;
export const GRAVITY_PLANET_MIN_Y_DIFF = GRAVITY_PLANET_MIN_Y_DIFF_PX / GRAVITY_REFERENCE_BOARD_PX;

/** How many pre-made planet PNGs `GravityPlanet.art` may index into. */
export const GRAVITY_PLANET_ART_COUNT = 3;

/**
 * How many resolved shots a set of planets lasts before the referee rolls a
 * fresh board (spec §2.1). Two means one shot apiece: the board changes only
 * once BOTH players have aimed at it, so nobody inherits a map their opponent
 * already had a free look at. Timeouts count — a turn that expired is still
 * that seat's shot spent.
 */
export const GRAVITY_SHOTS_PER_MAP = 2;

/**
 * How far a planet's own gravity is required to reach, as a multiple of its
 * own radius — the rule that rules out a "dead zone" a shot could cross
 * along the centre line without either planet mattering to it (follow-up
 * after issue #16). The gravity model (`GRAVITY_G * r² / max(dist², r²)`)
 * gives acceleration `G / k²` at distance `k * r` from ANY planet, regardless
 * of its own size — a size-invariant way to say "still significant here".
 * `k = 2` (a quarter of peak pull) is that follow-up's own untested pick
 * (spec §12). Since both ships sit on the board's own centre line (`x =
 * 0.5`, spec §2.2), requiring `|0.5 - planet.x| <= k * planet.r` for BOTH
 * planets independently is a complete fix, not a partial one: it puts each
 * planet's own influence zone in contact with the centre line, so their
 * union has no gap for a straight shot to slip through anywhere between them.
 */
export const GRAVITY_PLANET_INFLUENCE_RADIUS_FACTOR = 2;

/**
 * How far a ship sits from its own edge of the shared board (spec §2.2), in
 * world units — the one board-geometry fact both the client (drawing the
 * ship, aiming from it, simulating a shot's start/target point) and the
 * referee (issue #16's own map-fairness pre-check, `worker/gravityShooter.ts`)
 * need to agree on, so it lives here rather than with the client-only tuning
 * below. 0.08 was the original brief; issue #16 asked for the ships to sit a
 * further 20px from the edge.
 */
export const GRAVITY_SHIP_MARGIN = 0.08 + 20 / GRAVITY_REFERENCE_BOARD_PX;

/**
 * A pull's own strength is normalized 0..1 client-side; the referee clamps
 * an incoming `gravity-shot` to this range before re-broadcasting it, so a
 * malformed payload cannot produce `NaN`/`Infinity` in a replay (spec §6).
 *
 * The gravity simulation's own FEEL — step size, pull strength, hit radius,
 * launch speed, simulation bounds — is NOT here. Same reasoning Sling Puck's
 * own physics gives for staying out of `shared/`
 * (`www/src/games/sling-puck/physics.ts`): the referee never needs to agree
 * with the client's copy bit-for-bit, since it never adjudicates a claimed
 * hit with it (spec §8) — so it lives with the two clients that do, in
 * `www/src/games/gravity-shooter/game.ts`. `worker/gravityShooter.ts` keeps
 * its own small, deliberately approximate copy for a different job (issue
 * #16): sanity-checking a freshly-rolled map before it ships, not deciding
 * any one shot.
 */
export const GRAVITY_MAX_STRENGTH = 1;

/** How long a turn waits for its own `gravity-shot` before the referee
 *  resolves it as a miss and passes the turn on (spec §2.4) — comfortably
 *  longer than the 3s flight itself, since it only covers message arrival. */
export const GRAVITY_SHOT_TIMEOUT_MS = 15_000;

/** Derived from players.ts, so a card and its referee cannot disagree. */
export const GRAVITY_MIN_PLAYERS = PLAYERS['gravity-shooter'][0];
export const GRAVITY_MAX_PLAYERS = PLAYERS['gravity-shooter'][1];
