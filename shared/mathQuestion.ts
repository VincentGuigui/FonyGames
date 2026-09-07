/**
 * Math-o-matic's question generator. Spec: docs/specs/games/math-o-matic.md §3
 *
 * Shared rather than living in the worker because the whole difficulty of the
 * game is in here — the sum is trivial, the three wrong answers are not — and a
 * node test has to be able to roll ten thousand questions and check every one.
 * The referee is the only caller (spec §6: the host does not roll its own
 * question), but the maths is not the referee's to own.
 *
 * Must stay DOM-free: it typechecks under tsconfig.worker.json.
 *
 * ## What the options are allowed to produce
 *
 * The host can tick any operations, any digit width and any operator count, and
 * no combination may produce a question the spec forbids:
 *
 * - **division is exact** — never a remainder;
 * - **nothing goes negative**, at any point in the left-to-right evaluation,
 *   not just at the end;
 * - **standard precedence**, with no brackets (spec §3, §12 Q3) — so the
 *   printed expression must parse to the value we scored it as.
 *
 * The first two are guaranteed by construction, and the third falls out of
 * evaluating what we printed rather than printing what we evaluated.
 */

/** The four operations, as the wire and the host's toggles name them. */
export type MathOp = '+' | '-' | '*' | '/';

export const MATH_OPS: readonly MathOp[] = ['+', '-', '*', '/'];

/** What the host ticked in the lobby. Ranges are inclusive at both ends. */
export type MathOptions = {
  ops: readonly MathOp[];
  /** Digits per operand, 1–5. */
  digits: readonly [min: number, max: number];
  /** Operators per question, 1–3. */
  operators: readonly [min: number, max: number];
};

export const MATH_DIGITS_MIN = 1;
export const MATH_DIGITS_MAX = 5;
export const MATH_OPERATORS_MIN = 1;
export const MATH_OPERATORS_MAX = 3;

/** Everything on, which is what the lobby starts at (issue #5). */
export const MATH_DEFAULT_OPTIONS: MathOptions = {
  ops: MATH_OPS,
  digits: [MATH_DIGITS_MIN, MATH_DIGITS_MAX],
  operators: [MATH_OPERATORS_MIN, MATH_OPERATORS_MAX],
};

/** How many answers a question offers. One is right (spec §2). */
export const MATH_CHOICES = 4;

/**
 * The biggest answer this game will put on a button. Six digits.
 *
 * **This is a mobile-web rule, not an arithmetic one** (AGENTS.md §4), and it is
 * a deliberate departure from the issue's "all options enabled by default":
 * three multiplications at five digits produces answers like
 * `84 × 235 × 6511 × 5 = 642635700`, and four ten-digit numbers in a 2×2 grid
 * on a 390 px screen cannot be read at any font size, never mind compared
 * against each other in eight seconds.
 *
 * So an expression whose answer — or any value on the way to it — exceeds this
 * is rejected, and the generator relaxes the operator count exactly as it does
 * for an impossible division (`generateQuestion`). A host who ticks `×` at five
 * digits therefore gets a single multiplication rather than three, which is the
 * most this screen can honestly show. Spec §12 Q7.
 */
export const MATH_ANSWER_MAX = 999_999;

export type MathQuestion = {
  /** The expression as the player reads it, e.g. `12 + 3 × 4`. */
  text: string;
  /** The four answers in the order to draw them. */
  answers: number[];
  /** Which of `answers` is right. Never leaves the referee before the close. */
  correct: number;
};

/**
 * Sanitise whatever the host's phone sent.
 *
 * A payload decides the *difficulty*, so it does not need to be trusted, but it
 * does need to be survivable: an empty operation list, a backwards range or a
 * six-digit setting must land on something playable rather than hanging the
 * generator. Anything unrecognised falls back to the default for that field —
 * and an empty `ops` is the one the spec calls out explicitly, because the
 * lobby will not let you untick the last operation either.
 */
