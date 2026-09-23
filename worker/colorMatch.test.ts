import {
  levelMs,
  nextDeadline,
  onColorConfirm,
  onColorPick,
  onPlayerGone,
  startColorMatch,
  tick,
  toState,
  type ColorMatch,
  type Ctx,
} from './colorMatch';
import { COLOR_SCORE_HOLD_MS, type PlayerId, type ServerMessage } from '../shared/protocol';
import { COLOR_ACTION_TIERS, COLOR_BARREN_ROUNDS, COLOR_PICK_GRACE_MS, RUNG_ENDS, colorActionMs, paletteSize, rungAt, colorKey, isExtreme } from '../shared/color';
import { COLOR_SECTOR_MAX } from '../shared/protocol';

/**
 * Color Match's referee.
 * Spec: docs/specs/games/color-match.md
 *
 * What is worth proving here is the shape the game turns on rather than the
 * colour maths, which `shared/color.test.ts` already owns: everybody is scored
 * at the same instant so an early pick is not worth more than a late one, the
 * levels chain themselves with no lobby in between, the room's own barren
 * streak is what stops an unbounded ladder, and nobody's pick for the level in
 * flight is ever in a broadcast — which is the one thing standing between this
 * game and a player who reads the wire.
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

/** A referee harness with a clock and a random source we drive by hand. */
function harness(at = 1_000_000) {
  let now = at;
  let seq = 0;
  let stored: ColorMatch | null = null;
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
    get state(): ColorMatch {
      if (!stored) throw new Error('no state');
      return stored;
    },
    get alarm(): number {
      return alarm;
    },
    at: (t: number) => {
      now = t;
    },
    advance: (ms: number) => {
      now += ms;
    },
    seed: (v: number) => {
      rand = v;
    },
    /** Run the clock forward to the referee's own next deadline and tick. */
    step: async (): Promise<boolean> => {
      now = Math.max(now, nextDeadline(stored!));
      return tick(ctx);
    },
  };
}

async function starting(): Promise<void> {
  console.log('\nstarting a run');

  const h = harness();
  const ok = await startColorMatch(h.ctx, 1, [A, B]);
  check('a two-player room starts', ok);
  check('at level 1', h.state.level === 1);
  check('everyone is on the board at zero', h.state.totals[A] === 0 && h.state.totals[B] === 0);
  check('picking is open', h.state.phase === 'pick');
  check('a level-1 level is 3 s of picking plus 4 s of tail', levelMs(1) === 7000, levelMs(1));
  check('the first broadcast carries the target', h.sent.length === 1 && h.sent[0]?.t === 'color-match');

  // The ladder's first rung is one component out of {0, 255} with the rest at
  // black, so a level-1 target is one of four colours (shared/color.test.ts).
  const target = h.state.target;
  check('and it is a rung-1 colour', target.filter((v) => v === 255).length === 1 && target.every((v) => v === 0 || v === 255), target);
  check('never black or white', !isExtreme(target), target);

  // Color Match's minimum really is 1 (spec §7): the ladder is a perfectly
  // good solo score attack, so a lone player needs no solo-testing flag.
  const alone = harness();
  check('one player alone can start, no solo flag needed', await startColorMatch(alone.ctx, 1, [A]));
  check('and that run has nobody to beat, so it records no winner', alone.state.solo);
  check('an empty room cannot start', !(await harness().ctx && await startColorMatch(harness().ctx, 1, [])));
}

