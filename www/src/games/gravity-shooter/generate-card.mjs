/**
 * Regenerate Gravity Shooter's hub card from the game's own art and the game's
 * own physics. Contract: docs/design/illustrations.md
 *
 * ## Why generated rather than hand-drawn
 *
 * This game already owns everything the card is a picture of: two ship sprites,
 * three planet sprites, a missile sprite, and — the part that matters — the
 * function that decides where a missile actually goes. The hand-drawn card this
 * replaces was an *approximation* of all four, and approximations of authored
 * pixel art read worse at card size (the same reasoning illustrations.md already
 * records for Tap Fighter, Aliens Love Cows and Random Game).
 *
 * The trail is the real point. It is not a curve somebody liked the look of: it
 * is `simulateShot` from `game.ts`, run over a posed board, with the missile
 * drawn at a real point on the path and rotated to that point's real tangent.
 * Retune `GRAVITY_G` or the launch speed and this card's curve changes with the
 * game, because it is the same code.
 *
 * ## Why the board is posed rather than rolled
 *
 * A card is a promise about the game, so the shot it shows has to be a good one
 * every time — not whatever `rollBoard` happened to produce. `BOARD` and `SHOT`
 * below are hand-picked and legal under the spec's own placement rules (§2.1);
 * the physics that flies through them is not hand-picked at all.
 *
 * ## Staleness is a content hash, never a timestamp
 *
 * Same reasoning as `random-game/generate-card.mjs` and `og.mjs`: git does not
 * preserve mtimes. `art/.card-manifest.json` is committed and holds a hash of
 * every input — the five PNGs, `game.ts` and the shared protocol it reads its
 * constants from, the posed board, and this script's own `GENERATOR` version.
 *
 * `--check` exits 1 when the committed card is stale, and runs as part of
 * `npm test`.
 *
 * Usage:
 *   node www/src/games/gravity-shooter/generate-card.mjs           regenerate if stale
 *   node www/src/games/gravity-shooter/generate-card.mjs --check   exit 1 if stale
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

/** Bump when the composition changes, so the card regenerates even if no input did. */
const GENERATOR = 1;

// `process.cwd()`, not `import.meta.url`: npm scripts run from the repo root.
const ROOT = resolve(process.cwd());
const GAME = join(ROOT, 'www/src/games/gravity-shooter');
const ART = join(GAME, 'art');
const OUT_SVG = join(ART, 'card.svg');
const MANIFEST = join(ART, '.card-manifest.json');
const CACHE = join(ROOT, 'node_modules/.cache');

const check = process.argv.includes('--check');

/** This card's own accent (card.ts). The trail is drawn in it, so the file
 *  carries it literally — `cards.test.mjs` checks every card.svg contains its
 *  own game's accent hex. */
const OWN_ACCENT = '#818CF8';

/**
 * The posed board, legal under spec §2.1: one planet per half, radii inside the
 * 20–100px range and 30% apart, centres over 100px apart vertically, surfaces
 * well over 50px apart, star inside its own size range.
 */
const BOARD = {
  starRadius: 0.085,
  planets: [
    { x: 0.34, y: 0.42, r: 0.130, art: 0 },
    { x: 0.76, y: 0.68, r: 0.0845, art: 1 },
  ],
};

/**
 * The shot: 60° off straight up — fired almost sideways, away from the target —
 * at a little over half strength. Of a swept fan of every angle and strength
 * over this board, it is the one whose *drawn* trail bends hardest and still
 * lands, which is the thing the card has to promise. A shot that curves late is
 * a straight line in a still picture.
 */
const SHOT = { angleDeg: -60, strength: 0.6 };

/** How far along its own flight the missile is caught, 0..1. Late, so the whole
 *  hook is behind it and reads as something that already happened. */
const MISSILE_AT = 0.85;

/**
 * Where the framing starts, as a fraction of the flight. Not zero: fitting the
 * whole board into 4:3 shrinks a 256px ship sprite to about 30 device pixels on
 * a real hub card, and a detailed sprite that small is mush. Cropping to the
 * back half of the flight is what buys the sprites their size — the trail
 * simply enters from the bottom edge, which reads as "fired from down there"
 * without having to show it.
 */
const FIT_FROM = 0.42;

const CARD_W = 120;
const CARD_H = 90;

/**
 * The posed board has to be a board the game could actually deal (spec §2.1),
 * or the card is advertising something that never happens. Cheap to check, and
 * the one thing about a hand-posed board that can quietly rot.
 */
