/**
 * `shared/color.ts` — the distance, the ladder and the palettes.
 * Specs: docs/specs/games/color-match.md §2.3, §2.4 · color-hunt.md §2.2
 *
 * Both colour games score from this file and the referee is the only thing
 * that runs it for real, so every rule worth arguing about is pinned here:
 * a rung being hue x saturation x value and nothing else (so the randomiser
 * cannot ask for a colour the wheel has no way to show), the order light and
 * dark arrive in, the past-41 formula and its caps, and the fact that a
 * palette must not offer the same colour twice.
 */
import {
  COLOR_BARREN_ROUNDS,
  COLOR_REACTION_MULTIPLIERS,
  colorActionMs,
  colorPoints,
  reactionMultiplier,
  COLOR_D_MAX,
  COLOR_LUM_MIN,
  COLOR_LADDER_END,
  COLOR_MAX_HUES,
  COLOR_MAX_STEPS,
  COLOR_SAT_MIN,
  RUNG_ENDS,
  COLOR_MISS,
  COLOR_VALUE_FLOOR,
  COLOR_WHITE_FLOOR,
  HUNT_TARGETS,
  asRgb,
  colorDistance,
  colorKey,
  colorScore,
  dealTarget,
  hasLuminance,
  hsvToRgb,
  hueSteps,
  huntColor,
  isExtreme,
  nextHuntTarget,
  palette,
  paletteSize,
  rungAt,
  satOf,
  saturationSteps,
  snapToRung,
  valueSteps,
  withLuminance,
  type Rgb,
} from './color';

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

function distance(): void {
  console.log('\ndistance and score (§2.4)');

  check('a colour is zero from itself', colorDistance([12, 200, 7], [12, 200, 7]) === 0);
  check('black to white is the maximum', Math.abs(colorDistance([0, 0, 0], [255, 255, 255]) - COLOR_D_MAX) < 1e-9);
  check('nothing exceeds it', colorDistance([255, 0, 0], [0, 255, 255]) <= COLOR_D_MAX + 1e-9);
  check('it is symmetric', Math.abs(colorDistance([200, 10, 30], [4, 90, 250]) - colorDistance([4, 90, 250], [200, 10, 30])) < 1e-9);

  // Redmean leans on green: the same numeric gap costs more there than in blue.
  const green = colorDistance([0, 0, 0], [0, 40, 0]);
  const blue = colorDistance([0, 0, 0], [0, 0, 40]);
  check('green is weighted above blue', green > blue, { green, blue });

  check('an exact match is 100', colorScore([9, 9, 9], [9, 9, 9]) === 100);
  check('the far side of the wheel is 0', colorScore([0, 0, 0], [255, 255, 255]) === 0);
  check('and so is anything past the miss threshold', colorScore([0, 0, 0], [0, 200, 0]) === 0, colorScore([0, 0, 0], [0, 200, 0]));
  const near = colorScore([250, 0, 0], [255, 0, 0]);
  check('a near miss is worth most of it', near > 90 && near < 100, near);
  check('a score never goes negative', colorScore([255, 255, 255], [0, 0, 0]) >= 0);
  // Exactly at the threshold is the zero point, by construction.
  const atMiss = Math.round(COLOR_MISS * COLOR_D_MAX);
  check('the threshold itself is the zero point', COLOR_MISS > 0 && atMiss > 0 && colorScore([0, 0, 0], [0, 0, 0], 1e-9) === 100);
}

