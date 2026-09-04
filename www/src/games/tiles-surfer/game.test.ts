import {
  applyTilesSurfer,
  beatAt,
  beatsAt,
  bestStreak,
  isPerfect,
  reportDue,
  scoreOf,
  tapComment,
  tilesImpact,
  trackForTile,
  TILES_COMMENT_MS,
  TILES_MAX_BEATS,
  TILES_MISS_COMMENT,
  TILES_TILE_POINTS,
  TilesRun,
  windowMsFor,
  type TilesSurferView,
} from './game';
import { TILES_LIVES, TILES_SPAWN_INTERVAL_MS, TILES_TRACK_COUNT, type ServerMessage, type TilesSurferState } from '../../../../shared/protocol';

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

function comments(): void {
  console.log('\ntapComment: the accuracy tiers, top to bottom');

  check('10 is the perfect tier', tapComment(10) === '🌟🌟🌟');
  check('9.6, which rounds to 10, is also the perfect tier', tapComment(9.6) === '🌟🌟🌟');
  check('9 is the next tier down', tapComment(9) === '⭐⭐⭐');
  check('8 is the same tier as 9', tapComment(8) === '⭐⭐⭐');
  check('7 and 6 share a tier', tapComment(7) === '⭐⭐' && tapComment(6) === '⭐⭐');
  check('5 and 4 share a tier', tapComment(5) === '⭐' && tapComment(4) === '⭐');
  check('3 and 2 share a tier', tapComment(3) === '🫣' && tapComment(2) === '🫣');
  check('1 and 0 share the worst tier', tapComment(1) === '😱' && tapComment(0) === '😱');
  check('a fractional near-zero score still reads as the worst tier', tapComment(0.3) === '😱');
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

  r.press(tile.track, crossAt, tileHeightPx, lineY);
  check('a perfectly-timed tap scores full marks', r.score === 10, r.score);
  check('a perfect tap counts toward perfects', r.perfects === 1);
  check('the streak grows', r.longestStreak === 1);
  check('speed increases on a hit', r.speedMul > 1, r.speedMul);
  check('the tile is gone once tapped', r.tiles.length === 0);
  check('a perfect hit leaves its own accuracy comment', r.comments.length === 1 && r.comments[0]!.hit === true);
  check('and it is the perfect tier, in the tapped lane', r.comments[0]!.text === '🌟🌟🌟' && r.comments[0]!.track === tile.track);

  // A second tile, tapped early — before the tile ever reaches the line.
  r.spawnDue(600);
  const early = r.tiles.find((t) => t.spawnedAt === 600)!;
  const beforeMiss = r.lives;
  const speedBeforeMiss = r.speedMul;
  r.press(early.track, early.spawnedAt + early.fallMs - 1_000, tileHeightPx, lineY);
  check('an early tap is a miss, not a score', r.lives === beforeMiss - 1);
  check('a miss resets the streak', r.longestStreak === 1 && r.perfects === 1);
  check('a miss softens speed, never below the starting speed', r.speedMul < speedBeforeMiss && r.speedMul >= 1);
  check('the miss leaves its own skull comment', r.comments[1]!.text === TILES_MISS_COMMENT && r.comments[1]!.hit === false);

  // Comments fade: nothing survives long past TILES_COMMENT_MS, no matter when it was added.
  r.pruneComments(early.spawnedAt + early.fallMs + TILES_COMMENT_MS + 10_000);
  check('every comment is gone once its own window has passed', r.comments.length === 0);

  // Pressing a lane with nothing in it is a press that landed nothing, and
  // costs the same life any other early press does (spec §2.2). It used to be
  // free, which made mashing every lane strictly better than reading the board.
  const beforeIdleTap = { lives: r.lives, score: r.score };
  r.press(4, 999_999, tileHeightPx, lineY);
  check('pressing an empty lane costs a life', r.lives === beforeIdleTap.lives - 1, r.lives);
  check('and scores nothing for it', r.score === beforeIdleTap.score);

  // sweepMissed: a tile whose window has fully closed, never tapped, costs a life.
  const sweeper = new TilesRun(2);
  sweeper.spawnDue(0);
  const t0 = sweeper.tiles[0]!;
  const closeAt = t0.spawnedAt + t0.fallMs + windowMsFor(t0.fallMs, tileHeightPx, lineY) + 1;
  const beforeSweep = sweeper.lives;
  sweeper.sweepMissed(closeAt, tileHeightPx, lineY);
  check('an untapped, expired tile is swept as a miss', sweeper.lives === beforeSweep - 1);
  check('the swept tile is gone', sweeper.tiles.length === 0);
  check('a swept miss leaves the same skull comment, in the tile\'s own lane',
    sweeper.comments.length === 1 && sweeper.comments[0]!.text === TILES_MISS_COMMENT && sweeper.comments[0]!.track === t0.track);

  // Running out of lives ends the run.
  const dying = new TilesRun(3);
  for (let i = 0; i < TILES_LIVES; i++) {
    dying.spawnDue(i * 10_000);
    const dt = dying.tiles[dying.tiles.length - 1]!;
    dying.press(dt.track, dt.spawnedAt + dt.fallMs - 5_000, tileHeightPx, lineY);
  }
  check('lives bottom out at zero, not negative', dying.lives === 0);
  check('a dead run stops being alive', !dying.alive);

  const beforeDead = { score: dying.score, lives: dying.lives, tiles: dying.tiles.length };
  dying.spawnDue(999_999);
  check('a dead run never spawns another tile', dying.tiles.length === beforeDead.tiles);
  dying.press(0, 999_999, tileHeightPx, lineY);
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
  r.press(t0.track, crossAt0 + 50, tileHeightPx, lineY);
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
/**
 * Long tiles: two or more consecutive tiles down the same lane are one tile to
 * press and hold (spec §2.2b).
 *
 * The lanes are a pure function of `roundId`, so a real run to test against is
 * found rather than fabricated — these are the rounds the game actually deals.
 * Round 1 puts a two-run at index 3; round 3 puts five in a row from index 3,
 * which is where the cap earns its keep.
 */
function holds(): void {
  console.log('\nlong tiles: press and hold (§2.2b)');

  const tileHeightPx = 100;
  const lineY = 500;

  check('a lone tile is one beat', beatsAt(1, 0) === 1);
  check('two in a lane merge', beatsAt(1, 3) === 2, beatsAt(1, 3));
  check('and a longer run is capped rather than drawn off the screen',
    beatsAt(3, 3) === TILES_MAX_BEATS, beatsAt(3, 3));

  // Spawning: the merged tiles are gone from the stream, not merely drawn
  // together — the run occupies its own slots and the next tile follows it.
  const r = new TilesRun(1);
  r.spawnDue(3 * TILES_SPAWN_INTERVAL_MS);
  const long = r.tiles.find((tile) => tile.beats > 1);
  check('the run spawns as one tile', !!long && long.beats === 2, r.tiles.map((t) => t.beats));
  check('and only one, not two stacked in the same lane',
    r.tiles.filter((tile) => tile.track === long?.track).length === 1);
  r.spawnDue(5 * TILES_SPAWN_INTERVAL_MS);
  check('the tile after it is the one that follows the whole run',
    r.tiles.some((tile) => tile.spawnedAt === 5 * TILES_SPAWN_INTERVAL_MS));

  // Pressing the head: precision-scored like any tap, but the tile stays.
  const head = long!;
  const crossAt = head.spawnedAt + head.fallMs;
  r.press(head.track, crossAt, tileHeightPx, lineY);
  check('the head is scored on precision, like any other tap', r.score === TILES_TILE_POINTS, r.score);
  check('and the tile is held rather than consumed', head.held && r.tiles.includes(head));
  check('one beat banked so far', head.scored === 1);

  // Holding: each further beat banks the full tile as it reaches the line.
  r.awardHolds(beatAt(head, 1) - 1);
  check('nothing is banked before the next beat arrives', r.score === TILES_TILE_POINTS, r.score);
  const livesBefore = r.lives;
  r.awardHolds(beatAt(head, 1));
  check('holding through a beat banks a whole tile', r.score === TILES_TILE_POINTS * 2, r.score);
  check('a played-out tile retires itself', !r.tiles.includes(head));
  check('and costs nothing', r.lives === livesBefore);
  check('a held beat is not a precision tap, so it does not inflate perfects',
    r.perfects === 1 && r.longestStreak === 1, { perfects: r.perfects, streak: r.longestStreak });

  // Letting go early: keep what was banked, lose one life — never one per beat.
  const dropped = new TilesRun(3);
  dropped.spawnDue(3 * TILES_SPAWN_INTERVAL_MS);
  const four = dropped.tiles.find((tile) => tile.beats === TILES_MAX_BEATS)!;
  dropped.press(four.track, four.spawnedAt + four.fallMs, tileHeightPx, lineY);
  dropped.awardHolds(beatAt(four, 1));
  const banked = dropped.score;
  const before = dropped.lives;
  dropped.release(four.track, beatAt(four, 1) + 10);
  check('a dropped hold keeps what it banked', dropped.score === banked && banked === TILES_TILE_POINTS * 2, dropped.score);
  check('and costs exactly one life, not one per unplayed beat', dropped.lives === before - 1, dropped.lives);
  check('the dropped tile is gone', !dropped.tiles.includes(four));
  check('with a skull over its own lane',
    dropped.comments.at(-1)?.text === TILES_MISS_COMMENT && dropped.comments.at(-1)?.track === four.track);

  // Missing the head of a long tile is one miss, not four.
  const ignored = new TilesRun(3);
  ignored.spawnDue(3 * TILES_SPAWN_INTERVAL_MS);
  const untouched = ignored.tiles.find((tile) => tile.beats === TILES_MAX_BEATS)!;
  // On its own, so the earlier tiles' own misses are not counted as this one's.
  ignored.tiles = [untouched];
  const livesAtStart = ignored.lives;
  ignored.sweepMissed(beatAt(untouched, 0) + windowMsFor(untouched.fallMs, tileHeightPx, lineY) + 1, tileHeightPx, lineY);
  check('a long tile nobody presses costs one life, whatever it was worth',
    ignored.lives === livesAtStart - 1, ignored.lives);

  // Releasing a lane nobody is holding is not a drop, and a finger still down
  // after the last beat is not one either.
  const clean = new TilesRun(1);
  clean.spawnDue(3 * TILES_SPAWN_INTERVAL_MS);
  const livesClean = clean.lives;
  clean.release(0, 1_000);
  check('releasing an empty lane costs nothing', clean.lives === livesClean);
  const stillHeld = clean.tiles.find((tile) => tile.beats > 1)!;
  clean.press(stillHeld.track, stillHeld.spawnedAt + stillHeld.fallMs, tileHeightPx, lineY);
  clean.awardHolds(beatAt(stillHeld, stillHeld.beats - 1));
  clean.release(stillHeld.track, beatAt(stillHeld, stillHeld.beats - 1) + 500);
  check('letting go after the last beat is not a drop', clean.lives === livesClean, clean.lives);

  // A second finger on a lane that is already held is not a fresh mistake.
  const twoThumbs = new TilesRun(1);
  twoThumbs.spawnDue(3 * TILES_SPAWN_INTERVAL_MS);
  const busy = twoThumbs.tiles.find((tile) => tile.beats > 1)!;
  twoThumbs.press(busy.track, busy.spawnedAt + busy.fallMs, tileHeightPx, lineY);
  const livesHeld = twoThumbs.lives;
  twoThumbs.press(busy.track, busy.spawnedAt + busy.fallMs + 50, tileHeightPx, lineY);
  check('a second finger on a held lane is ignored, not punished', twoThumbs.lives === livesHeld);
}


scoring();
comments();
run();
holds();
reactionAverage();
projecting();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
