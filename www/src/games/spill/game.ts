import {
  SPILL_APPROACH_MS,
  SPILL_LOSE_LEVEL,
  SPILL_SPEED_MAX,
  SPILL_SPEED_MIN,
  SPILL_START_LEVEL,
  type PlayerId,
  type ServerMessage,
  type SpillDrop,
  type SpillState,
} from '../../../../shared/protocol';
import { aimSeat, screenAngleTo } from '../../../../shared/spillGeometry';

/**
 * Spill, client side. Spec: docs/specs/games/spill.md
 *
 * This file holds **no rules**. Every level, every catch and every landing is
 * decided in the Durable Object; what lives here is a projection of what the
 * server last said, plus the arithmetic needed to draw it at the current
 * instant. If you find yourself adding up drops here, it belongs on the server.
 *
 * It also mentions no water. Anything visual is the theme's business
 * (`themes/index.ts`), which is why this file can be read without knowing what
 * the game looks like.
 */

/** A drop as this phone needs to draw it *now*. */
export type Visible = {
  drop: SpillDrop;
  /** Position in CSS pixels. */
  x: number;
  y: number;
  /** 'leaving' is ours on its way out; 'arriving' is incoming and catchable. */
  phase: 'leaving' | 'arriving';
};

/** Position is a **fraction of the canvas**, so it survives a resize mid-splash. */
export type Splash = { x: number; y: number; at: number; size: number };

export type View = {
  /** 0..1 for the theme's pool. */
  level: number;
  /** The honest number, always shown alongside the pool (spec §11). */
  count: number;
  visible: Visible[];
  held: { size: number; soaksAt: number } | null;
  splashes: Splash[];
  /** Server time this phone may fling again; 0 when free. */
  lockedUntil: number;
};

export class SpillGame {
  /** Empty until identify() runs; state can arrive before we know who we are. */
  #me: PlayerId = '';
  #now: () => number = () => Date.now();
  #state: SpillState | null = null;
  #held: { dropId: string; size: number; soaksAt: number } | null = null;
  #splashes: Splash[] = [];
  #lockedUntil = 0;
  /** Set by the client the moment it flings, so the lock reads as instant. */
  #optimisticLock = 0;

  /**
   * Say who we are and whose clock to trust. Separate from the constructor
   * because the object must exist before the socket opens — otherwise the first
   * `spill` frame has nowhere to land.
   *
   * `now` must be RoomClient.now(), never Date.now(): every deadline in the
   * round is in server time.
   */
  identify(me: PlayerId, now: () => number): void {
    this.#me = me;
    this.#now = now;
  }

  get state(): SpillState | null {
    return this.#state;
  }

  /** Our seat index, or -1 when we are not seated (a spectator, or no round). */
  get seat(): number {
    return this.#state?.seats.indexOf(this.#me) ?? -1;
  }

  get seatCount(): number {
    return this.#state?.seats.length ?? 0;
  }

