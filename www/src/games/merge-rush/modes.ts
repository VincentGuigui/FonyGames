import type { MergeMode } from '../../../../shared/protocol';
import { tileValue } from '../../../../shared/merge';

/** What each mode is called, in both languages. Spec: docs/specs/games/merge-rush.md §3 */

type Both = { en: string; fr: string };

export function modeName(mode: MergeMode, target: number): Both {
  if (mode === 'race') return { en: `Race to ${tileValue(target)}`, fr: `Course à ${tileValue(target)}` };
  if (mode === 'highlander') return { en: 'Highlander', fr: 'Highlander' };
  return { en: 'Time Attack', fr: 'Contre-la-montre' };
}

export function modeBlurb(mode: MergeMode): Both {
  if (mode === 'race') return { en: 'First to make the tile wins', fr: 'Le premier à faire la tuile gagne' };
  if (mode === 'highlander') {
    return { en: 'There can be only one: merge the puzzle down to one tile', fr: 'Il ne doit en rester qu’une : fusionnez jusqu’à une seule tuile' };
  }
  return { en: 'Two minutes, highest score wins', fr: 'Deux minutes, le meilleur score gagne' };
}
