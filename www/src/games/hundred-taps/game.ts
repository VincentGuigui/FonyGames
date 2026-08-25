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
 * Unlike `TapTapGame`, there is no window to compute: every number is printed and
 * visible, so the board only ever needs two things per cell — its number, and
 * whether it's gone.
 */

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
/* The gradient: pink (top-right) → violet (bottom-left)               */
/* ------------------------------------------------------------------ */

/** The two endpoints. Distinct from every other game's accent colour (checked
 *  against every `card.ts` in the catalogue). */
export const GRADIENT_PINK = '#FF6FCF';
export const GRADIENT_VIOLET = '#7C3AED';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

/** Shortest-path hue interpolation, so a lerp never swings through unrelated hues. */
function lerpHue(a: number, b: number, t: number): number {
  let diff = b - a;
  if (diff > 180) diff -= 360;
  else if (diff < -180) diff += 360;
  return (a + diff * t + 360) % 360;
}

const PINK_HSL = rgbToHsl(...hexToRgb(GRADIENT_PINK));
const VIOLET_HSL = rgbToHsl(...hexToRgb(GRADIENT_VIOLET));

/**
 * A cell's fill colour, lerped in HSL along the diagonal from pink (top-right,
 * `t=0`) to violet (bottom-left, `t=1`). Pure and decorative only (spec §11) — a
 * cell's number and gone/live state never depend on it.
 */
export function cellColor(row: number, col: number, gridSize: number): string {
  const span = 2 * (gridSize - 1);
  const t = span === 0 ? 0 : (row + (gridSize - 1 - col)) / span;
  const h = lerpHue(PINK_HSL[0], VIOLET_HSL[0], t);
  const s = PINK_HSL[1] + (VIOLET_HSL[1] - PINK_HSL[1]) * t;
  const l = PINK_HSL[2] + (VIOLET_HSL[2] - PINK_HSL[2]) * t;
  return hslToHex(h, s, l);
}
