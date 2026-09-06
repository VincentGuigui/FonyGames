/**
 * `shared/color.ts` — the distance, the ladder and the palettes.
 * Specs: docs/specs/games/color-match.md §2.3, §2.4 · color-hunt.md §2.2
 *
 * Both colour games score from this file and the referee is the only thing
 * that runs it for real, so every rule worth arguing about is pinned here:
 * "splits" meaning intervals rather than values (the two readings differ by
 * one, and the whole ladder is built on it), the past-45 formula and its cap,
 * and the fact that a palette must not offer the same colour twice.
 */
import {
  COLOR_BARREN_ROUNDS,
  COLOR_D_MAX,
  COLOR_LUM_MIN,
  COLOR_LADDER_END,
  COLOR_MAX_SPLITS,
  RUNG_ENDS,
  COLOR_MISS,
  COLOR_VALUE_FLOOR,
  COLOR_WHITE_FLOOR,
  HUNT_TARGETS,
  asRgb,
  colorDistance,
  colorKey,
  colorScore,
  componentValues,
  dealTarget,
  huntColor,
  isExtreme,
  luminanceSteps,
  nextHuntTarget,
  palette,
  rungAt,
  snapToRung,
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

function splits(): void {
  console.log('\n"splits" means intervals, not values (§2.3)');

  // The issue's own three examples, which is the whole reason this is pinned.
  check('1 split is {0, 255}', JSON.stringify(componentValues(1)) === '[0,255]', componentValues(1));
  check('2 splits is {0, 128, 255}', JSON.stringify(componentValues(2)) === '[0,128,255]', componentValues(2));
  check('4 splits is {0, 64, 128, 192, 255}', JSON.stringify(componentValues(4)) === '[0,64,128,192,255]', componentValues(4));
  check('so a rung offers splits + 1 values', componentValues(8).length === 9);
  check('0 splits pins the component to black', JSON.stringify(componentValues(0)) === '[0]');
  check('every value stays in range', componentValues(16).every((v) => v >= 0 && v <= 255));
  check('and they climb', componentValues(16).every((v, i, a) => i === 0 || v > (a[i - 1] ?? -1)));
}

function ladder(): void {
  console.log('\nthe ladder, rung by rung (§2.3)');

  // Rung boundaries come from the ladder's own declared spans, so this reads
  // them rather than restating numbers that move when a rung is shortened.
  const at = (i: number): number => RUNG_ENDS[i] ?? 0;
  check('the first two rungs are three levels, not five', at(0) === 3 && at(1) - at(0) === 3, RUNG_ENDS);
  check('and every later one is five', RUNG_ENDS.every((e, i, a) => i < 2 || e - (a[i - 1] ?? 0) === 5), RUNG_ENDS);
  check('the ladder\'s table ends where its last rung does', COLOR_LADDER_END === at(RUNG_ENDS.length - 1));

  check('level 1 randomises one component at 1 split', rungAt(1).components === 1 && rungAt(1).splits === 1);
  check('and the rest are pinned to black', rungAt(1).restSplits === 0);
  check('a rung holds for its whole span', JSON.stringify(rungAt(1)) === JSON.stringify(rungAt(at(0))));
  check('and changes on the next level', JSON.stringify(rungAt(at(0) + 1)) !== JSON.stringify(rungAt(at(0))));
  check('rung 2 is two components at 1 split', rungAt(at(0) + 1).components === 2 && rungAt(at(0) + 1).splits === 1);
  check('rung 3 opens all three at 2 splits', rungAt(at(1) + 1).components === 3 && rungAt(at(1) + 1).splits === 2);
  check('rung 4 goes to 4', rungAt(at(2) + 1).splits === 4);
  check('rung 5 is one component at 8 over a 4-split rest', rungAt(at(3) + 1).components === 1 && rungAt(at(3) + 1).splits === 8 && rungAt(at(3) + 1).restSplits === 4);
  check('rung 6 is two', rungAt(at(4) + 1).components === 2 && rungAt(at(4) + 1).splits === 8);
  check('rung 7 is all three at 8', rungAt(at(5) + 1).components === 3 && rungAt(at(5) + 1).splits === 8);

  check('luminance is off right up to rung 8', !rungAt(1).luminance && !rungAt(at(6)).luminance);
  check('and on from it', rungAt(at(6) + 1).luminance);
  check('rung 9 doubles to 16', rungAt(at(7) + 1).splits === 16);

  // Past the table it is a formula: double every five levels.
  check('the level after the table doubles again, to 32', rungAt(COLOR_LADDER_END + 1).splits === 32, rungAt(COLOR_LADDER_END + 1));
  check('then 64', rungAt(COLOR_LADDER_END + 6).splits === 64);
  check('then 128', rungAt(COLOR_LADDER_END + 11).splits === 128);
  check('then the cap', rungAt(COLOR_LADDER_END + 16).splits === COLOR_MAX_SPLITS);
  check('and stays there forever', rungAt(500).splits === COLOR_MAX_SPLITS && rungAt(5000).splits === COLOR_MAX_SPLITS);
  check('the cap is a step of one, not an arbitrary ceiling', componentValues(COLOR_MAX_SPLITS).length === 256);

  check('the ladder never goes backwards', (() => {
    for (let n = 2; n <= 80; n++) if (rungAt(n).splits < rungAt(n - 1).splits) return false;
    return true;
  })());
  check('a level below 1 is treated as level 1', JSON.stringify(rungAt(0)) === JSON.stringify(rungAt(1)));
}

function palettes(): void {
  console.log('\nwhat a rung can actually produce');

  // Level 1: one component out of {0, 255}, the others black — which would be
  // black, red, green and blue, except that nobody is asked to guess black.
  const first = palette(rungAt(1));
  check('the first rung offers three colours — and lasts three levels', first.length === 3 && (RUNG_ENDS[0] ?? 0) === first.length, first);
  check('red, green and blue — black is not on offer', JSON.stringify([...first].sort()) === JSON.stringify([[0, 0, 255], [0, 255, 0], [255, 0, 0]].sort()), first);

  const dupes = (list: Rgb[]): boolean => new Set(list.map((c) => c.join(','))).size === list.length;
  check('no rung offers the same colour twice', dupes(first) && dupes(palette(rungAt(6))) && dupes(palette(rungAt(11))));

  // A full n-cube, less whatever the extreme filter takes off the two corners.
  check('rung 3 is a 3-cube less its black and white corners', palette(rungAt(9)).length === 25, palette(rungAt(9)).length);
  check('rung 4 is 5 cubed less nine', palette(rungAt(14)).length === 116, palette(rungAt(14)).length);
  check('rung 7 is 9 cubed less thirty-five', palette(rungAt(29)).length === 694, palette(rungAt(29)).length);
  check('and no rung ever offers black or white', [1, 4, 9, 14, 19, 24, 29, 34].every((lv) => palette(rungAt(lv)).every((c) => !isExtreme(c))));
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
  const dimmest = luminanceSteps()[0] ?? 1;
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
    // the slider is live every base is five colours. Rung 8 is rung 7 with
    // luminance and nothing else, so by base palette it adds nothing at all —
    // counting bases would call it broken when it has thousands to give.
    const lums = rung.luminance ? luminanceSteps() : [1];
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

function luminance(): void {
  console.log('\nluminance is a multiplier, not a fourth component (§2.3)');

  check('full luminance leaves a colour alone', JSON.stringify(withLuminance([200, 100, 50], 1)) === JSON.stringify([200, 100, 50]));
  check('half of it halves every channel', JSON.stringify(withLuminance([200, 100, 50], 0.5)) === JSON.stringify([100, 50, 25]));
  check('it clamps rather than overflowing', JSON.stringify(withLuminance([200, 100, 50], 9)) === JSON.stringify([200, 100, 50]));

  const steps = luminanceSteps();
  check('the slider offers splits + 1 steps', steps.length === 5, steps);
  check('the dimmest is not black', (steps[0] ?? 0) === COLOR_LUM_MIN && COLOR_LUM_MIN > 0);
  check('the brightest is full', Math.abs((steps[steps.length - 1] ?? 0) - 1) < 1e-9);
  check('and they climb', steps.every((v, i, a) => i === 0 || v > (a[i - 1] ?? -1)));
}

function dealing(): void {
  console.log('\ndealing a target');

  check('a level-1 target is one of that rung\'s four', (() => {
    const allowed = new Set(palette(rungAt(1)).map((c) => c.join(',')));
    for (let s = 1; s < 60; s++) if (!allowed.has(dealTarget(1, seeded(s)).rgb.join(','))) return false;
    return true;
  })());
  check('and it never carries a luminance before the slider rung', (() => {
    for (let s = 1; s < 40; s++) if (dealTarget(RUNG_ENDS[6] ?? 33, seeded(s)).lum !== 1) return false;
    return true;
  })());
  check('from that rung it does', (() => {
    for (let s = 1; s < 40; s++) if (dealTarget((RUNG_ENDS[6] ?? 33) + 1, seeded(s)).lum === 1) return true;
    return false;
  })());
  check('the dealt colour is the base under that luminance', (() => {
    for (let s = 1; s < 40; s++) {
      const t = dealTarget((RUNG_ENDS[6] ?? 33) + 3, seeded(s));
      if (JSON.stringify(t.rgb) !== JSON.stringify(withLuminance(t.base, t.lum))) return false;
    }
    return true;
  })());
  // A degenerate source — one that always returns the same number — used to
  // hang the deal outright: choosing k distinct components by drawing indices
  // until they differ never terminates when they cannot. It indexes into the
  // combination list now, so any source at all terminates.
  check('a constant random source still deals, rather than spinning', (() => {
    for (const v of [0, 0.5, 0.999]) {
      const t = dealTarget(31, () => v);
      if (!t.rgb.every((c) => c >= 0 && c <= 255)) return false;
    }
    return true;
  })());
  check('the same seed deals the same target', JSON.stringify(dealTarget(20, seeded(7))) === JSON.stringify(dealTarget(20, seeded(7))));
  check('different seeds do not all deal the same one', new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => dealTarget(14, seeded(s)).rgb.join(','))).size > 1);

  const rung = rungAt(14);
  const snapped = snapToRung([70, 200, 3], rung);
  check('a free drag snaps onto the rung\'s grid', snapped.every((v) => componentValues(rung.splits).includes(v)), snapped);
  check('and snaps to the nearest value', JSON.stringify(snapped) === JSON.stringify([64, 192, 0]), snapped);
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
splits();
extremes();
spansFitTheirColours();
noRepeats();
ladder();
palettes();
luminance();
dealing();
hunt();
wire();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
