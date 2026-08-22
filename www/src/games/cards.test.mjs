/**
 * The rules that keep game cards cheap and their art correct.
 * Contract: docs/design/illustrations.md
 *
 * Nothing here tests behaviour. Every assertion guards a mistake that is either
 * **invisible** or shows up only as a slowly heavier hub — which is exactly the kind
 * that survives review:
 *
 * - a card importing its own game's runtime drags *every* game into the hub chunk,
 *   because the hub imports every card;
 * - `currentColor` in an art file renders **black on a dark card**, because an
 *   `<img>` is a separate document and cannot see the page's CSS;
 * - a `var(--…)` in an art file makes the shape **disappear**, same reason;
 * - a typo'd art path typechecks, because `*?url&no-inline` is a wildcard ambient
 *   module that accepts any string;
 * - and an **ill-formed** art file renders as nothing at all. An `<img>` parses SVG
 *   as strict XML, so a doubled hyphen inside a comment — perfectly legal in the
 *   inline JSX this art came from — blanks the whole card. That one cost a round
 *   trip: all thirteen files shipped broken and the build was green.
 *
 * ## Why this one is `.mjs` when every other test is `.ts`
 *
 * It inspects **source text**, not behaviour: `card.ts` reaches a `.svg` through a
 * Vite-only loader, so a node harness cannot import one anyway. Written as TypeScript
 * it would need `fs`, and therefore `@types/node`, which this repo deliberately does
 * not carry (see the note in `vite.config.ts`) — and which would put `process` and
 * `Buffer` into the global scope of browser code. Plain node reads the files, so
 * there is no bundle step and no dependency.
 *
 * Paths resolve from `process.cwd()`, the repo root under npm scripts.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

const GAMES_DIR = join(process.cwd(), 'www/src/games');

/** What a card may reach. Anything else drags weight into the hub. */
const ALLOWED = ['../../core/types', '../../../../shared/players'];

/**
 * The slugs `shared/players.ts` knows about, read as text.
 *
 * Deliberately not imported: this asserts something about the *file*, and importing
 * a `.ts` from node would mean a bundle step for one array of strings.
 */
function knownSlugs() {
  const src = readFileSync(join(process.cwd(), 'shared/players.ts'), 'utf8');
  const body = src.slice(src.indexOf('export const PLAYERS'), src.indexOf('} as const'));
  return new Set([...body.matchAll(/^\s+'?([a-z][a-z-]*)'?:\s*\[/gm)].map((m) => m[1]));
}

const folders = readdirSync(GAMES_DIR)
  .filter((n) => statSync(join(GAMES_DIR, n)).isDirectory())
  .sort();

const withCard = folders.filter((n) => existsSync(join(GAMES_DIR, n, 'card.ts')));

/**
 * Cheap well-formedness: tags balance and the root is a single `<svg>`.
 *
 * Not a real XML parser — node has none built in and this repo carries no
 * dependency for one. It catches the mistakes hand-edited SVG actually makes; the
 * doubled-hyphen check beside it catches the one that already happened.
 */
function wellFormedEnough(svg) {
  const tags = [...svg.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-zA-Z]+)([^>]*)>/g)];
  const stack = [];
  for (const [, closing, name, attrs] of tags) {
    if (closing) {
      if (stack.pop() !== name) return false;
    } else if (!attrs.trimEnd().endsWith('/')) {
      stack.push(name);
    }
  }
  return stack.length === 0 && tags[0]?.[2] === 'svg';
}

