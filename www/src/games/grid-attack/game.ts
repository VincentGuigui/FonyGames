import {
  GRID_FUSE_MS,
  GRID_TAP_WINDOW_MS,
  GRID_TAPS,
  type GridCell,
  type GridState,
  type PlayerId,
  type ServerMessage,
} from '../../../../shared/protocol';

/**
 * What a phone knows about the board. Spec: docs/specs/games/grid-attack.md
 *
 * The referee (`worker/gridAttack.ts`) owns every cell, every fuse and every life. This
 * reduces the one frame it sends into something a screen can draw, and adds the single
 * thing the server deliberately does not know about: **your own tap progress**.
 *
 * ## Why tap progress is local
 *
 * A cell tells its owner nothing until it is armed — that is the game. So "somebody is two
 * taps into this one" cannot be on the wire, or the frame carrying it would hand the
 * defender the second they need. The referee counts taps privately and says nothing until
 * the third one lands.
 *
 * Which leaves the tapper with no feedback, and three taps with no feedback feels like a
 * broken button. So the count is ALSO kept here, purely to draw — an optimistic echo of
 * what the server is doing with the same rule and the same window. It is never authority:
 * if the two disagree, the board redraws from the frame and the local count is discarded.
 */
export type GridView = GridState & { seq: number };

export type GridBoard = GridView | null;

export function applyGrid(state: GridBoard, msg: ServerMessage): GridBoard {
  if (msg.t !== 'grid') return state;
  // A late frame must not move the board backwards, for the same reason Pass the Bomb
  // drops one: a cell appearing to be saved and then armed again is a lie about the past.
  if (state && msg.d.roundId < state.roundId) return state;
  const fresh = !state || msg.d.roundId > state.roundId;
  if (!fresh && state && msg.s <= state.seq) return state;

  return { ...msg.d, seq: msg.s };
}

/** The two seats, mine first. Empty until the first frame arrives. */
export function sides(state: GridView, me: PlayerId | undefined): { mine: PlayerId; theirs: PlayerId } | null {
  const seats = Object.keys(state.grids);
  if (seats.length < 2 || !me || !seats.includes(me)) return null;
  const theirs = seats.find((id) => id !== me);
  return theirs === undefined ? null : { mine: me, theirs };
}

export function cellsOf(state: GridView, who: PlayerId): GridCell[] {
  return state.grids[who] ?? [];
}

export function livesOf(state: GridView, who: PlayerId): number {
  return state.lives[who] ?? 0;
}

/**
 * How far through its fuse a cell is, 0…1, or null when nothing is happening to it.
 *
 * Derived from the clock rather than counted up from when the frame arrived, so a phone
 * that missed a frame — or joined halfway through a fuse — draws the same moment as the
 * other one instead of starting its own two seconds late.
 */
export function fuseProgress(cell: GridCell, now: number): number | null {
  if (cell.gone || cell.burstAt === 0) return null;
  const left = cell.burstAt - now;
  if (left <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - left / GRID_FUSE_MS));
}

/**
 * The pulse period at that point in the fuse, in ms.
 *
 * Accelerating: a whole second between flashes at the start, a tenth at the end, so the
 * cell reads as running out of time from across a table rather than only up close. The
 * curve is squared because a linear ramp spends most of its length in the slow half, where
 * nothing looks urgent.
 */
export function pulseMs(progress: number): number {
  const eased = progress * progress;
  return 1000 - eased * 900;
}

/**
 * Local tap counting, one per side of the board.
 *
 * The same rule as the referee's, and deliberately a separate implementation of it rather
 * than a shared one: this is a *guess* at what the server is doing so the finger gets
 * feedback, and a guess that shared code with the authority would be easy to mistake for
 * the authority. It is thrown away every time a frame lands.
 */
export function tapCounter(windowMs = GRID_TAP_WINDOW_MS) {
  const runs = new Map<number, { taps: number; at: number }>();

  return {
    /** Register a tap on `cell`, and say how many of the three are showing. */
    tap(cell: number, now: number): number {
      const run = runs.get(cell);
      const taps = run && now - run.at <= windowMs ? run.taps + 1 : 1;
      if (taps >= GRID_TAPS) {
        runs.delete(cell);
        return GRID_TAPS;
      }
      runs.set(cell, { taps, at: now });
      return taps;
    },
    /** How many taps are showing on `cell` right now, expiring a stale run. */
    showing(cell: number, now: number): number {
      const run = runs.get(cell);
      if (!run) return 0;
      if (now - run.at > windowMs) {
        runs.delete(cell);
        return 0;
      }
      return run.taps;
    },
    clear(cell: number): void {
      runs.delete(cell);
    },
    reset(): void {
      runs.clear();
    },
  };
}
