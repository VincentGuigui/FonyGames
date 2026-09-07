/**
 * The colour wheel's geometry. Spec: docs/specs/games/color-match.md §4.2
 *
 * `ColorWheel.tsx` is SVG and is covered by looking at a real round
 * (docs/testing.md §1.2). What is here is the part a player can lose to: that
 * every colour a rung offers has a wedge, that no two wedges overlap, that
 * tapping a wedge picks the colour that is drawn there — and, above all, that
 * **the wheel and the randomiser cannot disagree**. This is the only test with
 * both halves in scope, so it is where the reachability rule lives: a target
 * the disc has no way to show is a level nobody can win, which is exactly what
 * a dark green dealt at level 17 was.
 */
import { COLOR_SECTOR_MAX } from '../../../../shared/protocol';
import { dealTarget, palette, paletteSize, rungAt, snapToRung, valueSteps, type Rgb } from '../../../../shared/color';
import {
  WHEEL_HUB,
  continuousAt,
  hueOf,
  isSectorRung,
  neutralFor,
  positionOf,
  sectorAt,
  sectorsFor,
} from './wheel';

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

/** A deterministic 0..1 source, so a "random" deal is a fixed one in a test. */
function seeded(seed: number): () => number {
  let h = seed >>> 0;
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 4294967296;
  };
}

/** A point inside a wedge, in disc-radius units from the centre. */
function inside(s: { r0: number; r1: number; a0: number; a1: number }): { nx: number; ny: number } {
  const r = (s.r0 + s.r1) / 2;
  const a = (s.a0 + s.a1) / 2;
  return { nx: Math.sin(a) * r, ny: -Math.cos(a) * r };
}

function which(): void {
  console.log('\nwhich presentation a rung gets');

  check('level 1, three colours, is a sector wheel', isSectorRung(rungAt(1), COLOR_SECTOR_MAX));
  check('level 17, thirty-six, still is', isSectorRung(rungAt(17), COLOR_SECTOR_MAX), paletteSize(rungAt(17)));
  check('level 22, seventy-two, is already too many', !isSectorRung(rungAt(22), COLOR_SECTOR_MAX), paletteSize(rungAt(22)));
  check('and neither is the ladder\'s far end', !isSectorRung(rungAt(200), COLOR_SECTOR_MAX));
  check('the switch is on the palette, not the level', isSectorRung(rungAt(22), COLOR_SECTOR_MAX) === (paletteSize(rungAt(22)) <= COLOR_SECTOR_MAX));

  // The far end of the ladder is 360 hues on 16 rings; asking must not build it.
  const started = Date.now();
  isSectorRung(rungAt(1000), COLOR_SECTOR_MAX);
  check('asking about a huge rung is instant, not an enumeration', Date.now() - started < 50);
}

