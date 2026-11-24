import {
  TENT_COUNTDOWN_MS,
  TENT_MAX_GRABS_PER_S,
  TENT_REPORT_GRACE_MS,
  TENT_SQUAT_MS,
  TENT_SUMMIT_CAP_MS,
  TENT_SUMMIT_M,
  TENT_TRIAL_MS,
  type ServerMessage,
} from '../shared/protocol';
import { REACH, START_BODY, bodyOf, canGrab, dist, heightOf, pegsBetween, place, startPegs, type Peg, type Point } from '../shared/tentacules';
import { nextDeadline, onGrab, onLetGo, onPlayerGone, onReset, startTentacules, tick, toState, type Ctx, type Tentacules } from './tentacules';

/**
 * Tentacules' referee. Spec: docs/specs/games/tentacules.md §6–§8
 *
 * What this file owns: who holds which peg, what it believes of a grab, every
 * height, the clock and the winner.
 */

let failures = 0;
let checks = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  checks++;
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

const A = 'p-a';
const B = 'p-b';
const C = 'p-c';

function harness(randoms: number[] = [0.3]) {
  let clock = 5_000_000;
  let seq = 0;
  let r = 0;
  let stored: Tentacules | null = null;
  const sent: ServerMessage[] = [];
  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as Tentacules) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as Tentacules;
    },
    setAlarm: async () => {},
    random: () => randoms[r++ % randoms.length] as number,
  };
  return {
    ctx,
    sent,
    advance: (ms: number) => {
      clock += ms;
    },
    get now() {
      return clock;
    },
    state: () => stored as Tentacules,
  };
}
type H = ReturnType<typeof harness>;

const fresh = async (ids = [A, B], options: object = {}) => {
  const h = harness();
  await startTentacules(h.ctx, 1, ids, options);
  h.advance(TENT_COUNTDOWN_MS + 1000);
  return h;
};

/** The pegs a player holds, as pegs. */
function held(h: H, who: string): Peg[] {
  const s = h.state();
  return (s.players[who]?.holds ?? []).flatMap((id) => {
    if (id === null) return [];
    const p = id < 0 ? startPegs().find((q) => q.id === id) : pegsBetween(s.seed, 0, 40).find((q) => q.id === id);
    return p ? [p] : [];
  });
}

/** A free shared peg this player's arm `arm` can legally move to, highest first. */
function nextPeg(h: H, who: string, arm: number, taken: readonly number[] = []): Peg | null {
  const s = h.state();
  const holds = s.players[who]?.holds ?? [];
  const others = holds.filter((_, i) => i !== arm).flatMap((id) => (id === null ? [] : [id]));
  const otherPegs = held(h, who).filter((p) => others.includes(p.id));
  const body = place(otherPegs) as Point;
  const options = pegsBetween(s.seed, body.y - 1, body.y + 1)
    .filter((p) => !taken.includes(p.id) && !holds.includes(p.id) && canGrab(otherPegs, p, null))
    .sort((a, b) => b.y - a.y);
  return options[0] ?? null;
}

async function starting(): Promise<void> {
  console.log('\nstarting a round (§2, §3)');
  const h = harness();
  await startTentacules(h.ctx, 1, [A, B], {});
  const s = toState(h.state());
  check('nothing chosen is Time trial', s.mode === 'trial');
  check('every octopus starts on its own five starting pegs', Object.values(s.players).every((p) => p.holds.join() === '-1,-2,-3,-4,-5'));
  check('at height 0', Object.values(s.players).every((p) => p.best === 0));
  check('Time trial ends after a minute', nextDeadline(h.state()) === h.state().startsAt + TENT_TRIAL_MS + TENT_REPORT_GRACE_MS);
  const sm = harness();
  await startTentacules(sm.ctx, 1, [A], { mode: 'summit' }, true);
  check('Summit is capped at two minutes', sm.state().mode === 'summit' && nextDeadline(sm.state()) === sm.state().startsAt + TENT_SUMMIT_CAP_MS + TENT_REPORT_GRACE_MS);
  check('one player starts only in solo', !(await startTentacules(harness().ctx, 1, [], {})));
}

