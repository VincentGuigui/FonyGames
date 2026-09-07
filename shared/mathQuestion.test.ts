/**
 * `shared/mathQuestion.ts` — the sum, and the three wrong answers.
 * Spec: docs/specs/games/math-o-matic.md §3, §8, §12 Q5
 *
 * The three guarantees the spec makes about a generated question are all
 * *invisible* when they break: a division with a remainder, a negative
 * intermediate value, or a printed expression whose precedence disagrees with
 * the answer we scored all look like a perfectly ordinary question on screen,
 * and the player simply cannot find the right button. So they are checked by
 * brute force here — every legal combination of the host's options, a few
 * hundred rolls each — rather than by a couple of examples.
 *
 * The other thing pinned here is the **answer set**: four distinct answers,
 * exactly one of them right, none negative. A duplicate answer is a question
 * with two right buttons, which the reveal then contradicts.
 */
import {
  MATH_ANSWER_MAX,
  MATH_CHOICES,
  MATH_MINUS,
  MATH_DEFAULT_OPTIONS,
  MATH_DIGIT_CHOICES,
  MATH_OPERATOR_CHOICES,
  MATH_OPS,
  digitBounds,
  generateQuestion,
  leftToRight,
  normaliseOptions,
  symbol,
  type MathOptions,
} from './mathQuestion';

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

/** A deterministic 0..1 source, so a "random" question is a fixed one here. */
function seeded(seed: number): () => number {
  let h = seed >>> 0;
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 4294967296;
  };
}

/**
 * Evaluate a printed expression the way a player is expected to read it:
 * `×` and `÷` first, left to right within each precedence level.
 *
 * Written from the *text*, independently of the generator, because that is the
 * only way this test can catch the generator printing one thing and scoring
 * another. Returns null on anything it cannot parse — which is itself a
 * failure, since the only thing that produces this text is the generator.
 */
function evaluate(text: string): number | null {
  const parts = text.split(' ');
  if (parts.length % 2 === 0) return null;
  const values: number[] = [];
  const joins: string[] = [];

  let cur = Number(parts[0]);
  if (!Number.isFinite(cur)) return null;
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i] as string;
    const n = Number(parts[i + 1]);
    if (!Number.isFinite(n)) return null;
    if (op === '×') cur *= n;
    else if (op === '÷') cur /= n;
    else if (op === '+' || op === MATH_MINUS) {
      values.push(cur);
      joins.push(op);
      cur = n;
    } else return null;
  }
  values.push(cur);

  let total = values[0] as number;
  for (let i = 0; i < joins.length; i++) {
    total = joins[i] === '+' ? total + (values[i + 1] as number) : total - (values[i + 1] as number);
  }
  return total;
}

/** Every step of the left-to-right *additive* walk, so a negative that appears
 *  halfway through and is added back can still be caught (spec §3). */
function additivePrefixes(text: string): number[] {
  const parts = text.split(' ');
  const runs: number[] = [];
  const joins: string[] = [];
  let cur = Number(parts[0]);
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i] as string;
    const n = Number(parts[i + 1]);
    if (op === '×') cur *= n;
    else if (op === '÷') cur /= n;
    else {
      runs.push(cur);
      joins.push(op);
      cur = n;
    }
  }
  runs.push(cur);
  const out: number[] = [runs[0] as number];
  for (let i = 0; i < joins.length; i++) {
    const prev = out[out.length - 1] as number;
    out.push(joins[i] === '+' ? prev + (runs[i + 1] as number) : prev - (runs[i + 1] as number));
  }
  return out;
}

/** Every value the player passes through, including inside a `×`/`÷` run —
 *  where a remainder would appear (spec §3, exact division). */
function everyStep(text: string): number[] {
  const parts = text.split(' ');
  const out: number[] = [];
  let cur = Number(parts[0]);
  out.push(cur);
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i] as string;
    const n = Number(parts[i + 1]);
    if (op === '×') cur *= n;
    else if (op === '÷') cur /= n;
    else cur = n;
    out.push(cur);
  }
  return out;
}

/**
 * Every combination of the host's toggles: 15 operation subsets × 5 width sets
 * × 4 count sets. The width and count sets include gapped ones — `[2, 4]` with
 * no 3, `[1, 3]` with no 2 — which a range could not express and which are the
 * whole reason those two controls are sets.
 */
function allOptionSets(): MathOptions[] {
  const out: MathOptions[] = [];
  for (let mask = 1; mask < 16; mask++) {
    const ops = MATH_OPS.filter((_, i) => (mask >> i) & 1);
    for (const digits of [[1], [1, 2, 3, 4, 5], [3], [5], [2, 4]] as const) {
      for (const operators of [[1], [3], [1, 2, 3], [1, 3]] as const) {
        out.push({ ops, digits, operators });
      }
    }
  }
  return out;
}

