import {
  TAPTAP_TOTAL,
  taptapWindow,
  type PlayerId,
  type ServerMessage,
  type TapTapState,
} from '../../../../shared/protocol';

/**
 * Tap Tap Revolution, client side. Spec: docs/specs/games/tap-tap-revolution.md
 *
 * Same split Squash Mosquitoes' `game.ts` holds (spec §6): a shared `TapTapState` —
 * the order, everyone's remaining count, phase, winner — and this phone's own
 * private cleared history, sent separately. Nothing here decides whether a tap
 * landed; it only projects what the referee already decided into what the board
 * needs to draw. `taptapWindow` (shared/protocol.ts) is shared with the referee for
 * exactly one reason: both must compute the identical five live cells from the same
 * two facts, `order` and this history, or a tap that looks correct on screen could
 * be refused server-side.
 */

export class TapTapGame {
  #state: TapTapState | null = null;
  /** Cells I have correctly tapped, in the order I tapped them. Private — nobody
   *  else's business, and never reordered to match `order`. */
  #cleared: number[] = [];

  get state(): TapTapState | null {
    return this.#state;
  }

  get winner(): PlayerId | null {
    return this.#state?.winner ?? null;
  }

  get phase(): 'running' | 'done' | null {
    return this.#state?.phase ?? null;
  }

  /** How many I have cleared so far — what the timeline's pulse and the tune's
   *  note both key off, since both care about tap COUNT, not grid position. */
  get progress(): number {
    return this.#cleared.length;
  }

  /** My own remaining count — what the status bar shows. */
  get remaining(): number {
    return TAPTAP_TOTAL - this.#cleared.length;
  }

  /** Feed it everything from RoomClient's `game` event. */
  apply(msg: ServerMessage): void {
    switch (msg.t) {
      case 'taptap':
        if (this.#state?.roundId !== msg.d.roundId) this.#cleared = [];
        this.#state = msg.d;
        return;
      case 'taptap-progress':
        if (this.#state && msg.d.roundId !== this.#state.roundId) return;
        this.#cleared = msg.d.cleared;
        return;
    }
  }

  /** The up to five cells live for ME right now, in `order` order. */
  litCells(): number[] {
    const order = this.#state?.order;
    if (!order) return [];
    return taptapWindow(order, this.#cleared);
  }

  /** Every cell I have already cleared — hollow, on my own board. */
  goneCells(): Set<number> {
    return new Set(this.#cleared);
  }

  /** My own cleared cells, in the exact order I tapped them — what the timeline
   *  needs to know which of its hundred marks are passed. */
  clearedCells(): readonly number[] {
    return this.#cleared;
  }

  /** Everyone's remaining count, for the shared Scoreboard panel. */
  remainingByPlayer(): Record<PlayerId, number> {
    return this.#state?.remaining ?? {};
  }
}

/**
 * `SS.CC` — seconds and hundredths, the running clock and every finish time (spec
 * §4). No minutes place: a clean run is well under one, and a reset that drags a
 * round past 59.99s is already the safety cap's problem, not the clock's — see the
 * test for what happens at and past that edge.
 */
export function formatClock(ms: number): string {
  const clamped = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalCentis = Math.floor(clamped / 10);
  const seconds = Math.floor(totalCentis / 100);
  const centis = totalCentis % 100;
  return `${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

/** How long a round has been running, at `now` — never negative, even before `startsAt`. */
export function elapsedMs(state: TapTapState, now: number): number {
  return Math.max(0, now - state.startsAt);
}