export function normaliseOptions(raw: unknown): MathOptions {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const ops = Array.isArray(o['ops'])
    ? MATH_OPS.filter((op) => (o['ops'] as unknown[]).includes(op))
    : MATH_DEFAULT_OPTIONS.ops;
  return {
    ops: ops.length > 0 ? ops : MATH_DEFAULT_OPTIONS.ops,
    digits: range(o['digits'], MATH_DIGITS_MIN, MATH_DIGITS_MAX),
    operators: range(o['operators'], MATH_OPERATORS_MIN, MATH_OPERATORS_MAX),
  };
}

function range(raw: unknown, lo: number, hi: number): readonly [number, number] {
  const pair = Array.isArray(raw) ? raw : [];
  const a = clampInt(pair[0], lo, hi, lo);
  const b = clampInt(pair[1], lo, hi, hi);
  // Backwards is a bug in the sender, not a request for an empty range.
  return a <= b ? [a, b] : [b, a];
}

function clampInt(raw: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(raw)));
}

/** Inclusive integer pick. `random` is injected so a test can pin a question. */
function pick(random: () => number, lo: number, hi: number): number {
  return lo + Math.floor(random() * (hi - lo + 1));
}

function pickOf<T>(random: () => number, items: readonly T[]): T {
  // Non-null: every caller passes a non-empty list, and `normaliseOptions`
  // is what guarantees that for `ops`.
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))] as T;
}

/** The half-open bounds of an n-digit number: 1 digit is 1–9, 3 is 100–999. */
export function digitBounds(digits: number): readonly [number, number] {
  const lo = digits <= 1 ? 1 : 10 ** (digits - 1);
  return [lo, 10 ** digits - 1];
}

/** An operand of a width drawn from the host's digit range. */
function operand(random: () => number, digits: readonly [number, number]): number {
  const [lo, hi] = digitBounds(pick(random, digits[0], digits[1]));
  return pick(random, lo, hi);
}

/* ------------------------------------------------------------------ */
/* Building the expression                                            */
/* ------------------------------------------------------------------ */

/**
 * A multiplicative run: operands joined only by `×` and `÷`, which is what a
 * precedence-correct expression evaluates first.
 *
 * **Why the first operand is chosen last.** A run evaluates to
 * `o0 × (all multipliers) ÷ (all divisors)`, and every intermediate value is
 * `o0 × (some multipliers) ÷ (some divisors)`. So it is enough for `o0` to be
 * divisible by the product of *every* divisor in the run: each prefix then
 * divides exactly, and no step can produce a fraction. Rolling a dividend and
 * hoping — which is what the obvious version does — throws most rolls away and
 * still lets a two-division run slip through.
 */
function buildRun(
  random: () => number,
  ops: readonly MathOp[],
  digits: readonly [number, number],
  count: number,
): { text: string; value: number } | null {
  const muls: MathOp[] = ops.filter((op) => op === '*' || op === '/');
  const tail: { op: MathOp; n: number }[] = [];
  let divisorProduct = 1;

  // The head's own width is chosen FIRST, because it is what decides how many
  // divisors this run can afford to carry — picking it afterwards means the
  // budget was computed against a head that may not turn up.
  const [headLo, headHi] = digitBounds(pick(random, digits[0], digits[1]));

  for (let i = 0; i < count; i++) {
    const op = pickOf(random, muls);
    if (op === '/') {
      // A divisor of 1 divides everything and teaches nothing, so 2 is the floor
      // — which means a 1-digit setting draws from 2–9.
      const [lo, hi] = digitBounds(pick(random, digits[0], digits[1]));
      // What the head can still carry. Capped at half the head's ceiling so the
      // head keeps a choice of at least two multiples rather than being forced.
      const budget = Math.floor(headHi / (divisorProduct * 2));
      const top = Math.min(Math.max(2, hi), budget);
      if (top < Math.max(2, lo)) {
        /*
         * No divisor of this width fits any more. Falling back to `×` here is
         * what the first version did, and it put a multiplication into a
         * division-only question — the host's toggles silently overruled. So:
         * multiply only if the host ticked it, and otherwise give up on this
         * roll and let `generateQuestion` try again.
         */
        if (!muls.includes('*')) return null;
        tail.push({ op: '*', n: operand(random, digits) });
        continue;
      }
      const n = pick(random, Math.max(2, lo), top);
      divisorProduct *= n;
      tail.push({ op, n });
    } else {
      tail.push({ op, n: operand(random, digits) });
    }
  }

  /*
   * The head: a multiple of every divisor, still inside its own digit range.
   *
   * The quotient floor of 2 is what stops `19713 ÷ 19713` — a legal question,
   * exact and non-negative, and a completely worthless one, which is what the
   * first browser run of this game actually put on screen. It only relaxes to 1
   * when the digit range leaves no room for a second multiple.
   */
  const highestMultiple = Math.floor(headHi / divisorProduct);
  const wanted = Math.ceil(Math.max(headLo, divisorProduct) / divisorProduct);
  const lowestMultiple = divisorProduct > 1 && highestMultiple >= Math.max(2, wanted) ? Math.max(2, wanted) : wanted;
  if (highestMultiple < lowestMultiple) return null;
  let value = pick(random, lowestMultiple, highestMultiple) * divisorProduct;

  let text = String(value);
  for (const step of tail) {
    value = step.op === '*' ? value * step.n : value / step.n;
    // Checked at every step, not just at the end: `9 × 99999 ÷ 3` has a
    // perfectly readable answer and an intermediate nobody can hold in
    // their head.
    if (value > MATH_ANSWER_MAX) return null;
    text += ` ${symbol(step.op)} ${step.n}`;
  }
  return { text, value };
}

