/**
 * `art/jumper.png` — the jumper's sprite sheet, 6 columns x 2 rows (issue #48,
 * which asks for transparent PNG sprite sheets).
 *
 * Generated rather than drawn, for the reason `tilt-race/generate-smoke.mjs`
 * gives: the top row is a six-frame run cycle, and a run cycle is a *function*
 * of a phase angle — hand-drawing six poses that stay consistent as the
 * proportions change is the kind of thing that drifts silently. Here the whole
 * figure is one posed skeleton, so a change to the stride shows up in all six.
 *
 * Row 0: the run cycle, phase 0..2pi.
 * Row 1: take-off, hang, flap, land, faceplant, idle.
 *
 *     node www/src/games/maximum-jump/generate-jumper.mjs            write it
 *     node www/src/games/maximum-jump/generate-jumper.mjs --check    fail if stale
 *
 * `--check` is wired into `npm test`, and the PNG is committed, so a fresh
 * clone runs `vite dev` without knowing this script exists.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ART = join(fileURLToPath(new URL('./art/', import.meta.url)));
const OUT = join(ART, 'jumper.png');
const MANIFEST = join(ART, '.jumper-manifest.json');

/** 128 keeps the figure crisp at the ~90 px it is drawn on a phone. */
const CELL = 128;
const COLS = 6;
const ROWS = 2;

const SKIN = '#E8B98A';
const KIT = '#EAB308';
const LIMB = '#3B3550';

/** The skeleton, in cell coordinates. Everything else is angles off these. */
const HIP = { x: 56, y: 70 };
const SHOULDER = { x: 64, y: 40 };
const THIGH = 25;
const SHIN = 25;
const UPPER_ARM = 19;
const FOREARM = 18;

/** One joint out from another: `a` is radians from straight down, swinging
 *  forward (towards +x, the way the jumper faces). */
function out(from, a, len) {
  return { x: from.x + Math.sin(a) * len, y: from.y + Math.cos(a) * len };
}

