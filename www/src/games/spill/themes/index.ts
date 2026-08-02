/**
 * Theme registry for Spill. Spec: docs/specs/games/spill.md §6
 *
 * A theme owns **everything visual and nothing else**. The rules live in
 * `game.ts` and never mention water, balloons or anything else drawable —
 * swapping the artistic direction must never change how the game plays.
 *
 * Adding a theme = one new file + one line in THEMES below.
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
};

export type Theme = {
  id: string;
  /** Shown in the lobby picker. */
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
  words: { unit: string; unitPlural: string; verb: string };
};

import { waterTheme } from './water';
import { balloonTheme } from './balloon';

export const THEMES: Theme[] = [waterTheme, balloonTheme];

export const DEFAULT_THEME_ID = waterTheme.id;

export function themeById(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? waterTheme;
}
