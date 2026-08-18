import {
  BOMB_CLASSIC_ROUNDS,
  BOMB_DUEL_ROUNDS,
  BOMB_MAX_PLAYERS,
  BOMB_MIN_PLAYERS,
  type BombMatch,
  type ServerMessage,
} from '../shared/protocol';
import { onFuse, startBomb, type Ctx, type Bomb } from './passTheBomb';

/**
 * Pass the Bomb's start guard, and the match around the round. Same harness shape as
 * spill.test.ts — a fake `Ctx` with a clock we control (docs/testing.md §1.1).
 *
 * **The round itself is still uncovered.** The pairing window, the bump quota and the fuse
 * draw have no tests here, and this file is not pretending otherwise.
 *
 * What it does cover is the two things that are invisible from one round: a match has to
 * SURVIVE the round ending, because the referee's whole memory of it is the state saved by
 * the round just finished; and it has to end at the right moment, because the difference
 * between "next round" and "play again" on the end screen is this flag and nothing else.
 */

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

function harness() {
  let clock = 4_000_000;
  let seq = 0;
  let stored: Bomb | null = null;
  const sent: ServerMessage[] = [];

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    sendTo: (_id, m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as Bomb) : null),
    save: async (r) => {
      stored = JSON.parse(JSON.stringify(r)) as Bomb;
    },
    setAlarm: async () => {},
  };

  return {
    ctx,
    sent,
    saved: () => stored,
    /** The last frame of a kind, which is what a phone would be rendering. */
    last: <T extends ServerMessage['t']>(t: T) =>
      [...sent].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined,
    clear: () => void (sent.length = 0),
  };
}

/**
 * Blow the fuse until the round ends, and say who was left.
 *
 * A round with three or more players takes several booms to finish; a duel takes one. The
 * caller does not care which, only that a round was played.
 */
async function playRound(h: ReturnType<typeof harness>): Promise<BombMatch> {
  for (let i = 0; i < 20; i++) {
    if (await onFuse(h.ctx)) return h.last('boom')?.d.match as BombMatch;
  }
  throw new Error('a round that would not end');
}

/** `n` player ids. */
function players(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `p-${i}`);
}

async function startGuard(): Promise<void> {
  console.log('\nhow many players may start a bomb');

  // Below the floor: a two-player bomb is a duel, not a bomb.
  for (const n of [0, 1, BOMB_MIN_PLAYERS - 1]) {
    const h = harness();
    check(`${n} players cannot start`, (await startBomb(h.ctx, 1, players(n))) === false);
  }

  // Both ends of the range, and everything between, must start.
  for (let n = BOMB_MIN_PLAYERS; n <= BOMB_MAX_PLAYERS; n++) {
    const h = harness();
    check(`${n} players can start`, (await startBomb(h.ctx, 1, players(n))) === true);
  }

  // Above the ceiling. This is the case that was missing: the room admits up to
  // MAX_PLAYERS (10), so without a check here a card promising 3–8 was simply wrong.
  for (const n of [BOMB_MAX_PLAYERS + 1, 10]) {
    const h = harness();
    check(`${n} players cannot start`, (await startBomb(h.ctx, 1, players(n))) === false);
    check(`and ${n} players leaves no round behind`, h.saved() === null, h.saved());
    check(`and says nothing on the wire`, h.sent.length === 0, h.sent);
  }
}

async function startedRound(): Promise<void> {
  console.log('\na bomb that does start');

  const h = harness();
  await startBomb(h.ctx, 7, players(4));
  const r = h.saved();
  check('the round is saved', r !== null);
  check('with the round id it was given', r?.roundId === 7, r?.roundId);
  check('with everyone still alive', r?.alive.length === 4, r?.alive.length);
  check('the bomb is held by one of them', !!r && r.alive.includes(r.holder), {
    holder: r?.holder,
    alive: r?.alive,
  });
  check('and a fuse in the future', !!r && r.fuseAt > 4_000_000, r?.fuseAt);
  check('and something goes out to the room', h.sent.length > 0);
}

/**
 * Two players, three short rounds.
 *
 * The rule that makes this its own shape: with two people a boom leaves nobody to pass to,
 * so the round is already over the first time the fuse goes. Three of those, tallied like
 * any other round, decide the match — odd, so it cannot end tied.
 */
