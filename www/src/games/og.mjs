/**
 * Rasterise the social preview images.
 * Spec: docs/specs/seo.md §5
 *
 * One 1200×630 PNG per page, composed from that game's existing `art/card.svg` on its
 * accent background — so a link shared into a group chat previews as the card the
 * player is about to land on.
 *
 * ## Why a raster at all
 *
 * Because SVG `og:image` is rejected by iMessage, WhatsApp, X and Facebook — the free
 * option is the one that does not work (spec §3). PNG is the format every platform
 * actually renders.
 *
 * ## No text in the image
 *
 * `resvg` needs a real font file to render `<text>`, and committing one is a licence
 * and a size question for no gain: every platform displays `og:title` next to the
 * picture already. So these are pictures, and the words come from the tags.
 *
 * ## ⚠️ Staleness is a content hash, NEVER a timestamp
 *
 * `git` does not store mtimes. A fresh CI checkout stamps every file with the checkout
 * time, so "is the source newer than the output?" becomes a coin toss that sometimes
 * rebuilds everything and sometimes nothing, and never for a reason anyone can see.
 *
 * So `www/public/og/.manifest.json` is **committed** and holds each source's SHA-256
 * plus a generator version. An entry is regenerated exactly when its hash moved. That
 * is the behaviour you want locally — touch one piece of art, rebuild one file — and it
 * is *correct* in CI rather than lucky.
 *
 * `--check` exits 1 when anything is stale, and runs as part of `npm test`. Same guard
 * `outlines.mjs` uses for the hollow sprites.
 *
 * Usage:
 *   node www/src/games/og.mjs            regenerate what changed
 *   node www/src/games/og.mjs --check    exit 1 if anything is stale
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

/** Bump when the composition changes, so every PNG regenerates. */
const GENERATOR = 4;

/** The size every platform expects. 1.91:1. */
const W = 1200;
const H = 630;

/** From theme.css — the page background, so the preview matches the site. */
const BG = '#0d0f14';

// `process.cwd()`, not `import.meta.url`: npm scripts run from the repo root.
const ROOT = resolve(process.cwd());
const GAMES = join(ROOT, 'www/src/games');
const OUT = join(ROOT, 'www/public/og');
const MANIFEST = join(OUT, '.manifest.json');

const check = process.argv.includes('--check');

function sha(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

/** Every game folder that has both a card and its art. */
function games() {
  return readdirSync(GAMES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((slug) => existsSync(join(GAMES, slug, 'art/card.svg')))
    .sort();
}

/**
 * How finished a game is, from `card.ts`.
 *
 * Used to keep unbuilt games out of the hub's collage: the first version picked the
 * four alphabetically-first slugs and advertised the hub with `compass-hunt` and
 * `ghost-tag`, neither of which exists. A preview of games nobody can play is a worse
 * lie than no preview.
 */
function statusOf(slug) {
  const source = readFileSync(join(GAMES, slug, 'card.ts'), 'utf8');
  const match = /status:\s*'(live|new|soon)'/.exec(source);
  if (!match) throw new Error(`${slug}/card.ts has no status I can read`);
  return match[1];
}

/**
 * The accent, read from `card.ts` rather than duplicated here.
 *
 * A regex over the source instead of importing it: `card.ts` is TypeScript with
 * `?url&no-inline` imports that only Vite understands, so node cannot load it. The
 * pattern is anchored to the exact line the type requires, and a miss throws rather
 * than falling back to a default — a wrong accent would be invisible until somebody
 * shared a link.
 */
function accentOf(slug) {
  const source = readFileSync(join(GAMES, slug, 'card.ts'), 'utf8');
  const match = /accent:\s*'(#[0-9A-Fa-f]{3,8})'/.exec(source);
  if (!match) throw new Error(`${slug}/card.ts has no accent I can read`);
  return match[1];
}

/** The card art with its outer <svg> stripped, so it can be placed inside another. */
function innerArt(slug) {
  const source = readFileSync(join(GAMES, slug, 'art/card.svg'), 'utf8');
  const open = source.indexOf('>', source.indexOf('<svg'));
  const close = source.lastIndexOf('</svg>');
  if (open === -1 || close === -1) throw new Error(`${slug}/art/card.svg is not an svg`);
  return source.slice(open + 1, close);
}

/**
 * One game's preview: the illustration, centred and large, on its accent.
 *
 * The art is authored at 120×90 (4:3) and this canvas is 1200×630 (1.91:1), so it is
 * scaled to fit the HEIGHT with margin and centred — scaling to width would crop the
 * top and bottom off every illustration.
 */
function gameCard(slug) {
  const accent = accentOf(slug);
  const art = innerArt(slug);

  // 78% of the height, which leaves a visible border of background on all four sides
  // at 1.91:1. Any more and the art touches the edge, where a platform's rounded
  // corners clip it.
  const scale = (H * 0.78) / 90;
  const x = (W - 120 * scale) / 2;
  const y = (H - 90 * scale) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <!-- The same 14% accent wash the hub card paints in CSS, so the preview and the
       card a player lands on are recognisably the same object. -->
  <rect width="${W}" height="${H}" fill="${accent}" opacity="0.14"/>
  <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})">${art}</g>
</svg>`;
}

/**
 * The hub's preview: four playable games, two by two.
 *
 * A collage rather than a wordmark, because a wordmark needs text and text needs a
 * committed font. Four illustrations on the dark background read as "a pile of silly
 * games", which is the pitch, without a single glyph.
 *
 * **2×2, not 1×4.** Four columns in a 1.91:1 frame leaves most of the height empty and
 * every illustration small; a 2×2 grid of 600×315 cells lets each one fill its cell.
 */
function hubCard(picked) {
  const cols = 2;
  const cw = W / cols;
  const ch = H / 2;
  // Fit each cell in BOTH axes. Scaling on width alone overflowed the short cells.
  const scale = Math.min((cw * 0.7) / 120, (ch * 0.8) / 90);

  const tiles = picked
    .map((slug, i) => {
      const accent = accentOf(slug);
      const cx = (i % cols) * cw;
      const cy = Math.floor(i / cols) * ch;
      const x = cx + (cw - 120 * scale) / 2;
      const y = cy + (ch - 90 * scale) / 2;
      return `  <rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" fill="${accent}" opacity="0.16"/>
  <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})">${innerArt(slug)}</g>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