/**
 * What the player sees. `×`, `÷` and `−` rather than `*`, `/` and `-`: this is a
 * sum on a screen, not source code.
 *
 * The minus is U+2212 MINUS SIGN, not the hyphen. Next to a `÷` at 3.5rem a
 * hyphen reads as a thin dash sitting too high — visible the moment the first
 * question was on a phone-sized screen. Everything that parses this text back
 * (`leftToRight` here, `mathAnswerMs` in protocol.ts) matches on the same
 * character, so there is one printed form and no second representation to drift.
 */
export const MATH_MINUS = '\u2212';

export function symbol(op: MathOp): string {
  return op === '*' ? '×' : op === '/' ? '÷' : op === '-' ? MATH_MINUS : op;
}

/**
 * One question's expression, or null if this roll could not satisfy the
 * options (a run with no legal head, or a subtraction with nothing to take
 * from). The caller retries; see `generateQuestion`.
 */
function buildExpression(
  random: () => number,
  options: MathOptions,
): { text: string; value: number } | null {
  const { ops, digits } = options;
  const operators = pick(random, options.operators[0], options.operators[1]);
  const additive = ops.filter((op) => op === '+' || op === '-');
  const multiplicative = ops.filter((op) => op === '*' || op === '/');

  /*
   * A run, then (join, run) pairs — so there is always exactly one more run
   * than there are joins.
   *
   * Written the other way round first (push a run, then maybe a join) and it
   * always ended on a join with no operand after it, so every additive-only
   * setting produced nothing and fell through to the fallback. `+` alone
   * silently became "one addition, whatever you asked for".
   */
  const runs: { text: string; value: number }[] = [];
  const joins: MathOp[] = [];
  let left = operators;

  // With nothing additive ticked, the first run has to absorb every operator:
  // there is no legal way to join two runs.
  const headRun = multiplicative.length === 0
    ? 0
    : additive.length === 0 ? left : pick(random, 0, left);
  const head = buildRun(random, ops, digits, headRun);
  if (!head) return null;
  left -= headRun;
  runs.push(head);

  while (left > 0) {
    // Only reachable with an additive operation ticked, since otherwise the
    // head consumed everything above.
    if (additive.length === 0) return null;
    joins.push(pickOf(random, additive));
    left -= 1;
    const inRun = multiplicative.length === 0 ? 0 : pick(random, 0, left);
    const run = buildRun(random, ops, digits, inRun);
    if (!run) return null;
    left -= inRun;
    runs.push(run);
  }

  // Left to right over the runs, which is what precedence leaves for last.
  let value = runs[0]?.value ?? 0;
  let text = runs[0]?.text ?? '0';
  for (let i = 0; i < joins.length; i++) {
    const join = joins[i] as MathOp;
    const run = runs[i + 1] as { text: string; value: number };
    // Nothing goes negative — not the answer and not the running total (spec
    // §3). Rejected rather than repaired: flipping the operator here would
    // quietly turn a subtraction-only setting into an addition game.
    if (join === '-' && run.value > value) return null;
    value = join === '+' ? value + run.value : value - run.value;
    if (value > MATH_ANSWER_MAX) return null;
    text += ` ${symbol(join)} ${run.text}`;
  }
  return { text, value };
}

