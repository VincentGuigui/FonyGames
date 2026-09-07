/**
 * The colour wheel's geometry. Spec: docs/specs/games/color-match.md §4.2
 *
 * `ColorWheel.tsx` is SVG and is covered by looking at a real round
 * (docs/testing.md §1.2). What is here is the part a player can lose to: that
 * every colour a rung offers has a wedge, that no two wedges overlap, that
 * tapping a wedge picks the colour that is drawn there, and that the
 * continuous disc submits the colour it is showing rather than a different one
 * it snapped to afterwards.
 */
import { COLOR_SECTOR_MAX } from '../../../../shared/protocol';
import { componentValues, palette, rungAt, snapToRung } from '../../../../shared/color';
import {
  WHEEL_HUB,
  continuousAt,
  hueOf,
  isSectorRung,
  neutralFor,
  positionOf,
  ringsFor,
  sectorAt,
  sectorsFor,
  sortForWheel,
} from './wheel';

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

/** A point inside a wedge, in disc-radius units from the centre. */
function inside(s: { r0: number; r1: number; a0: number; a1: number }): { nx: number; ny: number } {
  const r = (s.r0 + s.r1) / 2;
  const a = (s.a0 + s.a1) / 2;
  return { nx: Math.sin(a) * r, ny: -Math.cos(a) * r };
}

function which(): void {
  console.log('\nwhich presentation a rung gets');

  check('level 1, four colours, is a sector wheel', isSectorRung(rungAt(1), COLOR_SECTOR_MAX));
  check('level 11, twenty-seven, still is', isSectorRung(rungAt(11), COLOR_SECTOR_MAX));
  check('level 16, a hundred and twenty-five, is already too many', !isSectorRung(rungAt(16), COLOR_SECTOR_MAX), palette(rungAt(16)).length);
  check('level 31, seven hundred, is not', !isSectorRung(rungAt(31), COLOR_SECTOR_MAX));
  check('and neither is the ladder\'s far end', !isSectorRung(rungAt(200), COLOR_SECTOR_MAX));
  check('the switch is on the palette, not the level', isSectorRung(rungAt(16), COLOR_SECTOR_MAX) === (palette(rungAt(16)).length <= COLOR_SECTOR_MAX));

  // A 255-split rung has 16.7M colours; asking must not enumerate them.
  const started = Date.now();
  isSectorRung(rungAt(1000), COLOR_SECTOR_MAX);
  check('asking about a huge rung is instant, not an enumeration', Date.now() - started < 50);
}

function layout(): void {
  console.log('\nlaying the wedges out');

  for (const level of [1, 6, 11]) {
    const rung = rungAt(level);
    const colors = palette(rung);
    const sectors = sectorsFor(rung, COLOR_SECTOR_MAX);
    check(`level ${level}: every colour the rung offers has a wedge`, sectors.length === colors.length, { sectors: sectors.length, colors: colors.length });
    check('  and no colour is drawn twice', new Set(sectors.map((s) => s.rgb.join(','))).size === sectors.length);
    check('  every wedge is inside the disc', sectors.every((s) => s.r0 >= WHEEL_HUB - 1e-9 && s.r1 <= 1 + 1e-9));
    check('  and has real width', sectors.every((s) => s.a1 > s.a0 && s.r1 > s.r0));

    // Each ring closes the circle exactly: no gap that reads as a missing
    // colour, and no overlap that makes a tap ambiguous.
    const byRing = new Map<number, typeof sectors>();
    for (const s of sectors) byRing.set(s.ring, [...(byRing.get(s.ring) ?? []), s]);
    check('  each ring closes the full circle', [...byRing.values()].every((ring) => {
      const span = ring.reduce((sum, s) => sum + (s.a1 - s.a0), 0);
      return Math.abs(span - Math.PI * 2) < 1e-9;
    }));
    check('  with no two wedges overlapping', [...byRing.values()].every((ring) => {
      const sorted = [...ring].sort((a, b) => a.a0 - b.a0);
      return sorted.every((s, i) => i === 0 || s.a0 >= (sorted[i - 1]?.a1 ?? 0) - 1e-9);
    }));
  }

  check('a rung too big for wedges lays none out', sectorsFor(rungAt(31), COLOR_SECTOR_MAX).length === 0);
  check('four colours go in one ring', ringsFor(4) === 1);
  check('twenty-seven go in three', ringsFor(27) === 3, ringsFor(27));
  check('and the ring count grows with the palette', ringsFor(64) >= ringsFor(27));
}

function tapping(): void {
  console.log('\ntapping a wedge picks what is drawn there');

  const rung = rungAt(11);
  const sectors = sectorsFor(rung, COLOR_SECTOR_MAX);
  check('every wedge is hit by a tap in its own middle', sectors.every((s) => {
    const p = inside(s);
    const hit = sectorAt(sectors, p.nx, p.ny);
    return hit?.rgb.join(',') === s.rgb.join(',');
  }));

  check('the hub in the middle is not a pick', sectorAt(sectors, 0, 0) === null);
  check('nor is just inside it', sectorAt(sectors, 0, -(WHEEL_HUB - 0.02)) === null);
  check('and neither is outside the disc', sectorAt(sectors, 0, -1.4) === null);
  check('twelve o\'clock lands in the first wedge of a ring', (() => {
    const hit = sectorAt(sectors, 0, -(WHEEL_HUB + 0.02));
    return hit !== null && hit.ring === 0 && hit.a0 === 0;
  })());
}

