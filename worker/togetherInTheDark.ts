import {
  DARK_LIVES,
  DARK_LOG_LINES,
  DARK_MAX_PLAYERS,
  DARK_MIN_PLAYERS,
  DARK_MONSTER_PATIENCE,
  DARK_MONSTER_TURNS,
  DARK_RUN_CAP_TURNS,
  DARK_TURN_MS,
  type DarkState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import {
  cellAt,
  isDarkDir,
  key,
  monsterStep,
  rollMap,
  stepIn,
  within,
  type Cell,
  type DarkDir,
  type DarkMap,
} from '../shared/darkMap';
import { enoughToStart } from '../shared/players';

/**
 * Together in the Dark. Spec: docs/specs/games/together-in-the-dark.md
 *
 * The only co-op game in the catalogue, and the only one whose referee keeps a
 * **secret**. Every other game here can broadcast its whole state; this one
 * cannot, because the hidden information is the game (§6). So the map lives
 * only in this file, and `toState` sends the visible subset — which is why that
 * function is the most important one here.
 *
 * The central mechanic is a cost, not a puzzle: on your turn you either walk
 * one cell or throw a light one cell, never both, and it is the **team's** turn
 * you are spending. That is what makes the people not acting the loudest people
 * in the room.
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md.
 */

export type DarkMonster = {
  at: Cell;
  /** Awake monsters walk; asleep ones sit still and unseen. */
  awake: boolean;
  /** The cell it was lit at — what it walks toward, not the character's live
   *  position (spec §2.2), which is what makes baiting one a real play. */
  toward: Cell;
  /** Turn index of its next move. Slow: one cell every `DARK_MONSTER_TURNS`. */
  movesAt: number;
  /** How many of its own moves it has spent standing on `toward`. At
   *  `DARK_MONSTER_PATIENCE` it goes back to sleep. */
  waited: number;
};

export type Dark = {
  roundId: number;
  map: DarkMap;
  monsters: DarkMonster[];
  /** Turn order is join order (spec §2). */
  order: PlayerId[];
  turn: number;
  turnEndsAt: number;
  at: Cell;
  /** Where the character came from, for the shove-back on a trap or a monster. */
  cameFrom: Cell;
  /** Revealed this turn only. */
  lit: { at: Cell; kind: string }[];
  /** The dim terrain memory. Monsters are deliberately never in here. */
  seen: Record<string, string>;
  escapeSeen: boolean;
  lives: number;
  log: string[];
  phase: 'playing' | 'done';
  won: boolean;
  solo: boolean;
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<Dark | null>;
  save(s: Dark): Promise<void>;
  setAlarm(at: number): Promise<void>;
  random(): number;
};

export function nextDeadline(s: Dark): number {
  return s.phase === 'done' ? Infinity : s.turnEndsAt;
}

/** Whose turn it is. Null only when the room has emptied. */
function currentPlayer(s: Dark): PlayerId | null {
  if (s.order.length === 0) return null;
  return s.order[s.turn % s.order.length] ?? null;
}

/**
 * A map that is known to roll cleanly, for the case where the roller cannot
 * produce one — the same shape as Gravity Shooter's committed fallback board.
 */
function fallbackMap(players: number): DarkMap {
  let h = 20260907;
  const random = (): number => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 4294967296;
  };
  for (let i = 0; i < 200; i++) {
    const m = rollMap(random, players);
    if (m) return m;
  }
  // Unreachable in practice: a bare corridor with nothing in it is still a
  // finishable map, and a boring round beats a broken one.
  const start = { x: 5, y: 12 };
  const escape = { x: 5, y: 2 };
  const path: Cell[] = [];
  for (let y = start.y; y >= escape.y; y--) path.push({ x: 5, y });
  return { cols: 12, rows: 16, start, escape, traps: [], monsters: [], trees: [], path };
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startDark(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [DARK_MIN_PLAYERS, DARK_MAX_PLAYERS], solo)) return false;

  let map = rollMap(ctx.random, connected.length);
  if (!map) map = fallbackMap(connected.length);

  const now = ctx.now();
  const s: Dark = {
    roundId,
    map,
    monsters: map.monsters.map((at) => ({ at, awake: false, toward: at, movesAt: 0, waited: 0 })),
    order: [...connected],
    turn: 0,
    turnEndsAt: now + DARK_TURN_MS,
    at: map.start,
    cameFrom: map.start,
    lit: [],
    seen: {},
    escapeSeen: false,
    lives: DARK_LIVES,
    log: [],
    phase: 'playing',
    won: false,
    solo: solo || connected.length <= 1,
  };

  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/** One line onto the turn log, keeping only what fits above the controls. */
