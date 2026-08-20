import type { GameCard } from '../types';
import type { Locale } from './locale';

/**
 * A `GameCard` with its French text substituted in, field by field — a game can ship
 * with only some fields translated, and the rest fall back to English rather than
 * leaving a blank. Spec: docs/specs/i18n.md
 *
 * Returns the same object for English (or a game with no `fr` block at all), so a
 * component that only ever sees English cards today keeps doing exactly that.
 */
export function localizeCard(card: GameCard, locale: Locale): GameCard {
  if (locale === 'en' || !card.fr) return card;

  const { fr } = card;
  return {
    ...card,
    ...(fr.title !== undefined ? { title: fr.title } : {}),
    ...(fr.pitch !== undefined ? { pitch: fr.pitch } : {}),
    ...(fr.concept !== undefined ? { concept: fr.concept } : {}),
    ...(fr.rules !== undefined ? { rules: fr.rules } : {}),
    ...(fr.art ? { art: { ...card.art, ...fr.art } } : {}),
  };
}