async function assertLegal(rules) {
  const [a, b] = BOARD.planets;
  const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
  const sizeDiff = Math.abs(a.r - b.r) / Math.max(a.r, b.r);
  const problems = [];
  if ((a.x < 0.5) === (b.x < 0.5)) problems.push('both planets are on the same half');
  if (gap < rules.GRAVITY_PLANET_MIN_GAP) problems.push(`surfaces are ${gap.toFixed(3)} apart, under ${rules.GRAVITY_PLANET_MIN_GAP}`);
  if (Math.abs(a.y - b.y) < rules.GRAVITY_PLANET_MIN_Y_DIFF) problems.push(`centres are ${Math.abs(a.y - b.y).toFixed(3)} apart vertically, under ${rules.GRAVITY_PLANET_MIN_Y_DIFF}`);
  if (sizeDiff < rules.GRAVITY_PLANET_MIN_SIZE_DIFF_RATIO) problems.push(`radii differ by ${(sizeDiff * 100).toFixed(0)}%, under ${rules.GRAVITY_PLANET_MIN_SIZE_DIFF_RATIO * 100}%`);
  for (const p of BOARD.planets) {
    if (p.r < rules.GRAVITY_PLANET_R_MIN || p.r > rules.GRAVITY_PLANET_R_MAX) problems.push(`radius ${p.r} is outside the rolled range`);
    if (p.y < rules.GRAVITY_PLANET_Y_MIN || p.y > rules.GRAVITY_PLANET_Y_MAX) problems.push(`y ${p.y} is outside the middle band`);
    if (p.x < rules.GRAVITY_PLANET_X_MARGIN || p.x > 1 - rules.GRAVITY_PLANET_X_MARGIN) problems.push(`x ${p.x} is inside the edge margin`);
  }
  if (BOARD.starRadius < rules.GRAVITY_STAR_R_MIN || BOARD.starRadius > rules.GRAVITY_STAR_R_MAX) problems.push('the star is outside its own size range');
  if (problems.length > 0) {
    console.error(`gravity-card: the posed board is not one this game would deal —\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
}

function sha(parts) {
  const hash = createHash('sha256');
  for (const p of parts) hash.update(p);
  return hash.digest('hex').slice(0, 32);
}

/**
 * The game's own physics, bundled for node.
 *
 * `game.ts` is TypeScript and imports the shared protocol, so node cannot load
 * it directly — the same bundle-then-run step every `test:*` script in
 * package.json already uses, through esbuild's JS API rather than its CLI so
 * this does not depend on where npm put the binary.
 */
async function gamePhysics() {
  const esbuild = await import('esbuild');
  mkdirSync(CACHE, { recursive: true });
  const entry = join(CACHE, 'gravity-card-entry.ts');
  const out = join(CACHE, 'gravity-card-physics.mjs');
  writeFileSync(entry, [
    `export { simulateShot, shipPosition, headingBetween, GRAVITY_SHIP_WIDTH } from ${JSON.stringify(join(GAME, 'game.ts'))};`,
    `export { gravityBodies, GRAVITY_PLANET_MIN_GAP, GRAVITY_PLANET_MIN_Y_DIFF, GRAVITY_PLANET_MIN_SIZE_DIFF_RATIO, GRAVITY_PLANET_R_MIN, GRAVITY_PLANET_R_MAX, GRAVITY_PLANET_X_MARGIN, GRAVITY_PLANET_Y_MIN, GRAVITY_PLANET_Y_MAX, GRAVITY_STAR_R_MIN, GRAVITY_STAR_R_MAX } from ${JSON.stringify(join(ROOT, 'shared/protocol.ts'))};`,
  ].join('\n'));
  await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'warning' });
  return import(`${pathToFileURL(out).href}?v=${Date.now()}`);
}

/** A sprite, trimmed to its own content and downscaled, as a base64 PNG plus
 *  the aspect ratio the trim left it with. */
async function sprite(file, renderWidth) {
  const trimmed = await sharp(join(ART, file)).trim().png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const height = Math.max(1, Math.round((renderWidth * meta.height) / meta.width));
  const resized = await sharp(trimmed)
    .resize(renderWidth, height)
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  return { href: `data:image/png;base64,${resized.toString('base64')}`, aspect: meta.width / meta.height, bytes: resized.length };
}

/** `<image>` centred on (cx, cy) at `w` card units wide, keeping the sprite's
 *  own aspect, optionally rotated (degrees, clockwise) or flipped vertically. */
function place(sprite, cx, cy, w, { rotate = 0, flip = false } = {}) {
  const h = w / sprite.aspect;
  const x = (cx - w / 2).toFixed(2);
  const y = (cy - h / 2).toFixed(2);
  const transforms = [];
  if (rotate) transforms.push(`rotate(${rotate.toFixed(1)} ${cx.toFixed(2)} ${cy.toFixed(2)})`);
  if (flip) transforms.push(`translate(0 ${(2 * cy).toFixed(2)}) scale(1 -1)`);
  const attr = transforms.length ? ` transform="${transforms.join(' ')}"` : '';
  return `  <image x="${x}" y="${y}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" href="${sprite.href}"${attr}/>`;
}

/* ── Staleness ───────────────────────────────────────────────────────────── */

const SPRITE_FILES = ['ship-a.png', 'ship-b.png', 'planet-a.png', 'planet-b.png', 'missile.png'];
const inputs = [
  Buffer.from(String(GENERATOR)),
  // This script's own source, which covers the posed board, the shot, the
  // framing and every line of the composition in one input. Random Game's
  // generator hashes a hand-listed set instead and relies on bumping
  // GENERATOR when the composition moves; the first change made here proved
  // how easy that is to forget — a new framing constant left the card
  // "already current" and unchanged.
  readFileSync(new URL(import.meta.url)),
  // The physics itself: a retuned G or launch speed is a different curve, and
  // the card has to know that without anybody remembering to say so.
  readFileSync(join(GAME, 'game.ts')),
  readFileSync(join(ROOT, 'shared/protocol.ts')),
];
for (const file of SPRITE_FILES) inputs.push(readFileSync(join(ART, file)));
const hash = sha(inputs);

const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const stale = previous.hash !== hash || !existsSync(OUT_SVG);

if (check) {
  if (!stale) {
    console.log('gravity-card: art/card.svg up to date');
    process.exit(0);
  }
  console.error('gravity-card: art/card.svg is stale. Run `npm run art:gravity-card`.');
  process.exit(1);
}

if (!stale) {
  console.log('gravity-card: nothing changed, art/card.svg already current');
  process.exit(0);
}

/* ── The shot ────────────────────────────────────────────────────────────── */

const physics = await gamePhysics();
await assertLegal(physics);
const bodies = physics.gravityBodies(BOARD.starRadius, BOARD.planets);
const shot = physics.simulateShot(bodies, 0, (SHOT.angleDeg * Math.PI) / 180, SHOT.strength);
const shooter = physics.shipPosition(0);
const target = physics.shipPosition(1);
const shipW = physics.GRAVITY_SHIP_WIDTH;

/* ── The camera ──────────────────────────────────────────────────────────── */

/**
 * Framed on the flight rather than on the board: the path, the planets, the
 * star and the ship being shot at. The shooter's own ship is deliberately left
 * out of the fit, so it sits low in frame and half out of it — the card is a
 * view down your own shot, not a screenshot of the whole match.
 */
function camera() {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const include = (x, y, pad = 0) => {
    minX = Math.min(minX, x - pad);
    maxX = Math.max(maxX, x + pad);
    minY = Math.min(minY, y - pad);
    maxY = Math.max(maxY, y + pad);
  };
  const first = Math.floor(FIT_FROM * (shot.path.length - 1));
  const last = Math.floor(MISSILE_AT * (shot.path.length - 1));
  for (let i = first; i <= last; i++) include(shot.path[i].x, shot.path[i].y);
  include(target.x, target.y, shipW / 2);
  // Only bodies the crop already reaches — one falling half outside the frame
  // is depth, but one dragging the whole frame open to fit it is not.
  for (const p of BOARD.planets) if (p.x > minX && p.x < maxX && p.y > minY && p.y < maxY) include(p.x, p.y, p.r);

  const margin = 0.04;
  minX -= margin;
  maxX += margin;
  minY -= margin;
  maxY += margin;

  // Grow the short side to 4:3 rather than stretching either — a squashed
  // planet is the one thing a sprite-based card cannot get away with.
  const aspect = CARD_W / CARD_H;
  let w = maxX - minX;
  let h = maxY - minY;
  if (w / h < aspect) {
    const grow = h * aspect - w;
    minX -= grow / 2;
    maxX += grow / 2;
    w = maxX - minX;
  } else {
    const grow = w / aspect - h;
    minY -= grow / 2;
    maxY += grow / 2;
    h = maxY - minY;
  }
  const scale = CARD_W / w;
  return {
    scale,
    x: (wx) => (wx - minX) * scale,
    y: (wy) => (wy - minY) * scale,
  };
}

const cam = camera();
const at = (p) => ({ x: cam.x(p.x), y: cam.y(p.y) });

/* ── Render ──────────────────────────────────────────────────────────────── */

const [shipA, shipB, planetA, planetB, missile] = await Promise.all([
  sprite('ship-a.png', 128),
  sprite('ship-b.png', 112),
  sprite('planet-a.png', 96),
  sprite('planet-b.png', 72),
  sprite('missile.png', 40),
]);

/** The star, drawn rather than sprited — exactly what `GravityCanvas`'s own
 *  `drawStar` does, and for the same reason it gives: its radius changes every
 *  couple of shots, so it has never been a file. Same two gradients. */
function star() {
  const c = at({ x: 0.5, y: 0.5 });
  const r = BOARD.starRadius * cam.scale;
  return `  <circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${(r * 2).toFixed(2)}" fill="url(#gs-corona)"/>
  <circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${r.toFixed(2)}" fill="url(#gs-star)"/>`;
}

/** The flight, dashed in the game's own accent. Sampled rather than drawn point
 *  by point: 240 path points is 240 coordinate pairs of file for a curve that
 *  reads identically at a dozen. */
function trail() {
  const step = Math.max(1, Math.floor(shot.path.length / 22));
  const points = [];
  for (let i = 0; i <= Math.floor(MISSILE_AT * (shot.path.length - 1)); i += step) {
    const p = at(shot.path[i]);
    points.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  }
  return `  <polyline points="${points.join(' ')}" fill="none" stroke="${OWN_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="3.2 3.2" opacity="0.9"/>`;
}

const noseIndex = Math.floor(MISSILE_AT * (shot.path.length - 1));
const nose = at(shot.path[noseIndex]);
const prev = at(shot.path[Math.max(0, noseIndex - 6)]);
// The same convention the game draws the missile with: 0 is straight up the
// screen, growing clockwise — which is also what an SVG rotate() wants.
const heading = (physics.headingBetween(prev, { x: nose.x, y: nose.y }) * 180) / Math.PI;

const shooterAt = at(shooter);
const targetAt = at(target);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}">
  <!--
    Gravity Shooter — hub card illustration. GENERATED, do not edit by hand:
    www/src/games/gravity-shooter/generate-card.mjs composes it from this game's
    own sprites, and the dashed curve is this game's own simulateShot flying a
    posed board. Run \`npm run art:gravity-card\` after changing either; \`npm test\`
    fails if the committed file is stale.

    Transparent: the accent tint behind it is painted by CSS, so it is both the
    placeholder before this file loads and the backdrop after.

    Style: docs/design/ui-guidelines.md §6 · mechanics: docs/design/illustrations.md
  -->
  <defs>
    <radialGradient id="gs-corona">
      <stop offset="0.3" stop-color="#FDE047" stop-opacity="0.42"/>
      <stop offset="0.5" stop-color="#F97316" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#F97316" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="gs-star" cx="0.35" cy="0.35" r="0.75">
      <stop offset="0" stop-color="#FFFBEB"/>
      <stop offset="0.45" stop-color="#FDE047"/>
      <stop offset="1" stop-color="#F97316"/>
    </radialGradient>
  </defs>
${star()}
${place(planetA, cam.x(BOARD.planets[0].x), cam.y(BOARD.planets[0].y), BOARD.planets[0].r * 2 * cam.scale)}
${place(planetB, cam.x(BOARD.planets[1].x), cam.y(BOARD.planets[1].y), BOARD.planets[1].r * 2 * cam.scale)}
${trail()}
${place(shipB, targetAt.x, targetAt.y, shipW * cam.scale, { flip: true })}
${place(missile, nose.x, nose.y, 0.05 * cam.scale * 1.6, { rotate: heading })}
${place(shipA, shooterAt.x, shooterAt.y, shipW * cam.scale)}
</svg>
`;

const bytes = Buffer.byteLength(svg, 'utf8');
if (bytes > 40 * 1024) {
  console.error(`gravity-card: card.svg would be ${(bytes / 1024).toFixed(1)} KB, over the 40 KB cap`);
  process.exit(1);
}

writeFileSync(OUT_SVG, svg);
writeFileSync(MANIFEST, `${JSON.stringify({ generator: GENERATOR, hash }, null, 2)}\n`);
console.log(
  `gravity-card: card.svg regenerated (${(bytes / 1024).toFixed(1)} KB total, `
  + `${shot.path.length} path points, hit=${shot.hit})`,
);