function say(s: Dark, line: string): void {
  s.log.push(line);
  while (s.log.length > DARK_LOG_LINES) s.log.shift();
}

/**
 * The current player's one action (spec §2).
 *
 * Returns true when the run ended on it.
 */
export async function onAct(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  turn: number,
  rawAction: unknown,
  rawDir: unknown,
): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.roundId !== roundId || s.phase !== 'playing') return false;
  // An action from a player whose turn it is not is ignored, and so is one for
  // a stale turn index — which is what stops a double-tap spending two turns
  // (spec §8).
  if (currentPlayer(s) !== playerId || s.turn !== turn) return false;
  if (rawAction !== 'walk' && rawAction !== 'light') return false;
  if (!isDarkDir(rawDir)) return false;

  return resolve(ctx, s, rawAction, rawDir);
}

/**
 * The clock. A player who does nothing has their turn spent on a **light in
 * the direction of travel** rather than skipped — friendlier, and it never
 * wastes the team's turn (spec §2).
 */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase === 'done') return false;
  if (ctx.now() < s.turnEndsAt) return false;

  // The direction of travel, or north if the character has not moved yet.
  const dx = s.at.x - s.cameFrom.x;
  const dy = s.at.y - s.cameFrom.y;
  const dir: DarkDir = dx > 0 ? 'E' : dx < 0 ? 'W' : dy > 0 ? 'S' : 'N';
  say(s, `nobody acted — a light went ${dir}`);
  return resolve(ctx, s, 'light', dir);
}

/**
 * Apply one action, move the monsters, and pass the turn.
 *
 * Order matters: the action resolves first, then the monsters move, then the
 * turn passes — so a monster that steps onto the character does so *after* the
 * team has had its go, which is what makes walking into an occupied cell and
 * being caught in one two different events.
 */
