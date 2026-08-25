import {
  TAPS100_TOTAL,
  type PlayerId,
  type ServerMessage,
  type Taps100State,
} from '../../../../shared/protocol';

/**
 * 100 Taps, client side. Spec: docs/specs/games/100-taps.md
 *
 * Same split Tap Tap Music's own `game.ts` holds (spec §6): a shared `Taps100State` —
 * the layout, everyone's remaining count, phase, winner — and this phone's own
 * private cleared history, sent separately. Nothing here decides whether a tap
 * landed; it only projects what the referee already decided into what the board
 * needs to draw.
 *
 * Every number stays printed and visible regardless of state — unlike Tap Tap
 * Music, nothing here is ever hidden. What IS windowed is which cells a tap can
 * land on at all (spec §2): `enabledCells()` is the next `TAPS100_WINDOW_SIZE`
 * due, in board position. This is a **client-side interaction limit, not a
 * correctness rule** — the referee still only ever accepts `order[cleared.length]`
 * (worker/taps100.ts), so disabling the rest just keeps a stray tap from costing
 * a checkpoint it was never going to land anyway.
 */

/** How many upcoming cells are tappable at once, ahead of a player's own progress. */
export const TAPS100_WINDOW_SIZE = 10;

export class Taps100Game {
  #state: Taps100State | null = null;
  /** Cells I have correctly tapped, in the order I tapped them. Private. */
  #cleared: number[] = [];
  /** `order` inverted: `#numbers[cell]` is the number printed on that cell. Rebuilt
   *  only when `order`'s identity changes, not on every private-progress message. */
  #numbers: number[] | null = null;
  #numbersFor: number[] | null = null;

  get state(): Taps100State | null {
    return this.#state;
  }

  get winner(): PlayerId | null {
    return this.#state?.winner ?? null;
  }

  get phase(): 'running' | 'done' | null {
    return this.#state?.phase ?? null;
  }

  /** How many I have cleared so far — what the timeline's pulse and the tune's
   *  pitch both key off. */
  get progress(): number {
    return this.#cleared.length;
  }

  /** My own remaining count — what the status bar shows. */
  get remaining(): number {
    return TAPS100_TOTAL - this.#cleared.length;
  }

  /** Feed it everything from RoomClient's `game` event. */
  apply(msg: ServerMessage): void {
    switch (msg.t) {
      case 'taps100':
        if (this.#state?.roundId !== msg.d.roundId) this.#cleared = [];
        this.#state = msg.d;
        return;
      case 'taps100-progress':
        if (this.#state && msg.d.roundId !== this.#state.roundId) return;
        this.#cleared = msg.d.cleared;
        return;
    }
  }

  /** `numbers[cell]` is the number printed on that grid cell — `order` inverted. */
  numbers(): readonly number[] {
    const order = this.#state?.order;
    if (!order) return [];
    if (this.#numbersFor !== order) {
      const inverted = new Array<number>(order.length);
      for (let k = 0; k < order.length; k++) inverted[order[k]!] = k + 1;
      this.#numbers = inverted;
      this.#numbersFor = order;
    }
    return this.#numbers ?? [];
  }

  /** Every cell I have already cleared — hollow, on my own board. */
  goneCells(): Set<number> {
    return new Set(this.#cleared);
  }

  /**
   * The cells a tap may currently land on — the next `TAPS100_WINDOW_SIZE` due,
   * in board position. `#cleared` is always exactly `order[0..progress)` (a
   * correct tap is the only thing that ever grows it, and a miss only ever
   * truncates it back to a checkpoint — worker/taps100.ts), so the window is a
   * plain slice starting at my own progress, not a search.
   */
  enabledCells(): Set<number> {
    const order = this.#state?.order;
    if (!order) return new Set();
    return new Set(order.slice(this.progress, this.progress + TAPS100_WINDOW_SIZE));
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
 * §4). No minutes place: a clean run is well under one.
 */
export function formatClock(ms: number): string {
  const clamped = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalCentis = Math.floor(clamped / 10);
  const seconds = Math.floor(totalCentis / 100);
  const centis = totalCentis % 100;
  return `${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

/** How long a round has been running, at `now` — never negative, even before `startsAt`. */
export function elapsedMs(state: Taps100State, now: number): number {
  return Math.max(0, now - state.startsAt);
}

/* ------------------------------------------------------------------ */
/* The board's shape: not a square (spec §4)                           */
/* ------------------------------------------------------------------ */

/**
 * Cells per row, top to bottom — six, centred, top and bottom; eight across
 * for the eleven rows between. Sums to `TAPS100_TOTAL`; `Taps100Board.tsx`
 * checks that once, on import, rather than trusting the arithmetic silently.
 */
export const TAPS100_ROW_COUNTS: readonly number[] = [6, ...Array<number>(11).fill(8), 6];

/**
 * Cell index (0-based, into `order`/`numbers()`) each row starts at — the
 * running sum of every row before it. One entry per `TAPS100_ROW_COUNTS`.
 */
export const TAPS100_ROW_STARTS: readonly number[] = (() => {
  const starts: number[] = [];
  let sum = 0;
  for (const count of TAPS100_ROW_COUNTS) {
    starts.push(sum);
    sum += count;
  }
  return starts;
})();

/* ------------------------------------------------------------------ */
/* The gradient: a hue wheel, keyed by a cell's own printed NUMBER      */
/* ------------------------------------------------------------------ */

/**
 * How far round the hue wheel the gradient travels. Short of a full 360° on
 * purpose — 1 and `TAPS100_TOTAL` would otherwise both land on red and read
 * as the same colour, the one pair a player most needs to tell apart (the
 * very first and very last cell they are looking for).
 */
const HUE_SPAN_DEG = 300;

/**
 * A cell's fill colour, by its own printed number (1..`total`) rather than by
 * where it happens to sit on the board — a full-saturation sweep around the
 * hue wheel keyed to the SEQUENCE, not the shuffle. Pure and decorative only
 * (spec §11): a cell's live/locked/gone state never depends on it, and the
 * hue says nothing about where on the board a number landed.
 */
export function cellColor(number: number, total: number): string {
  const hue = total > 1 ? ((number - 1) / (total - 1)) * HUE_SPAN_DEG : 0;
  return `hsl(${hue.toFixed(1)}deg 75% 55%)`;
}
