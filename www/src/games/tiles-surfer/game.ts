import {
  TILES_INITIAL_FALL_MS,
  TILES_LIVES,
  TILES_MISS_MUL,
  TILES_REPORT_EVERY,
  TILES_SPAWN_INTERVAL_MS,
  TILES_SPEEDUP_MUL,
  TILES_TRACK_COUNT,
  type PlayerId,
  type ServerMessage,
  type TilesSurferRun,
  type TilesSurferState,
} from '../../../../shared/protocol';

/**
 * Tiles Surfer's client-side simulation. Spec: docs/specs/games/tiles-surfer.md
 *
 * Unlike every other game in this catalogue, **the referee does not run this
 * game** (spec §8) — a player's own board, tiles, taps and timing all live
 * entirely on their own phone. `TilesRun` is that whole simulation: it owns
 * lives, score, speed, and every tile in flight, and nothing here is ever
 * corrected by a server frame. `applyTilesSurfer` is the OTHER half — the
 * shared, public picture of everyone's own last-reported numbers — and the
 * two never touch: this phone's own `TilesRun` is the only truth about this
 * phone's own board.
 */

const TILES_HASH_A = 374_761_393;
const TILES_HASH_B = 668_265_263;
const TILES_HASH_MIX = 1_274_126_177;

/**
 * Deterministic lane for tile #`tileIndex` of round `roundId` — every player's
 * client computes the same one, from nothing but a number every game already
 * broadcasts (spec §2.1). The same idea as UFO Hunt's `ufoPositionAt`: a pure
 * function of an index stands in for a shared seed, because nothing here
 * needs to be UNPREDICTABLE to a phone that already knows `roundId`, only
 * IDENTICAL across every phone that does.
 */
export function trackForTile(roundId: number, tileIndex: number): number {
  let h = (Math.trunc(roundId) * TILES_HASH_A + Math.trunc(tileIndex) * TILES_HASH_B) | 0;
  h = (h ^ (h >>> 13)) * TILES_HASH_MIX | 0;
  h = h ^ (h >>> 16);
  return Math.floor(((h >>> 0) / 4_294_967_296) * TILES_TRACK_COUNT);
}

/** What one tile is worth, tapped perfectly or held through (spec §2.2). */
export const TILES_TILE_POINTS = 10;

/**
 * The longest a merged tile may get, in beats (spec §2.2b). A run of five in
 * one lane is a 1-in-625 roll, and the tile it would draw is longer than the
 * screen above the line — so a longer run is served as a full-length tile and
 * then whatever is left, which is also what keeps the drawn length bounded.
 */
export const TILES_MAX_BEATS = 4;

/**
 * How many consecutive tiles from `index` fall down the same lane — 1 for a
 * lone tile, up to `TILES_MAX_BEATS`. This is what turns two tiles in a row in
 * one lane into one long tile to hold (spec §2.2b), and it is a pure function
 * of the same broadcast `roundId` the lanes themselves come from, so every
 * phone merges the identical runs.
 */
export function beatsAt(roundId: number, index: number): number {
  const track = trackForTile(roundId, index);
  let beats = 1;
  while (beats < TILES_MAX_BEATS && trackForTile(roundId, index + beats) === track) beats += 1;
  return beats;
}

/**
 * How long a tile takes to cross its own height once its leading edge has
 * reached the line, at `fallMs` — the width of the scoring window (spec §2.2).
 */
export function windowMsFor(fallMs: number, tileHeightPx: number, lineY: number): number {
  return lineY > 0 ? (tileHeightPx * fallMs) / lineY : 0;
}

/** The full score, before the caller enforces the too-early / too-late cutoffs (spec §2.2). */
export function tilesImpact(offsetMs: number, windowMs: number): number {
  if (windowMs <= 0) return 0;
  return Math.min(TILES_TILE_POINTS, Math.max(0, TILES_TILE_POINTS * (1 - offsetMs / windowMs)));
}

