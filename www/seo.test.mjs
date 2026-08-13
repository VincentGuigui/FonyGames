/**
 * The rules that keep a shared link previewing correctly.
 * Contract: docs/specs/seo.md §3
 *
 * Every assertion here guards a failure that is **invisible from the site itself**. A
 * missing or wrong `og:` tag changes nothing you can see in a browser; you find out when
 * somebody pastes a link into a group chat and it comes out as a bare URL. That is also
 * the state this project shipped in until 2026-08-06, on the one product whose entire
 * distribution mechanism is pasting a link into a group chat.
 *
 * Specifically:
 *
 * - a **relative** `og:image` is ignored by most scrapers, silently;
 * - an **SVG** `og:image` is rejected by iMessage, WhatsApp, X and Facebook, silently;
 * - an `og:image` pointing at a file that does not exist is a preview with a blank
 *   space, and `vite build` will not notice, because `public/` is copied verbatim;
 * - an `og:description` that has drifted from `<meta name="description">` means the
 *   page and its preview describe the game differently;
 * - a page added later with no tags at all is the original bug, returning.
 *
 * `.mjs` for the same reason `cards.test.mjs` is: it reads source text with `fs`, and
 * this repo deliberately carries no `@types/node`. Paths resolve from `process.cwd()`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

const WWW = join(process.cwd(), 'www');
const ORIGIN = 'https://fonygames.guigui.fr';

/** Every page that ships, discovered — so one added later cannot be forgotten. */
function pages() {
  const out = [{ name: 'hub', dir: '', url: `${ORIGIN}/`, image: 'hub' }];
  for (const entry of readdirSync(WWW, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!existsSync(join(WWW, entry.name, 'index.html'))) continue;
    // The admin centre is deliberately not indexable and is checked separately below.
    if (entry.name === 'ops-placeholder') continue;
    out.push({
      name: entry.name,
      dir: entry.name,
      url: `${ORIGIN}/${entry.name}/`,
      image: entry.name,
    });
  }
  return out;
}

function meta(html, attribute, name) {
  // Collapsed whitespace first: the existing `<meta name="description">` is written
  // across three lines in every file, and a single-line pattern silently missed it.
  const flat = html.replace(/\s+/g, ' ');
  const re = new RegExp(`<meta ${attribute}="${name}" content="([^"]*)"`);
  return re.exec(flat)?.[1] ?? null;
}

const all = pages();
console.log('\nevery page carries the tags');

/*
 * Cross-checked against the build's own list of pages rather than a hardcoded count.
 *
 * This used to assert `all.length === 6`, which failed the moment a seventh game shipped and
 * taught nobody anything when it did — the number was not the property worth protecting. What
 * matters is that the set of directories with an `index.html` is exactly the set of Rollup
 * inputs: a page nobody builds is dead, and a built page nobody tagged has no preview.
 */
const built = new Set(
  [...readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
    .matchAll(/^\s*'?([a-z0-9-]+)'?:\s*'www\/([a-z0-9-]*)\/?index\.html'/gm)]
    .map((m) => (m[2] === '' ? 'hub' : m[2]))
    .filter((name) => name !== 'ops-placeholder'),
);
const found = new Set(all.map((p) => p.name));
check(
  `every built page has tags (${built.size} built)`,
  [...built].every((name) => found.has(name)),
  { built: [...built], found: [...found] },
);
check(
  'and every tagged page is one the build produces',
  [...found].every((name) => built.has(name)),
  { built: [...built], found: [...found] },
);

