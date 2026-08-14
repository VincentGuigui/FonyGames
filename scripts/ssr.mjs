/**
 * Render the hub's markup at build time so PHP can serve it at request time.
 * Spec: docs/specs/seo.md §4
 *
 * ## The problem this shape solves
 *
 * The hub's HTML must change when the operator disables a game, with no rebuild. That
 * means rendering per request, and PHP cannot run Preact. The obvious workaround — a PHP
 * function that emits card markup — is a **second implementation of `GameCardTile`**, and
 * it would drift: silently, because the only reader of the server-rendered copy is a
 * crawler.
 *
 * So the build renders the real components and leaves PHP with nothing to author:
 *
 *   dist/_hub/shell.html   the whole page, with a marker where the cards go
 *   dist/_hub/cards.php    slug → variant → the rendered <li> string
 *   dist/index.php         shell + the variants the current flags select
 *
 * A "variant" is one (availability × isNew × hot × showAll) combination. They are
 * enumerated mechanically by calling `cardState()` — the same function the hub, the admin
 * centre and the Worker's rules all use — so no decision is duplicated anywhere. `hot`
 * doubles the count and most of the new entries are byte-identical to their twin, because
 * only an `active` card wears the badge; that redundancy is the price of `index.php` being
 * able to ask for a key without first knowing which combinations collapse.
 *
 * ## Why the Vite manifest is read
 *
 * Hydration compares the server's markup to the client's. Every card contains an
 * `<img src>` pointing at a content-hashed asset, so rendering with anything other than
 * the real hashed URL produces a mismatch — Preact would patch it, but a mismatch is the
 * symptom this whole design exists to avoid, and it would be reported as a console
 * warning nobody could explain. The manifest is where Vite publishes that mapping.
 *
 * Usage:  node scripts/ssr.mjs      (runs as part of `npm run build`)
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { build as esbuild } from 'esbuild';

const ROOT = resolve(process.cwd());
const DIST = join(ROOT, 'dist');
const OUT = join(DIST, '_hub');
const MANIFEST = join(DIST, '.vite/manifest.json');
const CACHE = join(ROOT, 'node_modules/.cache');

if (!existsSync(MANIFEST)) {
  console.error('ssr: dist/.vite/manifest.json is missing — run `vite build` first');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

/** `src/games/x/art/card.svg` → `/assets/card-HASH.svg`, exactly as the client sees it. */
const assets = {};
for (const [key, entry] of Object.entries(manifest)) {
  if (key.endsWith('.svg')) assets[key] = `/${entry.file}`;
}

/*
 * Bundle a tiny entry for node.
 *
 * Two things have to be replaced, and both are Vite-only:
 *
 *  - `?url&no-inline` SVG imports, which must become the manifest's hashed URL;
 *  - CSS imports, which node has no use for.
 *
 * Done with an esbuild **plugin**, not a `--loader` flag. `--loader:.svg=text` looked
 * simpler and was wrong: the specifier is `./art/card.svg?url&no-inline`, and the query
 * string means esbuild does not see a `.svg` extension at all. What came out was the
 * file's whole text sitting inside an `<img src>`, which then had to be string-matched
 * back out of the rendered HTML — fragile, and it broke on the renderer's attribute
 * escaping. Resolving the import to the URL up front is exact.
 *
 * esbuild rather than Vite's own SSR build: this needs two shims and no dev server, and
 * a second Vite config is a second place for the two builds to diverge.
 */
mkdirSync(CACHE, { recursive: true });