/** Rounds to the full ten — no separate tolerance constant (spec §2.2). */
export function isPerfect(score: number): boolean {
  return Math.round(score) === TILES_TILE_POINTS;
}

/** The skull shown over a tile nobody tapped in time, or a tap that landed
 *  outside the scoring window entirely (spec §2.2, §4). */
export const TILES_MISS_COMMENT = '☠️';

/**
 * The accuracy comment for a landed tap, keyed off the same rounding
 * `isPerfect` already uses — a perfect tap is exactly the top tier here, not
 * a separate check (spec §2.2, §4).
 */
export function tapComment(score: number): string {
  if (isPerfect(score)) return '🌟🌟🌟';
  const rounded = Math.round(score);
  if (rounded >= 8) return '⭐⭐⭐';
  if (rounded >= 6) return '⭐⭐';
  if (rounded >= 4) return '⭐';
  if (rounded >= 2) return '🫣';
  return '😱';
}

/** One tile currently on screen, not yet resolved. */
export type LiveTile = {
  id: number;
  track: number;
  /** Local run time (ms since this player's own board started) it spawned. */
  spawnedAt: number;
  /** Fixed at spawn, from that instant's own speed — a tile never changes speed mid-flight. */
  fallMs: number;
  /**
   * How many tiles were merged into this one (spec §2.2b). 1 is an ordinary
   * tap; 2 or more is a long tile to press and hold, and each further beat
   * reaches the line `TILES_SPAWN_INTERVAL_MS` after the one before it.
   */
  beats: number;
  /** Beats already banked — 1 the moment it is pressed, then one per beat held
   *  through. Equal to `beats` when the tile has been played out in full. */
  scored: number;
  /** True while a finger is down on it. */
  held: boolean;
};

/** How long a tile's own body takes to cross the line, head to tail: its own
 *  height plus one spawn interval per extra beat (spec §2.2b). */
export function tileSpanMs(tile: LiveTile, windowMs: number): number {
  return windowMs + (tile.beats - 1) * TILES_SPAWN_INTERVAL_MS;
}

/** When beat `n` of a tile reaches the line, in local run time. Beat 0 is the
 *  head, which is what a press is judged against. */
export function beatAt(tile: LiveTile, n: number): number {
  return tile.spawnedAt + tile.fallMs + n * TILES_SPAWN_INTERVAL_MS;
}

/** How long an accuracy comment stays on screen before it is dropped (spec §4). */
export const TILES_COMMENT_MS = 700;

/** One resolution's own feedback — the emoji shown over its lane, at the line,
 *  and whether the tile counts as tapped (green) or missed (red) (spec §4). */
export type LiveComment = {
  track: number;
  text: string;
  hit: boolean;
  /** Local run time it was resolved — a comment fades out `TILES_COMMENT_MS` after this. */
  at: number;
};

/**
 * One player's own board, start to finish. Everything here is local: nothing
 * is corrected by, or reported to, the referee except the periodic and
 * terminal numbers `toRun()` produces (spec §6, §8).
 */
export class TilesRun {
  lives = TILES_LIVES;
  score = 0;
  perfects = 0;
  longestStreak = 0;
  speedMul = 1;
  tiles: LiveTile[] = [];
  /** Recent accuracy feedback, for the board to draw over the line — pruned by `pruneComments`. */
  comments: LiveComment[] = [];

  #streak = 0;
  #reactionSum = 0;
  #reactionCount = 0;
  #nextIndex = 0;
  #nextId = 0;
  readonly roundId: number;

  constructor(roundId: number) {
    this.roundId = roundId;
  }

  get avgReactionMs(): number {
    return this.#reactionCount > 0 ? this.#reactionSum / this.#reactionCount : 0;
  }

  /** This instant's own fall duration — every NEW tile spawns at this speed. */
  get fallMs(): number {
    return TILES_INITIAL_FALL_MS / this.speedMul;
  }

  get alive(): boolean {
    return this.lives > 0;
  }

  toRun(): TilesSurferRun {
    return {
      score: this.score,
      lives: this.lives,
      perfects: this.perfects,
      longestStreak: this.longestStreak,
      avgReactionMs: this.avgReactionMs,
    };
  }