function optionsAreSurvivable(): void {
  console.log('\nthe host cannot ask for an illegal question (§3)');

  check('everything on is the default', MATH_DEFAULT_OPTIONS.ops.length === 4);
  check('an empty operation list falls back to all four', normaliseOptions({ ops: [] }).ops.length === 4);
  check('an unknown operation is dropped', normaliseOptions({ ops: ['+', '%'] }).ops.join('') === '+');
  // Widths and counts are sets, exactly like the operations above them: a
  // gapped selection survives the wire, and anything the game does not offer
  // is dropped rather than clamped onto a neighbour.
  check('a gapped width set survives', normaliseOptions({ digits: [4, 2] }).digits.join(',') === '2,4');
  check('and is returned in the lobby\'s own order', normaliseOptions({ digits: [5, 1, 3] }).digits.join(',') === '1,3,5');
  check('a width the game does not offer is dropped', normaliseOptions({ digits: [0, 3, 9] }).digits.join(',') === '3');
  check('an empty width set falls back to all of them', normaliseOptions({ digits: [] }).digits.join(',') === MATH_DIGIT_CHOICES.join(','));
  check('so does one with nothing recognisable in it', normaliseOptions({ operators: [7, 'two'] }).operators.join(',') === MATH_OPERATOR_CHOICES.join(','));
  check('a fractional setting is not a count', normaliseOptions({ operators: [1.4, 3] }).operators.join(',') === '3');
  check('nothing at all is the default', normaliseOptions(undefined).ops.length === 4);
  check('a hostile payload is the default', normaliseOptions('all of them').operators.join(',') === MATH_OPERATOR_CHOICES.join(','));

  check('one digit is 1–9', digitBounds(1).join(',') === '1,9');
  check('three digits is 100–999', digitBounds(3).join(',') === '100,999');
  check('× and ÷ are drawn, not typed', symbol('*') === '×' && symbol('/') === '÷');
  check('+ is itself', symbol('+') === '+');
  // The codepoint, not the glyph: a hyphen and a minus sign look alike in a diff.
  check('− is U+2212, not the hyphen U+002D', symbol('-') === MATH_MINUS && MATH_MINUS.codePointAt(0) === 0x2212);
}

