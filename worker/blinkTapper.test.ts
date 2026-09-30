import {
  BLINK_COUNTDOWN_MS,
  BLINK_MAX_PLAYERS,
  BLINK_MISS_LIMIT,
  BLINK_REPORT_GRACE_MS,
  BLINK_UNLIMITED_CAP_MS,
  type ServerMessage,
} from '../shared/protocol';
import { maxHits } from '../shared/blink';
import {
  nextDeadline,
  onBlinkFinal,
  onPlayerGone,
  startBlinkTapper,
  tick,
  toState,
  type BlinkTapper,
  type Ctx,
} from './blinkTapper';

/**
 * Blink Tapper's referee. Spec: docs/specs/games/blink-tapper.md §6-§8
 *
 * The round happens on the phones; what is asserted here is what this file
 * owns — the shared first blink, the bound on a report, the cap and the winner.
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

function harness() {
  let clock = 5_000_000;
  let seq = 0;
  let stored: BlinkTapper | null = null;
  const sent: ServerMessage[] = [];
  const ctx: Ctx = {
    now: () => clock,
    nextSeq: () => ++seq,
    broadcast: (m) => void sent.push(m),
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as BlinkTapper) : null),
    save: async (s) => {
      stored = JSON.parse(JSON.stringify(s)) as BlinkTapper;
    },
    setAlarm: async () => {},
  };
  return {
    ctx,
    sent,
    get now() {
      return clock;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    state: () => stored,
  };
}

async function starting(): Promise<void> {
  console.log('\nstarting a round (§2, §3)');
  const h = harness();
  const started = await startBlinkTapper(h.ctx, 1, [A, B], { lights: 3, duration: 30_000 });
  const s = h.state()!;
  check('two players start', started);
  check('the first blink is after the countdown', s.startsAt === h.now + BLINK_COUNTDOWN_MS);
  check('the host\'s options are kept', s.options.lights === 3 && s.options.duration === 30_000);
  check('nobody has reported yet', s.finals[A] === null && s.finals[B] === null);
  check('the cap is the round plus the grace', nextDeadline(s) === s.startsAt + 30_000 + BLINK_REPORT_GRACE_MS);
  check('the room was told', h.sent.some((m) => m.t === 'blink-tapper'));

  const odd = harness();
  await startBlinkTapper(odd.ctx, 1, [A, B], { lights: 9, duration: 12 });
  check('illegal options fall back to the defaults', odd.state()!.options.lights === 1 && odd.state()!.options.duration === 60_000);

  const open = harness();
  await startBlinkTapper(open.ctx, 1, [A, B], { lights: 1, duration: 0 });
  check('unlimited is capped for a phone that goes silent', nextDeadline(open.state()!) === open.state()!.startsAt + BLINK_UNLIMITED_CAP_MS + BLINK_REPORT_GRACE_MS);

  const alone = harness();
  check('one player alone is a round', await startBlinkTapper(alone.ctx, 1, [A], {}));
  check('and a solo one', alone.state()!.solo);
  const crowd = Array.from({ length: BLINK_MAX_PLAYERS + 1 }, (_, i) => `p${i}`);
  check('nine cannot start', !(await startBlinkTapper(harness().ctx, 1, crowd, {})));
}

async function reporting(): Promise<void> {
  console.log('\none report per phone, clamped rather than trusted (§6, §8)');
  const h = harness();
  await startBlinkTapper(h.ctx, 1, [A, B, C], { lights: 1, duration: 30_000 });
  h.advance(BLINK_COUNTDOWN_MS + 30_000);

  await onBlinkFinal(h.ctx, A, 1, 40, 12);
  check('a report is banked', JSON.stringify(h.state()!.finals[A]) === '{"hits":40,"misses":12,"score":28}');
  check('and the round waits for the others', h.state()!.phase === 'playing');

  await onBlinkFinal(h.ctx, A, 1, 400, 0);
  check('the first report is the one that counts', h.state()!.finals[A]!.hits === 40);

  await onBlinkFinal(h.ctx, B, 1, 1_000_000, 3);
  const bound = maxHits(30_000);
  check(`hits past the schedule are clamped to it (${h.state()!.finals[B]!.hits} = ${bound})`, h.state()!.finals[B]!.hits === bound);
  check('and the score follows the clamped hits', h.state()!.finals[B]!.score === bound - 3);

  await onBlinkFinal(h.ctx, C, 2, 5, 5);
  check('a stale round is ignored', h.state()!.finals[C] === null);
  await onBlinkFinal(h.ctx, 'stranger', 1, 5, 5);
  check('a stranger is ignored', !('stranger' in h.state()!.finals));

  await onBlinkFinal(h.ctx, C, 1, Number.NaN, -4);
  check('nonsense is zero, not a crash', JSON.stringify(h.state()!.finals[C]) === '{"hits":0,"misses":0,"score":0}');
  check('the last report ends the round', h.state()!.phase === 'done');
  check('highest net score wins', h.state()!.winner === B);

  const early = harness();
  await startBlinkTapper(early.ctx, 1, [A, B], { lights: 1, duration: 60_000 });
  early.advance(BLINK_COUNTDOWN_MS + 5000);
  await onBlinkFinal(early.ctx, A, 1, 500, 0);
  check('a report five seconds in cannot claim a minute of hits', early.state()!.finals[A]!.hits === maxHits(5000), early.state()!.finals[A]);
  early.advance(-60_000);
  await onBlinkFinal(early.ctx, B, 1, 3, 0);
  check('nor can one that arrives before the first blink', early.state()!.finals[B]!.hits === 0);

  const open = harness();
  await startBlinkTapper(open.ctx, 1, [A, B], { lights: 1, duration: 0 });
  open.advance(BLINK_COUNTDOWN_MS + 40_000);
  await onBlinkFinal(open.ctx, A, 1, 30, 25);
  check(`unlimited misses stop at ${BLINK_MISS_LIMIT}`, open.state()!.finals[A]!.misses === BLINK_MISS_LIMIT);
}

async function ending(): Promise<void> {
  console.log('\nhow a round ends (§7)');
  const h = harness();
  await startBlinkTapper(h.ctx, 1, [A, B], { lights: 1, duration: 30_000 });
  h.advance(BLINK_COUNTDOWN_MS + 30_000);
  await onBlinkFinal(h.ctx, A, 1, 10, 2);
  check('an early tick does nothing', !(await tick(h.ctx)));
  h.advance(BLINK_REPORT_GRACE_MS);
  check('the cap ends it', await tick(h.ctx));
  check('the silent phone is not ranked', h.state()!.finals[B] === null && h.state()!.winner === A);
  check('nextDeadline is never once done', nextDeadline(h.state()!) === Infinity);
  check('a report after the end is ignored', (await onBlinkFinal(h.ctx, B, 1, 99, 0), h.state()!.finals[B] === null));

  const left = harness();
  await startBlinkTapper(left.ctx, 1, [A, B], { lights: 2, duration: 60_000 });
  left.advance(BLINK_COUNTDOWN_MS + 60_000);
  await onBlinkFinal(left.ctx, A, 1, 3, 9);
  await onPlayerGone(left.ctx, B);
  check('a player leaving stops holding the room open', left.state()!.phase === 'done');
  check('and the one who reported wins, even below zero', left.state()!.winner === A && left.state()!.finals[A]!.score === -6);

  const kept = harness();
  await startBlinkTapper(kept.ctx, 1, [A, B, C], { lights: 1, duration: 30_000 });
  kept.advance(BLINK_COUNTDOWN_MS + 30_000);
  await onBlinkFinal(kept.ctx, A, 1, 20, 0);
  await onPlayerGone(kept.ctx, A);
  await onBlinkFinal(kept.ctx, B, 1, 5, 0);
  check('a reported score survives its player leaving', kept.state()!.phase === 'playing' && kept.state()!.finals[A]!.score === 20);
  await onBlinkFinal(kept.ctx, C, 1, 1, 0);
  check('and can still win', kept.state()!.winner === A);

  const tie = harness();
  await startBlinkTapper(tie.ctx, 1, [A, B], { lights: 1, duration: 30_000 });
  tie.advance(BLINK_COUNTDOWN_MS + 30_000);
  await onBlinkFinal(tie.ctx, A, 1, 12, 2);
  await onBlinkFinal(tie.ctx, B, 1, 15, 5);
  check('a tie at the top is unranked', tie.state()!.phase === 'done' && tie.state()!.winner === null);

  const solo = harness();
  await startBlinkTapper(solo.ctx, 1, [A], {}, true);
  solo.advance(BLINK_COUNTDOWN_MS + 60_000);
  await onBlinkFinal(solo.ctx, A, 1, 30, 1);
  check('solo ends on its one report, with no winner', solo.state()!.phase === 'done' && solo.state()!.winner === null);

  const nobody = harness();
  await startBlinkTapper(nobody.ctx, 1, [A, B], {});
  nobody.advance(BLINK_COUNTDOWN_MS + 60_000 + BLINK_REPORT_GRACE_MS);
  await tick(nobody.ctx);
  check('nobody reporting ends with no winner', nobody.state()!.phase === 'done' && nobody.state()!.winner === null);
}

async function wire(): Promise<void> {
  console.log('\nwhat the room sees (§6, §10)');
  const h = harness();
  await startBlinkTapper(h.ctx, 1, [A, B, C, 'p-d', 'p-e', 'p-f', 'p-g', 'p-h'], { lights: 4, duration: 100_000 });
  for (const id of Object.keys(h.state()!.finals)) {
    h.advance(1);
    await onBlinkFinal(h.ctx, id, 1, 1234, 567);
  }
  const bytes = JSON.stringify(toState(h.state()!)).length;
  check(`a full room's final frame is small (${bytes} bytes)`, bytes < 1024);
  check('the state carries three numbers per player and nothing else', Object.keys(toState(h.state()!).finals[A]!).sort().join() === 'hits,misses,score');
}

await starting();
await reporting();
await ending();
await wire();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