/**
 * The value a player gets by reading strictly left to right and ignoring
 * precedence — the single best wrong answer in the game, and the reason
 * multi-operator questions are worth having at all.
 *
 * Parsed back out of the printed text so it can only ever be the trap for the
 * expression actually on screen. Returns null when there is no trap: one
 * operator, or an expression whose precedence happens not to matter.
 */
export function leftToRight(text: string): number | null {
  const parts = text.split(' ');
  let value = Number(parts[0]);
  if (!Number.isFinite(value)) return null;
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i];
    const n = Number(parts[i + 1]);
    if (!Number.isFinite(n)) return null;
    if (op === '+') value += n;
    else if (op === MATH_MINUS) value -= n;
    else if (op === '×') value *= n;
    else if (op === '÷') value /= n;
    else return null;
  }
  return Number.isInteger(value) ? value : null;
}

/* ------------------------------------------------------------------ */
/* The three wrong answers                                            */
/* ------------------------------------------------------------------ */

/**
 * Distractors, best first. Spec §12 Q5: the difficulty of this game is mostly
 * in this list rather than in the sum, so they are ordered by how nearly right
 * they look and taken in that order — a random number in the same magnitude is
 * the last resort, not the design.
 *
 * 1. **The precedence trap** — what left-to-right reading gives.
 * 2. **Off by one**, either way: the arithmetic slip everybody actually makes.
 * 3. **Transposed digits** — `54` for `45`. Only exists above 9.
 * 4. **A digit changed**, which keeps the shape and the magnitude.
 * 5. **Off by ten and by the last operand**, the two other common slips.
 */
function distractors(text: string, correct: number, random: () => number): number[] {
  const out: number[] = [];
  const add = (n: number): void => {
    if (Number.isInteger(n) && n >= 0 && n !== correct && !out.includes(n)) out.push(n);
  };

  const trap = leftToRight(text);
  if (trap !== null) add(trap);
  add(correct + 1);
  add(correct - 1);
  add(transpose(correct));
  add(nudgeDigit(correct, random));
  add(correct + 10);
  add(correct - 10);
  const last = Number(text.split(' ').at(-1));
  if (Number.isFinite(last)) {
    add(correct + last);
    add(correct - last);
  }
  // A backstop for tiny answers, where every rule above collides: 0 and 1 have
  // almost no near neighbours to offer.
  for (let k = 2; out.length < MATH_CHOICES - 1; k++) add(correct + k);
  return out.slice(0, MATH_CHOICES - 1);
}

/**
 * `45` → `54`. Swaps the last two digits; identical when they match, which
 * `add` above then discards.
 *
 * A swap that moves a `0` to the front is refused rather than returned: `20`
 * would become `02`, which is `2` — a *shorter* number an order of magnitude
 * off the answer, and so an obviously wrong button rather than a tempting one.
 */
function transpose(n: number): number {
  const s = String(n);
  if (s.length < 2) return n;
  const swapped = s.slice(0, -2) + s.slice(-1) + s.slice(-2, -1);
  return swapped.startsWith('0') ? n : Number(swapped);
}

/** One digit moved by one, keeping the length — so it still looks like an
 *  answer to this question rather than to a different one. */
function nudgeDigit(n: number, random: () => number): number {
  const s = String(n);
  const at = Math.min(s.length - 1, Math.floor(random() * s.length));
  const digit = Number(s[at]);
  const next = digit === 9 ? 8 : digit + 1;
  // Never a leading zero: that shortens the number and gives the shape away.
  if (at === 0 && next === 0) return n;
  return Number(s.slice(0, at) + String(next) + s.slice(at + 1));
}