function everyQuestionIsLegal(): void {
  console.log('\nevery question, across every option set (§3)');

  const sets = allOptionSets();
  let rolled = 0;
  let unparsed = 0;
  let mismatched = 0;
  let fractional = 0;
  let negative = 0;
  let outsideOptions = 0;
  let overCeiling = 0;
  let oversized = 0;
  let badAnswers = 0;
  const relaxed = new Set<string>();
  let worstExample: unknown = null;

  for (const options of sets) {
    const random = seeded(0x5eed ^ options.ops.length ^ (options.digits.length << 4) ^ (options.operators.length << 8));
    for (let i = 0; i < 200; i++) {
      const q = generateQuestion(options, random);
      rolled++;

      const value = evaluate(q.text);
      if (value === null) {
        unparsed++;
        worstExample ??= q.text;
        continue;
      }
      // The printed expression must parse, under standard precedence, to the
      // answer that was marked correct. This is the check that would catch a
      // generator that builds a tree and prints it flat.
      if (value !== q.answers[q.correct]) {
        mismatched++;
        worstExample ??= { text: q.text, scored: q.answers[q.correct], reads: value };
      }
      if (everyStep(q.text).some((n) => !Number.isInteger(n))) {
        fractional++;
        worstExample ??= q.text;
      }
      // Readable on a phone: no value on the way to the answer, nor the answer
      // itself, may exceed the cap (spec §12 Q7).
      if (everyStep(q.text).some((n) => n > MATH_ANSWER_MAX) || additivePrefixes(q.text).some((n) => n > MATH_ANSWER_MAX)) {
        oversized++;
        worstExample ??= { text: q.text, cap: MATH_ANSWER_MAX };
      }
      if (additivePrefixes(q.text).some((n) => n < 0)) {
        negative++;
        worstExample ??= q.text;
      }

      /*
       * Inside the host's settings. Two different strengths of promise here,
       * and the difference matters:
       *
       * - **the ticked operations are absolute.** A question may never contain
         *  an operation the host unticked, under any setting.
       * - **the operator count is a ceiling.** Never more than asked for, but
       *   sometimes fewer, because some settings cannot express what they ask
       *   (`unsatisfiable` below names them and why).
       */
      const used = [...q.text.matchAll(/[+\u2212×÷]/g)].map((m) => m[0]);
      const allowed = new Set(options.ops.map(symbol));
      if (used.some((op) => !allowed.has(op))) {
        outsideOptions++;
        worstExample ??= { text: q.text, allowed: [...allowed] };
      }
      const ceiling = Math.max(...options.operators);
      if (used.length > ceiling || used.length < 1) {
        overCeiling++;
        worstExample ??= { text: q.text, ceiling };
      }
      // Below the smallest count the host ticked is the one relaxation the
      // generator is allowed, and `unsatisfiable` below names every setting it
      // is allowed for.
      if (used.length < Math.min(...options.operators)) relaxed.add(describe(options));

      if (
        q.answers.length !== MATH_CHOICES
        || new Set(q.answers).size !== MATH_CHOICES
        || q.answers.some((n) => !Number.isInteger(n) || n < 0)
        || q.correct < 0
        || q.correct >= MATH_CHOICES
      ) {
        badAnswers++;
        worstExample ??= q.answers;
      }
    }
  }

  check(`${rolled} questions across ${sets.length} option sets`, rolled === sets.length * 200);
  check('every expression parses', unparsed === 0, unparsed);
  check('the printed sum reads as the scored answer', mismatched === 0, { mismatched, worstExample });
  check('no division leaves a remainder', fractional === 0, { fractional, worstExample });
  check('nothing goes negative, at any step', negative === 0, { negative, worstExample });
  check('no question uses an operation the host unticked', outsideOptions === 0, { outsideOptions, worstExample });
  check('no question carries more operators than were asked for', overCeiling === 0, { overCeiling, worstExample });
  check(`no answer exceeds ${MATH_ANSWER_MAX}`, oversized === 0, { oversized, worstExample });
  check('four distinct non-negative answers, one marked right', badAnswers === 0, { badAnswers, worstExample });

  /*
   * The operator count is the one thing the generator is allowed to give up,
   * and only for two reasons — both of which make the setting genuinely
   * unshowable rather than merely awkward. Pinned as an exact list rather than
   * a count, so a NEW setting starting to relax fails here instead of passing
   * quietly.
   *
   * Every entry asks for exactly three operators, which is what makes the
   * counts being a *set* rather than a range worth having: a room that ticks
   * 1 and 3 never relaxes, because dropping from three to one lands on a count
   * it asked for rather than below the range's floor.
   *
   * **Arithmetically impossible.** `a ÷ b ÷ c ÷ d` needs `a` divisible by
   * three same-width divisors *and* the same width itself; `a − b − c − d ≥ 0`
   * needs `a` to beat three same-width operands.
   *
   * **Past `MATH_ANSWER_MAX`.** Two or three multiplications at three digits
   * and up runs off the end of a phone screen, so the cap rejects it — and a
   * host who ticks `×` at five digits gets one multiplication rather than
   * three (spec §12 Q7).
   */
  const unsatisfiable = [
    // no exact chain of divisions exists at these widths
    '/ d1 o3', '/ d1-2-3-4-5 o3', '/ d2-4 o3', '/ d3 o3', '/ d5 o3',
    // a subtraction chain cannot stay non-negative at these widths
    '- d1 o3', '- d3 o3', '- d5 o3',
    // the product would be unreadable on a phone (MATH_ANSWER_MAX)
    '* d1-2-3-4-5 o3', '* d2-4 o3', '* d3 o3', '* d5 o3',
    '*/ d5 o3', '+* d5 o3', '+-* d5 o3', '-* d5 o3',
  ];
  const unexpected = [...relaxed].filter((k) => !unsatisfiable.includes(k)).sort();
  check(`only the ${unsatisfiable.length} unshowable settings relax the operator count`, unexpected.length === 0, unexpected);
}

/** The probe label an option set is known by in `unsatisfiable` above. */
function describe(o: MathOptions): string {
  return `${o.ops.join('')} d${o.digits.join('-')} o${o.operators.join('-')}`;
}

function relaxingIsAlwaysLegal(): void {
  console.log('\nwhat the generator does when a setting is impossible (§3)');

  /*
   * Division-only at one digit with three operators is the tightest legal
   * setting there is, and the sweep above showed it can never produce three
   * divisions. What it must still do is produce a *legal* question: a division,
   * exact, non-negative, four distinct answers — and it must not hang.
   */
  const tight: MathOptions = { ops: ['/'], digits: [1], operators: [3] };
  const random = seeded(99);
  let divisions = 0;
  let illegal = 0;
  for (let i = 0; i < 400; i++) {
    const q = generateQuestion(tight, random);
    if (/^\d+( ÷ \d+)+$/.test(q.text)) divisions++;
    else illegal = illegal + 1;
    const value = evaluate(q.text);
    if (value !== q.answers[q.correct] || everyStep(q.text).some((n) => !Number.isInteger(n))) illegal++;
  }
  check(`an impossible setting still yields ${divisions}/400 exact divisions and nothing else`, divisions === 400 && illegal === 0, { divisions, illegal });

  // And the operations it gives back are still only the ticked one, which is
  // the guarantee the first version of this file broke.
  const subOnly: MathOptions = { ops: ['-'], digits: [3], operators: [3] };
  const r = seeded(5);
  let additions = 0;
  for (let i = 0; i < 400; i++) if (generateQuestion(subOnly, r).text.includes('+')) additions++;
  check('a subtraction-only room never gets an addition', additions === 0, additions);
}