const ENTRY = join(CACHE, 'ssr-entry.mjs');
writeFileSync(
  ENTRY,
  `import { renderToString } from 'preact-render-to-string';
import { h } from 'preact';
import { Hub } from '${join(ROOT, 'www/src/hub/Hub.tsx')}';
import { GameCardTile } from '${join(ROOT, 'www/src/hub/GameCardTile.tsx')}';
import { HubGrid } from '${join(ROOT, 'www/src/hub/HubGrid.tsx')}';
import { catalogue } from '${join(ROOT, 'www/src/games/registry.ts')}';
import { cardState } from '${join(ROOT, 'shared/flags.ts')}';

/** The marker index.php splices cards into. An element, so Preact renders it verbatim. */
const MARKER = h('fony-grid', null);

export function shell() {
  return renderToString(h(Hub, { flags: {}, showAll: false, grid: MARKER }));
}

/**
 * Every card, in every state a flag can put it in.
 *
 * The reason for a disabled card is the ONE runtime string, so it is rendered with a
 * sentinel that index.php substitutes — escaped — at request time.
 */
export function cards() {
  const out = {};
  for (const game of catalogue()) {
    const variants = {};
    for (const availability of ['active', 'disabled', 'hidden']) {
      for (const isNew of [false, true]) {
        for (const hot of [false, true]) {
          for (const showAll of [false, true]) {
            const flag = { availability, isNew, reason: '%%REASON%%' };
            // Ask cardState whether it renders at all, rather than assuming: a hidden
            // game is absent from the document entirely on prod and present on dev.
            const view = cardState(game.status, flag, showAll, hot);
            const key = availability + ':' + (isNew ? 1 : 0) + ':' + (hot ? 1 : 0) + ':' + (showAll ? 1 : 0);
            variants[key] = view.show
              ? renderToString(h(GameCardTile, { game, flag, showAll, hot }))
              : '';
          }
        }
      }
    }
    out[game.slug] = variants;
  }
  return out;
}

/** The curated order. index.php walks this, so the grid order is never PHP's decision. */
export function order() {
  return catalogue().map((g) => g.slug);
}

/**
 * The grid's own wrapper, taken from HubGrid's real output.
 *
 * So \`<ul class="hub__grid">\` is authored in exactly one place. Hard-coding it here
 * would be a second copy of a class name that hub.css depends on, and it would go stale
 * the first time the grid gained an attribute.
 */
export function gridShell() {
  const html = renderToString(h(HubGrid, { flags: {}, showAll: false }));
  const open = /^<ul[^>]*>/.exec(html);
  if (!open || !html.endsWith('</ul>')) {
    throw new Error('HubGrid no longer renders a single <ul> — the shell cannot be derived');
  }
  return { open: open[0], close: '</ul>' };
}
`,
);

const BUNDLE = join(CACHE, 'ssr.mjs');

/** Resolve Vite-only imports the way Vite would, using the real build's manifest. */
const vitePlugin = {
  name: 'vite-shims',
  setup(build) {
    // `import art from './art/card.svg?url&no-inline'` → the hashed URL.
    build.onResolve({ filter: /\.svg(\?.*)?$/ }, (args) => {
      const bare = args.path.split('?')[0];
      const absolute = resolve(dirname(args.importer), bare);
      const key = relative(join(ROOT, 'www'), absolute);
      const url = assets[key];
      if (!url) {
        // Hard failure, never a guess. A card rendered with the wrong src hydrates with
        // a mismatch — the exact silent failure this file exists to prevent.
        throw new Error(`no manifest entry for ${key} (imported by ${args.importer})`);
      }
      return { path: `${url}#svg-url`, namespace: 'art-url' };
    });
    build.onLoad({ filter: /.*/, namespace: 'art-url' }, (args) => ({
      contents: `export default ${JSON.stringify(args.path.replace(/#svg-url$/, ''))};`,
      loader: 'js',
    }));

    // Stylesheets: nothing to render on the server.
    build.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-noop' }));
    build.onLoad({ filter: /.*/, namespace: 'css-noop' }, () => ({ contents: '', loader: 'js' }));
  },
};

await esbuild({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: BUNDLE,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  logLevel: 'warning',
  // Left external so the bundle uses the installed copies rather than inlining two
  // different Preacts, which is how `h` from one and `renderToString` from the other end
  // up not recognising each other's vnodes.
  external: ['preact', 'preact-render-to-string', 'preact/hooks', 'preact/compat'],
  plugins: [vitePlugin],
});

