import {
  nextDeadline,
  onMathAnswer,
  onPlayerGone,
  startMathOMatic,
  tick,
  toState,
  type Ctx,
  type MathOMatic,
} from './mathOMatic';
import {
  MATH_LIVES,
  MATH_QUESTION_CAP,
  MATH_REVEAL_MS,
  MATH_TAP_GRACE_MS,
  mathAnswerMs,
  MATH_ANSWER_BASE_MS,
  MATH_ANSWER_PER_OPERATOR_MS,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { MATH_CHOICES } from '../shared/mathQuestion';

/**
 * Math-o-matic's referee.
 * Spec: docs/specs/games/math-o-matic.md
 *
 * The question generator is `shared/mathQuestion.test.ts`'s business. What is
 * worth proving here is the shape the game turns on:
 *
 * - **the correct answer is never on the wire while the question is open**,
 *   and neither is anybody else's tap. This is the only thing standing between
 *   the game and a player reading the socket, and it is the reason `toState`
 *   has two shapes rather than one.
 * - **everybody is scored at the same instant**, so a fast tap is not worth
 *   more than a slow one — the game is arithmetic, not reflexes.
 * - **the first tap is the answer.** Colour Match keeps the last pick; here a
 *   second tap must be ignored, or a phone can try all four buttons.
 * - **not answering costs a life**, which is what stops a silent player
 *   outliving everyone who tried.
 * - and the round actually **ends** — on the last player standing, on an
 *   empty room, and on the question cap.
 */

let failures = 0;
let checks = 0;

function check(what: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${what}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${what}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

const A = 'a' as PlayerId;
const B = 'b' as PlayerId;
const C = 'c' as PlayerId;

/** A referee harness with a clock and a random source we drive by hand. */
function harness(at = 1_000_000) {
  let now = at;
  let seq = 0;
  let stored: MathOMatic | null = null;
  const sent: ServerMessage[] = [];
  let alarm = 0;
  /* A seeded source rather than a constant. A constant `random()` makes the
     generator deal the same question forever, which hides anything about
     question-to-question behaviour and is not what the Worker passes it. */
  let h = 0xC0FFEE;
  const rand = (): number => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 4294967296;
  };

  const ctx: Ctx = {
    now: () => now,
    nextSeq: () => ++seq,
    broadcast: (m) => sent.push(m),
    load: async () => stored,
    save: async (s) => {
      stored = s;
    },
    setAlarm: async (a) => {
      alarm = a;
    },
    random: rand,
  };

  return {
    ctx,
    sent,
    get state(): MathOMatic {
      if (!stored) throw new Error('no state');
      return stored;
    },
    get alarm(): number {
      return alarm;
    },
    get now(): number {
      return now;
    },
    at: (t: number) => {
      now = t;
    },
    advance: (ms: number) => {
      now += ms;
    },
    reseed: (at: number) => {
      h = at >>> 0;
    },
    /** The last `math` frame, which is what a phone would actually have. */
    get last() {
      const frames = sent.filter((m) => m.t === 'math');
      const frame = frames[frames.length - 1];
      if (!frame || frame.t !== 'math') throw new Error('no math frame');
      return frame.d;
    },
  };
}

/** Answer correctly, whatever the question turned out to be. */
async function answerRight(h: ReturnType<typeof harness>, id: PlayerId): Promise<void> {
  await onMathAnswer(h.ctx, id, h.state.roundId, h.state.index, h.state.question.correct);
}

/** Answer wrongly, whatever the question turned out to be. */
async function answerWrong(h: ReturnType<typeof harness>, id: PlayerId): Promise<void> {
  const wrong = (h.state.question.correct + 1) % MATH_CHOICES;
  await onMathAnswer(h.ctx, id, h.state.roundId, h.state.index, wrong);
}

/** Close the question and let the reveal run out, landing on the next one. */
async function nextQuestion(h: ReturnType<typeof harness>): Promise<void> {
  h.at(h.state.closesAt + MATH_TAP_GRACE_MS);
  await tick(h.ctx);
  h.at(h.state.nextAt);
  await tick(h.ctx);
}

async function starting(): Promise<void> {
  console.log('\nstarting a round (§2)');

  const h = harness();
  const started = await startMathOMatic(h.ctx, 7, [A, B], undefined);
  check('a room of two starts', started);
  check('everybody has their lives from the first question', h.state.lives[A] === MATH_LIVES && h.state.lives[B] === MATH_LIVES);
  check('and a score of zero, rather than appearing on their first tap', h.state.scores[A] === 0 && h.state.scores[B] === 0);
  check('a question is on screen', h.last.text.length > 0 && h.last.answers.length === MATH_CHOICES);
  check('the first question is index 0', h.last.index === 0);

  const alone = harness();
  check('one player cannot start', !(await startMathOMatic(alone.ctx, 1, [A], undefined)));
  check('unless it is solo testing', await startMathOMatic(alone.ctx, 1, [A], undefined, true));

  const crowd = harness();
  check('nine players cannot start', !(await startMathOMatic(crowd.ctx, 1, [A, B, C, 'd', 'e', 'f', 'g', 'h', 'i'] as PlayerId[], undefined)));

  // The window is a reading budget, so it grows with the sum (§12 Q4).
  check('a one-operator question gets the base window', mathAnswerMs('2 + 3') === MATH_ANSWER_BASE_MS);
  check('each extra operator buys more time', mathAnswerMs('2 + 3 × 4') === MATH_ANSWER_BASE_MS + MATH_ANSWER_PER_OPERATOR_MS);
  check('and three operators more again', mathAnswerMs('2 + 3 × 4 \u2212 1') === MATH_ANSWER_BASE_MS + 2 * MATH_ANSWER_PER_OPERATOR_MS);
  check("this round's own window matches its question", h.state.closesAt - 1_000_000 === mathAnswerMs(h.state.question.text));
}

async function theAnswerIsNotOnTheWire(): Promise<void> {
  console.log('\nnothing gives the answer away while the question is open (§8)');

  const h = harness();
  await startMathOMatic(h.ctx, 1, [A, B], undefined);

  check('the open question carries no correct index', h.last.correct === null);
  check('and no taps', Object.keys(h.last.taps).length === 0);
  check('but it does carry all four answers', h.last.answers.length === MATH_CHOICES);

  // One player answers. Nothing about it may reach anybody until the close —
  // otherwise a phone reading the wire copies the good player.
  await answerRight(h, A);
  check('the referee stored it', h.state.taps[A] === h.state.question.correct);
  check('and nothing new was broadcast', h.sent.filter((m) => m.t === 'math').length === 1);
  check('a fresh joiner would still see no taps', Object.keys(toState(h.state).taps).length === 0);
  check('and still no correct index', toState(h.state).correct === null);

  // The close.
  h.at(h.state.closesAt + MATH_TAP_GRACE_MS);
  await tick(h.ctx);
  check('the reveal names the correct answer', h.last.correct === h.state.question.correct);
  check('and who tapped what', h.last.taps[A] === h.state.question.correct);
  check('the answer A tapped is the value it reads on screen', h.last.answers[h.last.correct ?? -1] !== undefined);
}

async function scoringIsSimultaneous(): Promise<void> {
  console.log('\neverybody is scored at the same instant (§2)');

  const h = harness();
  await startMathOMatic(h.ctx, 1, [A, B, C], undefined);

  await answerRight(h, A);
  h.advance(3_000);
  await answerRight(h, B);
  // C never answers.

  check('no life has moved while the question is open', h.state.lives[A] === MATH_LIVES && h.state.lives[C] === MATH_LIVES);
  check('and no score', h.state.scores[A] === 0);

  h.at(h.state.closesAt + MATH_TAP_GRACE_MS);
  await tick(h.ctx);

  check('a right answer scores, however late it was', h.state.scores[A] === 1 && h.state.scores[B] === 1);
  check('and costs no life', h.state.lives[A] === MATH_LIVES && h.state.lives[B] === MATH_LIVES);
  check('not answering costs a life', h.state.lives[C] === MATH_LIVES - 1);
  check('and scores nothing', h.state.scores[C] === 0);
  check('the fast answer is worth exactly the slow one', h.state.scores[A] === h.state.scores[B]);
}

async function tapRules(): Promise<void> {
  console.log('\nthe first tap is the answer (§8)');

  const h = harness();
  await startMathOMatic(h.ctx, 1, [A, B], undefined);
  const correct = h.state.question.correct;
  const wrong = (correct + 1) % MATH_CHOICES;

  await onMathAnswer(h.ctx, A, 1, 0, wrong);
  await onMathAnswer(h.ctx, A, 1, 0, correct);
  check('a second tap is ignored, not taken', h.state.taps[A] === wrong);

  // A phone cannot answer a question it was not shown.
  await onMathAnswer(h.ctx, B, 1, 0, MATH_CHOICES);
  check('a button that does not exist is refused', !(B in h.state.taps));
  await onMathAnswer(h.ctx, B, 1, 0, -1);
  check('and so is a negative one', !(B in h.state.taps));
  await onMathAnswer(h.ctx, B, 1, 0, 1.5);
  check('and a fractional one', !(B in h.state.taps));
  await onMathAnswer(h.ctx, B, 1, 0, 'two');
  check('and a string', !(B in h.state.taps));

  await onMathAnswer(h.ctx, B, 99, 0, correct);
  check('a tap for another round is refused', !(B in h.state.taps));
  await onMathAnswer(h.ctx, B, 1, 5, correct);
  check('a tap for a stale question is refused', !(B in h.state.taps));
  await onMathAnswer(h.ctx, 'nobody' as PlayerId, 1, 0, correct);
  check('a tap from somebody not in the round is refused', !('nobody' in h.state.taps));

  // The grace, and its edge.
  h.at(h.state.closesAt + MATH_TAP_GRACE_MS);
  await onMathAnswer(h.ctx, B, 1, 0, correct);
  check('a tap inside the grace still counts', h.state.taps[B] === correct);

  const late = harness();
  await startMathOMatic(late.ctx, 1, [A, B], undefined);
  late.at(late.state.closesAt + MATH_TAP_GRACE_MS + 1);
  await onMathAnswer(late.ctx, A, 1, 0, late.state.question.correct);
  check('a tap past the grace does not', !(A in late.state.taps));
}

async function questionsChain(): Promise<void> {
  console.log('\nquestions chain with no lobby in between (§2)');

  const h = harness();
  await startMathOMatic(h.ctx, 1, [A, B], undefined);
  const first = h.state.question.text;

  check('the alarm is the close plus the grace', h.alarm === h.state.closesAt + MATH_TAP_GRACE_MS);
  h.at(h.state.closesAt + MATH_TAP_GRACE_MS);
  await tick(h.ctx);
  check('closing moves to the reveal', h.state.phase === 'reveal');
  check('and the alarm to the end of it', h.alarm === h.state.nextAt);
  check('the reveal is as long as the spec says', h.state.nextAt - (h.state.closesAt + MATH_TAP_GRACE_MS) === MATH_REVEAL_MS);

  h.at(h.state.nextAt);
  await tick(h.ctx);
  check('then the next question is asked', h.state.phase === 'ask' && h.state.index === 1);
  check('and it is rolled fresh rather than repeated verbatim', h.state.question.text !== first, { first, next: h.state.question.text });
  check('with nobody carrying a tap over', Object.keys(h.state.taps).length === 0);
  check('and last question’s eliminations cleared', h.state.out.length === 0);

  // A tick before anything is due does nothing at all.
  const idle = harness();
  await startMathOMatic(idle.ctx, 1, [A, B], undefined);
  const before = idle.sent.length;
  check('an early tick is a no-op', (await tick(idle.ctx)) === false && idle.sent.length === before);
  check('nextDeadline agrees with the alarm', nextDeadline(idle.state) === idle.state.closesAt + MATH_TAP_GRACE_MS);
}

async function livesAndElimination(): Promise<void> {
  console.log('\nthree lives, and the last one standing (§2)');

  const h = harness();
  await startMathOMatic(h.ctx, 1, [A, B], undefined);

  // A answers everything right; B answers everything wrong.
  for (let i = 0; i < MATH_LIVES; i++) {
    await answerRight(h, A);
    await answerWrong(h, B);
    const livesBefore = h.state.lives[B] ?? 0;
    h.at(h.state.closesAt + MATH_TAP_GRACE_MS);
    await tick(h.ctx);
    check(`question ${i + 1} costs B a life (${livesBefore} → ${h.state.lives[B]})`, h.state.lives[B] === livesBefore - 1);
    if (i < MATH_LIVES - 1) {
      h.at(h.state.nextAt);
      await tick(h.ctx);
    }
  }

  check('B is out of lives', h.state.lives[B] === 0);
  check('and named on the reveal that did it', h.state.out.includes(B));
  check('the round is still revealing, not over', h.state.phase === 'reveal');
  check('A never lost one', h.state.lives[A] === MATH_LIVES);
  check('and scored every question', h.state.scores[A] === MATH_LIVES);

  h.at(h.state.nextAt);
  const over = await tick(h.ctx);
  check('the reveal ending finishes the round', over && h.state.phase === 'done');
  check('the last player standing wins', h.state.winner === A);
  check('and it is not a draw', !h.state.draw);

  // Out means out: no more taps, and no more lives to lose.
  const after = harness();
  await startMathOMatic(after.ctx, 1, [A, B], undefined);
  after.state.lives[B] = 0;
  await onMathAnswer(after.ctx, B, 1, 0, after.state.question.correct);
  check('a player with no lives cannot answer', !(B in after.state.taps));
  after.at(after.state.closesAt + MATH_TAP_GRACE_MS);
  await tick(after.ctx);
  check('and does not go negative', after.state.lives[B] === 0);
}

async function endings(): Promise<void> {
  console.log('\nhow a round can end (§2, §7)');

  // Everybody loses their last life on the same question: highest score of
  // those who fell wins, and a level score is a draw.
  const tied = harness();
  await startMathOMatic(tied.ctx, 1, [A, B], undefined);
  tied.state.lives[A] = 1;
  tied.state.lives[B] = 1;
  tied.at(tied.state.closesAt + MATH_TAP_GRACE_MS);
  await tick(tied.ctx);
  check('both went out together', tied.state.lives[A] === 0 && tied.state.lives[B] === 0);
  tied.at(tied.state.nextAt);
  await tick(tied.ctx);
  check('with equal scores it is a draw', tied.state.phase === 'done' && tied.state.draw && tied.state.winner === null);

  const decided = harness();
  await startMathOMatic(decided.ctx, 1, [A, B], undefined);
  decided.state.lives[A] = 1;
  decided.state.lives[B] = 1;
  decided.state.scores[A] = 4;
  decided.state.scores[B] = 2;
  decided.at(decided.state.closesAt + MATH_TAP_GRACE_MS);
  await tick(decided.ctx);
  decided.at(decided.state.nextAt);
  await tick(decided.ctx);
  check('otherwise the higher score takes it', decided.state.winner === A && !decided.state.draw);

  // The cap. Two players who never get one wrong still finish.
  const capped = harness();
  await startMathOMatic(capped.ctx, 1, [A, B], undefined);
  capped.state.scores[A] = 3;
  capped.state.scores[B] = 1;
  capped.state.index = MATH_QUESTION_CAP - 1;
  capped.at(capped.state.closesAt + MATH_TAP_GRACE_MS);
  await answerRight(capped, A);
  await tick(capped.ctx);
  capped.at(capped.state.nextAt);
  const done = await tick(capped.ctx);
  check(`the cap of ${MATH_QUESTION_CAP} questions ends it`, done && capped.state.phase === 'done');
  check('on score', capped.state.winner === A);

  // A solo round has nobody to beat, and ends when its one player is out
  // rather than at kick-off (`lastStanding` in shared/players.ts).
  const solo = harness();
  await startMathOMatic(solo.ctx, 1, [A], undefined, true);
  check('a solo round starts and is not immediately over', solo.state.phase === 'ask');
  solo.state.lives[A] = 1;
  solo.at(solo.state.closesAt + MATH_TAP_GRACE_MS);
  await tick(solo.ctx);
  solo.at(solo.state.nextAt);
  check('and it ends when its one player runs out', (await tick(solo.ctx)) === true);
  check('with no winner', solo.state.winner === null);

  // A finished round is inert.
  check('a tick after the end does nothing', (await tick(solo.ctx)) === false);
  check('and nextDeadline is never', nextDeadline(solo.state) === Infinity);
}

async function leaving(): Promise<void> {
  console.log('\na player leaves (§7)');

  const h = harness();
  await startMathOMatic(h.ctx, 1, [A, B], undefined);
  await answerRight(h, B);
  await onPlayerGone(h.ctx, B);
  check('their tap for the question in flight is dropped', !(B in h.state.taps));
  check('but their lives stay on the board', h.state.lives[B] === MATH_LIVES);
  check('and their score', h.state.scores[B] === 0);

  h.at(h.state.closesAt + MATH_TAP_GRACE_MS);
  await tick(h.ctx);
  check('so not being there costs them a life like anybody silent', h.state.lives[B] === MATH_LIVES - 1);

  await onPlayerGone(h.ctx, 'nobody' as PlayerId);
  check('a stranger leaving is harmless', h.state.phase === 'reveal');
}

async function hostOptions(): Promise<void> {
  console.log('\nthe host’s toggles (§3)');

  const h = harness();
  await startMathOMatic(h.ctx, 1, [A, B], { ops: ['+'], digits: [1], operators: [1] });
  check('a fixed setting is honoured', /^\d+ \+ \d+$/.test(h.state.question.text), h.state.question.text);

  // Fixed at start, so a later payload cannot change the difficulty mid-round.
  const stored = h.state.options;
  await nextQuestion(h);
  check('and the same options are used for the next question', h.state.options === stored || h.state.options.ops.join('') === '+');
  check('so the next question obeys them too', /^\d+ \+ \d+$/.test(h.state.question.text), h.state.question.text);

  const hostile = harness();
  await startMathOMatic(hostile.ctx, 1, [A, B], { ops: [], digits: [99, -3], operators: 'lots' });
  check('a hostile payload still produces a question', hostile.state.question.text.length > 0);
  check('with four answers', hostile.state.question.answers.length === MATH_CHOICES);
}

async function main(): Promise<void> {
  await starting();
  await theAnswerIsNotOnTheWire();
  await scoringIsSimultaneous();
  await tapRules();
  await questionsChain();
  await livesAndElimination();
  await endings();
  await leaving();
  await hostOptions();

  if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
  console.log(`\nall ${checks} passed`);
}

await main();
