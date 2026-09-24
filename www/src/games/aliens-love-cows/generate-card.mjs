/**
 * Regenerate Aliens Love Cows' hub card from the game's own UFO art.
 * Contract: docs/design/illustrations.md
 *
 * ## Why generated rather than hand-drawn
 *
 * The UFO used to be a hand-drawn approximation — a couple of flat vector
 * shapes standing in for the ship. It is now `art/ufo.png`, an authored
 * sprite (the same one `AbductScreen.tsx` renders in the round itself), and
 * a hand-drawn approximation of detailed authored art reads worse at card
 * size than the real thing — the same reasoning illustrations.md already
 * records for Tap Fighter, Random Game, Gravity Shooter and Asteroid Race.
 * The barn and cow were already generated this way (issue-driven: "hub's
 * card should reuse actual art"); the UFO joining them is the same rule
 * applied to the one shape that had not caught up yet. The cone, the stars
 * and the ground stay hand-drawn vector: none of them is a subject detailed
 * enough to need a real crop.
 *
 * ## The accent survives the swap
 *
 * `cards.test.mjs` requires every card to contain its own accent hex
 * literally (`#FACC15` here) — the hand-drawn UFO used to carry it as its
 * dome's own outline. A cropped photo cannot take a stroke, so a thin
 * accent-coloured ring stands in at the ship's own rim instead, exactly
 * where the tractor beam begins: not a compliance patch, the same "running
 * lights" idea a saucer's underside already reads as.
 *
 * ## Staleness is a content hash, never a timestamp
 *
 * Same reasoning as the other four generated cards: git does not preserve
 * mtimes. `art/.card-manifest.json` is committed and holds a hash of this
 * script's own source (which covers the composition, the placement and the
 * accent ring in one input) plus `ufo.png`, `barn.png` and `cow.png`
 * themselves, so a redrawn sprite marks the card stale without anyone having
 * to remember to say so.
 *
 * `--check` exits 1 when the committed card is stale, and runs as part of
 * `npm test`.
 *
 * Usage:
 *   node www/src/games/aliens-love-cows/generate-card.mjs           regenerate if stale
 *   node www/src/games/aliens-love-cows/generate-card.mjs --check   exit 1 if stale
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/** Bump when the composition changes, so the card regenerates even if no input did. */
const GENERATOR = 1;

// `process.cwd()`, not `import.meta.url`: npm scripts run from the repo root.
const ROOT = resolve(process.cwd());
const GAME = join(ROOT, 'www/src/games/aliens-love-cows');
const ART = join(GAME, 'art');
const UFO = join(ART, 'ufo.png');
const BARN = join(ART, 'barn.png');
const COW = join(ART, 'cow.png');
const OUT_SVG = join(ART, 'card.svg');
const MANIFEST = join(ART, '.card-manifest.json');

const check = process.argv.includes('--check');

const CARD_W = 120;
const CARD_H = 90;

/** Same footprint the hand-drawn UFO occupied (its own ellipse plus dome path
 *  together spanned roughly x 58-94, y 10-25) — the photo replaces it in
 *  place rather than moving the composition around it. */
const UFO_CENTER = { x: 76, y: 18 };
const UFO_WIDTH = 30;

/** Unchanged from the hand-authored card: where the barn and cow crops sit. */
const BARN_CENTER = { x: 64, y: 62.6 };
const BARN_WIDTH = 40;
const COW_CENTER = { x: 64, y: 29.15 };
const COW_WIDTH = 20;
/** The cow tilts as it lifts into the beam — the same rotation, about the
 *  same pivot, the hand-authored card used (not `COW_CENTER`: that pivot was
 *  its own hand-picked point, not derived from the image's placement). */
const COW_TILT_DEG = -6;
const COW_TILT_PIVOT = { x: 64, y: 30 };

function sha(parts) {
  const hash = createHash('sha256');
  for (const p of parts) hash.update(p);
  return hash.digest('hex').slice(0, 32);
}

/** A whole PNG, trimmed to its own content and downscaled, as a base64 PNG
 *  plus the aspect ratio the trim left it with — the same shape
 *  `gravity-shooter/generate-card.mjs`'s own `sprite()` and
 *  `asteroid-race/generate-card.mjs`'s own `frame()` both return. */