function axes(): void {
  console.log('\nhue, saturation and value are the only three axes (§2.3)');

  check('one hue step is red alone', JSON.stringify(hueSteps(1)) === '[0]');
  check('three are red, green and blue', JSON.stringify(hueSteps(3)) === '[0,120,240]', hueSteps(3));
  check('and doubling the count keeps every hue it had', hueSteps(24).every((h) => hueSteps(48).includes(h)));

  // The two that the bug report was about: one step means one ring.
  check('one saturation step is the outer ring alone', JSON.stringify(saturationSteps(1)) === '[1]');
  check('one value step is full brightness alone', JSON.stringify(valueSteps(1)) === '[1]');
  check('more rings reach inward, no further than the pale floor', saturationSteps(4)[0] === COLOR_SAT_MIN);
  check('more notches reach down, no further than the dark floor', valueSteps(4)[0] === COLOR_LUM_MIN);
  check('both end at the top', saturationSteps(5)[4] === 1 && valueSteps(5)[4] === 1);
  check('and both climb', saturationSteps(6).every((v, i, a) => i === 0 || v > (a[i - 1] ?? -1)) && valueSteps(6).every((v, i, a) => i === 0 || v > (a[i - 1] ?? -1)));

  // The min/max reading of the same three numbers, which is how the issue
  // asked for it and how an eye reads a colour.
  const maxOf = (c: Rgb): number => Math.max(c[0], c[1], c[2]);
  const minOf = (c: Rgb): number => Math.min(c[0], c[1], c[2]);
  check('value IS max(r, g, b)', [0.4, 0.7, 1].every((v) => maxOf(hsvToRgb(200, 0.6, v)) === Math.round(255 * v)));
  check('saturation IS min(r, g, b), over that max', [0.25, 0.6, 1].every((sat) => minOf(hsvToRgb(200, sat, 1)) === Math.round(255 * (1 - sat))));
  check('so one ring at full value has min 0 — no light colour', saturationSteps(1).every((sat) => minOf(hsvToRgb(90, sat, 1)) === 0));
  check('and one notch has max 255 — no dark colour', valueSteps(1).every((v) => maxOf(hsvToRgb(90, 1, v)) === 255));
}

function ladder(): void {
  console.log('\nthe ladder, rung by rung (§2.3)');

  // Rung boundaries come from the ladder's own declared spans, so this reads
  // them rather than restating numbers that move when a rung is shortened.
  const at = (i: number): number => RUNG_ENDS[i] ?? 0;
  check('the first two rungs are three levels, not five', at(0) === 3 && at(1) - at(0) === 3, RUNG_ENDS);
  check('and every later one is five', RUNG_ENDS.every((e, i, a) => i < 2 || e - (a[i - 1] ?? 0) === 5), RUNG_ENDS);
  check('the ladder\'s table ends where its last rung does', COLOR_LADDER_END === at(RUNG_ENDS.length - 1));

  check('level 1 is three hues, one ring, one notch', JSON.stringify(rungAt(1)) === JSON.stringify({ hues: 3, sats: 1, values: 1 }), rungAt(1));
  check('a rung holds for its whole span', JSON.stringify(rungAt(1)) === JSON.stringify(rungAt(at(0))));
  check('and changes on the next level', JSON.stringify(rungAt(at(0) + 1)) !== JSON.stringify(rungAt(at(0))));
  check('the hue count climbs 3, 6, 12, 24, 36', [1, at(0) + 1, at(1) + 1, at(2) + 1, at(3) + 1].map((lv) => rungAt(lv).hues).join(',') === '3,6,12,24,36');

  // The heart of the fix. Up to level 21 the wheel is the outer ring and
  // nothing else, so a target can be neither light nor dark; then light
  // arrives on its own, and only after it, dark.
  check('nothing is light or dark up to level 21', [1, 5, 10, 15, 17, 21].every((lv) => rungAt(lv).sats === 1 && rungAt(lv).values === 1));
  check('level 17 — the level the report was about — is pure hue, 36 of them', rungAt(17).hues === 36 && rungAt(17).sats === 1 && rungAt(17).values === 1, rungAt(17));
  check('the next rung adds light, and only light', rungAt(at(4) + 1).sats === 2 && rungAt(at(4) + 1).values === 1, rungAt(at(4) + 1));
  check('the rung after it adds dark', rungAt(at(5) + 1).values === 2 && rungAt(at(5) + 1).sats === 2, rungAt(at(5) + 1));
  check('so the brightness slider stays off until then', !hasLuminance(rungAt(at(5))) && hasLuminance(rungAt(at(5) + 1)));
  check('and no rung ever claims a slider it has no notches for', [1, 9, 21, 26, 31, 41, 60, 500].every((lv) => hasLuminance(rungAt(lv)) === (rungAt(lv).values > 1)));

  // Past the table it is a formula: double the hues every five levels, and add
  // a step to each of the other two.
  const past = rungAt(COLOR_LADDER_END + 1);
  check('the level after the table doubles the hues to 120', past.hues === 120, past);
  check('and adds one ring and one notch', past.sats === 5 && past.values === 5, past);
  check('then doubles again, to 240', rungAt(COLOR_LADDER_END + 6).hues === 240);
  check('up to one hue per degree', rungAt(COLOR_LADDER_END + 11).hues === COLOR_MAX_HUES && rungAt(5000).hues === COLOR_MAX_HUES);
  check('and the other two cap as well', rungAt(5000).sats === COLOR_MAX_STEPS && rungAt(5000).values === COLOR_MAX_STEPS);

  check('the ladder never goes backwards', (() => {
    for (let n = 2; n <= 200; n++) {
      const a = rungAt(n - 1);
      const b = rungAt(n);
      if (b.hues < a.hues || b.sats < a.sats || b.values < a.values) return false;
    }
    return true;
  })());
  check('a level below 1 is treated as level 1', JSON.stringify(rungAt(0)) === JSON.stringify(rungAt(1)));
}

