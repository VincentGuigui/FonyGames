/**
 * Regenerate Tilt Race's hub card from the game's own car sprite and road
 * texture. Contract: docs/design/illustrations.md
 *
 * ## Why generated rather than hand-drawn (#41)
 *
 * The card used to draw a flat magenta dart for the car and a flat grey
 * stroke for the road — a schematic stand-in from before either asset
 * existed. Both are real photographic art now (`art/car.png`, a muscle car
 * shot from directly above; `art/road.jpg`, a tileable asphalt texture), and
 * a hand-drawn approximation of detailed real art reads worse at card size
 * than the real thing — the same reasoning illustrations.md already records
 * for Tap Fighter, Aliens Love Cows, Random Game, Gravity Shooter and
 * Asteroid Race. The track's own shape (the kerb, the bend, the dashed rail,
 * the skid marks) stays hand-drawn vector: none of that is a photographed
 * subject, and redrawing it as a crop would only add bytes.
 *
 * ## The road is a tiled pattern, not one big embed
 *
 * `TrackCanvas.tsx` draws the road as `ctx.createPattern(roadImg, 'repeat')`
 * used as the stroke style — the same technique this card uses via an SVG
 * `<pattern>` referenced as `stroke="url(#road)"`, which tiles in the SVG's
 * own user-coordinate space exactly the way a canvas pattern tiles in world
 * space (neither rotates or stretches along the path it strokes). That means
 * the embedded tile only has to be as big as one repeat, not the whole road —
 * `art/road.jpg` is a 1024x1024, ~120 KB JPEG; the tile this script crops and
 * downscales from its centre is under 2 KB, however many times the pattern
 * repeats along the drawn track.
 *
 * ## The car's own rotation
 *
 * `car.png` is authored nose-up, the same convention the hand-drawn dart it
 * replaces used (nose at local `(0, -h/2)`) — see `TrackCanvas.tsx`'s own
 * comment on the live sprite. That is why this script can reuse the dart's
 * exact `rotate(130)`, unchanged, and have the real car turn into the same
 * bend the dart used to.
 *
 * ## Staleness is a content hash, never a timestamp
 *
 * Same reasoning as the other four generated cards: git does not preserve
 * mtimes. `art/.card-manifest.json` is committed and holds a hash of this
 * script's own source (which covers the composition, the tile size and the
 * rotation) plus `car.png` and `road.jpg` themselves, so redrawing either
 * asset marks the card stale.
 *
 * `--check` exits 1 when the committed card is stale, and runs as part of
 * `npm test`.
 *
 * Usage:
 *   node www/src/games/tilt-race/generate-card.mjs           regenerate if stale
 *   node www/src/games/tilt-race/generate-card.mjs --check   exit 1 if stale
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
const GAME = join(ROOT, 'www/src/games/tilt-race');
const ART = join(GAME, 'art');
const CAR = join(ART, 'car.png');
const ROAD = join(ART, 'road.jpg');
const OUT_SVG = join(ART, 'card.svg');
const MANIFEST = join(ART, '.card-manifest.json');

const check = process.argv.includes('--check');

/** This card's own accent (card.ts). `cards.test.mjs` checks every card.svg
 *  contains its own game's accent hex, and the hand-drawn dart this script
 *  replaces carried it as a racing stripe rather than the body colour — the
 *  car's real paint is the photo's own, not the accent (illustrations.md
 *  §3). Drawn as a thin pinstripe in the gap between `car.png`'s own two
 *  black stripes, so the accent keeps its place without fighting the photo. */
const OWN_ACCENT = '#E4572E';

const CARD_W = 120;
const CARD_H = 90;

/** Where the car sits and which way it points — the hand-drawn dart's own
 *  anchor and angle, turned hard into the bend (see the file doc comment). */
const CAR_CENTER = { x: 60, y: 35 };
const CAR_WIDTH = 16;
const CAR_ROTATE = 130;

/** One repeat of the road pattern, in SVG user units — small enough that the
 *  30-unit-wide road shows two or three tiles rather than one blown-up crop. */
const ROAD_TILE = 18;

function sha(parts) {
  const hash = createHash('sha256');
  for (const p of parts) hash.update(p);
  return hash.digest('hex').slice(0, 32);
}

/** `car.png` trimmed to its own content and downscaled, as a base64 PNG plus
 *  the aspect ratio the trim left it with — the same shape
 *  `asteroid-race/generate-card.mjs`'s own `frame()` returns. */
async function carSprite(renderWidth) {
  const trimmed = await sharp(CAR).trim().png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const outHeight = Math.max(1, Math.round((renderWidth * meta.height) / meta.width));
  const resized = await sharp(trimmed)
    .resize(renderWidth, outHeight)
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  return {
    href: `data:image/png;base64,${resized.toString('base64')}`,
    aspect: meta.width / meta.height,
  };
}

/** A small square cropped from the texture's own centre and downscaled hard
 *  to `size` pixels — the pattern repeats it, so one tiny tile is all a
 *  stroke ever needs (see the file doc comment). */
async function roadTile(size) {
  const meta = await sharp(ROAD).metadata();
  const crop = Math.min(meta.width, meta.height, 400);
  const left = Math.round((meta.width - crop) / 2);
  const top = Math.round((meta.height - crop) / 2);
  const tile = await sharp(ROAD)
    .extract({ left, top, width: crop, height: crop })
    .resize(size, size)
    .jpeg({ quality: 65 })
    .toBuffer();
  return `data:image/jpeg;base64,${tile.toString('base64')}`;
}