for (const page of all) {
  const file = join(WWW, page.dir, 'index.html');
  const html = readFileSync(file, 'utf8');
  const at = `${page.name}:`;

  const title = meta(html, 'property', 'og:title');
  const description = meta(html, 'property', 'og:description');
  const image = meta(html, 'property', 'og:image');
  const url = meta(html, 'property', 'og:url');

  check(`${at} og:title`, typeof title === 'string' && title.length > 0, title);
  check(`${at} og:description`, typeof description === 'string' && description.length > 0);
  check(`${at} twitter:card is summary_large_image`, meta(html, 'name', 'twitter:card') === 'summary_large_image');

  // ABSOLUTE. A relative og:image is ignored by most scrapers and nothing warns.
  check(`${at} og:image is absolute`, image?.startsWith(`${ORIGIN}/og/`) === true, image);
  // RASTER. SVG is rejected by every platform that matters — the free option is the
  // one that does not work.
  check(`${at} og:image is a PNG, not an SVG`, image?.endsWith('.png') === true, image);
  check(`${at} og:url is the canonical page`, url === page.url, url);
  check(`${at} canonical link agrees with og:url`, html.includes(`<link rel="canonical" href="${page.url}" />`));

  // The image has to EXIST. `public/` is copied verbatim, so a typo here is a 404 that
  // the build cannot see.
  const png = join(WWW, 'public/og', `${page.image}.png`);
  check(`${at} the preview image exists`, existsSync(png), png);
  if (existsSync(png)) {
    const kb = statSync(png).size / 1024;
    // Over ~300 KB and some scrapers give up, which shows as no preview at all.
    check(`${at} it is under the 300 KB scraper limit`, kb < 300, `${kb.toFixed(0)} KB`);
  }

  // The page and its preview must describe the game the same way.
  const pageDescription = meta(html, 'name', 'description');
  check(`${at} og:description matches the page description`, description === pageDescription, {
    og: description,
    page: pageDescription,
  });

  const pageTitle = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim() ?? null;
  check(`${at} og:title matches the page title`, title === pageTitle, { og: title, page: pageTitle });

  // Alt text is required on the card illustration by ui-guidelines §6; a shared link is
  // the one place a screen reader hears about the preview instead.
  const alt = meta(html, 'property', 'og:image:alt');
  check(`${at} og:image:alt describes the picture`, typeof alt === 'string' && alt.length > 10, alt);

  const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  check(`${at} has a JSON-LD block`, typeof ld === 'string');
  if (ld) {
    let parsed = null;
    try {
      parsed = JSON.parse(ld);
    } catch {
      // Left null; the assertion below reports it.
    }
    check(`${at} the JSON-LD parses`, parsed !== null);
    if (parsed) {
      const wanted = page.name === 'hub' ? 'WebSite' : 'VideoGame';
      check(`${at} it is a ${wanted}`, parsed['@type'] === wanted, parsed['@type']);
      check(`${at} its url matches the canonical`, parsed.url === page.url, parsed.url);
    }
  }
}

console.log('\nthe admin centre is the exception, and stays one');
const ops = join(WWW, 'ops-placeholder/index.html');
if (existsSync(ops)) {
  const html = readFileSync(ops, 'utf8');
  check('it is noindex', meta(html, 'name', 'robots')?.includes('noindex') === true);
  check('and carries no og: tags to advertise itself', !html.includes('property="og:'));
} else {
  check('the admin page exists to be checked', false, ops);
}

console.log('\nrobots.txt');
const robots = readFileSync(join(WWW, 'public/robots.txt'), 'utf8');
check('allows everything', /^Allow: \/$/m.test(robots));
check('points at the sitemap', robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`));
// THE assertion of this group. A Disallow line naming the admin path would publish the
// one thing that is supposed to be hard to guess, in the first file anyone reads.
check('and Disallows nothing — naming the admin path would publish it', !/^Disallow:/m.test(robots));

console.log('\nsitemap.xml');
const sitemap = readFileSync(join(WWW, 'public/sitemap.xml'), 'utf8');
for (const page of all) {
  check(`${page.name} is listed`, sitemap.includes(`<loc>${page.url}</loc>`), page.url);
}
// The admin path is a secret; a sitemap is the second file a crawler fetches.
check('the admin placeholder is not', !sitemap.includes('ops'), sitemap);
check('and every entry is absolute', (sitemap.match(/<loc>https:\/\//g) ?? []).length === all.length);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall passed');
