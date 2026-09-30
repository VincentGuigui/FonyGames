import {
  BLINK_MAX_RATE,
  BLINK_MISS_LIMIT,
  BLINK_RAMP_MS,
  BLINK_START_RATE,
} from './protocol';
import {
  advance,
  blinkRate,
  blinkScore,
  blinksAt,
  litLight,
  maxHits,
  newBlinker,
  normaliseBlinkOptions,
  tapLight,
  type Blinker,
} from './blink';

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, detail === undefined ? '' : detail);
  }
}
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

/** The middle of blink `k`'s lit half, found by bisection on `blinksAt`. */
function litMoment(k: number): number {
  const want = k + 0.25;
  let lo = 0;
  let hi = 10 * 60_000;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (blinksAt(mid) < want) lo = mid;
    else hi = mid;
  }
  return lo;
}
function darkMoment(k: number): number {
  const want = k + 0.75;
  let lo = 0;
  let hi = 10 * 60_000;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (blinksAt(mid) < want) lo = mid;
    else hi = mid;
  }
  return lo;
}

function cadence(): void {
  console.log('\nthe rate climbs linearly, then holds (§2.1)');
  check('one blink every two seconds at the start', blinkRate(0) === BLINK_START_RATE);
  check('30 a second at the top of the ramp', blinkRate(BLINK_RAMP_MS) === BLINK_MAX_RATE);
  check('and it stays there', blinkRate(BLINK_RAMP_MS * 3) === BLINK_MAX_RATE);
  check('halfway up the ramp is halfway up the rate', near(blinkRate(BLINK_RAMP_MS / 2), (BLINK_START_RATE + BLINK_MAX_RATE) / 2));
  // The rate starts climbing at once, so the first blink is a little under two seconds.
  check(`the first blink is over within two seconds (${litMoment(1).toFixed(0)} ms)`, blinksAt(2000) >= 1 && blinksAt(1000) < 1);
  check(`the first minute holds 915 blinks (${blinksAt(BLINK_RAMP_MS).toFixed(1)})`, near(blinksAt(BLINK_RAMP_MS), 915));
  check('then exactly 30 more a second', near(blinksAt(BLINK_RAMP_MS + 1000) - blinksAt(BLINK_RAMP_MS), 30));
  check('the count is continuous across the ramp', near(blinksAt(BLINK_RAMP_MS - 1e-6), blinksAt(BLINK_RAMP_MS + 1e-6), 1e-3));
  let rising = true;
  for (let t = 0; t < 120_000; t += 37) if (blinksAt(t + 37) <= blinksAt(t)) rising = false;
  check('and it only ever goes up', rising);
  check('nothing has blinked before the start', blinksAt(-500) === 0 && maxHits(0) === 0);
}

function lighting(): void {
  console.log('\nlit for half of each blink, one light after another (§2)');
  const one = newBlinker({ lights: 1, duration: 60_000 });
  check('the first blink is lit the moment the round starts', litLight(one, 0) === 0);
  check('lit in the first half of a blink', litLight(one, litMoment(0)) === 0);
  check('dark in the second half', litLight(one, darkMoment(0)) === null);

  const four = newBlinker({ lights: 4, duration: 60_000 });
  const order = [0, 1, 2, 3, 4, 5].map((k) => litLight(four, litMoment(k)));
  check(`four lights take turns (${order.join(',')})`, order.join(',') === '0,1,2,3,0,1', order);
  const three = newBlinker({ lights: 3, duration: 60_000 });
  check('never two at once — one index, one light', litLight(three, litMoment(4)) === 1);
}

