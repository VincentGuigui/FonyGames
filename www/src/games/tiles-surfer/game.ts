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
  return Math.min(10, Math.max(0, 10 * (1 - offsetMs / windowMs)));
}

/** Rounds to the full ten — no separate tolerance constant (spec §2.2). */
export function isPerfect(score: number): boolean {
  return Math.round(score) === 10;
}

/** One tile currently on screen, not yet resolved. */
export type LiveTile = {
  id: number;
  track: number;
  /** Local run time (ms since this player's own board started) it spawned. */
  spawnedAt: number;
  /** Fixed at spawn, from that instant's own speed — a tile never changes speed mid-flight. */
  fallMs: number;
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

  /** Spawn every tile due by local run time `t`, one every `TILES_SPAWN_INTERVAL_MS` (spec §2, §12). */
  spawnDue(t: number): void {
    if (!this.alive) return;
    while (this.#nextIndex * TILES_SPAWN_INTERVAL_MS <= t) {
      const spawnedAt = this.#nextIndex * TILES_SPAWN_INTERVAL_MS;
      this.tiles.push({
        id: this.#nextId++,
        track: trackForTile(this.roundId, this.#nextIndex),
        spawnedAt,
        fallMs: this.fallMs,
      });
      this.#nextIndex += 1;
    }
  }

  /** Anything whose own scoring window has closed untapped is a miss (spec §2.2, §2.3). */
  sweepMissed(t: number, tileHeightPx: number, lineY: number): void {
    if (!this.alive) return;
    this.tiles = this.tiles.filter((tile) => {
      const crossAt = tile.spawnedAt + tile.fallMs;
      if (t <= crossAt + windowMsFor(tile.fallMs, tileHeightPx, lineY)) return true;
      this.#miss();
      return false;
    });
  }

  /**
   * A finger landed on `track` at local run time `t`. The earliest still-live
   * tile in that lane is the one being judged — with several queued in one
   * lane (a fast enough run can outrun the spawn cadence), the one due soonest
   * is always what a tap there means. A lane with nothing in flight is simply
   * ignored: there is no tile to have missed (spec §2.2).
   */
  tap(track: number, t: number, tileHeightPx: number, lineY: number): void {
    if (!this.alive) return;
    let best: LiveTile | null = null;
    for (const tile of this.tiles) {
      if (tile.track === track && (!best || tile.spawnedAt < best.spawnedAt)) best = tile;
    }
    if (!best) return;

    this.tiles = this.tiles.filter((tile) => tile !== best);
    const crossAt = best.spawnedAt + best.fallMs;
    const offsetMs = t - crossAt;
    const windowMs = windowMsFor(best.fallMs, tileHeightPx, lineY);
    // Early or past the window is a miss outright — the score formula alone
    // would read a negative offset as an implausible >10 (spec §2.2).
    const score = offsetMs < 0 || offsetMs > windowMs ? 0 : tilesImpact(offsetMs, windowMs);

    if (score <= 0) {
      this.#miss();
      return;
    }

    this.score += score;
    this.speedMul *= TILES_SPEEDUP_MUL;
    this.#reactionSum += offsetMs;
    this.#reactionCount += 1;

    if (isPerfect(score)) {
      this.#streak += 1;
      this.perfects += 1;
      this.longestStreak = Math.max(this.longestStreak, this.#streak);
    } else {
      this.#streak = 0;
    }
  }

  #miss(): void {
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
