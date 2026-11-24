import { MERGE_TARGET_ENDLESS, type MergeMode } from '../../../../shared/protocol';
import { tileValue } from '../../../../shared/merge';

/** What each mode is called, in both languages. Spec: docs/specs/games/double-fusion.md §3 */

type Both = { en: string; fr: string };

/** A race's target as the player reads it: the tile, or ∞. */
export function targetLabel(target: number): string {
  return target === MERGE_TARGET_ENDLESS ? '∞' : String(tileValue(target));
}

export function modeName(mode: MergeMode, target: number): Both {
  if (mode === 'race' && target === MERGE_TARGET_ENDLESS) return { en: 'Endless race', fr: 'Course sans fin' };
  if (mode === 'race') return { en: `Race to ${tileValue(target)}`, fr: `Course à ${tileValue(target)}` };
  if (mode === 'highlander') return { en: 'Highlander', fr: 'Highlander' };
  return { en: 'Crescendo', fr: 'Crescendo' };
}

export function modeBlurb(mode: MergeMode, target: number): Both {
  if (mode === 'race' && target === MERGE_TARGET_ENDLESS) {
    return { en: 'No finish line: play until you are stuck, biggest tile wins', fr: 'Pas de ligne d’arrivée : jouez jusqu’à être bloqué, la plus grosse tuile gagne' };
  }
  if (mode === 'race') return { en: 'First to make the tile wins', fr: 'Le premier à faire la tuile gagne' };
  if (mode === 'highlander') {
    return { en: 'Puzzle: there can be only one number left', fr: 'Puzzle : il ne doit rester qu’un seul nombre' };
  }
  return {
    en: 'Increasing difficulty levels',
    fr: 'Niveaux de difficulté croissante',
  };
}
