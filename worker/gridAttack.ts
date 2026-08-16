import {
  GRID_CELLS,
  GRID_FUSE_MS,
  GRID_LIVES,
  GRID_MAX_PLAYERS,
  GRID_MIN_PLAYERS,
  GRID_READY_WAIT_MS,
  GRID_ROUND_CAP_MS,
  GRID_TAP_WINDOW_MS,
  GRID_TAPS,
  type GridCell,
  type GridState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';

/**
 * Grid Attack. Spec: docs/specs/games/grid-attack.md
 *
 * Two players, two four-by-four grids, and both of them attacking and defending at the
 * same time. Three quick taps on one of THEIR cells lights it; three quick taps on one of
 * YOURS puts it out. Two seconds between those, and if nobody puts it out the cell bursts
 * and its owner loses a life.
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md. Everything is driven through `Ctx`, which Room supplies —
 * this module never touches a socket.
 *
 * ## Everything that matters is a clock, so the server owns all of it
 *
 * A phone reports taps and nothing else. It does not decide when a cell is armed, when a
 * run of taps has gone stale, or when a cell blows — because two phones racing each other
 * on the same cell is exactly the case where two clocks disagree, and the disagreement
 * would be "I saved it" / "no you didn't". One clock, and it is this one.
 */

/** Tap progress on one cell by one player: how many, and when the last one landed. */
type Run = { taps: number; at: number };

export type Grid = GridState & {
  /**
   * Tap runs, keyed `playerId:side:cell`.
   *
   * Never sent. The whole game is that a cell says nothing to its owner until it is armed,
   * so an attacker's two-thirds of the way there is the one fact that must not travel.
   */
  runs: Record<string, Run>;
  /** Server time the ready wait gives up and starts the round anyway. */
  readyBy: number;
  /** Solo test mode is not offered here — see `startGrid`. Kept for shape parity. */
  solo: boolean;
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<Grid | null>;
  save(g: Grid): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

/** A fresh, whole grid. */
function freshCells(): GridCell[] {
  return Array.from({ length: GRID_CELLS }, () => ({ gone: false, burstAt: 0 }));
}

/**
 * When the room next needs waking: the soonest cell to burst, the end of the ready wait,
 * or the safety cap.
 *
 * Takes no clock, for the reason steady-hand.md §6 gives: Room asks this both to arm its
 * one alarm and to decide whether the alarm it woke on was this game's, and a deadline
 * computed from the caller's own clock is never due.
 */
export function nextDeadline(g: Grid): number {
  if (g.phase === 'done') return g.endsAt;
  if (g.phase === 'waiting') return g.readyBy;

  let soonest = g.endsAt;
  for (const cells of Object.values(g.grids)) {
    for (const cell of cells) {
      if (cell.burstAt > 0 && cell.burstAt < soonest) soonest = cell.burstAt;
    }
  }
  return soonest;
}

/**
 * Host pressed start. Returns false when the room is not eligible.
 *
 * **No solo mode.** Grid Attack is two grids facing each other; alone there is nobody to
 * attack and nobody attacking you, so there is no board to look at — the same reason Sling
 * Puck opts out (`soloSupported` in lobby/GameLobby.tsx). `solo` is accepted and ignored so
 * the call shape matches every other game's.
 */
export async function startGrid(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
): Promise<boolean> {
  if (!enoughToStart(connected.length, [GRID_MIN_PLAYERS, GRID_MAX_PLAYERS], false)) return false;

  const now = ctx.now();
  const grids: Record<PlayerId, GridCell[]> = {};
  const lives: Record<PlayerId, number> = {};
  const ready: Record<PlayerId, boolean> = {};
  for (const id of connected) {
    grids[id] = freshCells();
    lives[id] = GRID_LIVES;
    ready[id] = false;
  }

  const g: Grid = {
    roundId,
    grids,
    lives,
    ready,
    startsAt: 0,
    // The cap runs from the moment the board appears, not from the ready wait — a slow
    // pair should not be given a shorter game than a quick one. Until then `endsAt` only
    // has to be later than the wait, so the two deadlines cannot be confused.
    endsAt: now + GRID_READY_WAIT_MS + GRID_ROUND_CAP_MS,
    readyBy: now + GRID_READY_WAIT_MS,
    winner: null,
    phase: 'waiting',
    runs: {},
    solo: false,
  };

  await ctx.save(g);
  broadcast(ctx, g);
  // Woken at the end of the ready wait, so one phone left on a table cannot strand the
  // other in a round that never begins.
  await ctx.setAlarm(g.readyBy);
  return true;
}

/** A phone says it is fullscreen, sideways and looking at the board. */
export async function onGridReady(ctx: Ctx, playerId: PlayerId, roundId: number): Promise<void> {
  const g = await ctx.load();
  if (!g || g.phase !== 'waiting' || g.roundId !== roundId) return;
  if (!(playerId in g.ready) || g.ready[playerId]) return;

  g.ready[playerId] = true;
  if (Object.values(g.ready).every(Boolean)) begin(g, ctx.now());

  await ctx.save(g);
  broadcast(ctx, g);
  await ctx.setAlarm(nextDeadline(g));
}

function begin(g: Grid, now: number): void {
  g.phase = 'running';
  g.startsAt = now;
  g.endsAt = now + GRID_ROUND_CAP_MS;
  // Nothing tapped during the wait counts. There should be nothing — the board is not on
  // screen yet — but a client that sent early must not bank progress for the whistle.
  g.runs = {};
}

/**
 * A finger landed on a cell.
 *
 * `side` is resolved against the seating rather than trusted as an id: "mine" is this
 * player's own grid and "theirs" is the other one, so a crafted client cannot tap on
 * somebody else's behalf by naming them.
 */
export async function onGridTap(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  cell: number,
  side: 'mine' | 'theirs',
): Promise<void> {
  const g = await ctx.load();
  if (!g || g.phase !== 'running' || g.roundId !== roundId) return;
  if (!Number.isInteger(cell) || cell < 0 || cell >= GRID_CELLS) return;

  const seats = Object.keys(g.grids);
  if (!seats.includes(playerId)) return;
  const owner = side === 'mine' ? playerId : seats.find((id) => id !== playerId);
  if (owner === undefined) return;

  const target = g.grids[owner]?.[cell];
  // A hole in the grid takes no more taps, from either side.
  if (!target || target.gone) return;

  // Attacking an already-armed cell does nothing, and defending an unarmed one does
  // nothing: there is only ever one thing a cell is waiting for.
  const defending = owner === playerId;
  if (defending !== (target.burstAt > 0)) return;

  const now = ctx.now();
  const key = `${playerId}:${side}:${cell}`;
  const run = g.runs[key];
  // A run that has gone quiet is a new run, not a continuation. Three taps has to mean
  // three taps QUICKLY, or a grid can be armed all at once from taps left lying about.
  const taps = run && now - run.at <= GRID_TAP_WINDOW_MS ? run.taps + 1 : 1;

  if (taps < GRID_TAPS) {
    g.runs[key] = { taps, at: now };
    await ctx.save(g);
    // Nothing goes out: the other phone must not learn that somebody is working on a cell.
    return;
  }

  delete g.runs[key];
  if (defending) {
    target.burstAt = 0;
    /*
     * And the attacker's run on that cell dies with it. Their three taps have been spent —
     * without this, a finished run sits there and a single further tap re-arms a cell that
     * was just saved, which from the defender's side looks like the save not working.
     *
     * Only the OTHER player's run against this grid: `${me}:theirs:${cell}` is my own
     * attack on the same index of the opponent's grid, which is a different cell entirely.
     */
    for (const other of seats) {
      if (other !== playerId) delete g.runs[`${other}:theirs:${cell}`];
    }
  } else {
    target.burstAt = now + GRID_FUSE_MS;
  }

  await ctx.save(g);
  broadcast(ctx, g);
  await ctx.setAlarm(nextDeadline(g));
}

/**
 * The alarm. Ends the ready wait, blows anything due, and ends the round.
 *
 * Returns true when the round is over.
 */
export async function onGridTick(ctx: Ctx): Promise<boolean> {
  const g = await ctx.load();
  if (!g || g.phase === 'done') return false;

  const now = ctx.now();

  if (g.phase === 'waiting') {
    if (now < g.readyBy) {
      await ctx.setAlarm(nextDeadline(g));
      return false;
    }
    // The wait ran out. Play anyway: one phone that never arrived is better than a room
    // stuck on a screen with no way forward.
    begin(g, now);
    await ctx.save(g);
    broadcast(ctx, g);
    await ctx.setAlarm(nextDeadline(g));
    return false;
  }

  let burst = false;
  for (const [owner, cells] of Object.entries(g.grids)) {
    for (const cell of cells) {
      if (cell.burstAt === 0 || cell.burstAt > now) continue;
      cell.gone = true;
      cell.burstAt = 0;
      g.lives[owner] = Math.max(0, (g.lives[owner] ?? 0) - 1);
      burst = true;
    }
  }

  // Out of lives, or the cap. Either way the player still standing takes it — and a cap
  // reached level is a draw rather than a win for whoever the object listed first.
  const dead = Object.entries(g.lives).filter(([, n]) => n <= 0).map(([id]) => id);
  const capped = now >= g.endsAt;

  if (dead.length > 0 || capped) {
    g.phase = 'done';
    g.winner = decide(g.lives);
    await ctx.save(g);
    broadcast(ctx, g);
    return true;
  }

  if (burst) {
    await ctx.save(g);
    broadcast(ctx, g);
  }
  await ctx.setAlarm(nextDeadline(g));
  return false;
}

/** Most lives left, or null when they are level. */
function decide(lives: Record<PlayerId, number>): PlayerId | null {
  let best: PlayerId | null = null;
  let bestN = -1;
  let tied = false;
  for (const [id, n] of Object.entries(lives)) {
    if (n > bestN) {
      bestN = n;
      best = id;
      tied = false;
    } else if (n === bestN) {
      tied = true;
    }
  }
  return tied || bestN <= 0 ? null : best;
}

/**
 * A player vanished. The other one wins by default.
 *
 * There is no "carry on with one player" here — the whole board is two grids facing each
 * other, so a phone leaving does not shrink the game, it ends it.
 */
export async function onGridPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const g = await ctx.load();
  if (!g || g.phase === 'done') return;
  if (!(playerId in g.grids)) return;

  g.phase = 'done';
  g.lives[playerId] = 0;
  g.winner = Object.keys(g.grids).find((id) => id !== playerId) ?? null;
  await ctx.save(g);
  broadcast(ctx, g);
}

/** The board, whole. It is two arrays of sixteen small objects — there is nothing to diff. */
function broadcast(ctx: Ctx, g: Grid): void {
  ctx.broadcast({
    t: 'grid',
    s: ctx.nextSeq(),
    d: {
      roundId: g.roundId,
      grids: g.grids,
      lives: g.lives,
      ready: g.ready,
      startsAt: g.startsAt,
      endsAt: g.endsAt,
      winner: g.winner,
      phase: g.phase,
    },
  });
}