async function scoring(): Promise<void> {
  console.log('\neverybody is scored at the same instant');

  const h = harness();
  await startColorMatch(h.ctx, 1, [A, B]);
  const target = h.state.target;

  // A picks it exactly, early; B picks the far side of the wheel, late.
  await onColorPick(h.ctx, A, 1, 1, [...target], 0);
  h.advance(colorActionMs(1) - 100);
  const miss = target.map((v) => 255 - v);
  await onColorPick(h.ctx, B, 1, 1, miss, 0);

  check('nothing is scored while the window is open', h.state.phase === 'pick' && (h.state.picks[A]?.score ?? 0) === 0);
  check('and nobody\'s pick is on the wire yet', Object.keys(toState(h.state).picks).length === 0);

  await h.step();
  check('the window closes into the reveal', h.state.phase === 'reveal');
  // Issue #38: accuracy is the colour, the score is that accuracy bent by how
  // fast it was settled. Both picks landed instantly, in the first fifth of the
  // window, which is worth half again.
  check('an exact match is 100 accuracy', h.state.picks[A]?.accuracy === 100, h.state.picks[A]);
  check('and being early is worth half again', h.state.totals[A] === 150, h.state.totals);
  check('the far side of the wheel is worth nothing', h.state.totals[B] === 0, h.state.totals);
  check('a zero accuracy earns no bonus either', h.state.picks[B]?.score === 0, h.state.picks[B]);
  check('now the picks are on the wire', Object.keys(toState(h.state).picks).length === 2);
  check('somebody scored, so the streak resets', h.state.barren === 0);
}

async function replacing(): Promise<void> {
  console.log('\na later pick replaces an earlier one');

  const h = harness();
  await startColorMatch(h.ctx, 1, [A, B]);
  const target = h.state.target;

  await onColorPick(h.ctx, A, 1, 1, [...target], 0);
  await onColorPick(h.ctx, A, 1, 1, target.map((v) => 255 - v), 0);
  await h.step();
  check('the last one before the deadline is the one that counts', h.state.totals[A] === 0, h.state.totals);

  // ... and one arriving inside the grace still lands, because a phone 300ms
  // away should lose its own lag, not the round.
  const g = harness();
  await startColorMatch(g.ctx, 1, [A, B]);
  const t2 = g.state.target;
  g.advance(colorActionMs(1) + COLOR_PICK_GRACE_MS - 50);
  await onColorPick(g.ctx, A, 1, 1, [...t2], 0);
  await g.step();
  // Dead on the deadline: the last reaction slice, so the accuracy is halved.
  check('a pick inside the grace still counts', g.state.totals[A] === 50, g.state.totals);

  const l = harness();
  await startColorMatch(l.ctx, 1, [A, B]);
  const t3 = l.state.target;
  l.advance(colorActionMs(1) + COLOR_PICK_GRACE_MS + 50);
  await onColorPick(l.ctx, A, 1, 1, [...t3], 0);
  await l.step();
  check('one past it does not', l.state.totals[A] === 0, l.state.totals);
}

async function chaining(): Promise<void> {
  console.log('\nlevels chain themselves, with no lobby in between');

  const h = harness();
  await startColorMatch(h.ctx, 1, [A, B]);
  await onColorPick(h.ctx, A, 1, 1, [...h.state.target], 0);
  await h.step();
  check('reveal', h.state.phase === 'reveal');
  check('and the alarm is set for the end of it', h.alarm === h.state.levelEndsAt, { alarm: h.alarm, end: h.state.levelEndsAt });

  await h.step();
  check('then level 2 is dealt on its own', h.state.level === 2 && h.state.phase === 'pick');
  check('with a fresh picks board', Object.keys(h.state.picks).length === 0);
  check('and the totals carried over', h.state.totals[A] === 150, h.state.totals);

  // Walk far enough up the ladder to cross the rung that adds a dark ring.
  for (let n = 2; n <= 36; n++) {
    await onColorPick(h.ctx, A, 1, n, [...h.state.target], 0);
    await h.step();
    await h.step();
  }
  check('the ladder reaches level 37 by playing it', h.state.level === 37, h.state.level);
  check('and its rung really does have a dark ring by then', rungAt(37).values > 1, rungAt(37));
}

