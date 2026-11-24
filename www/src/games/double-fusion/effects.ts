import { MERGE_MALUS_MOVES, type MergeMalusKind } from '../../../../shared/protocol';

/**
 * What the maluses still on a board will do, counted in its owner's moves.
 * Spec: docs/specs/games/double-fusion.md §3.1
 *
 * A freeze swallows the next swipes, fog hides the numbers, a stone stays and
 * gravity pulls everything down again, each for `MERGE_MALUS_MOVES` — moves, not
 * seconds, so a slow player is hit as hard as a fast one. Pure, so the phone and
 * the bot count the same way.
 */
export type Effects = { frozen: number; fog: number; stone: number; gravity: number };

export const CLEAR: Effects = { frozen: 0, fog: 0, stone: 0, gravity: 0 };

/** A malus lands. Stone is counted when it finds a cell (`stoned`), not here; explode and add last no time. */
export function afflict(e: Effects, kind: MergeMalusKind): Effects {
  if (kind === 'freeze') return { ...e, frozen: MERGE_MALUS_MOVES };
  if (kind === 'fog') return { ...e, fog: MERGE_MALUS_MOVES };
  if (kind === 'gravity') return { ...e, gravity: MERGE_MALUS_MOVES };
  return e;
}

export function stoned(e: Effects): Effects {
  return { ...e, stone: MERGE_MALUS_MOVES };
}

/** A swipe while frozen does nothing and uses one of the freeze's moves up. */
export function swallow(e: Effects): { swallowed: boolean; effects: Effects } {
  return e.frozen > 0 ? { swallowed: true, effects: { ...e, frozen: e.frozen - 1 } } : { swallowed: false, effects: e };
}

/**
 * A move was played. Gravity pulls everything down once more for it (`fall`),
 * and each effect has one move less; a stone that reaches none crumbles (`crumbled`).
 */
export function played(e: Effects): { effects: Effects; fall: boolean; crumbled: boolean } {
  const down = (n: number): number => Math.max(0, n - 1);
  return {
    effects: { frozen: e.frozen, fog: down(e.fog), stone: down(e.stone), gravity: down(e.gravity) },
    fall: e.gravity > 0,
    crumbled: e.stone === 1,
  };
}
