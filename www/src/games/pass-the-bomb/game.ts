import type { BombMatch, PlayerId, ServerMessage } from '../../../../shared/protocol';

/**
 * What the phone knows about the bomb. Spec: docs/specs/games/pass-the-bomb.md
 *
 * The referee (`worker/passTheBomb.ts`) is authoritative for all of it. This reduces the three
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
 * ## Round end is announced now, and it has to be
 *
 * This used to work it out for itself — "a boom that leaves one player or none" — which held
 * for the elimination rounds and quietly failed for the other two ways a round ends. A
 * two-player round is over after one boom with both players still on their feet, and the
 * five-minute safety cap ends one with a whole circle left. So `boom` carries `over`, and
 * this believes it rather than counting heads.
 */
export type BombView = {
  roundId: number;
  /** Who is holding it right now. */
  holder: PlayerId;
  /** Still in the round, in join order as the server sends it. */
  alive: PlayerId[];
  phase: 'running' | 'over';
  /** Who it just went off on, and when — the explosion is shown from this. */
  lastBoom: { victim: PlayerId; at: number } | null;
  /** Who took this ROUND, once `phase` is `over`; null if everyone blew up. */
  winner: PlayerId | null;
  /**
   * Lives, wins and how far through the match — sent whole on every frame.
   *
   * The end screen reads this rather than the round: what a player wants after the third
   * boom of five is the standings, and whether there is another round coming.
   */
  match: BombMatch;
  /**
   * Highest `s` seen for this round. Part of the state rather than a local variable because
   * dropping a stale frame is a decision about the state, and a test has to be able to set it up.
   */
  seq: number;
};

/** Nothing yet, or the state after one frame. */
export type BombState = BombView | null;

/**
 * Fold a server frame into the view.
 *
 * `now` is passed in rather than read from a clock so the reducer stays pure and testable —
 * it is only used to stamp an explosion, which the screen times out from.
 *
 * Returns the same object when a frame changes nothing, so a caller can skip a re-render.
 */
export function applyBomb(state: BombState, msg: ServerMessage, now: number): BombState {
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
        match: msg.d.match,
        seq: msg.s,
      };
    }

    case 'boom': {
      if (!state || msg.d.roundId !== state.roundId) return state;
      if (msg.s <= state.seq) return state;

      const alive = msg.d.alive;
      const over = msg.d.over;

      return {
        ...state,
        alive,
        phase: over ? 'over' : 'running',
        lastBoom: { victim: msg.d.victim, at: now },
        // The last one standing took the round. A round nobody survived — solo, or a room
        // that emptied — has no winner, and neither does the safety cap with a circle left.
        winner: over && alive.length === 1 ? (alive[0] ?? null) : null,
        match: msg.d.match,
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
export function isAlive(state: BombState, id: PlayerId | undefined): boolean {
  return !!id && !!state && state.alive.includes(id);
}
