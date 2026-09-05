/**
 * Regenerate Asteroid Race's hub card from the game's own ship art.
 * Contract: docs/design/illustrations.md
 *
 * ## Why generated rather than hand-drawn
 *
 * The ship used to be a hand-drawn approximation of a flat hull. It is now
 * `art/ship.png`, an authored 5x5 pixel-art sheet (`render.ts`'s own doc
 * comment) — and a hand-drawn approximation of detailed authored pixel art
 * reads worse at card size than the real thing, the same reasoning
 * illustrations.md already records for Tap Fighter, Aliens Love Cows,
 * Random Game and Gravity Shooter. Everything else in the card — the tube,
 * the rocks, the crosshair — stays hand-drawn vector: none of it is a subject
 * detailed enough to need a real crop, and a mosaic tile (Random Game's own)
 * must stay pure vector regardless (illustrations.md §4).
 *
 * ## Which frame, and why it is fixed
 *
 * `FRAME` names one cell of the sheet outright rather than deriving it from
 * `steerX`/`steerY` the way `render.ts` does at runtime — a card has no
 * steer, so a fixed pose is the only kind there is. Top-right: the sheet's
 * own "viewed from above and from the left" corner, banking hard into a turn
 * rather than sitting dead level — the more legible read of the two motion
 * axes at a glance is the tilt, not the neutral pose the game defaults to.
 *
 * ## Staleness is a content hash, never a timestamp
 *
 * Same reasoning as the other three generated cards: git does not preserve
 * mtimes. `art/.card-manifest.json` is committed and holds a hash of this
 * script's own source (which covers the frame choice and every line of the
 * composition) plus `ship.png` itself, so a redrawn sheet or a moved frame
 * both mark the card stale.
 *
 * `--check` exits 1 when the committed card is stale, and runs as part of
 * `npm test`.
 *
 * Usage:
 *   node www/src/games/asteroid-race/generate-card.mjs           regenerate if stale
 *   node www/src/games/asteroid-race/generate-card.mjs --check   exit 1 if stale
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

/** Bump when the composition changes, so the card regenerates even if no input did. */
const GENERATOR = 1;

// `process.cwd()`, not `import.meta.url`: npm scripts run from the repo root.
const ROOT = resolve(process.cwd());
const GAME = join(ROOT, 'www/src/games/asteroid-race');
const ART = join(GAME, 'art');
const SHEET = join(ART, 'ship.png');
const OUT_SVG = join(ART, 'card.svg');
const MANIFEST = join(ART, '.card-manifest.json');

const check = process.argv.includes('--check');

const CARD_W = 120;
const CARD_H = 90;

/** The sheet is 5x5 — the same constants `render.ts` uses to slice it live. */
const SHEET_COLS = 5;
const SHEET_ROWS = 5;

/** Top-right: column 4 ("viewed from the left"), row 0 ("from above") — see
 *  the file doc comment for why this one and not the neutral centre pose. */
const FRAME = { row: 0, col: 4 };

/** Where the ship sits in the 120x90 card, matching the hand-drawn ship it
 *  replaces: low and centred, the same "seen from behind" reading. */
const SHIP_CENTER = { x: 60, y: 67 };
const SHIP_WIDTH = 34;

function sha(parts) {
  const hash = createHash('sha256');
  for (const p of parts) hash.update(p);
  return hash.digest('hex').slice(0, 32);
}

/** One cell of the sheet, trimmed to its own content and downscaled, as a
 *  base64 PNG plus the aspect ratio the trim left it with — the same shape
 *  `gravity-shooter/generate-card.mjs`'s own `sprite()` returns. */
async function frame(row, col, renderWidth) {
  const meta = await sharp(SHEET).metadata();
  const cellW = meta.width / SHEET_COLS;
  const cellH = meta.height / SHEET_ROWS;
  const left = Math.round(col * cellW);
  const top = Math.round(row * cellH);
  const width = Math.round(cellW);
  const height = Math.round(cellH);
  const cropped = await sharp(SHEET).extract({ left, top, width, height }).png().toBuffer();
  const trimmed = await sharp(cropped).trim().png().toBuffer();
  const trimmedMeta = await sharp(trimmed).metadata();
  const outHeight = Math.max(1, Math.round((renderWidth * trimmedMeta.height) / trimmedMeta.width));
  const resized = await sharp(trimmed)
    .resize(renderWidth, outHeight)
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  return {
    href: `data:image/png;base64,${resized.toString('base64')}`,
    aspect: trimmedMeta.width / trimmedMeta.height,
  };
}