/**
 * Fisher-Yates, on the injected `random` — so the correct answer's position is
 * the referee's own randomness and a client cannot predict which button it is
 * (spec §8).
 */
function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * One question, honouring the host's options.
 *
 * `buildExpression` rejects rather than repairs (a subtraction that would go
 * negative, a run with no legal head), so this retries. `MATH_ROLL_TRIES` is
 * generous because a rejection costs a few multiplications; if every try is
 * rejected — which the test measures for all 60 option combinations — the
 * fallback is the simplest legal question the options can express, not a
 * crash and not a question outside them.
 */
export const MATH_ROLL_TRIES = 60;

/**
 * The simplest legal question the host's options can express: two operands and
 * one ticked operation, built so it cannot break a spec rule.
 *
 * It must use an operation the host actually ticked — an addition-shaped
 * fallback under a subtraction-only setting is the game ignoring the lobby, and
 * it is exactly what the first version of this file shipped.
 */
function simplest(random: () => number, options: MathOptions): { text: string; value: number } {
  const op = pickOf(random, options.ops);
  const a = operand(random, options.digits);
  const b = operand(random, options.digits);
  if (op === '+') return { text: `${a} + ${b}`, value: a + b };
  // Ordered, so it cannot go negative.
  if (op === '-') return { text: `${Math.max(a, b)} ${MATH_MINUS} ${Math.min(a, b)}`, value: Math.abs(a - b) };
  if (op === '*') {
    // Narrow the second operand until the product fits the screen (`MATH_ANSWER_MAX`).
    const b2 = Math.max(2, Math.min(b, Math.floor(MATH_ANSWER_MAX / Math.max(1, a))));
    return { text: `${a} × ${b2}`, value: a * b2 };
  }
  // Exact by construction: the dividend is the product.
  const d = Math.max(2, b);
  return { text: `${a * d} ÷ ${d}`, value: a };
}

/**
 * One question, honouring the host's options.
 *
 * ## The operator count is a ceiling, not a promise
 *
 * Some settings simply cannot produce the number of operators they ask for, and
 * no amount of retrying changes that:
 *
 * - **three exact divisions at three digits.** The first operand has to be
 *   divisible by all three divisors, so it needs to be at least 100³ — and it
 *   has to fit in three digits.
 * - **three subtractions at three digits.** `a − b − c − d ≥ 0` needs `a` to
 *   exceed three other three-digit numbers, which is rare and at four digits of
 *   divisors impossible.
 *
 * So this walks *down* from what was asked to what fits, and the thing it gives
 * up is the operator count — never the ticked operations, and never a spec rule.
 * Relaxing the operations instead is what the first version did, and a
 * subtraction-only room got additions.
 *
 * `buildExpression` also rejects rather than repairs (a subtraction that would
 * go negative), so each count gets `MATH_ROLL_TRIES` attempts before the next
 * one down. If even one operator is impossible, `simplest` builds it directly.
 */
export function generateQuestion(options: MathOptions, random: () => number): MathQuestion {
  let built: { text: string; value: number } | null = null;
  for (let ceiling = options.operators[1]; ceiling >= options.operators[0] && !built; ceiling--) {
    const narrowed: MathOptions = { ...options, operators: [options.operators[0], ceiling] };
    for (let i = 0; i < MATH_ROLL_TRIES && !built; i++) built = buildExpression(random, narrowed);
  }
  // Still nothing: the low end of the requested range is itself unreachable, so
  // drop to one operator, which every option set can always express.
  for (let i = 0; i < MATH_ROLL_TRIES && !built; i++) {
    built = buildExpression(random, { ...options, operators: [1, 1] });
  }
  if (!built) built = simplest(random, options);

  const wrong = distractors(built.text, built.value, random);
  const answers = shuffle([built.value, ...wrong], random);
  return { text: built.text, answers, correct: answers.indexOf(built.value) };
}
