import {
  SLING_START_PUCKS,
  type PlayerId,
  type ServerMessage,
  type SlingState,
} from '../../../../shared/protocol';
import {
  BAND_REST_Y,
  MAX_PULL,
  PUCK_RADIUS,
  clampPull,
  isLoadable,
  restingPucks,
  slingVelocity,
  step,
  tapPull,
  type Puck,
} from './physics';

/**
 * Sling Puck, client side. Spec: docs/specs/games/sling-puck.md §4
 *
 * This is the one game in the catalogue that holds real state of its own. Spill
 * and Goat Siege are pure projections of what the server last said; here the
 * pucks on **your** half are yours, simulated here at 60 fps and visible to
 * nobody else. That is the design in spec §4, not a shortcut.
 *
 * The split is exact:
 *
 * - **Local:** every puck position and velocity, the band, the drag.
 * - **Server:** the count on each side, which is the score and the win.
 *
 * So the two never disagree about a puck — there is only ever one copy of one.
 * They can disagree about the *count*, and when they do the server is right:
 * `#reconcile` adds or removes resting pucks until the local board matches.
 */

export type Drag = {
  puckId: number;
  /** Where the puck is being held, already clamped to a legal pull. */
  x: number;
  y: number;
};

export type SlingView = {
  pucks: Puck[];
  drag: Drag | null;
  /** Pucks on my half, per the server. Shown as a number, never only as icons. */
  mine: number;
  /** Pucks on their half. */
  theirs: number;
  /** Freshly arrived pucks, for the drop-in flourish. */
  arrivals: { id: number; at: number }[];
  spectating: boolean;
};

/** How long an arrival is highlighted. */
export const ARRIVE_MS = 420;

/** Touch slop for grabbing a resting puck, in board widths. */
const GRAB_SLOP = PUCK_RADIUS * 1.8;

export class SlingGame {
  #me: PlayerId = '';
  #now: () => number = () => Date.now();
  #state: SlingState | null = null;

  #pucks: Puck[] = [];
  #nextId = 0;
  #drag: Drag | null = null;
  #arrivals: { id: number; at: number }[] = [];

  /** Crossings the simulation produced that still have to go on the wire. */
  #outbound: { x: number; vx: number; vy: number }[] = [];

  identify(me: PlayerId, now: () => number): void {
    this.#me = me;
    this.#now = now;
  }

  get state(): SlingState | null {
    return this.#state;
  }