/** The car, centred on (cx, cy) at `w` card units wide, keeping its own
 *  aspect and rotated by `deg` — the dart's own `translate().rotate()` shape —
 *  plus the accent pinstripe (see `OWN_ACCENT`), run most of the car's own
 *  length down its centreline, in the same local frame. */
function placeCar(sprite, cx, cy, w, deg) {
  const h = w / sprite.aspect;
  const x = (-w / 2).toFixed(2);
  const y = (-h / 2).toFixed(2);
  const stripeHalf = (h * 0.42).toFixed(2);
  return `  <g transform="translate(${cx} ${cy}) rotate(${deg})">
    <image x="${x}" y="${y}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" href="${sprite.href}"/>
    <line x1="0" y1="-${stripeHalf}" x2="0" y2="${stripeHalf}" stroke="${OWN_ACCENT}" stroke-width="1" stroke-linecap="round" opacity="0.85"/>
  </g>`;
}

/* ── Staleness ───────────────────────────────────────────────────────────── */

const inputs = [
  Buffer.from(String(GENERATOR)),
  // This script's own source covers the composition, the tile size and the
  // rotation in one input — the same call the other four generated cards
  // make, and for the same reason: a hand-listed set of inputs is easy to
  // leave incomplete when the composition moves, and nothing fails when it
  // does.
  //
  // Normalised to LF: read as text and rejoined rather than hashed as raw
  // bytes, because git checks this file out as CRLF on Windows
  // (core.autocrlf) and LF on the Linux CI runner that deploys `dev`/`prod`
  // — hashing the bytes made the very commit that generated the manifest
  // read as stale the moment CI checked it out.
  Buffer.from(readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n?/g, '\n')),
  readFileSync(CAR),
  readFileSync(ROAD),
];
const hash = sha(inputs);

const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const stale = previous.hash !== hash || !existsSync(OUT_SVG);

if (check) {
  if (!stale) {
    console.log('tilt-card: art/card.svg up to date');
    process.exit(0);
  }
  console.error('tilt-card: art/card.svg is stale. Run `npm run art:tilt-card`.');
  process.exit(1);
}

if (!stale) {
  console.log('tilt-card: nothing changed, art/card.svg already current');
  process.exit(0);
}

/* ── Render ──────────────────────────────────────────────────────────────── */

const car = await carSprite(90);
const roadHref = await roadTile(48);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}" role="img">
  <!--
    Tilt Race — hub card illustration. The car and the road surface are
    GENERATED, do not edit by hand: www/src/games/tilt-race/generate-card.mjs
    crops the car straight out of this game's own art/car.png and tiles a
    small crop of art/road.jpg as the road's own stroke pattern. Run
    \`npm run art:tilt-card\` after redrawing either asset; \`npm test\` fails
    if the committed card is stale. Everything else here (the kerb, the
    dashed rail, the skid marks) is hand-drawn vector and can be edited
    directly.

    Transparent background: the accent tint behind it is painted by CSS, so
    it is both the placeholder before this file loads and the backdrop after.

    Colours are literal hexes on purpose — an img-loaded SVG has no access to
    the page's CSS, so currentColor would render black and a CSS variable
    would make the shape vanish.

    Style: docs/design/ui-guidelines.md §6 · mechanics: docs/design/illustrations.md
  -->
  <title>Tilt Race</title>
  <defs>
    <pattern id="road" patternUnits="userSpaceOnUse" width="${ROAD_TILE}" height="${ROAD_TILE}">
      <image href="${roadHref}" x="0" y="0" width="${ROAD_TILE}" height="${ROAD_TILE}"/>
    </pattern>
  </defs>
  <rect width="120" height="90" fill="#151A16"/>
  <!-- The map is level, always. Kerb first, road on top of it, exactly as
       TrackCanvas draws it, so a bend gets its red edge for free. -->
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M-27 30 H48 Q66 30 66 48 V105" stroke="#C0392B" stroke-width="36"/>
    <path d="M-27 30 H48 Q66 30 66 48 V105" stroke="url(#road)" stroke-width="30"/>
    <path d="M-27 30 H48 Q66 30 66 48 V105" stroke="#E8EAF0" stroke-width="1.6" stroke-dasharray="7 6" opacity="0.5"/>
    <path d="M100 -12 V38 Q100 56 118 56 H140" stroke="#C0392B" stroke-width="36"/>
    <path d="M100 -12 V38 Q100 56 118 56 H140" stroke="url(#road)" stroke-width="30"/>
    <path d="M100 -12 V38 Q100 56 118 56 H140" stroke="#E8EAF0" stroke-width="1.6" stroke-dasharray="7 6" opacity="0.5"/>
  </g>
  <!-- Skid marks, trailing back up the straight the car has just left. -->
  <g opacity="0.5" stroke="#E8EAF0" stroke-width="2" stroke-linecap="round" fill="none">
    <path d="M36 24 C44 24 50 26 54 30"/>
    <path d="M32 37 C40 37 47 38 51 41"/>
  </g>
  <!-- The car, turned into the bend: it points where it is going, and the map
       underneath it does not move. -->
${placeCar(car, CAR_CENTER.x, CAR_CENTER.y, CAR_WIDTH, CAR_ROTATE)}
</svg>
`;

const bytes = Buffer.byteLength(svg, 'utf8');
if (bytes > 40 * 1024) {
  console.error(`tilt-card: card.svg would be ${(bytes / 1024).toFixed(1)} KB, over the 40 KB cap`);
  process.exit(1);
}

writeFileSync(OUT_SVG, svg);
writeFileSync(MANIFEST, `${JSON.stringify({ generator: GENERATOR, hash }, null, 2)}\n`);
console.log(`tilt-card: card.svg regenerated (${(bytes / 1024).toFixed(1)} KB total)`);
