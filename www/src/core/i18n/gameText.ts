import { useLocale } from './LocaleContext';
import type { Locale } from './locale';

/** Existing locales are complete; a newly-added locale may fall back to English. */
export type GameTextValue = { en: string; fr: string } & Partial<Record<Locale, string>>;
export type GameText = (value: GameTextValue) => string;

export function useGameText(): GameText {
  const { locale } = useLocale();
  return (value) => value[locale] ?? value.en;
}
