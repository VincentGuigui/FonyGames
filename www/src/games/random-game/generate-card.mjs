/**
 * Regenerate Random Game's hub card: a real photo of the die (`art/src/dice.png`)
 * over a dimmed 3×3 mosaic of nine other games' own hub illustrations.
 * Contract: docs/design/illustrations.md
 *
 * ## Why generated rather than hand-drawn
 *
 * The mosaic tiles are the nine source games' own `art/card.svg` markup, lifted
 * verbatim and scaled down. Copy-pasting that by hand is exactly the kind of drift
 * illustrations.md §4 warns about for a derived file: nothing fails when a source
 * card is redrawn and the copy goes stale. This script re-extracts the nine tiles
 * every run, so redrawing one of them updates this mosaic for free on the next build.
 *
 * ## Why a photo, not a fresh vector die
 *
 * Every other card redraws its subject as fresh paths, but illustrations.md §4 already
 * carries two exceptions — Tap Fighter and Aliens Love Cows — for the same reason this
 * is a third: a hand-drawn approximation of a detailed pixel-art die reads worse than
 * the real thing at hub-card size. `art/src/dice.png` is cropped to its own content,
 * downscaled, and embedded as a base64 PNG `<image>`, the same technique those two
 * cards use for their sprites.
 *
 * ## Staleness is a content hash, never a timestamp
 *
 * Same reasoning as `www/src/games/og.mjs`: git does not preserve mtimes, so "is the
 * source newer than the output" is a coin toss on a fresh checkout. `art/.card-manifest.json`
 * is committed and holds a hash of everything this file's content depends on — the nine
 * source `card.svg` files, their accents, `dice.png`, and this script's own `GENERATOR`
 * version. `art/card.svg` is rewritten only when that hash moves.
 *
 * `--check` exits 1 when the committed `art/card.svg` is stale, and runs as part of
 * `npm test` — same guard `og.mjs` and `outlines.mjs` use for their own derived files.
 *
 * Usage:
 *   node www/src/games/random-game/generate-card.mjs           regenerate if stale
 *   node www/src/games/random-game/generate-card.mjs --check   exit 1 if stale
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

/** Bump when the composition changes, so the card regenerates even if no input did. */
const GENERATOR = 1;

// `process.cwd()`, not `import.meta.url`: npm scripts run from the repo root.
const ROOT = resolve(process.cwd());
const GAMES = join(ROOT, 'www/src/games');
const ART = join(GAMES, 'random-game/art');
const DICE_PNG = join(ART, 'src/dice.png');
const OUT_SVG = join(ART, 'card.svg');
const MANIFEST = join(ART, '.card-manifest.json');

const check = process.argv.includes('--check');

/** This card's own accent (card.ts), also used as the die's grounding-shadow colour
 *  so the file still carries it literally — `cards.test.mjs` checks every card.svg
 *  contains its own game's accent hex. */
const OWN_ACCENT = '#F3E9D2';

/**
 * The 3×3 mosaic, row-major, at 40×30 per cell. Change this list and every tile
 * moves with it.
 *
 * **Every tile has to be a pure-vector card.** A tile is that game's own
 * `card.svg` markup lifted verbatim, so a card that embeds base64 sprites
 * arrives here at its full weight — which is why Tap Fighter and Aliens Love
 * Cows were never in this list, and why Gravity Shooter left it when its card
 * became generated from its own sprites (that one tile alone took this file to
 * 64 KB against a 40 KB cap, and the guard at the bottom caught it). Asteroid
 * Race took Gravity Shooter's place, and then left the same way when its own
 * ship became a generated crop of `ship.png` (asteroid-race.md §13); UFO Hunt
 * took its place.
 */
const MOSAIC = [
  'tic-tac-tic-tac-toe', 'shake-rush', 'steady-hand',
  'pass-the-bomb', 'tiles-surfer', 'neon-fall',
  'tap-duel', 'cat-and-mouse', 'ufo-hunt',
];

const CELL_W = 40;
const CELL_H = 30;

function sha(parts) {
  const hash = createHash('sha256');
  for (const p of parts) hash.update(p);
  return hash.digest('hex').slice(0, 32);
}

/** The accent, read from `card.ts` rather than duplicated here — same regex `og.mjs`
 *  uses, for the same reason: `card.ts` is TypeScript with a Vite-only art import, so
 *  node cannot load it directly. */