  get playing(): boolean {
    const s = this.#state;
    return !!s && s.phase === 'running' && s.players.includes(this.#me);
  }

  /** True once the pre-round rules panel has cleared and input is accepted. */
  get live(): boolean {
    const s = this.#state;
    return !!s && s.phase === 'running' && this.#now() >= s.startsAt;
  }

  apply(msg: ServerMessage): void {
    switch (msg.t) {
      case 'sling': {
        const fresh = !this.#state || this.#state.roundId !== msg.d.roundId;
        this.#state = msg.d;
        // A new round starts from a full rack. A resync mid-round does not: only
        // the count is authoritative, so the local board is nudged to match
        // rather than swept away under a player who is mid-drag (spec §9).
        if (fresh) this.#rack();
        else this.#reconcile();
        return;
      }

      case 'puck': {
        if (!this.#state) return;
        this.#state = { ...this.#state, pucks: msg.d.pucks };
        if (msg.d.to !== this.#me) return;
        this.#spawn(msg.d);
        return;
      }

      case 'sling-over':
        if (!this.#state) return;
        this.#state = { ...this.#state, phase: 'done', pucks: msg.d.pucks };
        this.#drag = null;
        return;
    }
  }

  /**
   * Advance my half by `dt` seconds and hand back anything that left through the
   * gap, for the caller to put on the wire.
   *
   * A puck being dragged is held out of the simulation entirely — it is in a
   * finger, not on the board — which is also what stops it being shoved around
   * by its neighbours while you aim.
   */
  advance(dt: number): { x: number; vx: number; vy: number }[] {
    if (!this.playing || !this.live) return [];

    const held = this.#drag;
    const moving = held ? this.#pucks.filter((p) => p.id !== held.puckId) : this.#pucks;

    for (const c of step(moving, dt)) {
      this.#outbound.push({ x: c.x, vx: c.vx, vy: c.vy });
    }
    // `step` splices crossed pucks out of the array it was given, which is a
    // different array when something is held. Mirror the removals back.
    if (held) {
      const alive = new Set(moving.map((p) => p.id));
      this.#pucks = this.#pucks.filter((p) => p.id === held.puckId || alive.has(p.id));
    }

    const out = this.#outbound;
    this.#outbound = [];
    return out;
  }

  view(): SlingView {
    const now = this.#now();
    this.#arrivals = this.#arrivals.filter((a) => now - a.at < ARRIVE_MS);
    const s = this.#state;
    const them = s?.players.find((p) => p !== this.#me);

    return {
      pucks: this.#pucks,
      drag: this.#drag,
      mine: s?.pucks[this.#me] ?? SLING_START_PUCKS,
      theirs: (them === undefined ? undefined : s?.pucks[them]) ?? SLING_START_PUCKS,
      arrivals: this.#arrivals,
      spectating: !s || !s.players.includes(this.#me),
    };
  }

  /* ------------------------- input ------------------------- */

  /**
   * Start a drag on the puck under (x, y), in board units. Only a resting puck
   * can be loaded — grabbing one that is still bouncing around would turn the
   * board into a stack of held pucks.
   */
  grab(x: number, y: number): boolean {
    if (!this.playing || !this.live || this.#drag) return false;

    let best: Puck | null = null;
    let bestDist = GRAB_SLOP;
    for (const p of this.#pucks) {
      if (!isLoadable(p)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    if (!best) return false;

    const at = clampPull(x, y);
    this.#drag = { puckId: best.id, x: at.x, y: at.y };
    return true;
  }

  /** Move the held puck. Returns false when there is nothing held. */
  drag(x: number, y: number): boolean {
    if (!this.#drag) return false;
    const at = clampPull(x, y);
    this.#drag = { ...this.#drag, x: at.x, y: at.y };
    return true;
  }

  /** Let go. The puck takes the band's launch velocity from where it was held. */
  release(): void {
    const held = this.#drag;
    this.#drag = null;
    if (!held) return;

    const p = this.#pucks.find((q) => q.id === held.puckId);
    if (!p) return;

    const v = slingVelocity(held.x, held.y);
    p.x = held.x;
    p.y = held.y;
    p.vx = v.vx;
    p.vy = v.vy;
  }

  /** Abandon a drag without firing — a cancelled pointer, or the round ending. */
  cancel(): void {
    this.#drag = null;
  }

  /**
   * The tap-to-launch fallback (spec §13): fire the puck nearest the tap at a
   * fixed strength, straight up the board. Required in the first iteration,
   * because a hard drag is exactly what some players cannot do.
   */
  tap(x: number, y: number): boolean {
    if (!this.grab(x, y)) return false;
    const held = this.#drag;
    if (!held) return false;
    // Straight back from where the puck sits, so a tap never aims sideways.
    const at = tapPull(held.x);
    this.#drag = { ...held, x: at.x, y: at.y };
    this.release();
    return true;
  }

  get dragging(): boolean {
    return this.#drag !== null;
  }

  /* ------------------------- bookkeeping ------------------------- */

  /** A fresh round: a full rack of pucks at rest behind the band. */
  #rack(): void {
    const n = this.#state?.pucks[this.#me] ?? SLING_START_PUCKS;
    this.#pucks = restingPucks(n, this.#nextId);
    this.#nextId += n;
    this.#drag = null;
    this.#arrivals = [];
    this.#outbound = [];
  }

  /** A puck arrived from the other side, already rotated into my frame. */
  #spawn(d: { x: number; vx: number; vy: number }): void {
    const id = this.#nextId++;
    this.#pucks.push({
      id,
      // Just inside the gap, so it enters the board rather than starting
      // half-through the wall it came from.
      x: Math.max(PUCK_RADIUS, Math.min(1 - PUCK_RADIUS, d.x)),
      y: PUCK_RADIUS,
      vx: d.vx,
      vy: d.vy,
    });
    this.#arrivals.push({ id, at: this.#now() });
  }

  /**
   * Make the local puck count match the server's.
   *
   * Only ever needed after a resync — a refresh, or a message that went missing.
   * Extra local pucks are dropped (resting ones first, so a shot in flight
   * survives); missing ones are replaced at rest behind the band. The player
   * loses the *motion* of anything the server did not know about, which nobody
   * else could see anyway (spec §9).
   */
  #reconcile(): void {
    const want = this.#state?.pucks[this.#me] ?? this.#pucks.length;
    if (want === this.#pucks.length) return;

    if (want < this.#pucks.length) {
      const order = [...this.#pucks].sort(
        (a, b) => Number(isLoadable(b)) - Number(isLoadable(a)),
      );
      const keep = new Set(order.slice(order.length - want).map((p) => p.id));
      this.#pucks = this.#pucks.filter((p) => keep.has(p.id));
      if (this.#drag && !keep.has(this.#drag.puckId)) this.#drag = null;
      return;
    }

    const extra = restingPucks(want - this.#pucks.length, this.#nextId);
    this.#nextId += extra.length;
    // Nudged down the board so they do not land on top of what is already there;
    // the collision pass sorts out any remaining overlap on the first frame.
    for (const p of extra) p.y = BAND_REST_Y + MAX_PULL * 0.5;
    this.#pucks.push(...extra);
  }
}