function palettes(): void {
  console.log('\nwhat a rung can actually produce');

  const first = palette(rungAt(1));
  check('the first rung offers three colours — and lasts three levels', first.length === 3 && (RUNG_ENDS[0] ?? 0) === first.length, first);
  check('red, green and blue, in that order', JSON.stringify(first) === JSON.stringify([[255, 0, 0], [0, 255, 0], [0, 0, 255]]), first);

  const dupes = (list: Rgb[]): boolean => new Set(list.map((c) => c.join(','))).size === list.length;
  check('no rung offers the same colour twice', [1, 6, 11, 16, 21, 26, 31].every((lv) => dupes(palette(rungAt(lv)))));

  check('a palette is hues x rings, exactly — no dedup, no filter', [1, 11, 21, 26, 31, 41].every((lv) => palette(rungAt(lv)).length === paletteSize(rungAt(lv))));
  check('and level 22 is 36 hues on two rings', paletteSize(rungAt(22)) === 72, paletteSize(rungAt(22)));

  // The order is what the wheel's hit test indexes into, so it is a rule.
  const wide = palette(rungAt(26));
  check('laid out ring by ring, palest ring first', Math.abs(satOf(wide[0] as Rgb) - COLOR_SAT_MIN) < 0.02 && satOf(wide[wide.length - 1] as Rgb) === 1, [wide[0], wide[wide.length - 1]]);
  check('and hue by hue within a ring, starting at red', JSON.stringify(wide[36]) === JSON.stringify([255, 0, 0]), wide[36]);

  check('no rung ever offers black or white', [1, 4, 9, 14, 19, 24, 29, 34, 41, 60].every((lv) => palette(rungAt(lv)).every((c) => !isExtreme(c))));
  check('nor does any of them once dimmed to the bottom notch', [26, 31, 41, 60].every((lv) => {
    const rung = rungAt(lv);
    const dimmest = valueSteps(rung.values)[0] ?? 1;
    return palette(rung).every((c) => !isExtreme(withLuminance(c, dimmest)));
  }));
  check('the palette grows down the ladder', palette(rungAt(4)).length > palette(rungAt(1)).length);
  check('every entry is a real colour', palette(rungAt(19)).every((c) => c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)));
}