function layout(): void {
  console.log('\nlaying the wedges out');

  for (const level of [1, 6, 11, 17, 22]) {
    const rung = rungAt(level);
    const colors = palette(rung);
    const sectors = sectorsFor(rung, COLOR_SECTOR_MAX);
    if (!isSectorRung(rung, COLOR_SECTOR_MAX)) {
      check(`level ${level}: too big for wedges, so none are laid out`, sectors.length === 0);
      continue;
    }
    check(`level ${level}: every colour the rung offers has a wedge`, sectors.length === colors.length, { sectors: sectors.length, colors: colors.length });
    check('  in the palette\'s own order, which is what the hit test indexes', sectors.every((s, i) => s.rgb.join(',') === (colors[i] as Rgb).join(',')));
    check('  and no colour is drawn twice', new Set(sectors.map((s) => s.rgb.join(','))).size === sectors.length);
    check('  every wedge is inside the disc', sectors.every((s) => s.r0 >= WHEEL_HUB - 1e-9 && s.r1 <= 1 + 1e-9));
    check('  and has real width', sectors.every((s) => s.a1 > s.a0 && s.r1 > s.r0));
    check('  there are exactly as many rings as the rung has saturations', new Set(sectors.map((s) => s.ring)).size === rung.sats);

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

  // The report, restated as an assertion: up to level 21 there is nothing on
  // the wheel but the outer ring, so no wedge is light and none is dark.
  check('up to level 21 no wedge is light or dark', [1, 6, 11, 17, 21].every((lv) => sectorsFor(rungAt(lv), COLOR_SECTOR_MAX)
    .every((s) => Math.min(...s.rgb) === 0 && Math.max(...s.rgb) === 255)));
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
  // Each hue is centred on its own angle rather than starting there, so twelve
  // o'clock is the middle of red's wedge and not the seam beside it.
  check('twelve o\'clock is red, dead centre of its wedge', (() => {
    const hit = sectorAt(sectors, 0, -(WHEEL_HUB + 0.02));
    return hit !== null && hit.ring === 0 && hit.rgb.join(',') === '255,0,0';
  })(), sectorAt(sectors, 0, -(WHEEL_HUB + 0.02))?.rgb);
  check('and a hair either side of it is still red', [-0.04, 0.04].every((a) => {
    const r = WHEEL_HUB + 0.3;
    return sectorAt(sectors, Math.sin(a) * r, -Math.cos(a) * r)?.rgb.join(',') === '255,0,0';
  }));
}

function ordering(): void {
  console.log('\nthe order colours are laid out in');

  const rung = rungAt(26);
  const colors = palette(rung);
  check('a palette is one ring after another, hue by hue', colors.length === rung.hues * rung.sats);
  check('hue climbs within a ring and restarts at the next', (() => {
    for (let ring = 0; ring < rung.sats; ring++) {
      let last = -1;
      for (let i = 0; i < rung.hues; i++) {
        const h = hueOf(colors[ring * rung.hues + i] as Rgb);
        if (h < last) return false;
        last = h;
      }
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

  for (const level of [22, 31, 60, 200]) {
    const rung = rungAt(level);
    const onGrid = new Set(palette(rung).map((c) => c.join(',')));
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
        // Already a colour the rung offers: what is drawn under the cursor is
        // what goes on the wire, never a different one snapped later.
        if (!onGrid.has(got.join(','))) good = false;
        // And snapping it again barely moves it. Not "not at all": at the far
        // end of the ladder a hue step on the palest ring is worth less than
        // one 8-bit unit, so reading a hue back out of a rounded triple can
        // land on the neighbouring step. Every colour is still one the rung
        // offers, which is the property that matters — this bounds the wobble
        // rather than pretending it is absent.
        const again = snapToRung(got, rung);
        if (again.some((v, i) => Math.abs(v - (got[i] ?? 0)) > 1)) good = false;
      }
    }
    check(`level ${level}: every point on the disc is a colour the rung offers (${checked} sampled)`, good && checked > 40);
  }

  const rung = rungAt(31);
  check('outside the disc is not a pick', continuousAt(rung, 0, -1.3) === null);
  check('the centre is a pick, unlike the sector wheel', continuousAt(rung, 0, 0) !== null);
  check('the centre is the palest ring', (() => {
    const c = continuousAt(rung, 0, 0);
    return !!c && Math.min(...c) > 150;
  })(), continuousAt(rung, 0, 0));
  check('the rim is the saturated one', (() => {
    const c = continuousAt(rung, 0, -0.99);
    return !!c && Math.min(...c) === 0 && Math.max(...c) === 255;
  })(), continuousAt(rung, 0, -0.99));
}

function reachable(): void {
  console.log('\nthe randomiser only ever asks for a colour the wheel has');

  /*
   * The rule the whole rewrite exists for, checked end to end and at every
   * level: deal a target, take the base the wheel is responsible for, and find
   * the thumb position that returns it. Both presentations, because the bug
   * was in one of them: the disc could only ever produce a full-value colour,
   * while the randomiser was building targets on an RGB grid that had plenty
   * of others.
   */
  let bad: unknown = null;
  for (const level of [1, 3, 8, 14, 17, 21, 22, 26, 27, 31, 36, 41, 50, 80, 200]) {
    const rung = rungAt(level);
    const sectors = sectorsFor(rung, COLOR_SECTOR_MAX);
    for (let s = 1; s <= 12 && bad === null; s++) {
      const t = dealTarget(level, seeded(s * 13 + level));
      const at = positionOf(t.base, rung);
      if (!at) {
        bad = { level, why: 'no position', target: t };
        break;
      }
      const back = sectors.length > 0
        ? sectorAt(sectors, at.nx, at.ny)?.rgb ?? null
        : continuousAt(rung, at.nx, at.ny);
      if (!back || back.join(',') !== t.base.join(',')) bad = { level, why: 'not reachable', target: t, back };
      // And the brightness the target carries is one the slider can be set to.
      if (!valueSteps(rung.values).some((v) => Math.abs(v - t.lum) < 1e-9)) bad = { level, why: 'brightness off the slider', target: t };
    }
  }
  check('every dealt target is reachable, at every level, in both presentations', bad === null, bad);
}

function cursor(): void {
  console.log('\nwhere the cursor is drawn');

  const wide = rungAt(31);
  check('a saturated colour sits on the outermost ring', (() => {
    const p = positionOf([255, 0, 0], wide);
    return !!p && Math.abs(Math.hypot(p.nx, p.ny) - (1 - (1 - WHEEL_HUB) / (2 * wide.sats))) < 1e-9;
  })(), positionOf([255, 0, 0], wide));
  check('red sits at twelve o\'clock', (() => {
    const p = positionOf([255, 0, 0], wide);
    return !!p && Math.abs(p.nx) < 1e-9 && p.ny < 0;
  })());
  check('a grey is nowhere on the wheel, so no cursor is drawn', positionOf([120, 120, 120], wide) === null);

  // The disc carries hue and saturation only — brightness is the slider's job
  // (spec §2.3) — so a dimmed target still points at its own hue.
  check('a dimmed target is drawn at its own hue, not off the wheel', (() => {
    const p = positionOf([0, 96, 0], wide);
    if (!p) return false;
    const back = continuousAt(wide, p.nx, p.ny);
    return !!back && hueOf(back) === 120 && Math.max(...back) === 255;
  })(), (() => { const p = positionOf([0, 96, 0], wide); return p ? continuousAt(wide, p.nx, p.ny) : null; })());
}

function neutral(): void {
  console.log('\nwhat a level opens on');

  check('a mid grey, not black', (() => {
    const n = neutralFor();
    return n[0] > 0 && n[0] === n[1] && n[1] === n[2];
  })(), neutralFor());
  // Never touching the wheel must score nothing, so the default may not be an
  // answer — at any level, not just the first.
  check('and it is never a possible answer', [1, 11, 17, 26, 31, 60].every((lv) => !palette(rungAt(lv)).some((c) => c.join(',') === neutralFor().join(','))));
}

which();
layout();
tapping();
ordering();
continuous();
reachable();
cursor();
neutral();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
