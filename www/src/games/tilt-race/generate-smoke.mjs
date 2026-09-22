/**
 * `art/smoke.png` — a 3x1 sheet of smoke puffs for the car's trail (issue #44).
 *
 * Generated rather than drawn so the three variants are genuinely different
 * shapes rather than one blurred circle three times: each is a handful of
 * overlapping blobs at its own radii and offsets, from a fixed seed, so the
 * sheet is reproducible and `--check` can prove the committed file matches.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ART = join(fileURLToPath(new URL('./art/', import.meta.url)));
const OUT = join(ART, 'smoke.png');
const MANIFEST = join(ART, '.smoke-manifest.json');

/** One cell per variant. 96 keeps a puff crisp at the ~40 px it is drawn. */
const CELL = 96;
const VARIANTS = 3;

function seeded(n) {
  let h = n >>> 0;
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 4294967296;
  };
}

/** A puff: overlapping soft blobs, lightest in the middle. */
function puff(random) {
  const blobs = [];
  const count = 5 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) {
    const a = random() * Math.PI * 2;
    const spread = random() * 0.22;
    blobs.push({
      cx: 0.5 + Math.cos(a) * spread,
      cy: 0.5 + Math.sin(a) * spread,
      r: 0.18 + random() * 0.14,
      o: 0.45 + random() * 0.35,
    });
  }
  return blobs
    .map(
      (b) =>
        `<circle cx="${(b.cx * CELL).toFixed(1)}" cy="${(b.cy * CELL).toFixed(1)}" r="${(b.r * CELL).toFixed(1)}" fill="url(#g)" opacity="${b.o.toFixed(2)}"/>`,
    )
    .join('');
}

const random = seeded(4471);
const cells = [];
for (let i = 0; i < VARIANTS; i++) {
  cells.push(`<g transform="translate(${i * CELL},0)">${puff(random)}</g>`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL * VARIANTS}" height="${CELL}" viewBox="0 0 ${CELL * VARIANTS} ${CELL}">
<defs><radialGradient id="g"><stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="0.55" stop-color="#d8dbe4" stop-opacity="0.6"/><stop offset="1" stop-color="#aeb4c4" stop-opacity="0"/></radialGradient></defs>
${cells.join('\n')}
</svg>`;

const stamp = createHash('sha256').update(svg).digest('hex').slice(0, 32);
const check = process.argv.includes('--check');

if (check) {
  const have = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')).sha : null;
  if (have !== stamp || !existsSync(OUT)) {
    console.error('smoke: art/smoke.png is stale. Run `npm run art:smoke`.');
    process.exit(1);
  }
  console.log('smoke: art/smoke.png up to date');
  process.exit(0);
}

const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
writeFileSync(OUT, png);
writeFileSync(MANIFEST, `${JSON.stringify({ sha: stamp, cell: CELL, variants: VARIANTS }, null, 2)}\n`);
console.log(`smoke: art/smoke.png regenerated (${CELL * VARIANTS}x${CELL}, ${VARIANTS} variants, ${(png.length / 1024).toFixed(1)} KB)`);
