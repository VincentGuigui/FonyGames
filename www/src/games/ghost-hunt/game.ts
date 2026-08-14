import {
  GHOST_HOLD_MS,
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
  scores: Record<PlayerId, number>;
  phase: 'running' | 'over';
  best: { player: PlayerId; ms: number } | null;
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
        phase: 'running',
        best: null,
        seq: msg.s,
      };
    }

    case 'hunt-end': {
      if (!state || msg.d.roundId !== state.roundId) return state;
      if (msg.s <= state.seq) return state;
      return { ...state, phase: 'over', scores: msg.d.scores, best: msg.d.best, seq: msg.s };
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

/** Everyone, best score first. Ties keep room order, which is stable. */
export function ranking(state: HuntView, players: PlayerId[]): PlayerId[] {
  return [...players].sort((a, b) => (state.scores[b] ?? 0) - (state.scores[a] ?? 0));
}
