import {
  SQUASH_GRID_COLS,
  squashFlies,
  type PlayerId,
  type ServerMessage,
  type SquashBoard,
  type SquashState,
} from '../../../../shared/protocol';

/**
 * Squash Mosquitoes, client side. Spec: docs/specs/games/squash-mosquitoes.md
 *
 * Holds two things the server sends **separately, on purpose** (spec §6): the shared
 * `SquashState` — the pattern, everyone's squashed *count*, phase, winner — and this
 * phone's own private `SquashBoard`. Nothing here invents a spawn or a score; both
 * arrive from the referee and this file only projects them into what the board needs
 * to draw right now. If you find yourself deciding whether a mosquito is spawned
 * here, that decision belongs on the server.
 */

/** One mosquito, resolved to where it lives and how it behaves. */
export type MosquitoView = {
  /** Pattern index — stable for the whole round, and what a rendered element is keyed on. */
  index: number;
  /** Grid cell, 0..SQUASH_GRID_CELLS-1. */
  position: number;
  row: number;
  col: number;
  flying: boolean;
};

export class SquashGame {
  /** Empty until identify() runs; state can arrive before we know who we are. */
  #me: PlayerId = '';
  #now: () => number = () => Date.now();
  #state: SquashState | null = null;
  #board: SquashBoard | null = null;

  /**
   * Say who we are and whose clock to trust. Separate from the constructor because
   * the object must exist before the socket opens — the first `squash` frame can
   * arrive before this component has ever rendered.
   */
  identify(me: PlayerId, now: () => number): void {
    this.#me = me;
    this.#now = now;
  }

  get state(): SquashState | null {
    return this.#state;
  }

  get winner(): PlayerId | null {
    return this.#state?.winner ?? null;
  }

  get phase(): 'running' | 'done' | null {
    return this.#state?.phase ?? null;
  }

  /** Server time. Only the wander (spec §2.2) reads it — everything else is event-driven. */
  now(): number {
    return this.#now();
  }

  /** My own squashed count — what StatusBar shows. */
  get mySquashed(): number {
    return this.#state?.scores[this.#me] ?? this.#board?.squashed.length ?? 0;
  }

  /** Feed it everything from RoomClient's `game` event. */
  apply(msg: ServerMessage): void {
    switch (msg.t) {
      case 'squash':
        this.#state = msg.d;
        return;
      case 'squash-board':
        this.#board = msg.d.board;
        return;
    }
  }

  /** Everyone's count, for the shared Scoreboard panel. */
  scores(): Record<PlayerId, number> {
    return this.#state?.scores ?? {};
  }

  /** Every mosquito alive on MY board right now, in no particular order. */
  active(): MosquitoView[] {
    const s = this.#state;
    const b = this.#board;
    if (!s || !b) return [];
    return b.active.map((index) => toView(s, index));
  }

  /** Every mosquito I have already squashed — drawn as a permanent blood mark. */
  squashed(): MosquitoView[] {
    const s = this.#state;
    const b = this.#board;
    if (!s || !b) return [];
    return b.squashed.map((index) => toView(s, index));
  }

  /**
   * Would a tap on `position` squash something, as far as this phone can tell?
   *
   * This is the client's own guess, for drawing a live button as enabled or not —
   * the referee is the only thing that actually decides (spec §8), and a guess that
   * disagrees with it costs nothing: the tap is sent regardless and simply does
   * nothing if the guess was wrong.
   */
  indexAt(position: number): number | null {
    const s = this.#state;
    const b = this.#board;
    if (!s || !b) return null;
    const index = s.pattern.indexOf(position);
    return index >= 0 && b.active.includes(index) ? index : null;
  }
}

function toView(s: SquashState, index: number): MosquitoView {
  // Always a valid pattern index: it came from THIS player's own board, which the
  // referee only ever fills with indices into its own 66-long pattern.
  const position = s.pattern[index]!;
  return {
    index,
    position,
    row: Math.floor(position / SQUASH_GRID_COLS),
    col: position % SQUASH_GRID_COLS,
    flying: squashFlies(index),
  };
}

/**
 * A flying mosquito's wander, as a fraction of the room it has to roam in: -0.5..0.5
 * on each axis, 0 dead centre (spec §2.2).
 *
 * A pure function of the mosquito's own pattern index (the seed — so mosquitoes
 * spawned next to each other in the pattern still wander differently) and server
 * time. Never a `dropId`-style piece of state, and never sent anywhere: spec §6 is
 * explicit that no flying coordinate ever crosses the wire in either direction, so
 * this only ever has to agree with itself, on one phone, frame to frame.
 *
 * The caller turns each axis into a pixel offset by multiplying by how far the
 * mosquito's own centre may travel before its hitbox would cross the cell's edge —
 * which is what keeps it "within the bounds of the cell plus their hitbox size"
 * (spec §2.2) without this function needing to know a single pixel.
 */
export function wander(index: number, nowMs: number): { dx: number; dy: number } {
  const seed = index * 0.618_033_988_7; // golden-ratio spacing: neighbours still differ a lot
  const t = nowMs / 1000;
  const dx = Math.sin(t * 1.7 + seed * Math.PI * 2) * 0.5;
  const dy = Math.cos(t * 1.3 + seed * Math.PI * 2 * 1.618) * 0.5;
  return { dx, dy };
}
