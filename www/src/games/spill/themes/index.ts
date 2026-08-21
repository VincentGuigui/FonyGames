/**
 * Spill's look, behind an interface. Spec: docs/specs/games/spill.md §6
 *
 * The theme owns **everything visual and nothing else**. The rules live in
 * `game.ts` and never mention water or anything else drawable, and `render.ts`
 * owns *when* and *where* rather than *what*.
 *
 * There is exactly one theme — water — and the seam stays anyway, because it is
 * what keeps the drawing out of the rules. A second one is a new file
 * implementing `Theme`; it is not a player-facing setting, so there is no picker.
 */

export type ThemeDraw = {
  ctx: CanvasRenderingContext2D;
  /** Canvas size in CSS pixels. */
  w: number;
  h: number;
  /** Seconds since the round started; drives all animation. */
  t: number;
  /** True when the player asked for less motion — flatten, do not remove. */
  calm: boolean;
  /**
   * Device pixel ratio the canvas is scaled by, capped at 2.
   *
   * Every draw coordinate here is a CSS pixel, so a theme drawing a sprite has to
   * pass this through to `SpriteSheet.at()` — that is the only thing it is for.
   */
  dpr: number;
};

export type Theme = {
  id: string;
  name: string;
  accent: string;
  /** Background behind everything. */
  drawBackdrop(d: ThemeDraw): void;
  /** The pool the player is trying to empty. `level` is 0..1. */
  drawPool(d: ThemeDraw, level: number, tilt: number): void;
  /** One projectile in flight. `size` is 1 normally, 2+ after a catch. */
  drawProjectile(d: ThemeDraw, x: number, y: number, size: number): void;
  /** Impact at a point. `age` is 0..1 through the splash animation. */
  drawSplash(d: ThemeDraw, x: number, y: number, age: number): void;
  /** So no UI string hardcodes "drops". */
  words: Record<'en' | 'fr', { unit: string; unitPlural: string; verb: string }>;
};

import { waterTheme } from './water';

export { waterTheme };

/** The theme in use. One indirection, so no caller reaches for `waterTheme`. */
export const SPILL_THEME: Theme = waterTheme;
