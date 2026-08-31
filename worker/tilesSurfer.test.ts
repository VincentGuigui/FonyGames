import {
  nextDeadline,
  onPlayerGone,
  onTilesReport,
  startTilesSurfer,
  tick,
  type Ctx,
  type TilesSurfer,
} from './tilesSurfer';
import { TILES_LIVES, TILES_ROUND_CAP_MS, type PlayerId, type ServerMessage } from '../shared/protocol';

/**
 * Tiles Surfer's referee.
 * Spec: docs/specs/games/tiles-surfer.md
 *
 * Unlike every other referee tested in this file's own neighbours, this one
 * never judges a tap — it only ever stores what a `tiles-report` claims (spec
 * §8), so what is worth proving here is narrower and different: a report
 * marks a player out the instant it claims 0 lives, elimination hands the
 * win to whoever is left, a genuinely-solo room ends on its own player's
 * elimination rather than running forever, and the safety cap ranks by
 * score with a tie unranked, same as every other game's own cap.
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

/** A referee harness with a clock we drive by hand. */
function harness(at = 1_000_000) {
  let now = at;
  let seq = 0;
  let stored: TilesSurfer | null = null;
  const sent: ServerMessage[] = [];
  let alarm = 0;

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
  };

  return {
    ctx,
    sent,
    get state() {
      return stored;
    },
    get alarm() {
      return alarm;
    },
    advance: (ms: number) => {
      now += ms;
    },
    get now() {
      return now;
    },
    last: (t: string) => [...sent].reverse().find((m) => m.t === t),
  };
}

console.log('\nstarting a round');

{
  const h = harness();
  const ok = await startTilesSurfer(h.ctx, 1, [A, B, C]);
  check('three players is a game', ok === true);
  check('everyone starts with all their lives', h.state?.players[A]?.lives === TILES_LIVES);
  check('everyone starts scoreless', h.state?.players[A]?.score === 0);
  check('a state frame went out', h.last('tiles')?.t === 'tiles');
  check('the alarm is the safety cap', h.alarm === h.now + TILES_ROUND_CAP_MS);
  check('not the solo case', h.state?.solo === false);

  const solo = harness();
  await startTilesSurfer(solo.ctx, 1, [A]);
  check('one real player is still a game — this is the one game where that is true', solo.state !== null);
  check('but it is marked solo, so their own elimination will end it', solo.state?.solo === true);
}

console.log('\na periodic report just updates the shared numbers');

{
  const h = harness();
  await startTilesSurfer(h.ctx, 1, [A, B]);
  await onTilesReport(h.ctx, A, 1, 240, 4, 12, 5, 180);
  check('the score landed', h.state?.players[A]?.score === 240);
  check('the lives landed', h.state?.players[A]?.lives === 4);
  check('the perfects landed', h.state?.players[A]?.perfects === 12);
  check('the longest streak landed', h.state?.players[A]?.longestStreak === 5);
  check('the average reaction landed', h.state?.players[A]?.avgReactionMs === 180);
  check('A is still alive', h.state?.alive.includes(A) === true);
  check('the round is still running', h.state?.phase === 'running');
}

console.log('\na report claiming 0 lives is elimination');

{
  const h = harness();
  await startTilesSurfer(h.ctx, 1, [A, B, C]);
  await onTilesReport(h.ctx, A, 1, 300, 0, 8, 6, 210);
  check('A is out', h.state?.alive.includes(A) === false);
  check('A has no lives on record', h.state?.players[A]?.lives === 0);
  check('B and C are still going', h.state?.alive.length === 2);
  check('the round is not over yet — two are still in it', h.state?.phase === 'running');

  await onTilesReport(h.ctx, B, 1, 150, 0, 4, 4, 250);
  check('B is out too', h.state?.alive.includes(B) === false);
  check('only C is left, so the round ends', h.state?.phase === 'done');
  check('C wins outright', h.state?.winner === C);

  await onTilesReport(h.ctx, B, 1, 999, 3, 20, 15, 90);
  check('a late report from someone other than the winner changes nothing', h.state?.players[B]?.score === 150);
}

console.log('\nthe winner catches up their own final numbers after the round ends (issue #8)');