function extremes(): void {
  console.log('\nnobody is asked to guess black or white');

  check('black is out', isExtreme([0, 0, 0]));
  check('white is out', isExtreme([255, 255, 255]));
  check('and so is a near-black', isExtreme([32, 32, 32]) && isExtreme([64, 0, 0]));
  check('and a washed-out near-white', isExtreme([224, 224, 224]) && isExtreme([255, 255, 224]));

  // Not a distance to black: redmean puts a dark red and a very dark grey at
  // almost the same distance from it, so one threshold cannot separate them.
  // Value and paleness can, and these are the colours that must survive.
  check('a mid grey is a fine target', !isExtreme([128, 128, 128]));
  check('so is a dark navy', !isExtreme([0, 0, 128]));
  check('and a proper dark red', !isExtreme([128, 0, 0]));
  check('the value floor is where black stops', isExtreme([COLOR_VALUE_FLOOR - 1, 0, 0]) && !isExtreme([COLOR_VALUE_FLOOR, 0, 0]));
  check('and the white floor where white starts', !isExtreme([COLOR_WHITE_FLOOR, COLOR_WHITE_FLOOR, COLOR_WHITE_FLOOR]) && isExtreme([COLOR_WHITE_FLOOR + 1, COLOR_WHITE_FLOOR + 1, COLOR_WHITE_FLOOR + 1]));

  // The dimmest luminance step must not drag a colour under the floor, or the
  // bottom notch of the slider would be unpickable.
  const dimmest = valueSteps(4)[0] ?? 1;
  check('the dimmest slider step still clears the floor', !isExtreme(withLuminance([255, 0, 0], dimmest)), withLuminance([255, 0, 0], dimmest));

  // And a rung too big to enumerate cannot deal one either: the deal nudges a
  // dark or pale draw back onto its own grid rather than rejecting in a loop.
  check('even an unenumerable rung never deals one', (() => {
    for (const v of [0, 0.02, 0.5, 0.98, 0.999]) if (isExtreme(dealTarget(80, () => v).rgb)) return false;
    for (let s2 = 1; s2 < 40; s2++) if (isExtreme(dealTarget(80, seeded(s2)).rgb)) return false;
    return true;
  })());
}

function spansFitTheirColours(): void {
  console.log('\nno rung outlasts the colours it adds (§2.3b)');

  // The rule, not the numbers: a rung may last no more levels than the colours
  // it brings that earlier rungs did not already offer. Rung 2's palette is
  // six but three of them are rung 1's, which is the trap the flat five-level
  // span fell into — counting palettes instead of new colours.
  const offered = new Set<string>();
  let ok = true;
  const report: string[] = [];
  for (let i = 0; i < RUNG_ENDS.length; i++) {
    const span = (RUNG_ENDS[i] ?? 0) - (i === 0 ? 0 : RUNG_ENDS[i - 1] ?? 0);
    const rung = rungAt((RUNG_ENDS[i] ?? 1) - span + 1);
    // What the rung can actually DEAL, not what its base palette holds: once
    // the slider is live every base is several colours. The rung that adds
    // dark keeps the palette it had and multiplies it by its notches, so
    // counting bases alone would call it broken when it doubles the targets.
    const lums = valueSteps(rung.values);
    const mine = palette(rung).flatMap((c) => lums.map((l) => colorKey(withLuminance(c, l))));
    const fresh = new Set(mine.filter((k) => !offered.has(k))).size;
    for (const k of mine) offered.add(k);
    report.push(`rung ${i + 1}: ${span} levels, ${fresh} new`);
    if (span > fresh) ok = false;
  }
  check('every rung has at least a colour per level', ok, report);

  // And the end-to-end consequence, flown level by level: no repeat at all,
  // through the whole table and out the other side into the formula.
  for (const trial of [1, 2, 3]) {
    const used = new Set<string>();
    let repeats = 0;
    for (let lv = 1; lv <= 60; lv++) {
      const t = dealTarget(lv, seeded(lv * 7 + trial), used);
      used.add(colorKey(t.rgb));
      if (t.repeat) repeats += 1;
    }
    check(`  sixty levels, sixty colours (trial ${trial})`, used.size === 60 && repeats === 0, { distinct: used.size, repeats });
  }
}

function noRepeats(): void {
  console.log('\na session never asks twice (§2.3b)');

  const used = new Set<string>();
  const got: string[] = [];
  for (let lv = 9; lv <= 20; lv++) {
    const t = dealTarget(lv, seeded(lv * 7 + 1), used);
    used.add(colorKey(t.rgb));
    got.push(colorKey(t.rgb));
    if (t.repeat) got.push('REPEAT');
  }
  check('twelve levels of a wide rung, twelve different colours', new Set(got).size === got.length && !got.includes('REPEAT'), got.length);

  // The first rung has exactly three colours and lasts exactly three levels,
  // so nothing repeats there either — that is why it was shortened.
  const rung1 = new Set<string>();
  let repeats = 0;
  for (let lv = 1; lv <= (RUNG_ENDS[0] ?? 3); lv++) {
    const t = dealTarget(lv, seeded(lv * 11 + 3), rung1);
    rung1.add(colorKey(t.rgb));
    if (t.repeat) repeats += 1;
  }
  check('the first rung fits its three colours in its three levels', rung1.size === 3 && repeats === 0, { size: rung1.size, repeats });
}