function limb(a, b, c, width, colour) {
  return (
    `<path d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${b.x.toFixed(1)} ${b.y.toFixed(1)} L${c.x.toFixed(1)} ${c.y.toFixed(1)}" ` +
    `fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

/** A leg from its thigh and knee angles. */
function leg(thigh, knee, colour) {
  const kneePt = out(HIP, thigh, THIGH);
  return limb(HIP, kneePt, out(kneePt, thigh - knee, SHIN), 9, colour);
}

/** An arm from its shoulder and elbow angles. */
function arm(shoulder, elbow, colour) {
  const elbowPt = out(SHOULDER, shoulder, UPPER_ARM);
  return limb(SHOULDER, elbowPt, out(elbowPt, shoulder + elbow, FOREARM), 7, colour);
}

/** Head, torso and the near-side kit, which every pose shares. */
function body(lean) {
  const hip = HIP;
  const head = { x: SHOULDER.x + Math.sin(lean) * 14 + 6, y: SHOULDER.y - Math.cos(lean) * 14 };
  return (
    `<path d="M${hip.x} ${hip.y} L${SHOULDER.x} ${SHOULDER.y}" stroke="${KIT}" stroke-width="20" stroke-linecap="round" fill="none"/>` +
    `<circle cx="${head.x.toFixed(1)}" cy="${head.y.toFixed(1)}" r="11" fill="${SKIN}"/>` +
    `<path d="M${(head.x - 9).toFixed(1)} ${(head.y - 5).toFixed(1)} a 10 10 0 0 1 17 -2 l -4 -4 a 10 10 0 0 0 -13 6 Z" fill="${LIMB}"/>`
  );
}

/** One frame: the far limbs, then the body, then the near ones, so the figure
 *  reads as having a front and a back. */
function pose({ farLeg, farArm, nearLeg, nearArm, lean = 0 }) {
  const far = '#8A7FA8';
  return (
    leg(farLeg[0], farLeg[1], far) +
    arm(farArm[0], farArm[1], far) +
    body(lean) +
    leg(nearLeg[0], nearLeg[1], LIMB) +
    arm(nearArm[0], nearArm[1], LIMB)
  );
}

/** The run cycle as a function of its phase. */
function running(p) {
  const thigh = (q) => 0.8 * Math.sin(q);
  const knee = (q) => 0.15 + 1.25 * (1 - Math.cos(q + 1.1)) * 0.5;
  const shoulder = (q) => -0.75 * Math.sin(q);
  const elbow = () => -1.5;
  return pose({
    nearLeg: [thigh(p), knee(p)],
    farLeg: [thigh(p + Math.PI), knee(p + Math.PI)],
    nearArm: [shoulder(p), elbow()],
    farArm: [shoulder(p + Math.PI), elbow()],
    lean: 0.12,
  });
}

/** Row 1, left to right. */
const SPECIALS = [
  // Take-off: driving knee up, trailing leg straight behind, arms thrown up.
  pose({ nearLeg: [1.5, 1.6], farLeg: [-0.9, 0.1], nearArm: [1.4, -0.6], farArm: [-1.2, -0.5], lean: 0.05 }),
  // Hang: both legs trailing, arms up and back — the shape of a jump going well.
  pose({ nearLeg: [-0.5, 0.9], farLeg: [-0.75, 1.1], nearArm: [2.3, -0.4], farArm: [2.1, -0.4], lean: 0 }),
  // Flap: the same hang with the arms hauled forward, which is what the
  // tapping looks like from outside.
  pose({ nearLeg: [-0.45, 0.8], farLeg: [-0.7, 1.0], nearArm: [-1.1, -0.8], farArm: [-0.9, -0.8], lean: 0 }),
  // Land: legs thrown forward together, arms swept back, braced for the sand.
  pose({ nearLeg: [1.3, 0.3], farLeg: [1.15, 0.35], nearArm: [-1.8, -0.5], farArm: [-1.6, -0.5], lean: -0.3 }),
  // Faceplant: the whole figure pitched forward onto its face. A rotation,
  // not a lean — `lean` only tilts the head, and a jumper who has gone over
  // the line has gone over it with everything.
  `<g transform="rotate(68 ${HIP.x} ${HIP.y})">${pose({ nearLeg: [-0.5, 0.4], farLeg: [-0.65, 0.5], nearArm: [0.9, -0.3], farArm: [0.75, -0.3] })}</g>`,
  // Idle: standing at the start line, waiting for the first leg press.
  pose({ nearLeg: [0.05, 0.08], farLeg: [-0.08, 0.1], nearArm: [0.1, -0.35], farArm: [-0.1, -0.35], lean: 0.02 }),
];

const cells = [];
for (let i = 0; i < COLS; i++) {
  cells.push(`<g transform="translate(${i * CELL},0)">${running((i / COLS) * Math.PI * 2)}</g>`);
}
for (let i = 0; i < COLS; i++) {
  cells.push(`<g transform="translate(${i * CELL},${CELL})">${SPECIALS[i]}</g>`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL * COLS}" height="${CELL * ROWS}" viewBox="0 0 ${CELL * COLS} ${CELL * ROWS}">
${cells.join('\n')}
</svg>`;

const stamp = createHash('sha256').update(svg).digest('hex').slice(0, 32);

if (process.argv.includes('--check')) {
  const have = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')).sha : null;
  if (have !== stamp || !existsSync(OUT)) {
    console.error('jumper: art/jumper.png is stale. Run `npm run art:jumper`.');
    process.exit(1);
  }
  console.log('jumper: art/jumper.png up to date');
  process.exit(0);
}

const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
writeFileSync(OUT, png);
writeFileSync(MANIFEST, `${JSON.stringify({ sha: stamp, cell: CELL, cols: COLS, rows: ROWS }, null, 2)}\n`);

const meta = await sharp(png).metadata();
console.log(`jumper: art/jumper.png  ${meta.width}x${meta.height}, ${meta.channels}ch, ${(png.length / 1024).toFixed(1)} KB`);