async function duel(): Promise<void> {
  console.log('\ntwo players play three short rounds');

  const h = harness();
  await startBomb(h.ctx, 1, ['p-0', 'p-1']);
  const opened = h.last('bomb')?.d.match;
  check(`it runs to ${BOMB_DUEL_ROUNDS} rounds`, opened?.rounds === BOMB_DUEL_ROUNDS, opened);

  const first = await playRound(h);
  const loser = h.last('boom')?.d.victim as string;
  const other = loser === 'p-0' ? 'p-1' : 'p-0';
  check('one boom is the whole round', h.last('boom')?.d.over === true, h.last('boom'));
  check('the survivor took the round', first.wins[other] === 1, first.wins);
  check('the loser stays in for the next one', first.wins[loser] === 0, first.wins);
  check('the match is not over', first.done === false, first);

  // The referee's only memory of the match is the round it saved, so continuing has to
  // survive a whole new `startBomb` — this is the assertion that catches a match reset.
  await startBomb(h.ctx, 2, ['p-1', 'p-0']);
  const second = h.last('bomb')?.d.match;
  check('the next round carries the standings', second?.wins[other] === 1, second?.wins);
  check('and counts up', second?.round === 2, second?.round);

  // Same player loses every round: three booms decide it outright.
  const h2 = harness();
  await startBomb(h2.ctx, 1, ['p-0', 'p-1']);
  let m: BombMatch = h2.last('bomb')?.d.match as BombMatch;
  let victim = '';
  for (let round = 1; round <= BOMB_DUEL_ROUNDS; round++) {
    // Force the same loser each time, so the match is decided rather than drawn.
    const bomb = h2.saved() as Bomb;
    if (victim === '') victim = bomb.holder;
    bomb.holder = victim;
    await h2.ctx.save(bomb);
    m = await playRound(h2);
    if (round < BOMB_DUEL_ROUNDS) {
      check(`after ${round} the match runs on`, m.done === false, m);
      await startBomb(h2.ctx, round + 1, ['p-0', 'p-1']);
    }
  }
  const winner = victim === 'p-0' ? 'p-1' : 'p-0';
  check(`${BOMB_DUEL_ROUNDS} rounds ends the match`, m.done === true, m);
  check('and whoever won them all takes it', m.champion === winner, m);
}

/**
 * Three or more: one round, played to a last player standing, and that round is the match.
 *
 * The rule that makes this its own shape: a boom eliminates for the rest of the match, not
 * just a trip round the circle, so a second round would only repeat a question the first one
 * already answered.
 */
async function eliminatesForTheMatch(): Promise<void> {
  console.log('\nthree or more play one round for the whole match');

  const h = harness();
  await startBomb(h.ctx, 1, players(4));
  const opened = h.last('bomb')?.d.match;
  check(`it runs to ${BOMB_CLASSIC_ROUNDS} round`, opened?.rounds === BOMB_CLASSIC_ROUNDS, opened);

  h.clear();
  await onFuse(h.ctx);
  const firstVictim = h.last('boom')?.d.victim;
  check('a boom with three left does not end the round', h.last('boom')?.d.over === false, h.last('boom'));
  check('and the round carries on to another bomb', h.last('bomb') !== undefined);
  check(
    "the player it cost does not come back for the next bomb",
    !h.last('bomb')?.d.alive.includes(firstVictim as string),
    h.last('bomb'),
  );

  const m = await playRound(h);
  check('the match ends with the round', m.done === true, m);
  check(
    'and the last one standing is the champion',
    m.champion !== null && m.wins[m.champion] === 1,
    m,
  );
}

/** A match belongs to the people who started it. */
async function newFaces(): Promise<void> {
  console.log('\nsomebody joins between rounds');

  const h = harness();
  await startBomb(h.ctx, 1, players(3));
  await playRound(h);
  await startBomb(h.ctx, 2, players(4));
  const m = h.last('bomb')?.d.match;
  check('the standings start again', m?.round === 1, m);
  check('with nobody carrying a round they were not there for',
    Object.values(m?.wins ?? {}).every((w) => w === 0), m?.wins);
}

for (const t of [startGuard, startedRound, duel, eliminatesForTheMatch, newFaces]) {
  await t();
}

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