async function resolve(ctx: Ctx, s: Dark, action: 'walk' | 'light', dir: DarkDir): Promise<boolean> {
  s.lit = [];
  const target = stepIn(s.at, dir);

  if (!within(s.map, target)) {
    say(s, `${dir} is the edge of the forest`);
  } else if (action === 'light') {
    /*
     * A light shows one cell for this turn only, and what it holds is
     * announced to the whole room — this is a game about arguing, so
     * information is shared the instant it exists (spec §2).
     */
    const kind = cellAt(s.map, target, s.monsters.map((m) => m.at));
    s.lit.push({ at: target, kind });
    // Terrain is remembered; a monster never is (spec §2.2).
    if (kind !== 'monster') s.seen[key(target)] = kind;
    if (kind === 'escape') s.escapeSeen = true;
    say(s, `a light went ${dir} — ${kind}`);

    if (kind === 'monster') {
      // Lighting a monster wakes it, and it heads for where it was lit rather
      // than where the character is: forgiving, and baitable (spec §2.2).
      for (const monster of s.monsters) {
        if (monster.at.x === target.x && monster.at.y === target.y && !monster.awake) {
          monster.awake = true;
          monster.toward = target;
          monster.movesAt = s.turn + DARK_MONSTER_TURNS;
          monster.waited = 0;
        }
      }
    }
  } else {
    const kind = cellAt(s.map, target, s.monsters.map((m) => m.at));
    if (kind === 'tree') {
      say(s, `${dir} is a tree`);
      s.seen[key(target)] = 'tree';
    } else if (kind === 'trap') {
      /*
       * A trap costs the TURN and a cell of ground, not a life (spec §2.2).
       * Instant death would make fifteen steps a minefield and end a
       * three-minute round in twelve seconds.
       */
      s.seen[key(target)] = 'trap';
      s.lit.push({ at: target, kind: 'trap' });
      say(s, `a trap ${dir}! shoved back`);
      s.at = s.cameFrom;
    } else if (kind === 'monster') {
      // Walking into one costs a life and shoves the character back; the
      // monster then sleeps again.
      s.lives = Math.max(0, s.lives - 1);
      s.lit.push({ at: target, kind: 'monster' });
      say(s, `something was ${dir}! a life gone`);
      s.at = s.cameFrom;
      for (const monster of s.monsters) {
        if (monster.at.x === target.x && monster.at.y === target.y) {
          monster.awake = false;
          monster.waited = 0;
        }
      }
    } else {
      s.cameFrom = s.at;
      s.at = target;
      s.seen[key(target)] = kind === 'escape' ? 'escape' : 'floor';
      if (kind === 'escape') s.escapeSeen = true;
      say(s, `walked ${dir}`);
    }
  }

  // Reached the escape: everybody wins.
  if (s.at.x === s.map.escape.x && s.at.y === s.map.escape.y) {
    s.won = true;
    return await finish(ctx, s);
  }

  moveMonsters(s);

  // Contact after a monster's own move: same cost, and it sleeps again.
  for (const monster of s.monsters) {
    if (monster.awake && monster.at.x === s.at.x && monster.at.y === s.at.y) {
      s.lives = Math.max(0, s.lives - 1);
      s.at = s.cameFrom;
      monster.awake = false;
      monster.waited = 0;
      say(s, 'something found you — a life gone');
    }
  }

  if (s.lives <= 0) return await finish(ctx, s);
  // The cap: a co-op room that will not finish is not a design element.
  if (s.turn + 1 >= DARK_RUN_CAP_TURNS) return await finish(ctx, s);

  s.turn += 1;
  s.turnEndsAt = ctx.now() + DARK_TURN_MS;
  await ctx.save(s);
  broadcast(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

/** Every awake monster that is due, one cell toward where it was lit. */
function moveMonsters(s: Dark): void {
  for (const monster of s.monsters) {
    if (!monster.awake || s.turn < monster.movesAt) continue;
    monster.movesAt = s.turn + DARK_MONSTER_TURNS;

    const arrived = monster.at.x === monster.toward.x && monster.at.y === monster.toward.y;
    if (arrived) {
      // Nobody here. A monster that reaches its target and finds nothing goes
      // back to sleep, so a bait is a real play rather than a permanent
      // removal (spec §2.2).
      monster.waited += 1;
      if (monster.waited >= DARK_MONSTER_PATIENCE) {
        monster.awake = false;
        monster.waited = 0;
      }
      continue;
    }
    monster.at = monsterStep(monster.at, monster.toward, s.map);
  }
}

/**
 * A player left: dropped from the turn order (spec §7).
 *
 * If it was their turn, the deadline resolves it as an auto-light and play
 * moves on — which is already what `tick` does, so nothing special is needed
 * here beyond keeping the index in range.
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase === 'done') return;
  const at = s.order.indexOf(playerId);
  if (at === -1) return;
  s.order.splice(at, 1);

  // Everybody left. The run stops rather than ticking on with nobody in it.
  if (s.order.length === 0) {
    await finish(ctx, s);
    return;
  }
  // Removing an earlier player shifts everyone along, so the turn index has to
  // move with them or the wrong phone gets the controls.
  if (at < s.turn % (s.order.length + 1)) s.turn = Math.max(0, s.turn - 1);
  await ctx.save(s);
  broadcast(ctx, s);
}

async function finish(ctx: Ctx, s: Dark): Promise<boolean> {
  s.phase = 'done';
  // Co-op: the room wins or loses together, and there is no ranking (spec §2).
  say(s, s.won ? 'out of the woods' : 'the forest kept him');
  await ctx.save(s);
  broadcast(ctx, s);
  return true;
}

/**
 * What each phone is allowed to know. **The most important function here.**
 *
 * The map is never in it. `lit` is this turn's revealed cells, `seen` is the
 * dim terrain memory, and `escape` appears only once somebody has actually
 * seen it — so a modified client has nothing to read (spec §6).
 */
export function toState(s: Dark): DarkState {
  return {
    roundId: s.roundId,
    cols: s.map.cols,
    rows: s.map.rows,
    turn: s.turn,
    who: currentPlayer(s),
    turnEndsAt: s.turnEndsAt,
    at: { x: s.at.x, y: s.at.y },
    lit: s.lit.map((l) => ({ x: l.at.x, y: l.at.y, kind: l.kind })),
    seen: Object.entries(s.seen).map(([k, kind]) => {
      const [x, y] = k.split(',').map(Number) as [number, number];
      return { x, y, kind };
    }),
    escape: s.escapeSeen ? { x: s.map.escape.x, y: s.map.escape.y } : null,
    lives: s.lives,
    turns: s.turn,
    log: [...s.log],
    phase: s.phase,
    won: s.won,
  };
}

function broadcast(ctx: Ctx, s: Dark): void {
  ctx.broadcast({ t: 'dark', s: ctx.nextSeq(), d: toState(s) });
}