async function grabbing(): Promise<void> {
  console.log('\nwhat a grab is believed (§8)');
  const h = await fresh();
  const p = nextPeg(h, A, 4) as Peg;
  check('the test finds a peg in reach', p !== null);
  const early = harness();
  await startTentacules(early.ctx, 1, [A, B], {});
  await onGrab(early.ctx, A, 1, 4, p.id);
  check('nothing is grabbed during the countdown', early.state().players[A]?.holds[4] === -5);

  await onGrab(h.ctx, A, 1, 4, p.id);
  check('a peg in reach is held', h.state().players[A]?.holds[4] === p.id);
  const body = bodyOf(h.state().seed, h.state().players[A]?.holds ?? []) as Point;
  check('the height is the referee\'s, from the holds', Math.abs((h.state().players[A]?.best ?? 0) - heightOf(body.y)) < 1e-9 && body.y > START_BODY.y);
  check('and so is when it was reached', h.state().players[A]?.bestAt === 1000);

  const far = pegsBetween(h.state().seed, 3, 5)[0] as Peg;
  await onGrab(h.ctx, A, 1, 3, far.id);
  check('a peg out of reach is refused', h.state().players[A]?.holds[3] === -4);
  await onGrab(h.ctx, A, 1, 3, 999_999);
  check('so is a peg that does not exist', h.state().players[A]?.holds[3] === -4);
  await onGrab(h.ctx, A, 1, 7, p.id);
  check('and an arm that does not exist', h.state().players[A]?.holds.length === 5);
  await onGrab(h.ctx, A, 1, 2, p.id);
  check('one peg holds one tentacle, even of the same octopus', h.state().players[A]?.holds[2] === -3);

  await onGrab(h.ctx, B, 1, 4, p.id);
  check('a peg another player holds is refused', h.state().players[B]?.holds[4] === -5 && h.state().players[A]?.holds[4] === p.id);
  h.advance(TENT_SQUAT_MS);
  await onGrab(h.ctx, B, 1, 4, p.id);
  check(`held ${TENT_SQUAT_MS / 1000} s, it can be taken over`, h.state().players[B]?.holds[4] === p.id);
  check('and the holder\'s tentacle is knocked off', h.state().players[A]?.holds[4] === null);
  check('starting pegs are each player\'s own: both hold −1', h.state().players[A]?.holds[0] === -1 && h.state().players[B]?.holds[0] === -1);

  const spam = await fresh([A]);
  let grabs = 0;
  for (let i = 0; i < 20; i++) {
    const arm = i % 5;
    const q = nextPeg(spam, A, arm);
    if (!q) continue;
    await onGrab(spam.ctx, A, 1, arm, q.id);
    if (spam.state().players[A]?.holds[arm] === q.id) grabs++;
  }
  check(`no more than ${TENT_MAX_GRABS_PER_S} grabs a second`, grabs <= TENT_MAX_GRABS_PER_S, grabs);
}

async function letting(): Promise<void> {
  console.log('\nletting go, falling, starting again (§2.3)');
  const h = await fresh();
  const s0 = h.state();
  await onLetGo(h.ctx, A, 1, [0, 1, 2]);
  check('tentacles let go', h.state().players[A]?.holds.join() === ',,,-4,-5');
  await onLetGo(h.ctx, A, 1, [3, 4, 9, 'x']);
  check('all of them: it holds nothing, and junk arms are ignored', h.state().players[A]?.holds.every((x) => x === null) === true);
  const low = startPegs()[3] as Peg;
  await onGrab(h.ctx, A, 1, 0, low.id);
  check('holding nothing, it can catch a peg below where it was', h.state().players[A]?.holds[0] === low.id);
  await onLetGo(h.ctx, A, 1, [0]);
  const high = pegsBetween(s0.seed, 4, 5)[0] as Peg;
  await onGrab(h.ctx, A, 1, 0, high.id);
  check('but not one higher than a leap from there', h.state().players[A]?.holds[0] === null);
  await onReset(h.ctx, A, 1);
  check('a reset puts it back on its starting pegs', h.state().players[A]?.holds.join() === '-1,-2,-3,-4,-5');
}