const { shell, cards, order, gridShell } = await import(`file://${BUNDLE}?v=${count0()}`);

/** Cache-buster for the dynamic import, since this script may run twice in one process. */
function count0() {
  return String(Object.keys(assets).length);
}

/**
 * Rendered markup must contain no raw SVG and no un-substituted art.
 *
 * The plugin above makes that structurally impossible, so this is a guard against the
 * plugin silently not applying — which is how the first version of this file shipped a
 * whole SVG document inside every `<img src>`.
 */
function assertClean(html, where) {
  if (html.includes('<svg') || html.includes('&lt;svg')) {
    console.error(`ssr: ${where} contains raw SVG text — the art shim did not apply`);
    process.exit(1);
  }
  return html;
}

mkdirSync(OUT, { recursive: true });

const shellHtml = assertClean(shell(), 'the shell');
if (!shellHtml.includes('<fony-grid></fony-grid>')) {
  console.error('ssr: the shell has no <fony-grid> marker — Hub is not honouring its `grid` prop');
  process.exit(1);
}
writeFileSync(join(OUT, 'shell.html'), shellHtml);

const variants = cards();
let count = 0;
for (const [slug, byKey] of Object.entries(variants)) {
  for (const [key, html] of Object.entries(byKey)) {
    byKey[key] = assertClean(html, `${slug} ${key}`);
    count++;
  }
}

writeFileSync(
  join(OUT, 'cards.php'),
  `<?php
// GENERATED by scripts/ssr.mjs from the real Preact components. Do not edit.
// One entry per (availability : isNew : hot : showAll). '' means the card is not rendered.
// Spec: docs/specs/seo.md §4
return ${phpArray({ order: order(), grid: gridShell(), cards: variants })};
`,
);

/*
 * The page template.
 *
 * Vite's `dist/index.html` becomes `_hub/page.html` and `index.php` takes its place. It
 * MOVES rather than being copied, for the trap in seo.md §4: the SFTP sync deletes
 * nothing, so an `index.html` sitting in the web root outranks `index.php` under Apache's
 * default DirectoryIndex — forever. Not emitting one at all is the half of that fix this
 * script can guarantee; the `.htaccess` and a one-time manual delete are the other half.
 */
const pageHtml = join(DIST, 'index.html');
if (!existsSync(pageHtml)) {
  console.error('ssr: dist/index.html is missing — did vite build run?');
  process.exit(1);
}
const template = readFileSync(pageHtml, 'utf8');
if (!template.includes('<div id="app"></div>')) {
  console.error('ssr: dist/index.html has no empty <div id="app"></div> to fill');
  process.exit(1);
}
writeFileSync(join(OUT, 'page.html'), template);
rmSync(pageHtml);

// `_hub/` is a template directory, not a route. Without this, `/_hub/page.html` serves a
// half-built page with an empty grid — indexable, and wrong.
writeFileSync(
  join(OUT, '.htaccess'),
  `# _hub/ holds build output that index.php assembles. None of it is a page.
# Docs: docs/specs/seo.md §4
<IfModule mod_authz_core.c>
  Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
  Order deny,allow
  Deny from all
</IfModule>
`,
);

