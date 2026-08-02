import {
  SIEGE_CABBAGES,
  type Goat,
  type GoatState,
  type PlayerId,
  type ServerMessage,
} from '../../../../shared/protocol';
import { LANDING_Y } from './layout';

/**
 * Goat Siege, client side. Spec: docs/specs/games/goat-siege.md
 *
 * Holds **no rules**: cabbage counts, splits and eliminations are all decided
 * in the Durable Object. What lives here is a projection of the last thing the
 * server said, plus the arithmetic to place a goat at this instant.
 *
 * A goat's whole flight is derived from `launchedAt`/`arrivesAt`, so two phones
 * showing the same goat agree without exchanging another byte.
 */

export type Flying = {
  goat: Goat;
  /** Position in CSS pixels. */
  x: number;
  y: number;
  /** 0..1 through the flight; drives scale, so a goat looms as it nears. */
  progress: number;
};

export type Chomp = { x: number; at: number };

export type SiegeView = {
  cabbages: number;
  /** Incoming goats, nearest to landing last so they draw on top. */
  incoming: Flying[];
  chomps: Chomp[];
  out: boolean;
  spectating: boolean;
};

/** How long the chomp animation runs. */
export const CHOMP_MS = 500;

/** Touch slop for shooing — generous, because the targets move. */
const SHOO_RADIUS = 54;

export class SiegeGame {
  #me: PlayerId = '';
  #now: () => number = () => Date.now();
  #state: GoatState | null = null;
  #chomps: Chomp[] = [];

  identify(me: PlayerId, now: () => number): void {
    this.#me = me;
    this.#now = now;
  }

  get state(): GoatState | null {
    return this.#state;
  }

  get playing(): boolean {
    const s = this.#state;
    return !!s && s.phase === 'running' && s.players.includes(this.#me) && !s.out.includes(this.#me);
  }

  /** Everyone still defending a patch, apart from us. */
  targets(): PlayerId[] {
    const s = this.#state;
    if (!s) return [];
    return s.players.filter((p) => p !== this.#me && !s.out.includes(p));
  }

  apply(msg: ServerMessage): void {
    switch (msg.t) {
      case 'siege':
        this.#state = msg.d;
        return;

      case 'goat':
        if (!this.#state) return;
        this.#state = { ...this.#state, air: [...this.#state.air, msg.d] };
        return;

      case 'split':
        if (!this.#state) return;
        this.#state = {
          ...this.#state,
          air: [...this.#state.air.filter((g) => g.goatId !== msg.d.goatId), ...msg.d.kids],
        };
        return;

      case 'chomp': {
        if (!this.#state) return;
        const eaten = this.#state.air.find((g) => g.goatId === msg.d.goatId);
        this.#state = {
          ...this.#state,
          air: this.#state.air.filter((g) => g.goatId !== msg.d.goatId),
          cabbages: msg.d.cabbages,
          out: msg.d.out,
        };
        if (msg.d.victim === this.#me) {
          this.#chomps.push({ x: eaten?.lane ?? 0.5, at: this.#now() });
        }
        return;
      }

      case 'siege-over':
        if (!this.#state) return;
        this.#state = { ...this.#state, phase: 'done', cabbages: msg.d.cabbages, air: [] };
        return;
    }
  }

  view(w: number, h: number): SiegeView {
    const now = this.#now();
    const s = this.#state;
    this.#chomps = this.#chomps.filter((c) => now - c.at < CHOMP_MS);

    const incoming = (s?.air ?? [])
      .filter((g) => g.victim === this.#me)
      .map((g) => this.#place(g, w, h, now))
      .filter((f): f is Flying => f !== null)
      .sort((a, b) => a.progress - b.progress);

    return {
      cabbages: s?.cabbages[this.#me] ?? SIEGE_CABBAGES,
      incoming,
      chomps: this.#chomps,
      out: !!s && s.out.includes(this.#me),
      spectating: !s || !s.players.includes(this.#me),
    };
  }

  /** The goat under a tap, if any. */
  shooAt(x: number, y: number, w: number, h: number): Goat | null {
    const now = this.#now();
    let best: Goat | null = null;
    // Ranked by distance **as a fraction of each goat's own reach**, not by raw
    // pixels — a plain distance cap would cancel out the larger target a nearer
    // goat is supposed to present.
    let bestScore = 1;
    for (const g of this.#state?.air ?? []) {
      if (g.victim !== this.#me) continue;
      const f = this.#place(g, w, h, now);
      if (!f) continue;
      // A goat that is nearly on the cabbages is bigger and easier to hit,
      // which is what makes a late tap feel fair rather than lucky.
      const reach = SHOO_RADIUS * (0.6 + f.progress * 0.6);
      const score = Math.hypot(f.x - x, f.y - y) / reach;
      if (score < bestScore) {
        bestScore = score;
        best = g;
      }
    }
    return best;
  }

  /**
   * A goat's arc: it comes over the fence at its lane and drops onto the patch.
   * The horizontal drift is small — the lane is where it will land, and a goat
   * that wandered across the screen would be unfair to track.
   */
  #place(goat: Goat, w: number, h: number, now: number): Flying | null {
    const span = Math.max(1, goat.arrivesAt - goat.launchedAt);
    const p = (now - goat.launchedAt) / span;
    if (p < 0 || p > 1) return null;

    const x = w * (0.5 + (goat.lane - 0.5) * (0.35 + 0.65 * p));
    // Ease into the ground so the last moments are the slow, tappable ones.
    const y = h * LANDING_Y * (p * p * 0.55 + p * 0.45);
    return { goat, x, y, progress: p };
  }
}