${tiles}
</svg>`;
}

/* ── Build the work list ─────────────────────────────────────────────────── */

const slugs = games();
if (slugs.length === 0) {
  console.error('og: no game art found — is www/src/games/ intact?');
  process.exit(1);
}

/**
 * Which games the hub collage uses.
 *
 * **Built games only.** Sorted by slug so the choice is stable across machines and
 * builds — a collage that reshuffled on every run would make the hash useless.
 */
const hubSources = slugs.filter((slug) => statusOf(slug) !== 'soon').slice(0, 4);
if (hubSources.length === 0) {
  console.error('og: no built games, so there is nothing honest to put on the hub preview');
  process.exit(1);
}

/** name → the SVG we would render, so the hash covers the composition too. */
const jobs = new Map();
for (const slug of slugs) jobs.set(slug, gameCard(slug));
jobs.set('hub', hubCard(hubSources));

const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const next = { generator: GENERATOR, images: {} };

const stale = [];
for (const [name, svg] of jobs) {
  // The hash covers the composed SVG, not just the source file — so a change to the
  // layout in this script invalidates every entry without anyone bumping GENERATOR.
  const hash = sha(svg);
  next.images[name] = hash;

  const wasHash = previous.images?.[name];
  const png = join(OUT, `${name}.png`);
  if (previous.generator !== GENERATOR || wasHash !== hash || !existsSync(png)) {
    stale.push(name);
  }
}

// A PNG with no job is a game that was deleted. It has to go, or the deploy — which
// deletes nothing — leaves an orphan on the host forever.
const orphans = existsSync(OUT)
  ? readdirSync(OUT)
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.replace(/\.png$/, ''))
      .filter((name) => !jobs.has(name))
  : [];

if (check) {
  if (stale.length === 0 && orphans.length === 0) {
    console.log(`og: ${jobs.size} previews up to date`);
    process.exit(0);
  }
  console.error('og: previews are stale. Run `npm run art:og`.');
  if (stale.length > 0) console.error(`  needs rebuilding: ${stale.join(', ')}`);
  if (orphans.length > 0) console.error(`  orphaned: ${orphans.join(', ')}`);
  process.exit(1);
}

/* ── Render ──────────────────────────────────────────────────────────────── */

mkdirSync(OUT, { recursive: true });

for (const name of stale) {
  const svg = jobs.get(name);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: W }, background: BG })
    .render()
    .asPng();

  // ui-guidelines caps art at 40 KB; a 1200x630 raster cannot meet that and is not
  // on the page's critical path. 300 KB is the ceiling here, from what scrapers
  // reliably fetch — over it, a preview silently does not appear.
  if (png.length > 300 * 1024) {
    console.error(`og: ${name}.png is ${(png.length / 1024).toFixed(0)} KB, over the 300 KB cap`);
    process.exit(1);
  }

  writeFileSync(join(OUT, `${name}.png`), png);
  console.log(`og: ${name}.png  ${(png.length / 1024).toFixed(1)} KB`);
}

for (const name of orphans) {
  console.log(`og: ${name}.png is orphaned — delete it by hand if the game is really gone`);
}

writeFileSync(MANIFEST, `${JSON.stringify(next, null, 2)}\n`);

if (stale.length === 0) console.log(`og: nothing changed, ${jobs.size} previews already current`);