/** PHP array literal. Values are markup, so the quoting has to be exact. */
function phpArray(value, indent = '') {
  if (Array.isArray(value)) {
    const inner = value.map((v) => `${indent}  ${phpArray(v, `${indent}  `)},`).join('\n');
    return `[\n${inner}\n${indent}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const inner = Object.entries(value)
      .map(([k, v]) => `${indent}  ${phpString(k)} => ${phpArray(v, `${indent}  `)},`)
      .join('\n');
    return `[\n${inner}\n${indent}]`;
  }
  return phpString(String(value));
}

/** A PHP single-quoted string: backslash first, then quote, or the escaping doubles. */
function phpString(text) {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/*
 * `index.php` — the page, per request.
 *
 * Thin on purpose: read the flags, pick the variants, print. Every decision it could have
 * made lives in `api/lib/Page.php`, which the PHP suite tests.
 */
writeFileSync(
  join(DIST, 'index.php'),
  `<?php

/**
 * The hub, assembled per request.
 * GENERATED by scripts/ssr.mjs. Spec: docs/specs/seo.md §4
 *
 * Why this is not a static file: the operator can disable or hide a game from the admin
 * centre at any time, and the HTML a crawler sees has to change with it — without a
 * rebuild. That is the entire reason the render happens here.
 *
 * It authors no markup. \`_hub/cards.php\` holds one finished string per card per flag
 * state, rendered from the real Preact components at build time, and this picks between
 * them (Page::grid).
 */

declare(strict_types=1);

require_once __DIR__ . '/api/lib/App.php';
require_once __DIR__ . '/api/lib/Page.php';

$app = App::boot(__DIR__ . '/api');
[$flags, $showAll, $plays] = Page::context($app->config);

$built = require __DIR__ . '/_hub/cards.php';

// A flag change must be visible immediately, so this page is never cached. The
// content-hashed assets it links to keep their long cache — they are immutable.
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache, must-revalidate');

echo Page::render(
    (string) file_get_contents(__DIR__ . '/_hub/page.html'),
    (string) file_get_contents(__DIR__ . '/_hub/shell.html'),
    (string) $built['grid']['open'],
    (string) $built['grid']['close'],
    Page::grid($built['order'], $built['cards'], $flags, $showAll, $plays),
    $flags,
    $showAll,
    $plays,
);
`,
);

/*
 * `sitemap.php`, not `sitemap.xml`.
 *
 * A sitemap that advertises a page the server will not serve is worse than no sitemap, so
 * a hidden game has to drop out of it — which means generating it per request, from the
 * same flags. `robots.txt` still points at `/sitemap.xml`, because that is the
 * conventional name every crawler looks for; the `.htaccess` rewrites it here.
 */
const gamePages = order().filter((slug) => existsSync(join(DIST, slug, 'index.html')));

writeFileSync(
  join(DIST, 'sitemap.php'),
  `<?php

// GENERATED by scripts/ssr.mjs. Spec: docs/specs/seo.md §2
// Per request, so a game the operator hid is not advertised to a crawler.

declare(strict_types=1);

require_once __DIR__ . '/api/lib/App.php';
require_once __DIR__ . '/api/lib/Page.php';

$app = App::boot(__DIR__ . '/api');
// The counts order the hub, not the sitemap: a crawler is given the curated order.
[$flags, $showAll] = Page::context($app->config);

$origin = rtrim((string) ($app->config['site_origin'] ?: 'https://fonygames.guigui.fr'), '/');
$slugs = ${JSON.stringify(gamePages).replace(/"/g, "'")};

header('Content-Type: application/xml; charset=utf-8');
header('Cache-Control: no-cache, must-revalidate');

echo "<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>\\n";
echo "<urlset xmlns=\\"http://www.sitemaps.org/schemas/sitemap/0.9\\">\\n";
echo '  <url><loc>' . $origin . "/</loc></url>\\n";

foreach ($slugs as $slug) {
    // 'hidden' means not reachable at all; 'disabled' is still a real page that shows a
    // greyed card, so it stays listed.
    $availability = $flags[$slug]['availability'] ?? 'active';
    if ($availability === 'hidden' && !$showAll) {
        continue;
    }
    echo '  <url><loc>' . $origin . '/' . $slug . "/</loc></url>\\n";
}

echo "</urlset>\\n";
`,
);

// The static one is superseded; leaving both would serve whichever the host preferred.
rmSync(join(DIST, 'sitemap.xml'), { force: true });

// The manifest is a build artefact and must not ship: it lists every source path.
rmSync(join(DIST, '.vite'), { recursive: true, force: true });

console.log(`ssr: shell + ${count} card variants for ${Object.keys(variants).length} games`);
