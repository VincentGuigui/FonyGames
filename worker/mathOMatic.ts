import {
  MATH_LIVES,
  MATH_MAX_PLAYERS,
  MATH_MIN_PLAYERS,
  MATH_QUESTION_CAP,
  MATH_REVEAL_MS,
  MATH_TAP_GRACE_MS,
  mathAnswerMs,
  type MathState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { MATH_CHOICES, generateQuestion, normaliseOptions, type MathOptions } from '../shared/mathQuestion';
import { enoughToStart, lastStanding } from '../shared/players';

/**
 * Math-o-matic. Spec: docs/specs/games/math-o-matic.md
 *
 * **The referee rolls the question, not the host.** That is the one place the
 * spec departs from the issue (§6), and it is the reason this file exists at
 * all: a host whose phone generated the sum would hold the correct index
 * before anybody had seen the question, and a modified host could roll until it
 * liked what it got. The generator is arithmetic on five numbers, so moving it
 * here costs nothing.
 *
 * The corollary is what `toState` withholds: while a question is open there is
 * nothing on the wire that marks which answer is right, and nothing that says
 * what anyone else tapped. Both appear at the reveal, together.
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md, and driven entirely through `Ctx` — this
 * module never touches a socket.
 */

export type MathQuestionState = {
  text: string;
  answers: number[];
  /** The referee's secret until the question closes. */
  correct: number;
};

export type MathOMatic = {
  roundId: number;
  index: number;
  question: MathQuestionState;
  phase: 'ask' | 'reveal' | 'done';
  closesAt: number;
  nextAt: number;
  lives: Record<PlayerId, number>;
  scores: Record<PlayerId, number>;
  /** This question's taps only, replaced wholesale each question. */
  taps: Record<PlayerId, number>;
  out: PlayerId[];
  /** The host's lobby toggles, fixed at start so a mid-round change is
   *  impossible (spec §7: the options were fixed at start). */
  options: MathOptions;
  solo: boolean;
  winner: PlayerId | null;
  draw: boolean;
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<MathOMatic | null>;
  save(s: MathOMatic): Promise<void>;
  setAlarm(at: number): Promise<void>;
  /** 0..1. Injected rather than read here so a test can pin a question — the
   *  same reason `shared/color.ts` takes one. */
  random(): number;
};

/**
 * The next thing this game needs waking for.
 *
 * During `ask` that is the close plus its grace: the referee waits
 * `MATH_TAP_GRACE_MS` past the deadline before scoring, so a phone 300 ms away
 * loses its own lag rather than a life (spec §6).
 */
export function nextDeadline(s: MathOMatic): number {
  if (s.phase === 'done') return Infinity;
  return s.phase === 'ask' ? s.closesAt + MATH_TAP_GRACE_MS : s.nextAt;
}

/** Everyone still holding a life. */
function alive(s: MathOMatic): PlayerId[] {
  return Object.keys(s.lives).filter((id) => (s.lives[id] ?? 0) > 0);
}

function armQuestion(ctx: Ctx, s: MathOMatic, index: number): void {
  const now = ctx.now();
  const q = generateQuestion(s.options, ctx.random);
  s.index = index;
  s.question = { text: q.text, answers: q.answers, correct: q.correct };
  s.phase = 'ask';
  // The window is a function of the sum's own length, so a three-operator
  // question is not a reading-speed test (spec §12 Q4).
  s.closesAt = now + mathAnswerMs(q.text);
  s.nextAt = s.closesAt + MATH_TAP_GRACE_MS + MATH_REVEAL_MS;
  s.taps = {};
  s.out = [];
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startMathOMatic(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** The host's lobby toggles, straight off the wire — sanitised here, never
   *  trusted (spec §3). */
  rawOptions: unknown,
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [MATH_MIN_PLAYERS, MATH_MAX_PLAYERS], solo)) return false;

  const lives: Record<PlayerId, number> = {};
  const scores: Record<PlayerId, number> = {};
  // Everybody starts on the board with their three lives showing rather than
  // appearing on their first tap — an empty scoreboard reads as broken.
  for (const id of connected) {
    lives[id] = MATH_LIVES;
    scores[id] = 0;
  }

  const s: MathOMatic = {
    roundId,
    index: 0,
    question: { text: '', answers: [], correct: 0 },
    phase: 'ask',
    closesAt: 0,
    nextAt: 0,
    lives,
    scores,
    taps: {},
    out: [],
    options: normaliseOptions(rawOptions),
    solo: solo || connected.length <= 1,
    winner: null,
    draw: false,
  };
  armQuestion(ctx, s, 0);

  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/**
 * One phone's answer to the question in flight (spec §6).
 *
 * Stored, never scored here — scoring happens once, for everybody, when the
 * window closes, so an answer that arrives early cannot be worth more than one
 * that arrives late.
 *
 * **The first tap is the answer.** Unlike Color Match, where the last pick
 * wins, a second tap on the same question is ignored: allowing changes would
 * let a fast phone try all four buttons and keep the one that scored.
 */
export async function onMathAnswer(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  index: number,
  choice: unknown,
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.phase !== 'ask' || s.index !== index) return;
  // Out of lives, or never in this round: no tap.
  if ((s.lives[playerId] ?? 0) <= 0) return;
  if (playerId in s.taps) return;
  if (ctx.now() > s.closesAt + MATH_TAP_GRACE_MS) return;

  // An index, and only one that names a button this question actually has
  // (spec §8) — a client cannot answer a question it was not shown.
  if (typeof choice !== 'number' || !Number.isInteger(choice)) return;
  if (choice < 0 || choice >= MATH_CHOICES || choice >= s.question.answers.length) return;

  s.taps[playerId] = choice;
  await ctx.save(s);
}

