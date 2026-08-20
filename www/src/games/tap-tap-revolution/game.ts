import { TAPTAP_TOTAL, type PlayerId, type ServerMessage, type TapTapState } from '../../../../shared/protocol';

/**
 * Tap Tap Revolution, client side. Spec: docs/specs/games/tap-tap-revolution.md
 *
 * Same split Squash Mosquitoes' `game.ts` holds (spec §6): a shared `TapTapState` —
 * the order, everyone's remaining count, phase, winner — and this phone's own
 * private progress index, sent separately. Nothing here decides whether a tap
 * landed; it only projects what the referee already decided into what the board
 * needs to draw.
 */

export class TapTapGame {
  #state: TapTapState | null = null;
  /** My own position in `order`, 0..TAPTAP_TOTAL. Private — nobody else's business. */
  #progress = 0;

  get state(): TapTapState | null {
    return this.#state;
  }

  get winner(): PlayerId | null {
    return this.#state?.winner ?? null;
  }

  get phase(): 'running' | 'done' | null {
    return this.#state?.phase ?? null;
  }

  /** My own position in the shared order — what the board and the timeline draw. */
  get progress(): number {
    return this.#progress;
  }

  /** My own remaining count — what the status bar shows. */
  get remaining(): number {
    return TAPTAP_TOTAL - this.#progress;
  }

  /** Feed it everything from RoomClient's `game` event. */
  apply(msg: ServerMessage): void {
    switch (msg.t) {
      case 'taptap':
        if (this.#state?.roundId !== msg.d.roundId) this.#progress = 0;
        this.#state = msg.d;
        return;
      case 'taptap-progress':
        if (this.#state && msg.d.roundId !== this.#state.roundId) return;
        this.#progress = msg.d.index;
        return;
    }
  }

  /** The cell lit for ME right now, or null before a round has dealt one. */
  litCell(): number | null {
    const order = this.#state?.order;
    if (!order) return null;
    return order[this.#progress] ?? null;
  }

  /** Every cell I have already cleared — hollow, on my own board. */
  goneCells(): Set<number> {
    const order = this.#state?.order;
    if (!order) return new Set();
    return new Set(order.slice(0, this.#progress));
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
