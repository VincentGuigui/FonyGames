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
  size: MosquitoSize;
};

export type MosquitoSize = 'large' | 'normal' | 'small';

/** Size is cosmetic and private to each phone; it is deliberately not progression-based. */
export function randomMosquitoSize(random = Math.random): MosquitoSize {
  const roll = random();
  if (roll < 1 / 3) return 'large';
  if (roll < 2 / 3) return 'normal';
  return 'small';
}

/** Which edge of the screen a mosquito flew in from. */
export type EntrySide = 'top' | 'right' | 'bottom' | 'left';

/**
 * Where mosquito `index` rests once it arrives, and how it got there — rolled once,
 * the moment this phone first sees it active, and never again (the feature this
 * exists for): a target that kept moving after being drawn would read as
 * remote-controlled rather than alive, and a swarm lined up dead-centre on every
 * cell reads as a grid, not bugs.
 *
 * Randomised per player on purpose — nobody else is ever shown this board (spec §9),
 * so there is nothing for two phones to disagree about.
 */
export type MosquitoVisual = {
  /** Offset from the cell's own centre, as a fraction of its width/height: -0.5..0.5 on
   *  each axis, half a cell either way. */
  ox: number;
  oy: number;
  /** The screen edge it entered from. */
  side: EntrySide;
  /** Where along that edge, 0..1. */
  lateral: number;
  /** Wiggle phase, so mosquitoes that spawn together do not swing in lockstep. */
  phase: number;
  /** Server time this mosquito was first seen active. */
  spawnedAt: number;
  /** Visual size, rolled independently from the pattern's flight progression. */
  size: MosquitoSize;
};

const ENTRY_SIDES: EntrySide[] = ['top', 'right', 'bottom', 'left'];

export class SquashGame {
  /** Empty until identify() runs; state can arrive before we know who we are. */
  #me: PlayerId = '';
  #now: () => number = () => Date.now();
  #state: SquashState | null = null;
  #board: SquashBoard | null = null;
  /** Cleared on every new round (see `apply`) — a fresh swarm gets a fresh scatter. */
  #visuals = new Map<number, MosquitoVisual>();

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
        // A new round gets a fresh scatter — the previous one's targets and entrances
        // mean nothing once the pattern indices have been dealt out again.
        if (this.#state?.roundId !== msg.d.roundId) this.#visuals.clear();
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
    return b.active.map((index) => toView(s, index, this.visual(index).size));
  }

  /** Every mosquito I have already squashed — drawn as a permanent blood mark. */
  squashed(): MosquitoView[] {
    const s = this.#state;
    const b = this.#board;
    if (!s || !b) return [];
    return b.squashed.map((index) => toView(s, index, this.visual(index).size));
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

  /** Mosquito `index`'s own scatter and entrance, rolled once and cached — see `MosquitoVisual`. */
  visual(index: number): MosquitoVisual {
    let v = this.#visuals.get(index);
    if (!v) {
      v = {
        ox: Math.random() - 0.5,
        oy: Math.random() - 0.5,
        side: ENTRY_SIDES[Math.floor(Math.random() * ENTRY_SIDES.length)]!,
        lateral: Math.random(),
        phase: Math.random() * Math.PI * 2,
        spawnedAt: this.#now(),
        size: randomMosquitoSize(),
      };
      this.#visuals.set(index, v);
    }
    return v;
  }
}

function toView(s: SquashState, index: number, size: MosquitoSize): MosquitoView {
  // Always a valid pattern index: it came from THIS player's own board, which the
  // referee only ever fills with indices into its own 66-long pattern.
  const position = s.pattern[index]!;
  return {
    index,
    position,
    row: Math.floor(position / SQUASH_GRID_COLS),
    col: position % SQUASH_GRID_COLS,
    flying: squashFlies(index),
    size,
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

/** How long a mosquito takes to fly in from the screen edge to its target. */
export const SQUASH_ENTRY_MS = 550;

/** How far the sinusoidal entrance swings off its straight line, in pixels. */
export const SQUASH_ENTRY_WIGGLE = 18;

/** How many full wiggles an entrance draws before it settles. */
export const SQUASH_ENTRY_WAVES = 2;

/** 0 the instant a mosquito is first seen active, 1 once its entrance has landed. */
export function entryProgress(spawnedAt: number, nowMs: number): number {
  return Math.min(1, Math.max(0, (nowMs - spawnedAt) / SQUASH_ENTRY_MS));
}

/**
 * A mosquito's position `t` of the way through its entrance — 0 at `start`
 * (off-screen), 1 at `rest` (its target). Pure: pixels in, pixels out, so it is
 * tested without a DOM.
 *
 * A straight lerp, eased, would look like it was reeled in on a string. This adds a
 * sine wave across the *perpendicular* of that line, its own envelope fading it in
 * and back out so the path still lands exactly on `rest` — the sinusoidal flight the
 * feature is named for. `phase` staggers mosquitoes that spawn together (spec §2.1's
 * doubling can spawn several in the same instant) so they do not swing as one.
 */
export function entryOffset(
  start: { x: number; y: number },
  rest: { x: number; y: number },
  t: number,
  phase: number,
): { x: number; y: number } {
  // Snapped rather than trusted to `Math.sin(Math.PI * t)` landing on exactly 0: it
  // does not, by about a femtometre, and this is the one point the path must not
  // miss by any amount — it is where the mosquito is actually tapped.
  if (t <= 0) return { x: start.x, y: start.y };
  if (t >= 1) return { x: rest.x, y: rest.y };

  const ease = t * t * (3 - 2 * t); // smoothstep: 0 at t=0, 1 at t=1
  const travelX = rest.x - start.x;
  const travelY = rest.y - start.y;
  let x = start.x + travelX * ease;
  let y = start.y + travelY * ease;

  const len = Math.hypot(travelX, travelY);
  if (len > 0) {
    const perpX = -travelY / len;
    const perpY = travelX / len;
    const envelope = Math.sin(Math.PI * t); // 0 at both ends, peak at the midpoint
    const wiggle =
      envelope * SQUASH_ENTRY_WIGGLE * Math.sin(t * SQUASH_ENTRY_WAVES * Math.PI * 2 + phase);
    x += perpX * wiggle;
    y += perpY * wiggle;
  }
  return { x, y };
}
