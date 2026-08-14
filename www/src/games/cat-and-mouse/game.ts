import {
  CM_GRAB_SLOP,
  CM_TICK_MS,
  type CatMouseState,
  type PlayerId,
  type ServerMessage,
} from '../../../../shared/protocol';
import { clampToFloor, dist, walk, type Point } from '../../../../shared/catMouse';

/**
 * Cat and Mouse on this phone. Spec: docs/specs/games/cat-and-mouse.md
 *
 * Two jobs, and they are deliberately different from each other:
 *
 * 1. **Your own icon is yours.** You move it here, at frame rate, and tell the
 *    server where it went. It never waits for a round trip — a chase that lagged
 *    behind your finger would be a different and much worse game. The server
 *    bounds the result (spec §9) and can pull you back, which is the trade.
 *
 * 2. **Everyone else arrives on a 15 Hz tick**, so they are *interpolated*
 *    between the last two frames rather than snapped to the newest one. Snapping
 *    at 15 Hz reads as a stutter, and this is a game about reading someone's
 *    movement — a stuttering mouse is unreadable, so smoothing it is part of the
 *    rules being legible rather than a flourish (spec §4).
 *
 * No `Ctx` here and no test alongside: what this file owns is *feel*, which the
 * harness cannot judge. The rules all live in `worker/catMouse.ts`, which has one.
 */

type Remote = {
  /** The two most recent server frames, oldest first. */
  from: Point;
  to: Point;
  /** Server times the two frames were taken. */
  fromAt: number;
  toAt: number;
};

export type Drawable = {
  playerId: PlayerId;
  x: number;
  y: number;
  isCat: boolean;
  isMe: boolean;
  lives: number;
  /** Untouchable until this server time, or 0. */
  graceUntil: number;
  out: boolean;
};

export class CatMouseGame {
  state: CatMouseState | null = null;
  /**
   * How the last round ended. Null until one does.
   *
   * `CatMouseState` cannot carry it: the winner here is a side, not a player, and
   * `lastedMs` arrives on the `cm-over` frame and nowhere else.
   */
  result: { catWins: boolean; survivors: PlayerId[]; lastedMs: number } | null = null;

  #me: PlayerId | null = null;
  #now: () => number = () => Date.now();

  /** My own position, authoritative locally, corrected by the server. */
  #mine: Point | null = null;
  /** `capped` only: where my finger last said to go. Cleared on release. */
  #target: Point | null = null;
  /** True while a finger is down on my icon. */
  #held = false;
  #lastStep = 0;

  #remote = new Map<PlayerId, Remote>();
  /** Server time of the last position I sent, so `move` is rate-limited. */
  #sentAt = 0;

  identify(me: PlayerId, now: () => number): void {
    this.#me = me;
    this.#now = now;
  }

  get me(): PlayerId | null {
    return this.#me;
  }

  get iAmCat(): boolean {
    return this.state !== null && this.state.catId === this.#me;
  }

  /** True once the rules panel has cleared and input is accepted (spec §6). */
  get live(): boolean {
    const s = this.state;
    return s !== null && s.phase === 'running' && this.#now() >= s.startsAt;
  }