async function sprite(file, renderWidth) {
  const trimmed = await sharp(file).trim().png().toBuffer();
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
function place(s, cx, cy, w) {
  const h = w / s.aspect;
  const x = (cx - w / 2).toFixed(2);
  const y = (cy - h / 2).toFixed(2);
  return { markup: `<image x="${x}" y="${y}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" href="${s.href}"/>`, h };
}

/* ── Staleness ───────────────────────────────────────────────────────────── */

const inputs = [
  Buffer.from(String(GENERATOR)),
  // This script's own source covers the placement, the accent ring and every
  // line of the composition in one input — the same call the other four
  // generated cards make, and for the same reason: a hand-listed set of
  // inputs is easy to leave incomplete when the composition moves, and
  // nothing fails when it does.
  //
  // Normalised to LF: read as text and rejoined rather than hashed as raw
  // bytes, because git checks this file out as CRLF on Windows
  // (core.autocrlf) and LF on the Linux CI runner that deploys `dev`/`prod`
  // — hashing the bytes made the very commit that generated the manifest
  // read as stale the moment CI checked it out.
  Buffer.from(readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n?/g, '\n')),
  readFileSync(UFO),
  readFileSync(BARN),
  readFileSync(COW),
];
const hash = sha(inputs);

const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const stale = previous.hash !== hash || !existsSync(OUT_SVG);

if (check) {
  if (!stale) {
    console.log('abduct-card: art/card.svg up to date');
    process.exit(0);
  }
  console.error('abduct-card: art/card.svg is stale. Run `npm run art:abduct-card`.');
  process.exit(1);
}

if (!stale) {
  console.log('abduct-card: nothing changed, art/card.svg already current');
  process.exit(0);
}

/* ── Render ──────────────────────────────────────────────────────────────── */

const ufo = place(await sprite(UFO, 120), UFO_CENTER.x, UFO_CENTER.y, UFO_WIDTH);
const barn = place(await sprite(BARN, 140), BARN_CENTER.x, BARN_CENTER.y, BARN_WIDTH);
const cow = place(await sprite(COW, 80), COW_CENTER.x, COW_CENTER.y, COW_WIDTH);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}">
  <!--
    Aliens love cows — hub card illustration. GENERATED, do not edit by hand:
    www/src/games/aliens-love-cows/generate-card.mjs crops the UFO, the barn
    and the cow straight out of this game's own art/. Run
    \`npm run art:abduct-card\` after redrawing any of those; \`npm test\`
    fails if the committed card is stale. The cone, the stars and the ground
    are hand-drawn vector and can be edited directly.

    Transparent background: the accent tint behind it is painted by CSS, so
    it is both the placeholder before this file loads and the backdrop after.

    Colours on the vector shapes are literal hexes on purpose — an img-loaded
    SVG has no access to the page's CSS, so currentColor would render black
    and a CSS variable would make the shape vanish.

    Style: docs/design/ui-guidelines.md §6 · mechanics: docs/design/illustrations.md
  -->

  <!-- A few stars, night countryside. -->
  <g fill="#FFFFFF" opacity="0.5">
    <circle cx="12" cy="10" r="1"/>
    <circle cx="26" cy="6" r="0.8"/>
    <circle cx="104" cy="8" r="1"/>
    <circle cx="112" cy="20" r="0.8"/>
    <circle cx="8" cy="28" r="0.8"/>
  </g>

  <!-- The UFO: the real art/ufo.png, cropped to content and downscaled. -->
  ${ufo.markup}
  <!-- Its own running-light ring, right where the beam begins — also where
       the card's own accent hex has to appear (cards.test.mjs). -->
  <ellipse cx="${UFO_CENTER.x}" cy="24" rx="12" ry="1.5" fill="none" stroke="#FACC15" stroke-width="1" opacity="0.85"/>

  <!-- The light cone, reaching down to the barn. -->
  <path d="M68 23 L52 68 L100 68 L84 23 Z" fill="#FDE68A" opacity="0.4"/>

  <!-- The barn: the real art/barn.png, cropped to content and downscaled. -->
  ${barn.markup}

  <!-- The cow, mid-abduction, lifted into the cone: the real art/cow.png. -->
  <g transform="rotate(${COW_TILT_DEG} ${COW_TILT_PIVOT.x} ${COW_TILT_PIVOT.y})">
    ${cow.markup}
  </g>

  <!-- Ground: one field, not two — a flat run behind the barn joins the two
       hills (each still its own Q curve, unchanged) into a single closed
       shape reaching every x from 0 to 120. Two separate paths used to
       leave x 40-80 with no fill at all below the barn's own footprint: the
       barn covers most of it, but not all the way down to y 90, so a strip
       of bare background showed through right under the barn. -->
  <path d="M0 80 Q30 74 40 80 L80 80 Q100 74 120 80 L120 90 L0 90 Z" fill="#166534" opacity="0.6"/>
</svg>
`;

const bytes = Buffer.byteLength(svg, 'utf8');
if (bytes > 40 * 1024) {
  console.error(`abduct-card: card.svg would be ${(bytes / 1024).toFixed(1)} KB, over the 40 KB cap`);
  process.exit(1);
}

writeFileSync(OUT_SVG, svg);
writeFileSync(MANIFEST, `${JSON.stringify({ generator: GENERATOR, hash }, null, 2)}\n`);
console.log(`abduct-card: card.svg regenerated (${(bytes / 1024).toFixed(1)} KB total)`);