function scoring(): void {
  console.log('\na tap while lit is a point; anything else costs one (§2)');
  let b = newBlinker({ lights: 1, duration: 60_000 });
  b = tapLight(b, litMoment(0), 0);
  check('a tap on the lit light scores', b.hits === 1 && b.misses === 0, b);
  check('and the light goes dark until the next blink', litLight(b, litMoment(0) + 1) === null);
  b = tapLight(b, litMoment(0) + 2, 0);
  check('so tapping it again straight away is a miss', b.hits === 1 && b.misses === 1, b);
  b = advance(b, litMoment(1));
  check('the tapped blink does not also count as missed when it closes', b.misses === 1, b);
  check('and the next blink lights up as usual', litLight(b, litMoment(1)) === 0);

  const gone = advance(newBlinker({ lights: 1, duration: 60_000 }), darkMoment(0));
  const dark = tapLight(gone, darkMoment(0), 0);
  check('a tap on a dark light is a miss', dark.hits === 0 && dark.misses === gone.misses + 1, { gone, dark });

  let wrong = newBlinker({ lights: 2, duration: 60_000 });
  wrong = tapLight(wrong, litMoment(0), 1);
  check('a tap on the wrong light is a miss', wrong.hits === 0 && wrong.misses === 1, wrong);

  let idle = newBlinker({ lights: 1, duration: 60_000 });
  idle = advance(idle, darkMoment(0));
  check('a blink that goes dark untapped is a miss', idle.misses === 1, idle);
  idle = advance(idle, darkMoment(0) + 1);
  check('counted once, not once per frame', idle.misses === 1, idle);
  idle = advance(idle, darkMoment(4));
  check('blinks skipped between frames all count — five gone, five missed', idle.misses === 5, idle);

  const mashed = mash(newBlinker({ lights: 1, duration: 60_000 }), 20_000, 30);
  check(`mashing every frame loses (${blinkScore(mashed)})`, blinkScore(mashed) < 0, mashed);

  check('score is hits minus misses', blinkScore({ hits: 7, misses: 3 }) === 4);
}

/** A thumb hammering the one light every `everyMs`, lit or not. */
function mash(b: Blinker, untilMs: number, everyMs: number): Blinker {
  let out = b;
  for (let t = 0; t < untilMs; t += everyMs) out = tapLight(out, t, 0);
  return out;
}

function ending(): void {
  console.log('\nhow a phone\'s round ends (§2, §7)');
  let timed = newBlinker({ lights: 1, duration: 30_000 });
  timed = advance(timed, 29_999);
  check('a timed round is still going just before its end', !timed.done);
  timed = advance(timed, 30_000);
  check('and over at it', timed.done);
  const settled = timed.misses;
  const late = advance(timed, 45_000);
  check('nothing after the end is scored', late.misses === settled, { settled, late: late.misses });
  check('an idle 30 s misses every blink that started in it', settled === Math.floor(blinksAt(30_000)) || settled === Math.floor(blinksAt(30_000)) + 1, { settled, blinks: blinksAt(30_000) });

  let open = newBlinker({ lights: 1, duration: 0 });
  open = advance(open, 60_000);
  check(`unlimited ends at ${BLINK_MISS_LIMIT} misses`, open.done && open.misses === BLINK_MISS_LIMIT, open);
  // Into blink 0's dark half, which is one miss already, then eight bad taps.
  let early = advance(newBlinker({ lights: 1, duration: 0 }), darkMoment(0));
  for (let i = 0; i < BLINK_MISS_LIMIT - 2; i++) early = tapLight(early, darkMoment(0), 0);
  check('nine misses is still playing', !early.done && early.misses === 9, early);
  early = tapLight(early, darkMoment(0), 0);
  check('the tenth ends it', early.done, early);
  check('a finished round ignores taps', tapLight(early, litMoment(3), 0).hits === 0);
}

function bound(): void {
  console.log('\nthe referee\'s bound is the schedule itself (§8)');
  let perfect = newBlinker({ lights: 1, duration: 100_000 });
  for (let k = 0; ; k++) {
    const t = litMoment(k);
    if (t >= 100_000) break;
    perfect = tapLight(perfect, t, 0);
  }
  perfect = advance(perfect, 100_000);
  check(`a perfect 100 s run fits under the bound (${perfect.hits} ≤ ${maxHits(100_000)})`, perfect.hits <= maxHits(100_000), perfect);
  check('and the bound is not loose by more than one', maxHits(100_000) - perfect.hits <= 1, perfect.hits);
  check('the light count does not move the bound', maxHits(30_000) === Math.floor(blinksAt(30_000)) + 1);
}

function options(): void {
  console.log('\nthe host\'s options are sanitised, not trusted (§3)');
  check('defaults when nothing arrives', JSON.stringify(normaliseBlinkOptions(undefined)) === '{"lights":1,"duration":60000}');
  check('a legal pick is kept', JSON.stringify(normaliseBlinkOptions({ lights: 3, duration: 0 })) === '{"lights":3,"duration":0}');
  check('five lights falls back to the default', normaliseBlinkOptions({ lights: 5 }).lights === 1);
  check('an unknown duration falls back too', normaliseBlinkOptions({ duration: 45_000 }).duration === 60_000);
  check('a string is not a number', normaliseBlinkOptions({ lights: '2' }).lights === 1);
}

cadence();
lighting();
scoring();
ending();
bound();
options();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