function precedenceTrap(): void {
  console.log('\nthe precedence trap (§12 Q5)');

  check('2 + 3 × 4 reads as 20 left to right', leftToRight('2 + 3 × 4') === 20);
  check('and its real value is 14', evaluate('2 + 3 × 4') === 14);
  check('a single operator has no trap to offer', leftToRight('2 + 3') === 5 && evaluate('2 + 3') === 5);
  check('a fractional left-to-right reading is no trap', leftToRight('2 + 3 ÷ 4') === null);
  check('garbage is not a number', leftToRight('2 ^ 3') === null);

  // The trap must actually be offered when it exists — it is the best wrong
  // answer in the game and the reason multi-operator questions earn their place.
  const options: MathOptions = { ops: ['+', '*'], digits: [1], operators: [2] };
  const random = seeded(4242);
  let withTrap = 0;
  let offered = 0;
  for (let i = 0; i < 300; i++) {
    const q = generateQuestion(options, random);
    const trap = leftToRight(q.text);
    const correct = q.answers[q.correct];
    if (trap === null || trap === correct || trap < 0) continue;
    withTrap++;
    if (q.answers.includes(trap)) offered++;
  }
  check(`the trap is on the buttons every time it exists (${offered}/${withTrap})`, withTrap > 0 && offered === withTrap, { withTrap, offered });
}

function answersLookPlausible(): void {
  console.log('\nthe wrong answers look nearly right (§12 Q5)');

  const options: MathOptions = { ops: ['+'], digits: [2], operators: [1] };
  const random = seeded(1);
  let near = 0;
  let total = 0;
  for (let i = 0; i < 300; i++) {
    const q = generateQuestion(options, random);
    const correct = q.answers[q.correct] as number;
    for (const a of q.answers) {
      if (a === correct) continue;
      total++;
      // Within an order of magnitude of the answer: a random number would not be.
      if (a > 0 && a / correct > 0.1 && a / correct < 10) near++;
    }
  }
  check(`${near}/${total} wrong answers are the same magnitude as the right one`, near === total, { near, total });

  // Tiny answers are where the distractor rules collide — 0 and 1 have almost
  // no near neighbours — so they get their own check rather than being lucky.
  const one: MathOptions = { ops: ['-'], digits: [1], operators: [1] };
  const r = seeded(31);
  let tiny = 0;
  for (let i = 0; i < 400; i++) {
    const q = generateQuestion(one, r);
    const correct = q.answers[q.correct] as number;
    if (correct > 2) continue;
    tiny++;
    if (new Set(q.answers).size !== MATH_CHOICES || q.answers.some((n) => n < 0)) {
      check('a tiny answer still gets three distinct non-negative alternatives', false, q.answers);
      return;
    }
  }
  check(`a tiny answer still gets three distinct alternatives (${tiny} of them)`, tiny > 0, tiny);
}

function deterministic(): void {
  console.log('\nthe referee owns the randomness (§8)');

  const a = generateQuestion(MATH_DEFAULT_OPTIONS, seeded(12345));
  const b = generateQuestion(MATH_DEFAULT_OPTIONS, seeded(12345));
  check('the same seed gives the same question', a.text === b.text && a.correct === b.correct);

  const c = generateQuestion(MATH_DEFAULT_OPTIONS, seeded(54321));
  check('a different seed gives a different one', c.text !== a.text);

  // The correct answer must not sit in the same slot every time, or the button
  // position is the answer.
  const random = seeded(8);
  const slots = [0, 0, 0, 0];
  for (let i = 0; i < 400; i++) {
    const q = generateQuestion(MATH_DEFAULT_OPTIONS, random);
    slots[q.correct] = (slots[q.correct] ?? 0) + 1;
  }
  check(`the right answer moves around the four buttons (${slots.join('/')})`, slots.every((n) => n > 40), slots);
}

optionsAreSurvivable();
everyQuestionIsLegal();
relaxingIsAlwaysLegal();
precedenceTrap();
answersLookPlausible();
deterministic();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