  apply(msg: ServerMessage): void {
    switch (msg.t) {
      case 'cm':
        this.state = msg.d;
        this.#reset(msg.d);
        return;
      case 'cm-frame': {
        if (!this.state || msg.d.roundId !== this.state.roundId) return;
        for (const [id, p] of Object.entries(msg.d.pos)) {
          if (id === this.#me) {
            /*
             * The server's word on where I am.
             *
             * **While a finger is down, my own position is the local truth.** The
             * frame in this message was taken at `at`, which is already a tick or
             * more old, so a walking icon is legitimately ahead of it — and the
             * gap grows with the walk. Adopting it would drag the icon backwards
             * every frame.
             *
             * That is not hypothetical: an earlier version corrected on a 0.08
             * gap *and* cleared the destination, so `capped` walked about a
             * quarter of the way to the finger and then stopped for good. The
             * destination is the player's stated intent and is never thrown away
             * here — only a release or a respawn clears it.
             *
             * On release the server's word is taken, because a stopped icon
             * should sit exactly where the referee thinks it is. And a gap too
             * big to be lag is adopted either way: that is a truncated speed hack
             * being pulled back into line.
             */
            const mine = this.#mine;
            if (mine) {
              const server = { x: p[0], y: p[1] };
              const gap = dist(mine, server);
              if (gap > 0.25 || (!this.#held && gap > 0.01)) this.#mine = server;
            }
            continue;
          }
          this.#push(id, { x: p[0], y: p[1] }, msg.d.at);
        }
        return;
      }
      case 'cm-catch': {
        const s = this.state;
        if (!s || msg.d.roundId !== s.roundId) return;
        const a = s.actors.find((x) => x.playerId === msg.d.victim);
        if (a) {
          a.lives = msg.d.lives;
          a.graceUntil = msg.d.graceUntil;
          a.out = msg.d.out;
          a.x = msg.d.x;
          a.y = msg.d.y;
        }
        if (msg.d.victim === this.#me) {
          // Being caught is the one time my own icon moves without my finger.
          // The finger is released too, or a held drag would immediately walk the
          // respawned mouse back toward wherever the cat is standing.
          this.#mine = { x: msg.d.x, y: msg.d.y };
          this.#target = null;
          this.#held = false;
        } else {
          this.#snap(msg.d.victim, { x: msg.d.x, y: msg.d.y });
        }
        return;
      }
      case 'cm-over': {
        const s = this.state;
        if (!s || msg.d.roundId !== s.roundId) return;
        this.state = { ...s, phase: 'done' };
        /*
         * The result, kept: this is the one game where the winner is a SIDE, so there is
         * no winning player id to read back off the state — and `lastedMs` exists nowhere
         * else. The end screen needs both.
         */
        this.result = { catWins: msg.d.catWins, survivors: msg.d.survivors, lastedMs: msg.d.lastedMs };
        this.#held = false;
        this.#target = null;
        return;
      }
      default:
        return;
    }
  }

  #reset(s: CatMouseState): void {
    this.#remote.clear();
    this.#target = null;
    this.#held = false;
    this.#sentAt = 0;
    this.#lastStep = this.#now();
    const mine = s.actors.find((a) => a.playerId === this.#me);
    this.#mine = mine ? { x: mine.x, y: mine.y } : null;
    for (const a of s.actors) {
      if (a.playerId === this.#me) continue;
      this.#snap(a.playerId, { x: a.x, y: a.y });
    }
  }

  #snap(id: PlayerId, p: Point): void {
    const at = this.#now();
    this.#remote.set(id, { from: p, to: p, fromAt: at - CM_TICK_MS, toAt: at });
  }

  #push(id: PlayerId, p: Point, at: number): void {
    const prev = this.#remote.get(id);
    if (!prev) {
      this.#snap(id, p);
      return;
    }
    // Out-of-order or duplicate frames are dropped rather than rewinding
    // somebody: UDP-like reordering does not happen on a WebSocket, but a resync
    // can replay an older instant.
    if (at <= prev.toAt) return;
    this.#remote.set(id, { from: prev.to, to: p, fromAt: prev.toAt, toAt: at });
  }

  /* ------------------------------- input ------------------------------- */

  /**
   * A finger went down. True when it landed on **my own icon** (spec §6).
   *
   * You must grab your own icon rather than the icon jumping to wherever you
   * touch: tapping the far side of the floor would be a teleport, and a teleport
   * is not a chase.
   */
  grab(x: number, y: number): boolean {
    if (!this.live || !this.#mine) return false;
    const a = this.state?.actors.find((q) => q.playerId === this.#me);
    if (a?.out) return false;
    if (dist(this.#mine, { x, y }) > CM_GRAB_SLOP) return false;
    this.#held = true;
    this.#lastStep = this.#now();
    // `direct` starts tracking immediately; `capped` needs somewhere to walk to,
    // and the grab point is where the icon already is, so it stays put until the
    // finger moves off it.
    this.#target = { x, y };
    return true;
  }

  /** The finger moved. In `direct` this *is* the position; in `capped` it is a destination. */
  drag(x: number, y: number): void {
    if (!this.#held || !this.live) return;
    const p = clampToFloor({ x, y });
    if (this.state?.drag === 'capped') {
      this.#target = p;
      return;
    }
    this.#mine = p;
  }

  /**
   * The finger came up. The icon stops **dead**, and in `capped` the destination
   * is dropped rather than walked out.
   *
   * That is the game's signature rule (spec §6): an icon that coasted on after
   * release would be playable without holding at all, which is a different game.
   */
  release(): void {
    this.#held = false;
    this.#target = null;
  }

  get holding(): boolean {
    return this.#held;
  }

  /* ------------------------------ per frame ----------------------------- */

  /**
   * Advance my own icon and report it. Called once per animation frame.
   *
   * `send` is invoked at most every `CM_TICK_MS`: the server broadcasts on its own
   * tick, so telling it 60 times a second would triple the inbound bill — the one
   * metered direction (spec §4) — and change nothing anyone sees.
   */
  advance(send: (p: Point) => void): void {
    const now = this.#now();
    const dt = Math.min(200, Math.max(0, now - this.#lastStep));
    this.#lastStep = now;
    if (!this.live || !this.#mine) return;

    if (this.state?.drag === 'capped' && this.#held && this.#target) {
      this.#mine = walk(this.#mine, this.#target, this.iAmCat, dt);
    }

    // A still icon sends nothing. Input only exists while a finger is down, so
    // the wire is quiet exactly when the game is (spec §4).
    if (!this.#held) return;
    if (now - this.#sentAt < CM_TICK_MS) return;
    this.#sentAt = now;
    send(this.#mine);
  }

  /** Everyone on the floor, at this instant, ready to draw. */
  view(): Drawable[] {
    const s = this.state;
    if (!s) return [];
    const now = this.#now();

    return s.actors
      .filter((a) => !a.out)
      .map((a) => {
        const isMe = a.playerId === this.#me;
        const p = isMe ? (this.#mine ?? { x: a.x, y: a.y }) : this.#interp(a.playerId, a, now);
        return {
          playerId: a.playerId,
          x: p.x,
          y: p.y,
          isCat: a.playerId === s.catId,
          isMe,
          lives: a.lives,
          graceUntil: a.graceUntil,
          out: a.out,
        };
      });
  }

  /**
   * Where someone else is, between the last two ticks.
   *
   * Rendered ~90 ms behind the newest frame, which is what makes it interpolation
   * rather than extrapolation: guessing forward from a velocity puts an icon
   * where its player never went and then yanks it back, and in a chase that reads
   * as the other player teleporting. A fixed delay is honest and smooth. The cost
   * is that a catch can look slightly late on a bystander's screen — and the
   * server decides catches anyway, so nothing is scored on what this shows.
   */
  #interp(id: PlayerId, fallback: Point, now: number): Point {
    const r = this.#remote.get(id);
    if (!r) return fallback;
    const span = r.toAt - r.fromAt;
    if (!(span > 0)) return r.to;
    const t = (now - CM_TICK_MS - r.fromAt) / span;
    const k = Math.min(1, Math.max(0, t));
    return { x: r.from.x + (r.to.x - r.from.x) * k, y: r.from.y + (r.to.y - r.from.y) * k };
  }

  /** My lives, or null when I am the cat — which has none and cannot be caught. */
  myLives(): number | null {
    if (this.iAmCat) return null;
    return this.state?.actors.find((a) => a.playerId === this.#me)?.lives ?? null;
  }

  /** Server time the round ends, for the clock in the chrome. */
  endsAt(): number {
    return this.state?.endsAt ?? 0;
  }
}