function ordering(): void {
  console.log('\nthe order colours are laid out in');

  const sorted = sortForWheel(palette(rungAt(16)));
  check('nothing is lost or gained by sorting', sorted.length === palette(rungAt(16)).length);
  check('greys come first, all together', (() => {
    const greys = sorted.filter((c) => hueOf(c) < 0);
    const firstColoured = sorted.findIndex((c) => hueOf(c) >= 0);
    return greys.length > 0 && firstColoured === greys.length;
  })(), sorted.slice(0, 6));
  check('and hue never goes backwards after that', (() => {
    let last = -1;
    for (const c of sorted) {
      const h = hueOf(c);
      if (h < last) return false;
      last = h;
    }
    return true;
  })());
  check('pure red is at hue 0', hueOf([255, 0, 0]) === 0);
  check('pure green at 120', hueOf([0, 255, 0]) === 120);
  check('pure blue at 240', hueOf([0, 0, 255]) === 240);
  check('and grey has no hue at all', hueOf([90, 90, 90]) === -1 && hueOf([0, 0, 0]) === -1);
}

function continuous(): void {
  console.log('\nthe continuous disc submits what it shows');

  const rung = rungAt(31);
  const values = componentValues(rung.splits);
  let checked = 0;
  let good = true;
  for (let a = 0; a < Math.PI * 2; a += 0.21) {
    for (const r of [0.15, 0.5, 0.95]) {
      const got = continuousAt(rung, Math.sin(a) * r, -Math.cos(a) * r);
      if (!got) {
        good = false;
        continue;
      }
      checked++;
      // Already on the rung's grid: the colour drawn under the cursor is the
      // colour that goes on the wire, never a different one snapped later.
      if (!got.every((v) => values.includes(v))) good = false;
      if (JSON.stringify(snapToRung(got, rung)) !== JSON.stringify(got)) good = false;
    }
  }
  check(`every point on the disc snaps to the rung (${checked} sampled)`, good && checked > 40);
  check('outside the disc is not a pick', continuousAt(rung, 0, -1.3) === null);
  check('the centre is a pick, unlike the sector wheel', continuousAt(rung, 0, 0) !== null);
  check('the centre is unsaturated', (() => {
    const c = continuousAt(rung, 0, 0);
    return !!c && c[0] === c[1] && c[1] === c[2];
  })());
  check('the rim is saturated', (() => {
    const c = continuousAt(rung, 0, -0.99);
    return !!c && Math.max(...c) - Math.min(...c) > 100;
  })(), continuousAt(rung, 0, -0.99));
}

function cursor(): void {
  console.log('\nwhere the cursor is drawn');

  check('a saturated colour sits near the rim', (() => {
    const p = positionOf([255, 0, 0]);
    return Math.abs(Math.hypot(p.nx, p.ny) - 1) < 1e-9;
  })());
  check('a grey sits at the centre', (() => {
    const p = positionOf([120, 120, 120]);
    return Math.hypot(p.nx, p.ny) < 1e-9;
  })());
  // The disc carries hue and saturation only — brightness is the slider's job
  // (spec §2.3) — so a round trip preserves those two and nothing else. Fully
  // bright colours are the ones it can return exactly.
  check('a fully bright colour round-trips through the disc exactly', (() => {
    const rung = rungAt(31);
    for (const rgb of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255]] as const) {
      const p = positionOf(rgb);
      const back = continuousAt(rung, p.nx, p.ny);
      if (!back || JSON.stringify(back) !== JSON.stringify(snapToRung(rgb, rung))) return false;
    }
    return true;
  })());
  check('and a dim one comes back at full brightness, same hue', (() => {
    const rung = rungAt(31);
    const p = positionOf([0, 96, 0]);
    const back = continuousAt(rung, p.nx, p.ny);
    return !!back && hueOf(back) === 120 && Math.max(...back) === 255;
  })(), (() => { const p = positionOf([0, 96, 0]); return continuousAt(rungAt(31), p.nx, p.ny); })());
}

function neutral(): void {
  console.log('\nwhat a level opens on');

  check('the middle of the rung, not black', (() => {
    const n = neutralFor(rungAt(16));
    return n[0] > 0 && n[0] === n[1] && n[1] === n[2];
  })(), neutralFor(rungAt(16)));
  check('and it is on the rung\'s own grid', (() => {
    const rung = rungAt(16);
    return JSON.stringify(snapToRung(neutralFor(rung), rung)) === JSON.stringify(neutralFor(rung));
  })());
  // Level 1's palette is black, red, green, blue — a grey default is not one
  // of them, which is the point: never touching the wheel scores nothing.
  check('at level 1 the default is not a possible answer', (() => {
    const n = neutralFor(rungAt(1));
    return !palette(rungAt(1)).some((c) => c.join(',') === n.join(','));
  })(), neutralFor(rungAt(1)));
}

which();
layout();
tapping();
ordering();
continuous();
cursor();
neutral();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