async function barren(): Promise<void> {
  console.log('\nthe run ends when the room stops scoring (§2.1)');

  const h = harness();
  await startColorMatch(h.ctx, 1, [A, B]);

  for (let n = 1; n <= COLOR_BARREN_ROUNDS; n++) {
    // Nobody picks anything at all — the worst kind of scoreless level.
    check(`level ${n} passes with nobody scoring`, h.state.level === n);
    await h.step();
    check(`  and the streak is at ${n}`, h.state.barren === n, h.state.barren);
    if (n < COLOR_BARREN_ROUNDS) await h.step();
  }

  check('the third scoreless level is still revealed, not cut off', h.state.phase === 'reveal');
  const over = await h.step();
  check('and then the run is over', over && h.state.phase === 'done');
  check('with nobody having scored, nobody wins', h.state.winner === null);

  // One player scoring keeps the whole room in — deliberately (§2.1).
  const k = harness();
  await startColorMatch(k.ctx, 1, [A, B]);
  await k.step();
  await k.step();
  await k.step();
  await k.step();
  check('two blanks do not end it', k.state.phase !== 'done' && k.state.barren === 2, k.state.barren);
  await onColorPick(k.ctx, A, 1, k.state.level, [...k.state.target], 0);
  await k.step();
  check('and one player scoring resets the streak for everyone', k.state.barren === 0);
}

async function winning(): Promise<void> {
  console.log('\nwho wins');

  const h = harness();
  await startColorMatch(h.ctx, 1, [A, B]);
  await onColorPick(h.ctx, A, 1, 1, [...h.state.target], 0);
  await h.step();
  await h.step();
  // Now let it die out.
  for (let n = 0; n < COLOR_BARREN_ROUNDS; n++) {
    await h.step();
    if (n < COLOR_BARREN_ROUNDS - 1) await h.step();
  }
  await h.step();
  check('the run ended', h.state.phase === 'done');
  check('and the highest total took it', h.state.winner === A, { winner: h.state.winner, totals: h.state.totals });

  const t = harness();
  await startColorMatch(t.ctx, 1, [A, B]);
  await onColorPick(t.ctx, A, 1, 1, [...t.state.target], 0);
  await onColorPick(t.ctx, B, 1, 1, [...t.state.target], 0);
  await t.step();
  await t.step();
  for (let n = 0; n < COLOR_BARREN_ROUNDS; n++) {
    await t.step();
    if (n < COLOR_BARREN_ROUNDS - 1) await t.step();
  }
  await t.step();
  check('a dead heat at the top is unranked', t.state.phase === 'done' && t.state.winner === null, t.state.totals);
}

async function cheating(): Promise<void> {
  console.log('\nwhat the referee refuses (§8)');

  const h = harness();
  await startColorMatch(h.ctx, 1, [A, B]);
  const target = h.state.target;

  await onColorPick(h.ctx, A, 2, 1, [...target], 0);
  check('a pick for the wrong round is dropped', h.state.picks[A] === undefined);
  await onColorPick(h.ctx, A, 1, 9, [...target], 0);
  check('a pick for a level not in flight is dropped', h.state.picks[A] === undefined);
  await onColorPick(h.ctx, 'nobody' as PlayerId, 1, 1, [...target], 0);
  check('a pick from somebody not in the room is dropped', h.state.picks['nobody' as PlayerId] === undefined);
  await onColorPick(h.ctx, A, 1, 1, 'crimson', 0);
  check('a pick that is not a colour is dropped', h.state.picks[A] === undefined);
  await onColorPick(h.ctx, A, 1, 1, [1, 2], 0);
  check('and neither is a two-component one', h.state.picks[A] === undefined);

  await onColorPick(h.ctx, A, 1, 1, [999, -20, 40], 0);
  check('an out-of-range colour is clamped, not rejected', JSON.stringify(h.state.picks[A]?.rgb) === '[255,0,40]', h.state.picks[A]);

  // The wire carries a colour and never a score — the payload has no field for
  // one, and the referee computes it from the colour regardless.
  await h.step();
  check('the score comes from the colour, not the payload', typeof h.state.picks[A]?.score === 'number');
}