async function climbing(): Promise<void> {
  console.log('\nclimbing, and the modes (§3)');
  const h = await fresh([A, B, C]);
  // A climbs a few moves; B a few fewer; C stays.
  for (const [who, n] of [[A, 12], [B, 6]] as const) {
    for (let i = 0; i < n; i++) {
      const holds = h.state().players[who]?.holds ?? [];
      const lowest = holds.map((id, arm) => ({ arm, y: held(h, who).find((p) => p.id === id)?.y ?? -1 })).sort((a, b) => a.y - b.y)[0];
      const q = nextPeg(h, who, lowest?.arm ?? 0);
      if (q) await onGrab(h.ctx, who, 1, lowest?.arm ?? 0, q.id);
      h.advance(300);
    }
  }
  const a = h.state().players[A]?.best ?? 0;
  const b = h.state().players[B]?.best ?? 0;
  check(`moving tentacles up raises the body (${a.toFixed(2)} m, ${b.toFixed(2)} m)`, a > b && b > 0);
  await onLetGo(h.ctx, A, 1, [0, 1, 2, 3, 4]);
  check('a fall does not take the best away', h.state().players[A]?.best === a);
  h.advance(TENT_TRIAL_MS);
  await tick(h.ctx);
  check('at the bell, the highest point reached wins', h.state().phase === 'done' && h.state().winner === A);

  const tie = await fresh([A, B]);
  const q = nextPeg(tie, B, 4) as Peg;
  await onGrab(tie.ctx, B, 1, 4, q.id);
  tie.advance(500);
  const q2 = nextPeg(tie, A, 4, [q.id]);
  // Same height for both is unlikely by chance; set it directly to test the rule.
  const st = tie.state();
  (st.players[A] as { best: number; bestAt: number }).best = st.players[B]?.best ?? 0;
  (st.players[A] as { best: number; bestAt: number }).bestAt = (st.players[B]?.bestAt ?? 0) + 500;
  await tie.ctx.save(st);
  tie.advance(TENT_TRIAL_MS + TENT_REPORT_GRACE_MS);
  await tick(tie.ctx);
  check('same height: whoever got there first', tie.state().winner === B && q2 !== undefined);

  const sum = harness();
  await startTentacules(sum.ctx, 1, [A, B], { mode: 'summit' });
  sum.advance(TENT_COUNTDOWN_MS + 1000);
  const ss = sum.state();
  // Hang A on two pegs just under the line, one grab short of it.
  // On a wall whose line does not fall in a gap — the seed is the wall, so try a few.
  const line = START_BODY.y + TENT_SUMMIT_M;
  let setup: { below: Peg[]; up: Peg } | null = null;
  for (let seed = 1; seed < 40 && !setup; seed++) {
    const near = pegsBetween(seed, line - 1.2, line + 0.8);
    for (const p1 of near) for (const p2 of near) {
      if (setup || p1.id >= p2.id) continue;
      const pair = [p1, p2];
      const body = place(pair);
      if (!body || heightOf(body.y) >= TENT_SUMMIT_M) continue;
      const up = near.find((u) => u.id !== p1.id && u.id !== p2.id && canGrab(pair, u, null) && heightOf((place([...pair, u]) as Point).y) >= TENT_SUMMIT_M);
      if (up) {
        setup = { below: pair, up };
        ss.seed = seed;
      }
    }
  }
  const below = setup?.below ?? [];
  (ss.players[A] as { holds: (number | null)[] }).holds = [below[0]?.id ?? null, below[1]?.id ?? null, null, null, null];
  (ss.players[A] as { lastBody: Point }).lastBody = (place(below) ?? START_BODY) as Point;
  await sum.ctx.save(ss);
  if (setup) await onGrab(sum.ctx, A, 1, 2, setup.up.id);
  const reached = setup !== null;
  check('the test reaches the line', reached);
  check('Summit: the first grab that puts the body on the line wins outright', sum.state().phase === 'done' && sum.state().winner === A && sum.state().players[A]?.finishedMs !== undefined);
}

async function leaving(): Promise<void> {
  console.log('\nleaving (§7)');
  const h = await fresh([A, B]);
  const p = nextPeg(h, A, 4) as Peg;
  await onGrab(h.ctx, A, 1, 4, p.id);
  await onPlayerGone(h.ctx, A);
  check('a player who leaves frees their pegs at once', h.state().players[A]?.holds.every((x) => x === null) === true);
  check('and their best stands', (h.state().players[A]?.best ?? 0) > 0);
  await onGrab(h.ctx, B, 1, 4, p.id);
  check('so someone else can take the peg straight away', h.state().players[B]?.holds[4] === p.id);
  await onPlayerGone(h.ctx, B);
  check('everyone gone ends the round', h.state().phase === 'done');
}

async function wire(): Promise<void> {
  console.log('\nwhat the room sees (§6)');
  const h = await fresh(Array.from({ length: 8 }, (_, i) => `player-${i}`));
  const bytes = JSON.stringify(toState(h.state())).length;
  check(`a full room's frame is small (${bytes} bytes)`, bytes < 2000);
  check('no position or pose travels: holds only', Object.keys(toState(h.state()).players['player-0'] ?? {}).sort().join() === 'best,bestAt,holds,since');
  check('reach is the shared one', REACH > 0 && dist(START_BODY, START_BODY) === 0);
}

await starting();
await grabbing();
await letting();
await climbing();
await leaving();
await wire();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
