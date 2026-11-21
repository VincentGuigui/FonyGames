import { MERGE_TARGET_ENDLESS, type MergeMode } from '../../../../shared/protocol';
import { tileValue } from '../../../../shared/merge';

/** What each mode is called, in both languages. Spec: docs/specs/games/merge-rush.md §3 */

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
    return { en: 'There can be only one: merge the puzzle down to one tile', fr: 'Il ne doit en rester qu’une : fusionnez jusqu’à une seule tuile' };
  }
  return {
    en: 'Level after level, one more tile each time: most levels wins',
    fr: 'Niveau après niveau, une tuile de plus à chaque fois : le plus de niveaux gagne',
  };
}