/** `<image>` centred on (cx, cy) at `w` card units wide, keeping its own aspect. */
function place(sprite, cx, cy, w) {
  const h = w / sprite.aspect;
  const x = (cx - w / 2).toFixed(2);
  const y = (cy - h / 2).toFixed(2);
  return `  <image x="${x}" y="${y}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" href="${sprite.href}"/>`;
}

/* ── Staleness ───────────────────────────────────────────────────────────── */

const inputs = [
  Buffer.from(String(GENERATOR)),
  // This script's own source covers the frame choice, the placement and
  // every line of the composition in one input — the same call
  // gravity-shooter/generate-card.mjs makes, and for the same reason: a
  // hand-listed set of inputs is easy to leave incomplete when the
  // composition moves, and nothing fails when it does.
  readFileSync(new URL(import.meta.url)),
  readFileSync(SHEET),
];
const hash = sha(inputs);

const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const stale = previous.hash !== hash || !existsSync(OUT_SVG);

if (check) {
  if (!stale) {
    console.log('asteroid-card: art/card.svg up to date');
    process.exit(0);
  }
  console.error('asteroid-card: art/card.svg is stale. Run `npm run art:asteroid-card`.');
  process.exit(1);
}

if (!stale) {
  console.log('asteroid-card: nothing changed, art/card.svg already current');
  process.exit(0);
}

/* ── Render ──────────────────────────────────────────────────────────────── */

const ship = await frame(FRAME.row, FRAME.col, 128);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}">
  <!--
    Asteroid Race — hub card illustration. The ship is GENERATED, do not edit
    by hand: www/src/games/asteroid-race/generate-card.mjs crops it straight
    out of this game's own art/ship.png. Run \`npm run art:asteroid-card\` after
    redrawing that sheet; \`npm test\` fails if the committed card is stale.
    Everything else here (the tube, the rocks, the crosshair) is hand-drawn
    vector and can be edited directly.

    Transparent background: the accent tint behind it is painted by CSS, so
    it is both the placeholder before this file loads and the backdrop after.

    Colours are literal hexes on purpose — an img-loaded SVG has no access to
    the page's CSS, so currentColor would render black and a CSS variable
    would make the shape vanish.

    Style: docs/design/ui-guidelines.md §6 · mechanics: docs/design/illustrations.md
  -->
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <!-- the tube, receding -->
    <ellipse cx="60" cy="34" rx="7" ry="5" stroke="#334155" stroke-width="1"/>
    <ellipse cx="60" cy="34" rx="18" ry="13" stroke="#334155" stroke-width="1"/>
    <ellipse cx="60" cy="34" rx="34" ry="24" stroke="#3F4E63" stroke-width="1.2"/>
    <ellipse cx="60" cy="34" rx="56" ry="40" stroke="#475569" stroke-width="1.4"/>

    <!-- far rocks, nearly gone into the black -->
    <path d="M52 30 L56 28 L58 31 L55 34 L51 33 Z" fill="#475569"/>
    <path d="M68 37 L72 36 L73 39 L70 41 L67 40 Z" fill="#3F4E63"/>

    <!-- a mid-distance small rock -->
    <path d="M83 26 L90 23 L95 27 L93 34 L86 35 L81 31 Z" fill="#9CA3AF"/>

    <!-- the near large rock, the one that splits -->
    <path d="M24 40 L36 33 L48 39 L47 53 L34 59 L22 52 Z" fill="#4B5563" stroke="#94A3B8" stroke-width="1.5"/>
${place(ship, SHIP_CENTER.x, SHIP_CENTER.y, SHIP_WIDTH)}
    <!-- the crosshair, dead ahead -->
    <path d="M56 30 L53 27 M64 30 L67 27 M56 38 L53 41 M64 38 L67 41" stroke="#A3E635" stroke-width="1.6"/>
  </g>
</svg>
`;

const bytes = Buffer.byteLength(svg, 'utf8');
if (bytes > 40 * 1024) {
  console.error(`asteroid-card: card.svg would be ${(bytes / 1024).toFixed(1)} KB, over the 40 KB cap`);
  process.exit(1);
}

writeFileSync(OUT_SVG, svg);
writeFileSync(MANIFEST, `${JSON.stringify({ generator: GENERATOR, hash }, null, 2)}\n`);
console.log(`asteroid-card: card.svg regenerated (${(bytes / 1024).toFixed(1)} KB total)`);