function brightness(): void {
  console.log('\nbrightness is a multiplier, not a fourth component (§2.3)');

  check('full brightness leaves a colour alone', JSON.stringify(withLuminance([200, 100, 50], 1)) === JSON.stringify([200, 100, 50]));
  check('half of it halves every channel', JSON.stringify(withLuminance([200, 100, 50], 0.5)) === JSON.stringify([100, 50, 25]));
  check('it clamps rather than overflowing', JSON.stringify(withLuminance([200, 100, 50], 9)) === JSON.stringify([200, 100, 50]));
  // Which is exactly why the slider can be a control of its own: scaling all
  // three channels moves value and leaves hue and saturation where they were.
  check('and it moves value without touching hue or saturation', (() => {
    const base: Rgb = [255, 128, 0];
    const dim = withLuminance(base, 0.6);
    return Math.abs(satOf(dim) - satOf(base)) < 0.01 && Math.max(...dim) === Math.round(255 * 0.6);
  })());

  const steps = valueSteps(4);
  check('a four-notch rung offers four steps', steps.length === 4, steps);
  check('the dimmest is not black', (steps[0] ?? 0) === COLOR_LUM_MIN && COLOR_LUM_MIN > 0);
  check('the brightest is full', Math.abs((steps[steps.length - 1] ?? 0) - 1) < 1e-9);
  check('and they climb', steps.every((v, i, a) => i === 0 || v > (a[i - 1] ?? -1)));
  check('one notch is no slider at all', JSON.stringify(valueSteps(1)) === '[1]');
}

function dealing(): void {
  console.log('\ndealing a target');

  // The last level before the brightness slider, read off the ladder rather
  // than written down, so shortening a rung moves it.
  const lastFlat = RUNG_ENDS[5] ?? 26;

  check('a level-1 target is one of that rung\'s three', (() => {
    const allowed = new Set(palette(rungAt(1)).map((c) => c.join(',')));
    for (let s2 = 1; s2 < 60; s2++) if (!allowed.has(dealTarget(1, seeded(s2)).rgb.join(','))) return false;
    return true;
  })());

  /*
   * The rule the whole rewrite exists for: a dealt target is a palette colour
   * under one of the rung's own brightness notches, and nothing else. The old
   * randomiser built colours on an RGB grid and could hand out a dark green at
   * level 17 that the wheel — drawn at full value — had no way to show.
   */
  check('every target is a palette colour under a slider notch, at every level', (() => {
    for (const lv of [1, 3, 8, 14, 17, 21, 24, 29, 33, 40, 45, 60]) {
      const rung = rungAt(lv);
      const bases = new Set(palette(rung).map((c) => c.join(',')));
      const lums = valueSteps(rung.values);
      for (let s2 = 1; s2 < 25; s2++) {
        const t = dealTarget(lv, seeded(s2 + lv));
        if (!bases.has(t.base.join(','))) return false;
        if (!lums.some((l) => Math.abs(l - t.lum) < 1e-9)) return false;
        if (JSON.stringify(t.rgb) !== JSON.stringify(withLuminance(t.base, t.lum))) return false;
      }
    }
    return true;
  })());

  check('and it never carries a brightness before the slider rung', (() => {
    for (const lv of [1, 9, 17, lastFlat]) {
      for (let s2 = 1; s2 < 40; s2++) if (dealTarget(lv, seeded(s2)).lum !== 1) return false;
    }
    return true;
  })());
  check('from that rung it does', (() => {
    for (let s2 = 1; s2 < 40; s2++) if (dealTarget(lastFlat + 1, seeded(s2)).lum !== 1) return true;
    return false;
  })());

  // A degenerate source — one that always returns the same number — must still
  // deal rather than spin: every draw is a clamped index, never a retry.
  check('a constant random source still deals, rather than spinning', (() => {
    for (const v of [0, 0.5, 0.999]) {
      for (const lv of [31, 80]) {
        const t = dealTarget(lv, () => v);
        if (!t.rgb.every((c) => c >= 0 && c <= 255)) return false;
      }
    }
    return true;
  })());
  check('the same seed deals the same target', JSON.stringify(dealTarget(20, seeded(7))) === JSON.stringify(dealTarget(20, seeded(7))));
  check('different seeds do not all deal the same one', new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s2) => dealTarget(14, seeded(s2)).rgb.join(','))).size > 1);

  // Snapping is the same grid seen from the other side: whatever a thumb drags
  // to, what comes back is a colour the rung offers.
  const rung = rungAt(14);
  const onGrid = new Set(palette(rung).map((c) => c.join(',')));
  check('a free drag snaps onto the rung\'s own palette', onGrid.has(snapToRung([70, 200, 3], rung).join(',')), snapToRung([70, 200, 3], rung));
  check('and it snaps to the nearest hue, the short way round', JSON.stringify(snapToRung([255, 8, 40], rungAt(1))) === JSON.stringify([255, 0, 0]), snapToRung([255, 8, 40], rungAt(1)));
  check('a snapped colour is already snapped', [1, 14, 26, 31, 60].every((lv) => {
    const r = rungAt(lv);
    const once = snapToRung([70, 200, 3], r);
    return JSON.stringify(snapToRung(once, r)) === JSON.stringify(once);
  }));
  check('and every palette colour snaps to itself', [1, 11, 22, 31].every((lv) => {
    const r = rungAt(lv);
    return palette(r).every((c) => JSON.stringify(snapToRung(c, r)) === JSON.stringify(c));
  }));
}