  /**
   * Spawn every tile due by local run time `t`, one every
   * `TILES_SPAWN_INTERVAL_MS` (spec §2, §12) — except that a run of
   * consecutive tiles down the SAME lane spawns as one long tile to hold
   * (spec §2.2b), and consumes all of their indices at once.
   */
  spawnDue(t: number): void {
    if (!this.alive) return;
    while (this.#nextIndex * TILES_SPAWN_INTERVAL_MS <= t) {
      const spawnedAt = this.#nextIndex * TILES_SPAWN_INTERVAL_MS;
      const beats = beatsAt(this.roundId, this.#nextIndex);
      this.tiles.push({
        id: this.#nextId++,
        track: trackForTile(this.roundId, this.#nextIndex),
        spawnedAt,
        fallMs: this.fallMs,
        beats,
        scored: 0,
        held: false,
      });
      // The merged tiles are gone from the stream, not merely drawn together:
      // their own spawn slots belong to this tile now.
      this.#nextIndex += beats;
    }
  }

  /**
   * Anything whose own scoring window has closed untapped is a miss (spec §2.2,
   * §2.3). A long tile is judged on its HEAD: let its head go by without
   * pressing and the whole thing is one miss — one life, not one per beat
   * (spec §2.2b). A tile still being held is never swept; `awardHolds` owns it
   * until the finger lifts or its last beat lands.
   */
  sweepMissed(t: number, tileHeightPx: number, lineY: number): void {
    if (!this.alive) return;
    this.tiles = this.tiles.filter((tile) => {
      if (tile.held || tile.scored > 0) return true;
      const crossAt = tile.spawnedAt + tile.fallMs;
      if (t <= crossAt + windowMsFor(tile.fallMs, tileHeightPx, lineY)) return true;
      this.#miss(tile.track, t);
      return false;
    });
  }

  /**
   * Bank every beat of a held tile that has reached the line since the last
   * frame, and retire a tile whose last beat has landed (spec §2.2b).
   *
   * A held beat is worth the full tile — there is no precision left to measure
   * once the finger is already down, and the press that started the hold was
   * judged on precision like any other tap. It does NOT count toward perfects
   * or the streak for the same reason: those measure timing, and holding is
   * not a timing.
   */
  awardHolds(t: number): void {
    if (!this.alive) return;
    this.tiles = this.tiles.filter((tile) => {
      if (!tile.held) return true;
      while (tile.scored < tile.beats && t >= beatAt(tile, tile.scored)) {
        this.score += TILES_TILE_POINTS;
        tile.scored += 1;
        this.speedMul *= TILES_SPEEDUP_MUL;
      }
      if (tile.scored < tile.beats) return true;
      // Played out in full. The finger may still be down; the lane is simply
      // free again, and lifting it later is not a drop.
      this.comments.push({ track: tile.track, text: tapComment(TILES_TILE_POINTS), hit: true, at: t });
      return false;
    });
  }

  /** Drop any accuracy comment older than `TILES_COMMENT_MS` (spec §4). */
  pruneComments(t: number): void {
    this.comments = this.comments.filter((c) => t - c.at < TILES_COMMENT_MS);
  }

  /**
   * A finger landed on `track` at local run time `t`. The earliest still-live
   * tile in that lane is the one being judged — with several queued in one
   * lane (a fast enough run can outrun the spawn cadence), the one due soonest
   * is always what a press there means.
   *
   * **A press that lands nothing costs a life** (spec §2.2): too early, too
   * late, or a lane with nothing in it at all. That last one used to be free —
   * the lane was simply ignored — which made mashing every lane strictly
   * better than reading the board, since a mash that arrived early cost
   * nothing whenever the lane happened to be empty.
   *
   * A press on a lane already held by another finger is not an attempt at
   * anything and is ignored outright: a second thumb landing on a tile that is
   * already being held should not read as a fresh mistake.
   */
  press(track: number, t: number, tileHeightPx: number, lineY: number): void {
    if (!this.alive) return;
    let best: LiveTile | null = null;
    for (const tile of this.tiles) {
      if (tile.track !== track) continue;
      if (tile.held) return;
      if (!best || tile.spawnedAt < best.spawnedAt) best = tile;
    }

    if (!best) {
      // Nothing in this lane to have pressed. Early, by the only measure that
      // matters to a player: there is no tile on the line.
      this.#miss(track, t);
      return;
    }

    const crossAt = best.spawnedAt + best.fallMs;
    const offsetMs = t - crossAt;
    const tileWindowMs = windowMsFor(best.fallMs, tileHeightPx, lineY);
    // Early or past the window is a miss outright — the score formula alone
    // would read a negative offset as an implausible >10 (spec §2.2).
    const score = offsetMs < 0 || offsetMs > tileWindowMs ? 0 : tilesImpact(offsetMs, tileWindowMs);

    if (score <= 0) {
      this.tiles = this.tiles.filter((tile) => tile !== best);
      this.#miss(best.track, t);
      return;
    }

    this.score += score;
    this.speedMul *= TILES_SPEEDUP_MUL;
    this.#reactionSum += offsetMs;
    this.#reactionCount += 1;
    best.scored = 1;

    if (isPerfect(score)) {
      this.#streak += 1;
      this.perfects += 1;
      this.longestStreak = Math.max(this.longestStreak, this.#streak);
    } else {
      this.#streak = 0;
    }

    if (best.beats > 1) {
      // A long tile: the press bought the head, and the rest is the hold.
      // `awardHolds` banks each further beat as it reaches the line.
      best.held = true;
      return;
    }

    this.comments.push({ track: best.track, text: tapComment(score), hit: true, at: t });
    this.tiles = this.tiles.filter((tile) => tile !== best);
  }

  /**
   * The finger came off `track`. Letting go of a long tile before its last
   * beat has reached the line drops it (spec §2.2b): the beats already banked
   * are kept, the rest are gone, and it costs **one** life — the same one
   * missing its head would have cost, never one per unplayed beat. A long tile
   * is an opportunity, not a bigger trap than the tiles it replaced.
   */
  release(track: number, t: number): void {
    if (!this.alive) return;
    const held = this.tiles.find((tile) => tile.track === track && tile.held);
    if (!held) return;
    this.tiles = this.tiles.filter((tile) => tile !== held);
    if (held.scored < held.beats) this.#miss(held.track, t);
  }

  #miss(track: number, t: number): void {
    this.comments.push({ track, text: TILES_MISS_COMMENT, hit: false, at: t });
    this.lives = Math.max(0, this.lives - 1);
    this.speedMul = Math.max(1, this.speedMul * TILES_MISS_MUL);
    this.#streak = 0;
  }
}

/**
 * Whether this run's own numbers are worth sending: a fresh 100-point
 * checkpoint crossed, or lives just reached 0 (spec §6) — never per tap.
 */
export function reportDue(run: TilesRun, lastReportedScore: number): boolean {
  if (!run.alive) return true;
  return Math.floor(run.score / TILES_REPORT_EVERY) > Math.floor(lastReportedScore / TILES_REPORT_EVERY);
}

/** The shared, public half — everyone's own last-reported run (spec §6). */
export type TilesSurferView = TilesSurferState & { seq: number };

export function applyTilesSurfer(prev: TilesSurferView | null, msg: ServerMessage): TilesSurferView | null {
  if (msg.t !== 'tiles') return prev;
  if (prev && prev.roundId === msg.d.roundId && msg.s <= prev.seq) return prev;
  return { ...msg.d, seq: msg.s };
}

export function scoreOf(state: TilesSurferView, id: PlayerId): number {
  return state.scores[id]?.score ?? 0;
}

/** The longest perfect streak across every player, for the results panel's own note (spec §4). */
export function bestStreak(state: TilesSurferView): number {
  return Object.values(state.scores).reduce((best, run) => Math.max(best, run.longestStreak), 0);
}
