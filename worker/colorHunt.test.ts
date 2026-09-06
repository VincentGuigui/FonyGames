import {
  nextDeadline,
  onHuntFind,
  onPlayerGone,
  startColorHunt,
  tick,
  toState,
  type ColorHunt,
  type Ctx,
} from './colorHunt';
import { COLOR_HUNT_ACTION_MS, type PlayerId, type ServerMessage } from '../shared/protocol';
import { COLOR_BARREN_ROUNDS, COLOR_PICK_GRACE_MS, HUNT_TARGETS, huntColor } from '../shared/color';

/**
 * Color Hunt's referee.
 * Spec: docs/specs/games/color-hunt.md
 *
 * Color Match's referee with the reveal phase removed, so what is worth
 * proving separately is exactly the part that differs: a scored round is
 * replaced by the next target in the same instant with no phase in between,
 * the target never repeats back to back, and the ladder strip can still show
 * what just happened even though nothing paused to show it.
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

function harness(at = 1_000_000) {
  let now = at;
  let seq = 0;
  let stored: ColorHunt | null = null;
  const sent: ServerMessage[] = [];
  let alarm = 0;
  let rand = 0.5;

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
    random: () => rand,
  };

  return {
    ctx,
    sent,
    get state(): ColorHunt {
      if (!stored) throw new Error('no state');
      return stored;
    },
    get alarm(): number {
      return alarm;
    },
    advance: (ms: number) => {
      now += ms;
    },
    seed: (v: number) => {
      rand = v;
    },
    step: async (): Promise<boolean> => {
      now = Math.max(now, nextDeadline(stored!));
      return tick(ctx);
    },
  };
}

async function starting(): Promise<void> {
  console.log('\nstarting a hunt');

  const h = harness();
  check('a two-player room starts', await startColorHunt(h.ctx, 1, [A, B]));
  check('at round 1', h.state.round === 1);
  check('everyone on the board at zero', h.state.totals[A] === 0 && h.state.totals[B] === 0);
  check('hunting is open', h.state.phase === 'hunt');
  check('the target is one of the six', HUNT_TARGETS.some((t) => t.key === h.state.targetKey), h.state.targetKey);

  // Not a pure hue: a room does not contain a 255,0,0 (spec §2.2).
  check('and it is a findable colour, not a pure one', h.state.target.every((v) => v <= 204), h.state.target);
  check('the round has the spec\'s six seconds', h.state.dueAt === h.state.startsAt + COLOR_HUNT_ACTION_MS);

  const alone = harness();
  check('one player alone cannot hunt', !(await startColorHunt(alone.ctx, 1, [A])));
  check('unless solo testing is on', await startColorHunt(alone.ctx, 1, [A], true));
}

async function scoring(): Promise<void> {
  console.log('\nscoring, and the next target in the same instant (§2)');

  const h = harness();
  await startColorHunt(h.ctx, 1, [A, B]);
  const target = h.state.target;
  const wasKey = h.state.targetKey;

  await onHuntFind(h.ctx, A, 1, 1, [...target], 0);
  await onHuntFind(h.ctx, B, 1, 1, [10, 10, 10], 0);
  check('nothing is scored while the window is open', (h.state.finds[A]?.score ?? 0) === 0);
  check('and no find is on the wire', Object.keys(toState(h.state).finds).length === 0);

  await h.step();
  check('an exact read is worth 100', h.state.totals[A] === 100, h.state.totals);
  check('near-black against a bright target is worth nothing', h.state.totals[B] === 0, h.state.totals);
  check('there is no reveal phase to wait through', h.state.phase === 'hunt');
  check('the next round is already up', h.state.round === 2);
  check('with a different target', h.state.targetKey !== wasKey, { was: wasKey, now: h.state.targetKey });
  check('and the previous round\'s finds still on the wire for the ladder', Object.keys(toState(h.state).finds).length === 2);
  check('nobody\'s find for the round in flight, though', h.state.finds[A] === undefined);
}

async function neverRepeats(): Promise<void> {
  console.log('\nthe same colour never comes up twice at all (§2.2)');

  const h = harness();
  await startColorHunt(h.ctx, 1, [A, B]);
  let previous = h.state.targetKey;
  let repeats = 0;
  for (let n = 0; n < 12; n++) {
    // Vary the source so the pick actually moves around the pool.
    h.seed((n * 0.137 + 0.05) % 1);
    await h.step();
    if (h.state.phase === 'done') break;
    if (h.state.targetKey === previous) repeats++;
    previous = h.state.targetKey;
  }
  check('no back-to-back repeat over a dozen rounds', repeats === 0, repeats);
}

async function sixAndDone(): Promise<void> {
  console.log('\nsix colours, six rounds, and then it is over (§2.2)');

  const h = harness();
  await startColorHunt(h.ctx, 1, [A, B]);
  const seen: string[] = [h.state.targetKey];
  let rounds = 1;
  for (let n = 0; n < 10; n++) {
    // Score every round so the barren rule is not what ends it.
    await onHuntFind(h.ctx, A, 1, h.state.round, [...h.state.target], 0);
    h.seed((n * 0.19 + 0.04) % 1);
    const over = await h.step();
    if (over) break;
    seen.push(h.state.targetKey);
    rounds += 1;
  }
  check('a hunt is six rounds long', rounds === 6, rounds);
  check('all six colours, each exactly once', new Set(seen).size === 6, seen);
  check('and then it ends on its own, still scoring', h.state.phase === 'done');
  check('with a winner, not a washout', h.state.winner === A, { winner: h.state.winner, totals: h.state.totals });
  check('the round window is the spec\'s fifteen seconds', COLOR_HUNT_ACTION_MS === 15000, COLOR_HUNT_ACTION_MS);
}

async function barren(): Promise<void> {
  console.log('\nthree scoreless rounds ends the hunt (§2.1)');

  const h = harness();
  await startColorHunt(h.ctx, 1, [A, B]);

  for (let n = 1; n < COLOR_BARREN_ROUNDS; n++) {
    await h.step();
    check(`round ${n} scored nothing, streak ${n}`, h.state.barren === n, h.state.barren);
    check('  and the hunt continues', h.state.phase === 'hunt');
  }
  const over = await h.step();
  check('the third one ends it', over && h.state.phase === 'done');
  check('nobody scored, so nobody wins', h.state.winner === null);

  // One player scoring keeps everyone in.
  const k = harness();
  await startColorHunt(k.ctx, 1, [A, B]);
  await k.step();
  await k.step();
  check('two blanks do not end it', k.state.phase === 'hunt' && k.state.barren === 2, k.state.barren);
  await onHuntFind(k.ctx, A, 1, k.state.round, [...k.state.target], 0);
  await k.step();
  check('and one find resets the streak for the room', k.state.barren === 0);
  check('the hunt is still going', k.state.phase === 'hunt');
}

async function winning(): Promise<void> {
  console.log('\nwho wins');

  const h = harness();
  await startColorHunt(h.ctx, 1, [A, B]);
  await onHuntFind(h.ctx, A, 1, 1, [...h.state.target], 0);
  await h.step();
  for (let n = 0; n < COLOR_BARREN_ROUNDS; n++) await h.step();
  check('the hunt ended on the barren streak', h.state.phase === 'done');
  check('and the highest total took it', h.state.winner === A, { winner: h.state.winner, totals: h.state.totals });

  const t = harness();
  await startColorHunt(t.ctx, 1, [A, B]);
  await onHuntFind(t.ctx, A, 1, 1, [...t.state.target], 0);
  await onHuntFind(t.ctx, B, 1, 1, [...t.state.target], 0);
  await t.step();
  for (let n = 0; n < COLOR_BARREN_ROUNDS; n++) await t.step();
  check('a dead heat is unranked', t.state.phase === 'done' && t.state.winner === null, t.state.totals);
}

async function refusing(): Promise<void> {
  console.log('\nwhat the referee refuses (§8)');

  const h = harness();
  await startColorHunt(h.ctx, 1, [A, B]);
  const target = h.state.target;

  await onHuntFind(h.ctx, A, 2, 1, [...target], 0);
  check('a find for the wrong round id is dropped', h.state.finds[A] === undefined);
  await onHuntFind(h.ctx, A, 1, 7, [...target], 0);
  check('a find for a round not in flight is dropped', h.state.finds[A] === undefined);
  await onHuntFind(h.ctx, 'ghost' as PlayerId, 1, 1, [...target], 0);
  check('a find from outside the room is dropped', h.state.finds['ghost' as PlayerId] === undefined);
  await onHuntFind(h.ctx, A, 1, 1, { r: 1 }, 0);
  check('a find that is not a colour is dropped', h.state.finds[A] === undefined);

  h.advance(COLOR_HUNT_ACTION_MS + COLOR_PICK_GRACE_MS - 20);
  await onHuntFind(h.ctx, A, 1, 1, [...target], 0);
  check('one inside the grace still lands', h.state.finds[A] !== undefined);

  const l = harness();
  await startColorHunt(l.ctx, 1, [A, B]);
  l.advance(COLOR_HUNT_ACTION_MS + COLOR_PICK_GRACE_MS + 20);
  await onHuntFind(l.ctx, A, 1, 1, [...l.state.target], 0);
  check('one past it does not', l.state.finds[A] === undefined);
}

async function privacy(): Promise<void> {
  console.log('\nno pixel is ever on this wire (§10)');

  const h = harness();
  await startColorHunt(h.ctx, 1, [A, B]);
  await onHuntFind(h.ctx, A, 1, 1, [...h.state.target], 0);
  await h.step();

  const state = toState(h.state);
  const wire = JSON.stringify(state);
  check('a find is three integers and a score, nothing else', (() => {
    const f = state.finds[A];
    return !!f && f.rgb.length === 3 && typeof f.score === 'number' && Object.keys(f).length === 2;
  })(), state.finds[A]);
  // A whole round's broadcast, for eight players, is a few hundred bytes.
  check('and a whole round\'s state is tiny', wire.length < 1024, wire.length);
  check('the target name goes out as a word for the band', HUNT_TARGETS.some((t) => t.key === state.name), state.name);
}

async function leaving(): Promise<void> {
  console.log('\nsomebody leaves');

  const h = harness();
  await startColorHunt(h.ctx, 1, [A, B]);
  await onHuntFind(h.ctx, A, 1, 1, [...h.state.target], 0);
  await h.step();
  await onPlayerGone(h.ctx, A);
  check('their total stays on the board', h.state.totals[A] === 100, h.state.totals);
  check('and the hunt carries on', h.state.phase === 'hunt');
}

async function targets(): Promise<void> {
  console.log('\nthe six targets, as the referee deals them');

  const seen = new Set<string>();
  for (let s = 0; s < 30; s++) {
    const h = harness();
    h.seed((s * 0.0331 + 0.001) % 1);
    await startColorHunt(h.ctx, 1, [A, B]);
    seen.add(h.state.targetKey);
    check(`  deal ${s} is a real target`, HUNT_TARGETS.some((t) => JSON.stringify(huntColor(t)) === JSON.stringify(h.state.target)));
    if (seen.size === HUNT_TARGETS.length) break;
  }
  check('all six can come up', seen.size === HUNT_TARGETS.length, [...seen]);
}

async function main(): Promise<void> {
  await starting();
  await scoring();
  await neverRepeats();
  await sixAndDone();
  await barren();
  await winning();
  await refusing();
  await privacy();
  await leaving();
  await targets();

  if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
  console.log(`\nall passed (${checks} checks)`);
}

await main();