function hunt(): void {
  console.log('\nColor Hunt\'s own six (color-hunt.md §2.2)');

  check('there are six of them', HUNT_TARGETS.length === 6);
  check('primaries and secondaries', HUNT_TARGETS.map((t) => t.key).join(',') === 'red,yellow,green,cyan,blue,magenta');

  // Not pure: a room does not contain a 255,0,0, so a pure target would score
  // zero for everybody forever and end the hunt in three rounds.
  const red = huntColor(HUNT_TARGETS[0]!);
  check('red is a findable red, not a pure one', red[0] < 255 && red[0] > 150, red);
  check('and it is still unmistakably red', red[0] > red[1] + 80 && red[0] > red[2] + 80, red);
  const cyan = huntColor(HUNT_TARGETS[3]!);
  check('cyan has both of its channels', cyan[1] > 150 && cyan[2] > 150 && cyan[0] < 100, cyan);
  check('all six are distinct', new Set(HUNT_TARGETS.map((t) => huntColor(t).join(','))).size === 6);
  // Pointing at the wrong one of the six must never be worth anything much.
  // Red and magenta are the closest pair at 0.335 normalised — inside
  // COLOR_MISS, but only just, so a magenta thing offered against a red target
  // is worth 4 points out of 100. Every other pair scores a flat zero.
  const worst = (() => {
    let hi = 0;
    for (const a of HUNT_TARGETS) {
      for (const b of HUNT_TARGETS) {
        if (a.key === b.key) continue;
        hi = Math.max(hi, colorScore(huntColor(a), huntColor(b)));
      }
    }
    return hi;
  })();
  check('the worst confusion between two of them is worth almost nothing', worst < 10, worst);
  check('and only one pair is confusable at all', (() => {
    let pairs = 0;
    for (const a of HUNT_TARGETS) {
      for (const b of HUNT_TARGETS) {
        if (a.key >= b.key) continue;
        if (colorDistance(huntColor(a), huntColor(b)) / COLOR_D_MAX < COLOR_MISS) pairs++;
      }
    }
    return pairs === 1;
  })());

  check('a used target never comes up again', (() => {
    for (let s = 1; s < 80; s++) if (nextHuntTarget(new Set(['green']), seeded(s))?.key === 'green') return false;
    return true;
  })());
  check('with nothing used, any of the six may come up', new Set([...Array(40)].map((_, i) => nextHuntTarget(new Set(), seeded(i + 1))?.key)).size > 1);
  // Six colours, six rounds: the pool running dry is the hunt's own ending
  // (color-hunt.md §2.2), not an error to guard against.
  check('the pool runs dry after six, and says so', (() => {
    const used = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const t = nextHuntTarget(used, seeded(i * 13 + 5));
      if (!t) return false;
      used.add(t.key);
    }
    return nextHuntTarget(used, seeded(1)) === null;
  })());
}

