import {
  GHOST_HOLD_MS,
  GHOST_SPEED_MAX,
  GHOST_SPEEDUP_PER_FIND,
  RADAR_FOV_DEG,
  type PlayerId,
  type ServerMessage,
} from '../../../../shared/protocol';
import { angleBetween, type Aim } from '../../core/sensors/orientation';
import { bearingDeg, radarSpot } from './radar';

/**
 * What the phone knows about the hunt. Spec: docs/specs/games/ghost-hunt.md
 *
 * The referee (`worker/ghostHunt.ts`) owns the sequence, the clock and the score.
 * It cannot see an aim — no orientation crosses the wire at all — so the lock is
 * decided **here**, on the phone, and the server checks the timing of the claim.
 *
 * Everyone walks the same sequence at their own pace, so this view holds the whole
 * list and each player's place in it.
 */
export type HuntView = {
  roundId: number;
  targets: Aim[];
  index: Record<PlayerId, number>;
  endsAt: number;
  /** How many each player has caught. */
  scores: Record<PlayerId, number>;
  /** Time spent searching, per player, in ms. Not the score — what it is made of. */
  totals: Record<PlayerId, number>;
  /** The score: a hundred a ghost, less the seconds each took. Highest wins. */
  points: Record<PlayerId, number>;
  phase: 'running' | 'over';
  /** Per player, in ms, and only once the round is over. Empty while it runs. */
  fastest: Record<PlayerId, number>;
  slowest: Record<PlayerId, number>;
  seq: number;
};

export type HuntState = HuntView | null;

/** Fold a server frame into the view. Same object back when nothing changed. */
export function applyHunt(state: HuntState, msg: ServerMessage): HuntState {
  switch (msg.t) {
    case 'hunt': {
      if (state && msg.d.roundId < state.roundId) return state;
      const startingOver = !state || msg.d.roundId > state.roundId;
      if (!startingOver && state && msg.s <= state.seq) return state;

      return {
        roundId: msg.d.roundId,
        targets: msg.d.targets,
        index: msg.d.index,
        endsAt: msg.d.endsAt,
        scores: msg.d.scores,
        totals: msg.d.totals,
        points: msg.d.points,
        phase: 'running',
        // Only the end frame carries these; a running round has nothing to show yet.
        fastest: {},
        slowest: {},
        seq: msg.s,
      };
    }

    case 'hunt-end': {
      if (!state || msg.d.roundId !== state.roundId) return state;
      if (msg.s <= state.seq) return state;
      return {
        ...state,
        phase: 'over',
        scores: msg.d.scores,
        totals: msg.d.totals,
        points: msg.d.points,
        fastest: msg.d.fastest,
        slowest: msg.d.slowest,
        seq: msg.s,
      };
    }

    default:
      return state;
  }
}

/** The ghost this player is hunting, or null if the sequence has not caught up. */
export function myTarget(state: HuntView, me: PlayerId | undefined): Aim | null {
  if (!me) return null;
  const i = state.index[me];
  if (i === undefined) return null;
  return state.targets[i] ?? null;
}

/** Which index this player is on. `found` for anything else is refused server-side. */
export function myIndex(state: HuntView, me: PlayerId | undefined): number {
  return (me ? state.index[me] : undefined) ?? 0;
}

/**
 * How close the aim is, as 0…1, for the radar's brightness and colour.
 *
 * Full once the ghost is on the dial rather than at zero degrees: the radar has to
 * be visibly *closing* through the approach, and a signal that only moves in the
 * last twenty degrees is a signal nobody sees. `HOT_FROM_DEG` is where it starts to
 * respond.
 */
export const HOT_FROM_DEG = 60;

export function heat(errorDeg: number): number {
  if (!Number.isFinite(errorDeg)) return 0;
  if (errorDeg <= RADAR_FOV_DEG) return 1;
  if (errorDeg >= HOT_FROM_DEG) return 0;
  return (HOT_FROM_DEG - errorDeg) / (HOT_FROM_DEG - RADAR_FOV_DEG);
}

export type LockState = {
  /** Degrees from the aim to the ghost. */
  error: number;
  /** 0…1 of the hold completed. The radar's rim fills with this. */
  dwell: number;
  /** True on the frame the hold completes — the caller sends one `found`. */
  locked: boolean;
  /** Where the ghost is on the dial, −1…1 of the radius. Null when it is off it. */
  spot: { x: number; y: number } | null;
  /** Which way to turn, degrees clockwise from up. Null when there is no ghost. */
  bearing: number | null;
};

const NOTHING: LockState = {
  error: Number.POSITIVE_INFINITY,
  dwell: 0,
  locked: false,
  spot: null,
  bearing: null,
};