/**
 * The clock. Two things happen on it: the question closes and gets scored, and
 * the reveal finishes and the next question is dealt.
 *
 * Returns true when the round is over.
 */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase === 'done') return false;
  if (ctx.now() < nextDeadline(s)) return false;

  if (s.phase === 'ask') {
    score(s);
    s.phase = 'reveal';
    await ctx.save(s);
    broadcast(ctx, s);
    // Scored, shown, and then possibly over: the question that ended the round
    // is still revealed, because ending on a blank screen reads as a crash.
    await ctx.setAlarm(nextDeadline(s));
    return false;
  }

  // The reveal is over. Either the round ended on this question, or the next
  // one is dealt and the whole thing goes round again — no lobby in between,
  // the same shape Color Match's ladder uses.
  if (isOver(s)) {
    await finish(ctx, s);
    return true;
  }
  armQuestion(ctx, s, s.index + 1);
  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

/**
 * Score the question: a wrong tap **or no tap at all** costs a life, a right
 * one adds to the score (spec §2).
 *
 * Not tapping costing a life is deliberate and it is what stops a room from
 * stalling out: a player who never answers would otherwise outlive everyone
 * who tried.
 */
function score(s: MathOMatic): void {
  for (const id of alive(s)) {
    const tap = s.taps[id];
    if (tap === s.question.correct) {
      s.scores[id] = (s.scores[id] ?? 0) + 1;
      continue;
    }
    const left = (s.lives[id] ?? 0) - 1;
    s.lives[id] = Math.max(0, left);
    if (left <= 0) s.out.push(id);
  }
}

/** Is the round finished? Last player standing, everybody gone, or the cap. */
function isOver(s: MathOMatic): boolean {
  if (s.index + 1 >= MATH_QUESTION_CAP) return true;
  return lastStanding(alive(s).length, s.solo);
}

/**
 * A player vanished. Their lives and score stay on the board — Color Match's
 * own rule: removing them would rewrite a scoreboard the rest of the room is
 * still comparing itself to. They simply stop being able to answer, which
 * costs them a life per question until they are out.
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase === 'done') return;
  if (!(playerId in s.taps)) return;
  delete s.taps[playerId];
  await ctx.save(s);
}

/**
 * End the round.
 *
 * The last player with a life takes it. If the last lives in the room went on
 * the same question, the highest score among *those* players wins, and a tie
 * there is a draw that says so (spec §2) — a draw is a legitimate outcome, not
 * an error.
 */
async function finish(ctx: Ctx, s: MathOMatic): Promise<void> {
  const standing = alive(s);
  let winner: PlayerId | null = null;
  let draw = false;

  if (s.solo) {
    // Nobody to beat.
  } else if (standing.length === 1) {
    winner = standing[0] ?? null;
  } else {
    // Either the cap with several still alive, or everybody out at once. Both
    // are decided on score among whoever is left — and "whoever is left" is
    // everyone when the room emptied on one question.
    const contenders = standing.length > 0 ? standing : s.out;
    let best = -Infinity;
    for (const id of contenders) {
      const points = s.scores[id] ?? 0;
      if (points > best) {
        best = points;
        winner = id;
        draw = false;
      } else if (points === best) {
        draw = true;
      }
    }
    if (draw) winner = null;
  }

  s.phase = 'done';
  s.winner = winner;
  s.draw = draw;
  await ctx.save(s);
  broadcast(ctx, s);
}

/** The question as every phone needs it. */
export function toState(s: MathOMatic): MathState {
  const open = s.phase === 'ask';
  return {
    roundId: s.roundId,
    index: s.index,
    text: s.question.text,
    answers: [...s.question.answers],
    phase: s.phase,
    closesAt: s.closesAt,
    nextAt: s.nextAt,
    lives: { ...s.lives },
    scores: { ...s.scores },
    // Both withheld while the question is open (spec §8). `correct` is the
    // obvious one; `taps` matters just as much, because one good player's
    // choice is the answer to everybody watching the wire.
    taps: open ? {} : { ...s.taps },
    correct: open ? null : s.question.correct,
    out: open ? [] : [...s.out],
    winner: s.winner,
    draw: s.draw,
  };
}

function broadcast(ctx: Ctx, s: MathOMatic): void {
  ctx.broadcast({ t: 'math', s: ctx.nextSeq(), d: toState(s) });
}
