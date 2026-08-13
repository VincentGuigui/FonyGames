import {
  LOCK_CONE_DEG,
  LOCK_DWELL_MS,
  type PlayerId,
  type ServerMessage,
} from '../../../../shared/protocol';
import { angleBetween, type Aim } from '../../core/sensors/orientation';

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
 * How close the aim is, as 0…1, for the ring's size, brightness and colour.
 *
 * Full at the lock cone rather than at zero degrees: the ring has to be visibly
 * *closing* through the approach, and a signal that only moves in the last twelve
 * degrees is a signal nobody sees. `HOT_FROM_DEG` is where it starts to respond.
 */
export const HOT_FROM_DEG = 60;

export function heat(errorDeg: number): number {
  if (!Number.isFinite(errorDeg)) return 0;
  if (errorDeg <= LOCK_CONE_DEG) return 1;
  if (errorDeg >= HOT_FROM_DEG) return 0;
  return (HOT_FROM_DEG - errorDeg) / (HOT_FROM_DEG - LOCK_CONE_DEG);
}

export type LockState = {
  /** Degrees off target. */
  error: number;
  /** 0…1 of the dwell completed. The ring's rim fills with this. */
  dwell: number;
  /** True on the frame the dwell completes — the caller sends one `found`. */
  locked: boolean;
};

/**
 * The lock-on, as a pure function of "when did the aim enter the cone".
 *
 * A dwell counter that increments per frame would run at whatever rate the sensor
 * happens to fire, so this is derived from a single timestamp instead: enter the
 * cone and the clock starts, leave and it is discarded. A sweep straight through
 * the target never accumulates, which is the entire purpose of the dwell (spec §2).
 */
export function createLock() {
  let enteredAt: number | null = null;
  let fired = false;

  return {
    /** Feed the current aim and target. `now` is a monotonic clock. */
    update(aim: Aim | null, target: Aim | null, now: number): LockState {
      if (!aim || !target) {
        enteredAt = null;
        fired = false;
        return { error: Number.POSITIVE_INFINITY, dwell: 0, locked: false };
      }

      const error = angleBetween(aim, target);

      if (error > LOCK_CONE_DEG) {
        enteredAt = null;
        fired = false;
        return { error, dwell: 0, locked: false };
      }

      if (enteredAt === null) enteredAt = now;
      const held = now - enteredAt;
      const dwell = Math.min(1, held / LOCK_DWELL_MS);

      // `fired` latches so one dwell produces exactly one `found`, however many
      // sensor frames arrive while the phone is still sitting on the target.
      const locked = dwell >= 1 && !fired;
      if (locked) fired = true;

      return { error, dwell, locked };
    },
    /** Call when the target changes: the next ghost starts from cold. */
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