function accentOf(slug) {
  const source = readFileSync(join(GAMES, slug, 'card.ts'), 'utf8');
  const match = /accent:\s*'(#[0-9A-Fa-f]{3,8})'/.exec(source);
  if (!match) throw new Error(`${slug}/card.ts has no accent I can read`);
  return match[1];
}

/** The card art with its outer <svg> stripped, so it can sit inside this one. */
function innerArt(slug) {
  // Git may check the same SVG out as CRLF on Windows and LF in CI. The staleness hash
  // must describe the art rather than the checkout, same as og.mjs's own innerArt.
  const source = readFileSync(join(GAMES, slug, 'art/card.svg'), 'utf8').replace(/\r\n?/g, '\n');
  const open = source.indexOf('>', source.indexOf('<svg'));
  const close = source.lastIndexOf('</svg>');
  if (open === -1 || close === -1) throw new Error(`${slug}/art/card.svg is not an svg`);
  return source.slice(open + 1, close);
}

function mosaicTiles() {
  return MOSAIC.map((slug, i) => {
    const x = (i % 3) * CELL_W;
    const y = Math.floor(i / 3) * CELL_H;
    const accent = accentOf(slug);
    return `  <rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" fill="${accent}" opacity="0.16"/>
  <g opacity="0.4" transform="translate(${x}.000 ${y}.000) scale(0.3333)">${innerArt(slug)}</g>`;
  }).join('\n');
}

/**
 * The die: trimmed to its own content, downscaled to hub-card size, and embedded as a
 * base64 PNG. 160px source width is comfortably sharp at the ~70px the die actually
 * renders at on a card (ui-guidelines' 160px-wide reference card) while keeping the
 * whole file inside the ≤40 KB budget alongside the nine mosaic tiles' own markup.
 */
async function dieImage() {
  const trimmed = await sharp(DICE_PNG).trim().png().toBuffer();
  const meta = await sharp(trimmed).metadata();

  const RENDER_W = 160;
  const renderH = Math.round((RENDER_W * meta.height) / meta.width);
  const resized = await sharp(trimmed)
    .resize(RENDER_W, renderH)
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();

  // Same box the hand-drawn die it replaces occupied (x 34–86, y 18–78), fit to the
  // photo's own aspect ratio rather than stretched to match exactly.
  const boxW = 52;
  const boxH = Math.round((boxW * meta.height) / meta.width);
  const x = 34;
  const y = 18 + (60 - boxH) / 2;

  const markup =
    `  <ellipse cx="60" cy="${(y + boxH - 2).toFixed(1)}" rx="18" ry="3.2" fill="${OWN_ACCENT}" opacity="0.28"/>\n` +
    `  <image x="${x}" y="${y.toFixed(1)}" width="${boxW}" height="${boxH}" ` +
    `href="data:image/png;base64,${resized.toString('base64')}"/>`;

  return { markup, bytes: resized };
}

/* ── Staleness ───────────────────────────────────────────────────────────── */

const inputs = [Buffer.from(String(GENERATOR)), readFileSync(DICE_PNG)];
for (const slug of MOSAIC) {
  inputs.push(Buffer.from(accentOf(slug)));
  inputs.push(Buffer.from(innerArt(slug)));
}
const hash = sha(inputs);

const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const stale = previous.hash !== hash || !existsSync(OUT_SVG);

if (check) {
  if (!stale) {
    console.log('random-card: art/card.svg up to date');
    process.exit(0);
  }
  console.error('random-card: art/card.svg is stale. Run `npm run art:random-card`.');
  process.exit(1);
}

if (!stale) {
  console.log('random-card: nothing changed, art/card.svg already current');
  process.exit(0);
}

/* ── Render ──────────────────────────────────────────────────────────────── */

const die = await dieImage();
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90">
${mosaicTiles()}

${die.markup}
</svg>
`;

const bytes = Buffer.byteLength(svg, 'utf8');
if (bytes > 40 * 1024) {
  console.error(`random-card: card.svg would be ${(bytes / 1024).toFixed(1)} KB, over the 40 KB cap`);
  process.exit(1);
}

writeFileSync(OUT_SVG, svg);
writeFileSync(MANIFEST, `${JSON.stringify({ generator: GENERATOR, hash }, null, 2)}\n`);
console.log(`random-card: card.svg regenerated (${(bytes / 1024).toFixed(1)} KB total, die ${(die.bytes.length / 1024).toFixed(1)} KB)`);
