import { BUMP_RELAY_MAX_PLAYERS, BUMP_RELAY_MIN_PLAYERS, type ServerMessage } from '../shared/protocol';
import { startRelay, type Ctx, type Relay } from './bumpRelay';

/**
 * Bump Relay's start guard. Same harness shape as spill.test.ts — a fake `Ctx` with a
 * clock we control (docs/testing.md §1.1).
 *
 * **This covers the guard only.** The rest of `bumpRelay.ts` — the pairing window, the
 * bump quota, the fuse — has no tests, and this file is not pretending otherwise. It
 * exists because the maximum was missing: the card promised 3–8 players and the referee
 * checked only the minimum, so a ninth and tenth could join and start. A limit nothing
 * asserts is a limit that comes back.
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
  let stored: Relay | null = null;
  const sent: ServerMessage[] = [];

  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    sendTo: (_id, m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as Relay) : null),
    save: async (r) => {
      stored = JSON.parse(JSON.stringify(r)) as Relay;
    },
    setAlarm: async () => {},
  };

  return { ctx, sent, saved: () => stored };
}

/** `n` player ids. */
function players(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `p-${i}`);
}

async function startGuard(): Promise<void> {
  console.log('\nhow many players may start a relay');

  // Below the floor: a two-player relay is a duel, not a relay.
  for (const n of [0, 1, BUMP_RELAY_MIN_PLAYERS - 1]) {
    const h = harness();
    check(`${n} players cannot start`, (await startRelay(h.ctx, 1, players(n))) === false);
  }

  // Both ends of the range, and everything between, must start.
  for (let n = BUMP_RELAY_MIN_PLAYERS; n <= BUMP_RELAY_MAX_PLAYERS; n++) {
    const h = harness();
    check(`${n} players can start`, (await startRelay(h.ctx, 1, players(n))) === true);
  }

  // Above the ceiling. This is the case that was missing: the room admits up to
  // MAX_PLAYERS (10), so without a check here a card promising 3–8 was simply wrong.
  for (const n of [BUMP_RELAY_MAX_PLAYERS + 1, 10]) {
    const h = harness();
    check(`${n} players cannot start`, (await startRelay(h.ctx, 1, players(n))) === false);
    check(`and ${n} players leaves no round behind`, h.saved() === null, h.saved());
    check(`and says nothing on the wire`, h.sent.length === 0, h.sent);
  }
}

async function startedRound(): Promise<void> {
  console.log('\na relay that does start');

  const h = harness();
  await startRelay(h.ctx, 7, players(4));
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

for (const t of [startGuard, startedRound]) {
  await t();
}

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