/** Every `import … from '<here>'` in a file. */
function specifiers(src) {
  return [...src.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
}

function folderHygiene() {
  console.log('\nthe game folders');
  const known = knownSlugs();
  check('shared/players.ts parsed', known.size > 0, known.size);
  const orphans = folders.filter((f) => !known.has(f));
  check('no game folder without player limits', orphans.length === 0, orphans);

  // Every game in the catalogue owns a folder, `soon` ones included: that is what
  // makes removing a game one `git rm -r` plus one line of registry.ts.
  const missingFolder = [...known].filter((s) => !folders.includes(s)).sort();
  check('every game in players.ts has a folder', missingFolder.length === 0, missingFolder);
  const missingCard = folders.filter((f) => !withCard.includes(f));
  check('every folder has a card.ts', missingCard.length === 0, missingCard);
}

function cardsAreLeaves() {
  console.log('\ncards are leaves');
  for (const game of withCard) {
    const rel = `games/${game}/card.ts`;
    const src = readFileSync(join(GAMES_DIR, game, 'card.ts'), 'utf8');

    for (const spec of specifiers(src)) {
      const isArt = spec.startsWith('./art/');
      const ok = isArt || ALLOWED.includes(spec);
      check(
        `${rel} may import ${spec}`,
        ok,
        ok
          ? undefined
          : 'the hub imports every card, so this drags the whole game into the hub' +
            ' chunk — see docs/design/illustrations.md §3',
      );
      if (!isArt) continue;

      // A typo here typechecks: ?url&no-inline is a wildcard ambient module.
      check(
        `${rel}'s ${spec} carries ?url&no-inline`,
        spec.endsWith('.svg?url&no-inline'),
        'without it Vite base64-inlines anything under 4096 bytes into the JS',
      );
      const file = spec.replace(/\?.*$/, '').replace('./', '');
      check(`${rel}'s ${spec} exists on disk`, existsSync(join(GAMES_DIR, game, file)), file);
    }
  }
}

function liveCardsHaveFrench() {
  console.log('\nlive cards have complete French copy');
  for (const game of withCard) {
    const src = readFileSync(join(GAMES_DIR, game, 'card.ts'), 'utf8');
    if (!/status:\s*'(live|new)'/.test(src)) continue;
    const start = src.indexOf('fr: {');
    const end = src.indexOf('\n  accent:', start);
    const fr = start >= 0 && end > start ? src.slice(start, end) : '';
    check(`${game} has a French block`, fr !== '');
    check(`${game} translates pitch`, /\bpitch\s*:/.test(fr));
    check(`${game} translates concept`, /\bconcept\s*:/.test(fr));
    check(`${game} translates rules`, /\brules\s*:/.test(fr));
    check(`${game} translates art alt text`, /\bart\s*:\s*\{\s*alt\s*:/.test(fr));
  }
}

function artIsSelfContained() {
  console.log('\nart files carry their own colour');
  const cards = folders
    .map((game) => ({ game, path: join(GAMES_DIR, game, 'art/card.svg') }))
    .filter((c) => existsSync(c.path));

  if (cards.length === 0) {
    console.log('  --   no art files yet');
    return;
  }

  for (const { game, path } of cards) {
    const svg = readFileSync(path, 'utf8');
    const rel = `${game}/art/card.svg`;
    // Markup only. The files carry a comment explaining *why* they use literal
    // hexes, and that comment names both forbidden things — checking the raw text
    // would fail every well-documented file.
    const markup = svg.replace(/<!--[\s\S]*?-->/g, '');

    // Both of these fail silently: the first renders black, the second vanishes.
    check(`${rel} has no currentColor`, !markup.includes('currentColor'));
    check(`${rel} has no CSS variable`, !markup.includes('var(--'));
    check(`${rel} is 120x90`, svg.includes('viewBox="0 0 120 90"'));

    // An <img> parses SVG as strict XML: any of these renders the card as nothing.
    const comments = [...svg.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);
    check(
      `${rel} has no doubled hyphen inside a comment`,
      comments.every((c) => !c.includes('--')),
      'illegal in XML, and an <img> rejects the whole document for it',
    );
    check(`${rel} opens and closes as one <svg>`, wellFormedEnough(svg), 'unbalanced tags');
    const bytes = new TextEncoder().encode(svg).length;
    check(`${rel} is under 40 KB`, bytes <= 40 * 1024, bytes);

    // The accent is necessarily written twice (illustrations.md §3). Prove they agree.
    const cardPath = join(GAMES_DIR, game, 'card.ts');
    if (!existsSync(cardPath)) continue;
    const accent = /accent:\s*'(#[0-9a-fA-F]{6})'/.exec(readFileSync(cardPath, 'utf8'));
    if (accent) {
      check(
        `${rel} uses its card's accent ${accent[1]}`,
        markup.toLowerCase().includes(accent[1].toLowerCase()),
        'the accent lives in both card.ts and card.svg and they must match',
      );
    }
  }
}

folderHygiene();
cardsAreLeaves();
liveCardsHaveFrench();
artIsSelfContained();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
