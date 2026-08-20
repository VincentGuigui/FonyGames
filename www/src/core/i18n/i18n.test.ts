import { detectLocale } from './locale';
import { localizeCard } from './localizeCard';
import type { GameCard } from '../types';

/**
 * Locale detection and card translation — the two pieces with actual logic in the
 * i18n layer. Everything else (`LocaleContext.tsx`) is state plumbing with no
 * decision worth a test of its own. Spec: docs/specs/i18n.md
 */

let failures = 0;
let checks = 0;

function check(what: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${what}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${what}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

console.log('\ndetectLocale: first supported match wins, English otherwise');

{
  check("a French tag before English picks French", detectLocale(['fr-FR', 'en']) === 'fr');
  check("plain 'fr' matches too", detectLocale(['fr']) === 'fr');
  check("English ahead of French picks English", detectLocale(['en-US', 'fr']) === 'en');
  check("an unsupported language falls back to English", detectLocale(['de-DE']) === 'en');
  check('an empty list falls back to English', detectLocale([]) === 'en');
  check("case does not matter", detectLocale(['FR-CA']) === 'fr');
}

console.log('\nlocalizeCard: French where given, English where not');

const card: GameCard = {
  slug: 'demo',
  title: 'Demo',
  pitch: 'A pitch',
  concept: 'A concept',
  rules: ['Rule one', 'Rule two'],
  art: { src: 'demo.svg', alt: 'A picture' },
  accent: '#000000',
  players: [2, 4],
  duration: '1 min',
  inputs: ['touch'],
  modes: [],
  status: 'live',
};

{
  check('English asks for the card untouched', localizeCard(card, 'en') === card);
  check('French with no fr block also falls back untouched', localizeCard(card, 'fr') === card);

  const full: GameCard = {
    ...card,
    fr: { title: 'Démo', pitch: 'Un pitch', concept: 'Un concept', rules: ['Règle un'], art: { alt: 'Une image' } },
  };
  const localized = localizeCard(full, 'fr');
  check('title is translated', localized.title === 'Démo');
  check('pitch is translated', localized.pitch === 'Un pitch');
  check('rules are translated', localized.rules[0] === 'Règle un');
  check("art.alt is translated, art.src is not", localized.art.alt === 'Une image' && localized.art.src === 'demo.svg');
  check('slug and accent are untouched', localized.slug === 'demo' && localized.accent === '#000000');

  const partial: GameCard = { ...card, fr: { title: 'Démo seulement' } };
  const partialLocalized = localizeCard(partial, 'fr');
  check('an untranslated field falls back to English', partialLocalized.pitch === 'A pitch');
  check('a translated field wins', partialLocalized.title === 'Démo seulement');
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
