import type { PlayerId, ServerMessage } from '../../../../shared/protocol';

/**
 * What the phone knows about the bomb. Spec: docs/specs/games/bump-relay.md
 *
 * The referee (`worker/bumpRelay.ts`) is authoritative for all of it. This reduces the three
 * frames it sends into something a screen can render, and does nothing else — no timers, no
 * guessing, and above all **no fuse**.
 *
 * ## There is no clock here on purpose
 *
 * The remaining fuse is never sent (spec §2.1) and must never be inferred. Every other game in
 * the catalogue counts down to an `endsAt` the server supplies; this one has to resist the
 * habit, because a countdown — even an approximate one drawn from watching how long the bomb
 * has been in the room — hands the holder the one fact the game is built on withholding.
 *
 * ## Round end is derived, not announced
 *
 * The spec's §6 table lists a `round-end` frame. It was never implemented, and the referee has
 * no equivalent: the round is over when a `boom` leaves one player or none. So that is what
 * this watches for. Anything expecting an explicit end frame would wait forever.
 */
export type RelayView = {
  roundId: number;
  /** Who is holding it right now. */
  holder: PlayerId;
  /** Still in the round, in join order as the server sends it. */
  alive: PlayerId[];
  phase: 'running' | 'over';
  /** Who it just went off on, and when — the explosion is shown from this. */
  lastBoom: { victim: PlayerId; at: number } | null;
  /** Set once `phase` is `over`; absent if everyone left at once. */
  winner: PlayerId | null;
  /**
   * Highest `s` seen for this round. Part of the state rather than a local variable because
   * dropping a stale frame is a decision about the state, and a test has to be able to set it up.
   */
  seq: number;
};

/** Nothing yet, or the state after one frame. */
export type RelayState = RelayView | null;

/**
 * Fold a server frame into the view.
 *
 * `now` is passed in rather than read from a clock so the reducer stays pure and testable —
 * it is only used to stamp an explosion, which the screen times out from.
 *
 * Returns the same object when a frame changes nothing, so a caller can skip a re-render.
 */
export function applyRelay(state: RelayState, msg: ServerMessage, now: number): RelayState {
  switch (msg.t) {
    case 'bomb': {
      /*
       * A late frame must not move the bomb backwards.
       *
       * `bomb` frames carry an incrementing `s`, and the transport can deliver them out of
       * order; the spec is explicit that a lower `s` is dropped (§6), because the alternative
       * is the bomb appearing to sit on two phones at once. A frame from an *older round* is
       * dropped for the same reason — "Play again" starts a new roundId and a straggler from
       * the last one would otherwise resurrect it.
       */
      if (state && msg.d.roundId < state.roundId) return state;
      const fresh = !state || msg.d.roundId > state.roundId;
      if (!fresh && state && msg.s <= state.seq) return state;

      return {
        roundId: msg.d.roundId,
        holder: msg.d.holder,
        alive: msg.d.alive,
        phase: 'running',
        // A new round clears the last explosion; a pass within a round keeps it, so the
        // screen can still be showing the boom when the next bomb lands.
        lastBoom: fresh ? null : (state?.lastBoom ?? null),
        winner: null,
        seq: msg.s,
      };
    }

    case 'boom': {
      if (!state || msg.d.roundId !== state.roundId) return state;
      if (msg.s <= state.seq) return state;

      const alive = msg.d.alive;
      // One player left, or none — either way nobody can pass to anybody, so the round is
      // finished whether or not a frame says so.
      const over = alive.length <= 1;

      return {
        ...state,
        alive,
        phase: over ? 'over' : 'running',
        lastBoom: { victim: msg.d.victim, at: now },
        winner: over ? (alive[0] ?? null) : null,
        seq: msg.s,
      };
    }

    default:
      // `calm-down` is handled by the screen, not here: it is addressed to one player and
      // changes nothing about where the bomb is.
      return state;
  }
}

/** Is this player still in the round? Eliminated players watch (spec §2 step 4). */
export function isAlive(state: RelayState, id: PlayerId | undefined): boolean {
  return !!id && !!state && state.alive.includes(id);
}