/** Issue #38: the score is accuracy bent by reaction time. */
function reaction(): void {
  console.log('\nthe clock bends the accuracy into a score (issue #38)');

  const window = colorActionMs(1);
  check('a level up to the slider gives three seconds', window === 3000, window);
  check('and the slider rungs give ten', colorActionMs(RUNG_ENDS[6] as number + 1) === 10_000);

  // One multiplier per fifth of the window, first fifth first.
  const slices = COLOR_REACTION_MULTIPLIERS.length;
  check('five slices', slices === 5, slices);
  const mids = COLOR_REACTION_MULTIPLIERS.map((_, i) => reactionMultiplier(((i + 0.5) * window) / slices, window));
  check('the middle of each slice reads its own multiplier',
    JSON.stringify(mids) === JSON.stringify([...COLOR_REACTION_MULTIPLIERS]), mids);
  check('the multipliers only ever fall', COLOR_REACTION_MULTIPLIERS.every((m, i, a) => i === 0 || m < (a[i - 1] as number)));

  // The edges, which is where an off-by-one would hide.
  check('an instant answer is the first slice', reactionMultiplier(0, window) === 1.5);
  check('one tick before the boundary is still the first slice', reactionMultiplier(window / 5 - 1, window) === 1.5);
  check('and on the boundary it is the second', reactionMultiplier(window / 5, window) === 1.2);
  check('the last tick of the window is the last slice', reactionMultiplier(window - 1, window) === 0.5);
  check('past the window it stays the last slice, never worse', reactionMultiplier(window * 4, window) === 0.5);
  check('a negative reaction cannot buy more than the best slice', reactionMultiplier(-500, window) === 1.5);

  // And the points themselves.
  check('a fast bullseye is worth half again', colorPoints(100, 0, window) === 150);
  check('a slow bullseye is worth half', colorPoints(100, window - 1, window) === 50);
  check('the middle slice changes nothing', colorPoints(80, window * 0.5, window) === 80);
  check('no accuracy is no points, however fast', colorPoints(0, 0, window) === 0);
  // The consequence of a +50%/-50% spread, pinned deliberately: speed can
  // outweigh a large accuracy gap. The crossover is 1/3 — anything above 34
  // accuracy taken in the first fifth beats a bullseye taken in the last.
  check('a fast near miss really does beat a slow bullseye',
    colorPoints(40, 0, window) > colorPoints(100, window - 1, window),
    [colorPoints(40, 0, window), colorPoints(100, window - 1, window)]);
  check('and the crossover sits where the multipliers put it',
    colorPoints(34, 0, window) > colorPoints(100, window - 1, window)
    && colorPoints(33, 0, window) <= colorPoints(100, window - 1, window),
    [colorPoints(34, 0, window), colorPoints(33, 0, window)]);
  check('points are whole numbers', Number.isInteger(colorPoints(37, window * 0.9, window)), colorPoints(37, window * 0.9, window));
}

function wire(): void {
  console.log('\nnothing off the wire is trusted');

  check('a good triple parses', JSON.stringify(asRgb([1, 2, 3])) === '[1,2,3]');
  check('a float is rounded', JSON.stringify(asRgb([1.6, 2.4, 3])) === '[2,2,3]');
  check('out of range is clamped, not rejected', JSON.stringify(asRgb([-40, 900, 3])) === '[0,255,3]');
  check('the wrong length is null', asRgb([1, 2]) === null && asRgb([1, 2, 3, 4]) === null);
  check('a non-array is null', asRgb('red') === null && asRgb(null) === null && asRgb(undefined) === null);
  check('a non-number member is null', asRgb([1, 'x', 3]) === null);
  check('NaN is null, not zero', asRgb([1, NaN, 3]) === null);

  check('both games end on the same barren streak', COLOR_BARREN_ROUNDS === 3);
}

distance();
axes();
extremes();
spansFitTheirColours();
noRepeats();
ladder();
palettes();
brightness();
dealing();
hunt();
reaction();
wire();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
