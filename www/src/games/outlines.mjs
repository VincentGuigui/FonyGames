#!/usr/bin/env node
/**
 * Derive the hollow variant of a sprite from the filled one.
 * Contract: docs/design/illustrations.md §4
 *
 * Cat and Mouse needs a mouse both filled and hollow (its spec §7), and a sprite is
 * pixels by the time canvas sees it — pixels cannot be recoloured into an outline,
 * because filled-versus-hollow is a difference of *geometry*, not of colour. So the
 * second file has to exist. What it must not be is **hand-maintained**: two copies of
 * one silhouette drift the moment somebody redraws the mouse, and nothing fails when
 * they do.
 *
 * So one file is the art and the other is generated from it.
 *
 * ## Opting in
 *
 * A sprite gets a derived outline by putting `data-outline="<width>"` on its root
 * `<svg>`. No attribute, no variant — this walks every game's `art/` and only touches
 * files that ask for it. The width lives in the art rather than in this script because
 * how thick the outline reads is an art decision.
 *
 * ## The transform
 *
 * For every element with a solid `fill`:
 *
 *     fill="#f4f1e8"  ->  fill="none" stroke="#f4f1e8" stroke-width="6.6"
 *
 * Elements that are **already strokes** (`fill="none"`) are left exactly alone: the
 * mouse's tail is a stroked curve in both versions, and thickening it would be a
 * change nobody asked for. An element may override the width with its own
 * `data-outline`.
 *
 * That rule is deliberately small. It is not an SVG engine, and it does not need to
 * be: it handles the one thing a hollow variant is, and anything it cannot express is
 * a sign the variant should be drawn by hand and this attribute left off.
 *
 * ## Usage
 *
 *     node www/src/games/outlines.mjs            rewrite the derived files
 *     node www/src/games/outlines.mjs --check    fail if any is stale
 *
 * `--check` is wired into `npm test`, so a committed variant that no longer matches
 * its source fails CI rather than shipping a mouse whose two halves disagree. The
 * generated files **are committed**: a fresh clone must be able to run `vite dev`
 * without knowing this script exists.
 *
 * Paths resolve from `process.cwd()` — the repo root under npm scripts — not from
 * `import.meta.url`, for the reason cards.test.mjs gives.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const GAMES = join(process.cwd(), 'www', 'src', 'games');
const check = process.argv.includes('--check');

/** Every `art/` directory under a game folder. */
function artDirs() {
  const out = [];
  for (const slug of readdirSync(GAMES).sort()) {
    const art = join(GAMES, slug, 'art');
    try {
      if (statSync(art).isDirectory()) out.push([slug, art]);
    } catch {
      // A file, not a game folder. cards.test.mjs is the one that polices layout.
    }
  }
  return out;
}

/**
 * Rewrite one element's attributes, filled to outlined.
 *
 * Returns the tag unchanged when it is already a stroke or has no fill, so the
 * transform is idempotent and safe to run over a whole file.
 */
function outlineTag(tag, defaultWidth) {
  if (/\bstroke=/.test(tag)) return tag;
  const fill = /\bfill="([^"]+)"/.exec(tag);
  if (!fill || fill[1] === 'none') return tag;

  const own = /\bdata-outline="([^"]+)"/.exec(tag);
  const width = own ? own[1] : defaultWidth;
  return tag
    .replace(/\s*\bdata-outline="[^"]*"/, '')
    .replace(/\bfill="[^"]+"/, `fill="none" stroke="${fill[1]}" stroke-width="${width}"`);
}

const BANNER = (from) => `<!--
    GENERATED. Do not edit.

    The hollow variant of ${from}, derived by www/src/games/outlines.mjs: every solid
    fill became a stroke of the same colour. Edit ${from} and run
    "npm run art:outlines"; a stale copy fails "npm test".

    Why a file at all, when this is only a fill change: canvas draws a sprite through
    an Image, so by the time it is on screen it is pixels, and an outline is a
    different shape rather than a different colour (docs/design/illustrations.md).
  -->`;

/** The derived text for one source file, or null when it does not opt in. */
function derive(src, sourceName) {
  const root = /<svg\b[^>]*>/.exec(src);
  if (!root) return null;
  const opt = /\bdata-outline="([^"]+)"/.exec(root[0]);
  if (!opt) return null;
  const width = opt[1];

  // The source's own comment describes the filled version, so it is replaced rather
  // than carried over. Only the first comment goes: a per shape note still applies.
  let out = src.replace(/<!--[\s\S]*?-->\s*/, '');
  out = out.replace(/<svg\b[^>]*>/, (t) => t.replace(/\s*\bdata-outline="[^"]*"/, ''));
  out = out.replace(/<(?:path|circle|ellipse|rect|polygon|polyline|line)\b[^>]*>/g, (t) =>
    outlineTag(t, width),
  );
  // Banner after the opening tag, so the file still starts with <svg.
  const text = out.replace(/(<svg\b[^>]*>)\s*/, `$1\n  ${BANNER(sourceName)}\n  `);

  /*
   * An SVG loaded through <img> is parsed as strict XML, and a doubled hyphen anywhere
   * inside a comment makes the whole document ill formed — which renders as **nothing**,
   * with a green build and no error. It has already cost this repo a day: thirteen blank
   * hub cards (docs/design/illustrations.md §3). A generator writing prose into a comment
   * is exactly how it would happen again, so it checks its own output.
   */
  for (const comment of text.match(/<!--[\s\S]*?-->/g) ?? []) {
    if (comment.slice(4, -3).includes('--')) {
      throw new Error(`generated comment for ${sourceName} contains a doubled hyphen`);
    }
  }
  if (!/\bwidth=/.test(text) || !/\bheight=/.test(text) || !/\bviewBox=/.test(text)) {
    // Without an intrinsic size the sprite loader's naturalWidth check reads 0 or 300
    // depending on the engine, and the sprite is permanently blank.
    throw new Error(`generated ${sourceName} lost width, height or viewBox`);
  }
  return text;
}

let stale = 0;
let wrote = 0;
let seen = 0;

for (const [slug, dir] of artDirs()) {
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.svg') || name.endsWith('-hollow.svg')) continue;
    const src = readFileSync(join(dir, name), 'utf8');
    const text = derive(src, name);
    if (text === null) continue;

    seen++;
    const target = join(dir, name.replace(/\.svg$/, '-hollow.svg'));
    let current = null;
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      // Not generated yet.
    }

    if (current === text) {
      console.log(`  ok    ${slug}/art/${name} -> ${name.replace(/\.svg$/, '-hollow.svg')}`);
      continue;
    }
    if (check) {
      stale++;
      console.log(
        `  STALE ${slug}/art/${name.replace(/\.svg$/, '-hollow.svg')}` +
          `${current === null ? ' (missing)' : ''}\n` +
          `        Run "npm run art:outlines" and commit the result.`,
      );
      continue;
    }
    writeFileSync(target, text);
    wrote++;
    console.log(`  wrote ${slug}/art/${name.replace(/\.svg$/, '-hollow.svg')}`);
  }
}

if (seen === 0) {
  // Not an error: no sprite currently needs a hollow twin. Said out loud, because a
  // silent zero would look exactly like a broken glob.
  console.log('  no sprite opts in with data-outline — nothing to derive');
}
if (stale > 0) throw new Error(`${stale} derived outline(s) out of date`);
console.log(check ? '\nall derived outlines current' : `\n${wrote} written, ${seen} checked`);