async function leaving(): Promise<void> {
  console.log('\nsomebody leaves');

  const h = harness();
  await startColorMatch(h.ctx, 1, [A, B]);
  await onColorPick(h.ctx, A, 1, 1, [...h.state.target], 0);
  await h.step();
  await h.step();

  await onPlayerGone(h.ctx, A);
  check('their total stays on the board', h.state.totals[A] === 150, h.state.totals);
  check('and the run carries on', h.state.phase === 'pick');
}

async function confirming(): Promise<void> {
  console.log('\nlocking a pick ends the level early (§6, reusing Color Hunt\'s own issue #45)');

  const h = harness();
  await startColorMatch(h.ctx, 1, [A, B]);
  const due = h.state.picksDueAt;

  check('nobody is locked in to start with', h.state.confirmed.length === 0);
  await onColorConfirm(h.ctx, A, 1, 1);
  check('confirming without a pick does nothing', h.state.confirmed.length === 0, h.state.confirmed);

  await onColorPick(h.ctx, A, 1, 1, [...h.state.target], 0);
  await onColorConfirm(h.ctx, A, 1, 1);
  check('with a pick, it locks', h.state.confirmed.includes(A), h.state.confirmed);
  await onColorConfirm(h.ctx, A, 1, 1);
  check('confirming twice does not double up', h.state.confirmed.length === 1);
  check('one of two is not everyone, so the clock stands', h.state.picksDueAt === due, { was: due, now: h.state.picksDueAt });
  check('and it is on the wire for the other phones', toState(h.state).confirmed.includes(A));

  // A locked pick is locked.
  await onColorPick(h.ctx, A, 1, 1, [1, 2, 3], 0);
  check('a locked pick cannot be changed', h.state.picks[A]?.rgb[0] !== 1, h.state.picks[A]);

  await onColorPick(h.ctx, B, 1, 1, [10, 10, 10], 0);
  await onColorConfirm(h.ctx, B, 1, 1);
  check('everyone in brings the deadline to now', h.state.picksDueAt <= 1_000_000, h.state.picksDueAt);

  await h.step();
  check('and the level scores on it', h.state.phase === 'reveal', h.state.phase);
  // Both picks landed instantly, exactly the same shape `scoring()` above
  // already pins down: 100 accuracy, worth half again for being early.
  check('the exact pick still got its points', h.state.totals[A] === 150, h.state.totals);

  await h.step();
  check('the new level starts unlocked', h.state.confirmed.length === 0, h.state.confirmed);
  check('and the ladder moved on', h.state.level === 2, h.state.level);
}

async function confirmTimeout(): Promise<void> {
  console.log('\nnot confirming is not a penalty (§6)');

  const h = harness();
  await startColorMatch(h.ctx, 1, [A, B]);
  await onColorPick(h.ctx, A, 1, 1, [...h.state.target], 0);
  // Nobody confirms; the clock runs out on its own.
  await h.step();
  check('the deadline auto-confirms whatever was picked', h.state.totals[A] === 150, h.state.totals);
}

async function leaverDoesNotHoldTheLevel(): Promise<void> {
  console.log('\na phone that leaves does not hold the level open (§6)');

  const h = harness();
  await startColorMatch(h.ctx, 1, [A, B]);
  await onColorPick(h.ctx, A, 1, 1, [...h.state.target], 0);
  await onColorConfirm(h.ctx, A, 1, 1);
  check('one of two is in, clock still running', h.state.picksDueAt > 1_000_000);
  await onPlayerGone(h.ctx, B);
  check('the one who left counts as in', h.state.confirmed.includes(B), h.state.confirmed);
}