{
  /*
   * The winner's own lives never reach zero — by definition they are still
   * going when the round ends around them — so their real closing numbers
   * only ever arrive in a report sent AFTER `phase` is already 'done'
   * (`TilesRoom.tsx`'s own "the winner never sends their own closing report
   * by running out of lives" effect). Rejecting every post-done report
   * outright, as the general case above still does, left the winner's
   * numbers frozen at their last mid-round checkpoint — invisible in most
   * multiplayer matches, but the ONLY number ever recorded in a solo round,
   * where there is nobody else's correct terminal report to fall back on.
   */
  const h = harness();
  await startTilesSurfer(h.ctx, 1, [A]);
  await onTilesReport(h.ctx, A, 1, 120, 5, 6, 4, 150);
  h.advance(TILES_ROUND_CAP_MS);
  await tick(h.ctx);
  check('surviving to the cap wins it, still alive', h.state?.phase === 'done' && h.state?.winner === A);
  check('but the streak on record is only the last checkpoint', h.state?.players[A]?.longestStreak === 4);

  await onTilesReport(h.ctx, A, 1, 190, 5, 12, 8, 140);
  check('the winner’s own catch-up report lands', h.state?.players[A]?.longestStreak === 8);
  check('and the rest of their final numbers land with it', h.state?.players[A]?.score === 190 && h.state?.players[A]?.perfects === 12);

  await onTilesReport(h.ctx, A, 2, 999, 5, 99, 99, 999);
  check('a catch-up report for the wrong round still changes nothing', h.state?.players[A]?.longestStreak === 8);
}

console.log('\na genuinely-solo room ends on its own elimination, not a forced win');

{
  const h = harness();
  await startTilesSurfer(h.ctx, 1, [A]);
  await onTilesReport(h.ctx, A, 1, 60, 0, 2, 2, 300);
  check('the lone player going out ends the round', h.state?.phase === 'done');
  check('there is nobody to have beaten — no winner', h.state?.winner === null);
}

console.log('\nrejections');

{
  const h = harness();
  await startTilesSurfer(h.ctx, 1, [A, B]);
  await onTilesReport(h.ctx, A, 2, 500, 3, 10, 10, 100);
  check('a report for another round changes nothing', h.state?.players[A]?.score === 0);

  await onTilesReport(h.ctx, 'z' as PlayerId, 1, 500, 3, 10, 10, 100);
  check('an unseated player changes nothing', Object.keys(h.state?.players ?? {}).length === 2);

  await onTilesReport(h.ctx, A, 1, Number.NaN, -1, -5, -5, -1);
  check('a non-finite or negative claim is clamped away, not stored', h.state?.players[A]?.score === 0);
  check('lives stays at the last good value', h.state?.players[A]?.lives === TILES_LIVES);
}

console.log('\na player leaving mid-round is treated exactly like their own elimination');

{
  const h = harness();
  await startTilesSurfer(h.ctx, 1, [A, B]);
  await onPlayerGone(h.ctx, A);
  check('A counts as out', h.state?.alive.includes(A) === false);
  check('only B is left, so B wins', h.state?.phase === 'done' && h.state?.winner === B);
}

console.log('\nthe safety cap ranks by score, ties unranked');

{
  const h = harness();
  await startTilesSurfer(h.ctx, 1, [A, B, C]);
  await onTilesReport(h.ctx, A, 1, 500, 2, 20, 10, 150);
  await onTilesReport(h.ctx, B, 1, 300, 1, 10, 5, 200);
  h.advance(TILES_ROUND_CAP_MS);
  const over = await tick(h.ctx);
  check('the cap ends it', over === true);
  check('A leads on score', h.state?.winner === A, h.state?.players);
  check('C, who never reported, is not the winner', h.state?.winner !== C);

  const tied = harness();
  await startTilesSurfer(tied.ctx, 1, [A, B]);
  await onTilesReport(tied.ctx, A, 1, 400, 2, 10, 10, 150);
  await onTilesReport(tied.ctx, B, 1, 400, 3, 10, 10, 150);
  tied.advance(TILES_ROUND_CAP_MS);
  await tick(tied.ctx);
  check('an equal score at the cap is not ranked', tied.state?.winner === null);
}

console.log('\nthe deadline is only ever the safety cap');

{
  const h = harness();
  await startTilesSurfer(h.ctx, 1, [A, B]);
  check('it is the cap away', nextDeadline(h.state as TilesSurfer) === h.state!.startsAt + TILES_ROUND_CAP_MS);
  check('not due yet', h.now < nextDeadline(h.state as TilesSurfer));
  h.advance(TILES_ROUND_CAP_MS + 1);
  check('now it is due', h.now >= nextDeadline(h.state as TilesSurfer));
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