/**
 * The hold, as a pure function of "when did the ghost arrive on the dial".
 *
 * A counter that increments per frame would run at whatever rate the sensor happens
 * to fire, so this is derived from a single timestamp instead: the ghost appears on
 * the dial and the clock starts, it leaves and the clock is discarded. Sweeping
 * straight past never accumulates, which is the whole point of the hold (spec §2).
 *
 * The `ghost` passed in is the ghost's position **now**, roam included — this does
 * not know about homes or ages, only about whether the thing is on the dial. That
 * keeps the wandering in one place (`radar.ts`) and the timing in another.
 */
export function createLock() {
  let enteredAt: number | null = null;
  let fired = false;

  return {
    /** Feed the current aim and the ghost's current place. `now` is monotonic. */
    update(aim: Aim | null, ghost: Aim | null, now: number): LockState {
      if (!aim || !ghost) {
        enteredAt = null;
        fired = false;
        return NOTHING;
      }

      const error = angleBetween(aim, ghost);
      const bearing = bearingDeg(aim, ghost);
      const spot = radarSpot(aim, ghost);

      if (!spot) {
        enteredAt = null;
        fired = false;
        return { error, dwell: 0, locked: false, spot: null, bearing };
      }

      if (enteredAt === null) enteredAt = now;
      const held = now - enteredAt;
      const dwell = Math.min(1, held / GHOST_HOLD_MS);

      // `fired` latches so one hold produces exactly one `found`, however many
      // sensor frames arrive while the phone is still following the ghost.
      const locked = dwell >= 1 && !fired;
      if (locked) fired = true;

      return { error, dwell, locked, spot, bearing };
    },
    /** Call when the ghost changes: the next one starts from cold. */
    reset(): void {
      enteredAt = null;
      fired = false;
    },
  };
}

/** This player's score. Zero for somebody who has caught nothing, which is honest. */
export function pointsOf(state: HuntView, id: PlayerId): number {
  return state.points[id] ?? 0;
}

/**
 * Everyone, best first: **most points**.
 *
 * One key, one direction, which it took a change of scoring to earn. The rule used to be
 * "most caught, then the lowest time", in that order and never either alone — a player who
 * has caught nothing has spent no time, so ranking on time crowned whoever played least.
 *
 * Points say the same thing in one number. A ghost is worth `HUNT_POINTS_PER_FIND` and no
 * total can span more than the round, so more catches always outranks quicker catches, and
 * among equal catches the quicker player is ahead. Same order, half the rule.
 *
 * Ties keep room order, which is stable.
 */
export function ranking(state: HuntView, players: PlayerId[]): PlayerId[] {
  return [...players].sort((a, b) => pointsOf(state, b) - pointsOf(state, a));
}

/**
 * Who is winning, or null when nobody is.
 *
 * Null in two cases, and both matter: nobody has caught anything — every score is zero and
 * crowning the first row would invent a winner — or the top two are level, which is a tie
 * and a tie has no leader (core/ui/Scoreboard.tsx).
 */
export function leaderOf(state: HuntView, players: PlayerId[]): PlayerId | null {
  const [first, second] = ranking(state, players);
  if (first === undefined || pointsOf(state, first) === 0) return null;
  if (second !== undefined && pointsOf(state, second) === pointsOf(state, first)) return null;
  return first;
}

/** One player's find times, or null when they caught nothing to have times for. */
export type FindTimes = { fastest: number; slowest: number; average: number };

/**
 * Fastest, slowest and average find, in SECONDS, for the results panel.
 *
 * The average is computed here rather than sent: it is the total over the count, both of
 * which are already on the wire, and a number the receiver can divide for itself is one
 * that cannot disagree with the two it came from.
 */
export function findTimes(state: HuntView, id: PlayerId): FindTimes | null {
  const found = state.scores[id] ?? 0;
  if (found === 0) return null;
  return {
    fastest: (state.fastest[id] ?? 0) / 1000,
    slowest: (state.slowest[id] ?? 0) / 1000,
    average: (state.totals[id] ?? 0) / found / 1000,
  };
}

/** Those three as one line under a name: `fastest 6.2s · slowest 21.4s · avg 12.1s`. */
export function findTimesLine(state: HuntView, id: PlayerId): string | undefined {
  const t = findTimes(state, id);
  if (!t) return undefined;
  const s = (n: number): string => `${n.toFixed(1)}s`;
  return `fastest ${s(t.fastest)} · slowest ${s(t.slowest)} · avg ${s(t.average)}`;
}

/**
 * How fast this player's ghost drifts, as a multiple of the base roam.
 *
 * Their own catch count, not the room's: the hunt gets harder as *you* win it, so a
 * runaway leader is tracking a quicker ghost than the player chasing them. Two players on
 * the same count get exactly the same path, which is the part of "everyone's ghost moves
 * identically" worth keeping (radar.ts).
 */
export function ghostSpeed(found: number): number {
  return Math.min(GHOST_SPEED_MAX, 1 + Math.max(0, found) * GHOST_SPEEDUP_PER_FIND);
}
