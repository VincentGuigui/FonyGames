import {
  applyTilesSurfer,
  bestStreak,
  isPerfect,
  reportDue,
  scoreOf,
  tilesImpact,
  trackForTile,
  TilesRun,
  windowMsFor,
  type TilesSurferView,
} from './game';
import { TILES_LIVES, TILES_TRACK_COUNT, type ServerMessage, type TilesSurferState } from '../../../../shared/protocol';

/**
 * Tiles Surfer, client side. Spec: docs/specs/games/tiles-surfer.md
 *
 * There is no referee to check this against — `TilesRun` IS the game, on
 * this phone, and the whole point of `trackForTile` is that every OTHER
 * phone must land on the exact same number for the same `(roundId,
 * tileIndex)`, so determinism across repeated calls is what actually
 * matters here, not just "returns something in range."
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

const A = 'a';
const B = 'b';

function view(over: Partial<TilesSurferState> = {}): TilesSurferView {
  return {
    roundId: 1,
    startsAt: 0,
    endsAt: 300_000,
    scores: {
      [A]: { score: 0, lives: TILES_LIVES, perfects: 0, longestStreak: 0, avgReactionMs: 0 },
      [B]: { score: 0, lives: TILES_LIVES, perfects: 0, longestStreak: 0, avgReactionMs: 0 },
    },
    winner: null,
    phase: 'running',
    seq: 1,
    ...over,
  };
}

function msg(v: TilesSurferView, s = 1): ServerMessage {
  const { seq: _seq, ...d } = v;
  return { t: 'tiles', s, d };
}

function trackAssignment(): void {
  console.log('\ntrackForTile: every player must land on the same lane for the same tile');

  const first = trackForTile(1, 0);
  for (let i = 0; i < 5; i++) {
    check('repeated calls agree', trackForTile(1, 0) === first);
  }
  check('the result is a real track', first >= 0 && first < TILES_TRACK_COUNT);

  const seen = new Set<number>();
  for (let i = 0; i < 200; i++) seen.add(trackForTile(1, i));
  check('every lane gets used across enough tiles', seen.size === TILES_TRACK_COUNT, [...seen]);

  check('a different round can place its own first tile differently — not a fixed constant',
    trackForTile(1, 0) !== trackForTile(2, 0) || trackForTile(1, 1) !== trackForTile(2, 1));
}

function scoring(): void {
  console.log('\nwindowMsFor / tilesImpact / isPerfect');

  check('window scales with fall time and tile height, against line position',
    windowMsFor(2_000, 100, 500) === 400);
  check('a zero line position does not divide by zero', windowMsFor(2_000, 100, 0) === 0);

  check('right on time scores full marks', tilesImpact(0, 400) === 10);
  check('halfway through the window scores half', tilesImpact(200, 400) === 5);
  check('at the very edge of the window scores nothing', tilesImpact(400, 400) === 0);
  check('past the window clamps to zero, not negative', tilesImpact(500, 400) === 0);
  check('a degenerate window scores nothing', tilesImpact(0, 0) === 0);

  check('10 exactly is perfect', isPerfect(10));
  check('9.6, which rounds to 10, is perfect', isPerfect(9.6));
  check('9.4 is not', !isPerfect(9.4));
}

function run(): void {
  console.log('\nTilesRun: one player\'s own board, start to finish');

  const r = new TilesRun(1);
  check('starts with all lives', r.lives === TILES_LIVES);
  check('starts scoreless', r.score === 0);
  check('starts alive', r.alive);
  check('starts at the initial speed', r.speedMul === 1);

  r.spawnDue(0);
  check('a tile is on screen at t=0', r.tiles.length === 1);
  const tile = r.tiles[0]!;

  const tileHeightPx = 100;
  const lineY = 500;
  const crossAt = tile.spawnedAt + tile.fallMs;

  r.tap(tile.track, crossAt, tileHeightPx, lineY);
  check('a perfectly-timed tap scores full marks', r.score === 10, r.score);
  check('a perfect tap counts toward perfects', r.perfects === 1);
  check('the streak grows', r.longestStreak === 1);
  check('speed increases on a hit', r.speedMul > 1, r.speedMul);
  check('the tile is gone once tapped', r.tiles.length === 0);

  // A second tile, tapped early — before the tile ever reaches the line.
  r.spawnDue(600);
  const early = r.tiles.find((t) => t.spawnedAt === 600)!;
  const beforeMiss = r.lives;
  const speedBeforeMiss = r.speedMul;
  r.tap(early.track, early.spawnedAt + early.fallMs - 1_000, tileHeightPx, lineY);
  check('an early tap is a miss, not a score', r.lives === beforeMiss - 1);
  check('a miss resets the streak', r.longestStreak === 1 && r.perfects === 1);
  check('a miss softens speed, never below the starting speed', r.speedMul < speedBeforeMiss && r.speedMul >= 1);

  // Tapping a lane with nothing in flight does nothing at all.
  const beforeIdleTap = { lives: r.lives, score: r.score };
  r.tap(4, 999_999, tileHeightPx, lineY);
  check('tapping an empty lane is a no-op', r.lives === beforeIdleTap.lives && r.score === beforeIdleTap.score);

  // sweepMissed: a tile whose window has fully closed, never tapped, costs a life.
  const sweeper = new TilesRun(2);
  sweeper.spawnDue(0);
  const t0 = sweeper.tiles[0]!;
  const closeAt = t0.spawnedAt + t0.fallMs + windowMsFor(t0.fallMs, tileHeightPx, lineY) + 1;
  const beforeSweep = sweeper.lives;
  sweeper.sweepMissed(closeAt, tileHeightPx, lineY);
  check('an untapped, expired tile is swept as a miss', sweeper.lives === beforeSweep - 1);
  check('the swept tile is gone', sweeper.tiles.length === 0);

  // Running out of lives ends the run.
  const dying = new TilesRun(3);
  for (let i = 0; i < TILES_LIVES; i++) {
    dying.spawnDue(i * 10_000);
    const dt = dying.tiles[dying.tiles.length - 1]!;
    dying.tap(dt.track, dt.spawnedAt + dt.fallMs - 5_000, tileHeightPx, lineY);
  }
  check('lives bottom out at zero, not negative', dying.lives === 0);
  check('a dead run stops being alive', !dying.alive);

  const beforeDead = { score: dying.score, lives: dying.lives, tiles: dying.tiles.length };
  dying.spawnDue(999_999);
  check('a dead run never spawns another tile', dying.tiles.length === beforeDead.tiles);
  dying.tap(0, 999_999, tileHeightPx, lineY);
  check('a dead run ignores taps entirely', dying.score === beforeDead.score && dying.lives === beforeDead.lives);
}

function reactionAverage(): void {
  console.log('\naverage reaction time and reportDue checkpoints');

  const r = new TilesRun(1);
  const tileHeightPx = 100;
  const lineY = 500;
  check('no taps yet, no average', r.avgReactionMs === 0);

  r.spawnDue(0);
  const t0 = r.tiles[0]!;
  const crossAt0 = t0.spawnedAt + t0.fallMs;
  r.tap(t0.track, crossAt0 + 50, tileHeightPx, lineY);
  check('one tap: the average is that tap\'s own offset', r.avgReactionMs === 50, r.avgReactionMs);

  check('not due until a checkpoint is crossed', !reportDue(r, 0));
  r.score = 100;
  check('due right at a 100-point checkpoint', reportDue(r, 0));
  check('not due again until the NEXT checkpoint', !reportDue(r, 100));
  r.lives = 0;
  check('always due the moment the run ends, checkpoint or not', reportDue(r, 100));
}

function projecting(): void {
  console.log('\napplying frames and the shared-state helpers');

  let state: TilesSurferView | null = null;
  state = applyTilesSurfer(state, msg(view()));
  check('the frame landed', state?.scores[A]?.score === 0);

  state = applyTilesSurfer(state, msg(view({ scores: { ...view().scores, [A]: { score: 240, lives: 4, perfects: 12, longestStreak: 5, avgReactionMs: 180 } } }), 2));
  check('a score update landed', state?.scores[A]?.score === 240);
  check('scoreOf reads it back', scoreOf(state!, A) === 240);
  check('scoreOf on an unknown player reads zero', scoreOf(state!, 'nobody') === 0);

  const stale = applyTilesSurfer(state, msg(view({ scores: { ...view().scores, [A]: { score: 999, lives: 4, perfects: 0, longestStreak: 0, avgReactionMs: 0 } } }), 1));
  check('a stale frame is ignored', stale === state);

  const untouched = applyTilesSurfer(state, { t: 'presence', s: 3, d: { code: 'ABCDEF', players: [], hostId: null } });
  check('an unrelated message changes nothing', untouched === state);

  const withStreaks = view({
    scores: {
      [A]: { score: 100, lives: 3, perfects: 8, longestStreak: 9, avgReactionMs: 120 },
      [B]: { score: 80, lives: 2, perfects: 4, longestStreak: 15, avgReactionMs: 200 },
    },
  });
  check('bestStreak picks the highest across every player', bestStreak(withStreaks) === 15);
}

trackAssignment();
scoring();
run();
reactionAverage();
projecting();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