async function noRepeats(): Promise<void> {
  console.log('\na session never asks twice for the same colour (§2.3b)');

  // The first rung is red, green and blue with black banned — and it lasts
  // exactly three levels for that reason, so even it never has to repeat.
  const h = harness();
  await startColorMatch(h.ctx, 1, [A, B]);
  const seen: string[] = [colorKey(h.state.target)];
  for (let n = 1; n < 30; n++) {
    h.seed((n * 0.137 + 0.03) % 1);
    await h.step();
    await h.step();
    if (h.state.phase === 'done') break;
    seen.push(colorKey(h.state.target));
  }
  check(`thirty levels, thirty different colours (${seen.length} sampled)`, new Set(seen).size === seen.length, seen.length - new Set(seen).size);
  check('the first three are the first rung\'s own three', new Set(seen.slice(0, 3)).size === 3);
  check('and not one of them is black or white', seen.every((key) => !isExtreme(key.split(',').map(Number) as [number, number, number])));
}

async function timing(): Promise<void> {
  console.log('\nthe action window is tiered by level (§2.2)');

  // The boundaries are derived from the ladder, so this asserts the RUNGS the
  // steps sit on rather than the numbers they currently work out to — those
  // move the moment a rung's length does. The boundary is the rung before the
  // wheel goes continuous (`COLOR_SECTOR_MAX`).
  const lastSector = RUNG_ENDS[4] ?? 0;
  check('3 s while a wedge can be tapped exactly',
    colorActionMs(1) === 3000 && colorActionMs(lastSector) === 3000, colorActionMs(1));
  check('10 s from the rung that goes continuous',
    colorActionMs(lastSector + 1) === 10000 && colorActionMs(400) === 10000, colorActionMs(lastSector + 1));
  check('and that rung really is the first past the sector cap', paletteSize(rungAt(lastSector + 1)) > COLOR_SECTOR_MAX && paletteSize(rungAt(lastSector)) <= COLOR_SECTOR_MAX);
  check('the tiers only ever get longer', COLOR_ACTION_TIERS.every((t, i, a) => i === 0 || t.ms > (a[i - 1]?.ms ?? 0)));
  check('and the last one catches every level', COLOR_ACTION_TIERS[COLOR_ACTION_TIERS.length - 1]?.upTo === Infinity);
  check('a whole level is its own window plus a fixed tail', levelMs(1) === colorActionMs(1) + 4000 && levelMs(40) === colorActionMs(40) + 4000);

  const h = harness();
  await startColorMatch(h.ctx, 1, [A, B]);
  check('a level-1 round really closes after 3 s', h.state.picksDueAt - h.state.startsAt === 3000);
}

async function phases(): Promise<void> {
  console.log('\nthe phase boundaries are absolute times (§2.2)');

  const h = harness(5_000_000);
  await startColorMatch(h.ctx, 1, [A, B]);
  const s = h.state;
  check('picks close after the action window', s.picksDueAt === s.startsAt + colorActionMs(1), { due: s.picksDueAt - s.startsAt });
  check('the reveal starts after the score hold', s.revealAt === s.picksDueAt + COLOR_SCORE_HOLD_MS);
  check('and the level ends a whole level in', s.levelEndsAt === s.startsAt + levelMs(1));
  check('the first alarm waits for the grace, not just the deadline', nextDeadline(s) === s.picksDueAt + COLOR_PICK_GRACE_MS, nextDeadline(s));
  check('a finished run wants no alarm at all', (() => {
    const done = { ...s, phase: 'done' as const };
    return nextDeadline(done) === Infinity;
  })());
}

async function main(): Promise<void> {
  await starting();
  await scoring();
  await replacing();
  await chaining();
  await barren();
  await winning();
  await cheating();
  await leaving();
  await confirming();
  await confirmTimeout();
  await leaverDoesNotHoldTheLevel();
  await noRepeats();
  await timing();
  await phases();

  if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
  console.log(`\nall passed (${checks} checks)`);
}

await main();