  get playing(): boolean {
    const s = this.#state;
    return !!s && s.phase === 'running' && this.seat >= 0 && !s.out.includes(this.#me);
  }

  /** Feed it everything from RoomClient's `game` event. */
  apply(msg: ServerMessage): void {
    switch (msg.t) {
      case 'spill':
        this.#state = msg.d;
        // A resync can arrive after we caught something the server then
        // resolved; the snapshot is authoritative, so drop a stale hold.
        if (this.#held && !msg.d.air.some((d) => d.dropId === this.#held?.dropId)) {
          // Only clear it if the server no longer knows about it at all.
          this.#held = null;
        }
        return;

      case 'drop': {
        if (!this.#state) return;
        const { levels, replaces, ...drop } = msg.d;
        this.#state = { ...this.#state, air: [...this.#state.air, drop], levels };
        // The payload we were holding has been thrown on. Letting this go
        // unhandled strands #held forever, and since heldId() is attached to
        // every outgoing fling, the server then rejects all of them — the
        // player is silently locked out for the rest of the round.
        if (replaces !== undefined && this.#held?.dropId === replaces) this.#held = null;
        if (this.#state.seats[drop.from] === this.#me) {
          this.#lockedUntil = drop.leavesAt;
          this.#optimisticLock = 0;
        }
        return;
      }

      case 'caught': {
        if (!this.#state) return;
        this.#state = {
          ...this.#state,
          air: this.#state.air.filter((d) => d.dropId !== msg.d.dropId),
        };
        if (msg.d.by === this.#me) {
          this.#held = { dropId: msg.d.dropId, size: msg.d.size, soaksAt: msg.d.soaksAt };
        }
        return;
      }

      case 'land': {
        if (!this.#state) return;
        this.#state = {
          ...this.#state,
          air: this.#state.air.filter((d) => d.dropId !== msg.d.dropId),
          levels: msg.d.levels,
          out: msg.d.out,
        };
        if (this.#held?.dropId === msg.d.dropId) this.#held = null;
        // Only splash for something that actually hit this phone.
        if (msg.d.on === this.#me) this.#splash(msg.d.size);
        return;
      }

      case 'spill-over':
        if (!this.#state) return;
        this.#state = { ...this.#state, phase: 'done', levels: msg.d.levels, air: [] };
        this.#held = null;
        return;
    }
  }

  /**
   * Everything the renderer needs, resolved to this instant. `w`/`h` are the
   * canvas size in CSS pixels — positions cannot be computed without them.
   */
  view(w: number, h: number): View {
    const now = this.#now();
    const s = this.#state;
    const count = s?.levels[this.#me] ?? SPILL_START_LEVEL;
    this.#expireStaleHold(now);

    const visible: Visible[] = [];
    for (const drop of s?.air ?? []) {
      const v = this.#place(drop, w, h, now);
      if (v) visible.push(v);
    }

    this.#splashes = this.#splashes.filter((sp) => now - sp.at < SPLASH_MS);

    return {
      // The pool is drawn against the losing level, so a full screen *is*
      // losing — the height means something rather than being decorative.
      level: Math.max(0, Math.min(1, count / SPILL_LOSE_LEVEL)),
      count,
      visible,
      held: this.#held ? { size: this.#held.size, soaksAt: this.#held.soaksAt } : null,
      splashes: this.#splashes,
      lockedUntil: Math.max(this.#lockedUntil, this.#optimisticLock),
    };
  }

  /* ------------------------- what we send -------------------------- */

  /**
   * Turn a drag into a flick. `dx`/`dy` are the gesture in CSS pixels, `dt` its
   * duration in ms, `h` the canvas height — speed goes on the wire in screen
   * heights per second so the server never needs to know how big this phone is.
   */
  fling(dx: number, dy: number, dt: number, h: number): { angle: number; speed: number } {
    const dist = Math.hypot(dx, dy);
    const seconds = Math.max(dt, 16) / 1000;
    const speed = Math.max(SPILL_SPEED_MIN, Math.min(SPILL_SPEED_MAX, dist / h / seconds));
    // Screen angle is measured clockwise from the top of the screen, which is
    // the convention shared/spillGeometry.ts expects.
    const angle = Math.atan2(dx, -dy);
    // Lock immediately rather than waiting for the echo: on a slow link the
    // button would otherwise stay live long enough to double-fling.
    this.#optimisticLock = this.#now() + 250;
    return { angle, speed };
  }

  /** The seat a flick at this angle would hit, for the aim preview. */
  target(angle: number): number | null {
    const seat = this.seat;
    if (seat < 0) return null;
    return aimSeat(seat, angle, this.seatCount);
  }

  /** Straight at a named seat — the tap-a-seat fallback (spec §11). */
  angleToSeat(seat: number): number {
    return screenAngleTo(this.seat, seat, this.seatCount);
  }

  /** The catchable drop under a touch, if any. */
  catchAt(x: number, y: number, w: number, h: number): SpillDrop | null {
    const now = this.#now();
    let best: SpillDrop | null = null;
    let bestD = CATCH_RADIUS;
    for (const drop of this.#state?.air ?? []) {
      const v = this.#place(drop, w, h, now);
      if (!v || v.phase !== 'arriving') continue;
      const d = Math.hypot(v.x - x, v.y - y);
      if (d < bestD) {
        bestD = d;
        best = drop;
      }
    }
    return best;
  }

  heldId(): string | null {
    return this.#held?.dropId ?? null;
  }

  /* ---------------------------------------------------------------- */

  /**
   * Where a drop is on *this* screen, or null when it is over the table and
   * nobody can see it. Flight is derived entirely from the server's timestamps,
   * so two phones showing the same drop agree without exchanging another byte.
   */
  #place(drop: SpillDrop, w: number, h: number, now: number): Visible | null {
    const s = this.#state;
    if (!s) return null;
    const mine = this.seat;

    if (drop.from === mine && now < drop.leavesAt) {
      const p = clamp01((now - drop.launchedAt) / Math.max(1, drop.leavesAt - drop.launchedAt));
      const reach = Math.hypot(w, h) / 2 + 40;
      return {
        drop,
        x: w / 2 + Math.sin(drop.angle) * p * reach,
        y: h / 2 - Math.cos(drop.angle) * p * reach,
        phase: 'leaving',
      };
    }

    if (drop.to === mine && now >= drop.arrivesAt - SPILL_APPROACH_MS && now < drop.arrivesAt) {
      // It comes in from the direction of whoever threw it — the whole point of
      // arranging the phones in the first place.
      const bearing = screenAngleTo(mine, drop.from, s.seats.length);
      const reach = Math.hypot(w, h) / 2 + 40;
      const ex = w / 2 + Math.sin(bearing) * reach;
      const ey = h / 2 - Math.cos(bearing) * reach;
      const p = clamp01(1 - (drop.arrivesAt - now) / SPILL_APPROACH_MS);
      const tx = w / 2;
      const ty = h / 2;
      return { drop, x: ex + (tx - ex) * p, y: ey + (ty - ey) * p, phase: 'arriving' };
    }

    return null;
  }

  #splash(size: number): void {
    this.#splashes.push({ x: 0.5, y: 0.5, at: this.#now(), size });
  }

  /**
   * Belt and braces for the hold.
   *
   * A held payload has exactly two ends: we throw it on (the server echoes
   * `replaces`) or it soaks in (the server sends `land`). If neither frame
   * arrives well after `soaksAt`, our copy is stale — the server has certainly
   * resolved it by now. Letting it linger would attach a dead id to every
   * subsequent fling and lock the player out, which is far too harsh a
   * punishment for one dropped frame.
   */
  #expireStaleHold(now: number): void {
    if (this.#held && now > this.#held.soaksAt + HOLD_GRACE_MS) this.#held = null;
  }
}

/** How long a splash animation runs. Shared with the renderer. */
export const SPLASH_MS = 600;

/** How long past a hold's expiry we wait for the server before giving up on it. */
const HOLD_GRACE_MS = 2_000;

/** Touch slop for grabbing an incoming drop — a fingertip is about this wide. */
const CATCH_RADIUS = 56;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
