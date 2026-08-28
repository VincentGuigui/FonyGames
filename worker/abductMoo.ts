import {
  ABDUCT_BARN_COUNT,
  ABDUCT_CHOOSE_MS,
  ABDUCT_MAX_PLAYERS,
  ABDUCT_MIN_PLAYERS,
  ABDUCT_REVEAL_MS,
  ABDUCT_ROUNDS,
  type AbductBarn,
  type AbductState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';

/**
 * Abduct-Moo. Spec: docs/specs/games/abduct-moo.md
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md. Everything here is driven through `Ctx`,
 * which Room supplies — this module never touches a socket directly.
 *
 * Unlike every other game in this catalogue, the whole match is public
 * (spec §6): a player's own barn pick is something everyone else is
 * explicitly meant to see live, so there is no private half to keep off
 * the wire. `Abduct` below is the wire shape (`AbductState`) plus the one
 * field that never leaves the room: `solo`.
 */
export type Abduct = AbductState & {
  /** Started in solo test mode — see shared/players.ts. Nothing else moves. */
  solo: boolean;
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<Abduct | null>;
  save(game: Abduct): Promise<void>;
  setAlarm(at: number): Promise<void>;
  /**
   * Who is on the room's roster right now. Unlike every other game here, a
   * round's own resolution (who is safe, who scores) depends on this at
   * TICK time, not only at start — a late joiner is meant to start scoring
   * the moment they are on the roster, whether or not they have tapped yet
   * (spec §7). Every other game freezes its roster at `start`; this is the
   * one new thing Abduct-Moo needs from `Ctx`.
   */
  connected(): Promise<PlayerId[]>;
};

function freshBarns(): AbductBarn[] {
  return Array.from({ length: ABDUCT_BARN_COUNT }, () => ({ destroyed: false }));
}

/**
 * One of the barns still standing, or null if every one of them has been
 * destroyed already (never actually reachable at `ABDUCT_BARN_COUNT: 5` and
 * `ABDUCT_ROUNDS: 3` — at most one barn is destroyed per round — but a random
 * draw is not the place to assume an invariant holds forever).
 */
function randomValidBarn(barns: AbductBarn[]): number | null {
  const valid = barns.reduce<number[]>((acc, b, i) => (b.destroyed ? acc : [...acc, i]), []);
  if (valid.length === 0) return null;
  return valid[Math.floor(Math.random() * valid.length)]!;
}

/**
 * The public frame is the whole state minus `solo`, which never leaves the
 * room — plus one more thing withheld while `phase === 'choosing'`: `target`
 * is drawn the instant a round's choosing phase opens (spec §2, §8), not at
 * its deadline, but a client is never told it before its own reveal. Nulling
 * it out here, rather than not drawing it yet, is what keeps that promise —
 * the internal state and the wire state simply disagree about it until then.
 */
export function toState(game: Abduct): AbductState {
  const { solo: _solo, ...state } = game;
  return state.phase === 'choosing' ? { ...state, target: null } : state;
}

function publish(ctx: Ctx, game: Abduct): void {
  ctx.broadcast({ t: 'abduct', s: ctx.nextSeq(), d: toState(game) });
}

/**
 * Who has the most points, or null when several players are tied for the
 * top — the same "a tie is unranked" convention Pass the Bomb's own
 * (unexported) `leader` uses. A small pure helper like this is cheaper
 * duplicated than cross-imported between sibling worker modules.
 */
function leader(scores: Record<PlayerId, number>): PlayerId | null {
  let best: PlayerId | null = null;
  let bestN = 0;
  let tied = false;
  for (const [id, n] of Object.entries(scores)) {
    if (n > bestN) {
      bestN = n;
      best = id;
      tied = false;
    } else if (n === bestN) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/** When this room next owes Abduct-Moo an answer. Never, once the match is done. */
export function nextDeadline(game: Abduct): number {
  return game.phase === 'done' ? Infinity : game.deadlineAt;
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startAbduct(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [ABDUCT_MIN_PLAYERS, ABDUCT_MAX_PLAYERS], solo)) return false;

  const now = ctx.now();
  const barns = freshBarns();
  const game: Abduct = {
    roundId,
    round: 1,
    phase: 'choosing',
    deadlineAt: now + ABDUCT_CHOOSE_MS,
    barns,
    picks: {},
    // Drawn now, not at the deadline — see `toState`'s own doc for why that
    // is safe: nothing on the wire leaks it before this round's own reveal.
    target: randomValidBarn(barns),
    abducted: [],
    scores: Object.fromEntries(connected.map((id) => [id, 0])),
    winner: null,
    solo,
  };

  await ctx.save(game);
  publish(ctx, game);
  await ctx.setAlarm(game.deadlineAt);
  return true;
}

/**
 * A phone tapped a barn. Sendable any number of times while choosing is open —
 * only the latest one before the deadline is ever honoured (spec §8).
 */
export async function onPick(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  round: number,
  barn: number,
): Promise<void> {
  const game = await ctx.load();
  if (!game || game.phase !== 'choosing') return;
  // A pick belongs to the round it was made in. Without this, a stale frame
  // from a previous round — or a forged one — moves a barn nobody is at now.
  if (game.roundId !== roundId || game.round !== round) return;
  if (!Number.isInteger(barn) || barn < 0 || barn >= ABDUCT_BARN_COUNT) return;
  // A destroyed barn cannot be used for the rest of the match (spec §2.1) — the
  // client already disables tapping one, this is the referee's own copy of that
  // rule for a client that skips the button.
  if (game.barns[barn]?.destroyed) return;

  game.picks[playerId] = barn;
  // A late joiner's first pick is also their first appearance in the score
  // table (spec §7) — they start at nil, same as everyone at kick-off.
  if (game.scores[playerId] === undefined) game.scores[playerId] = 0;
  await ctx.save(game);
  publish(ctx, game);
}

/**
 * The choosing deadline has passed. `game.target` was already drawn the
 * moment this round opened (`toState` is what kept it off the wire since) —
 * everything here is what falls out of it: a random valid barn for anyone
 * who never tapped one, who gets abducted, whether the target is destroyed,
 * and this round's scoring.
 *
 * Scores only ever move for currently CONNECTED players: a disconnected
 * player's last score simply stands (spec §7) rather than continuing to tick
 * up, or down, while nobody is there to see it.
 */
function resolveChoosing(game: Abduct, connected: PlayerId[]): void {
  for (const id of connected) {
    if (game.picks[id] === null || game.picks[id] === undefined) {
      // Hiding nowhere is not the same as being safe (spec §12) — an
      // undecided cow ends up somewhere, same as everyone else's.
      game.picks[id] = randomValidBarn(game.barns);
    }
  }

  const { target } = game;
  const abducted = target === null ? [] : connected.filter((id) => game.picks[id] === target);
  game.abducted = abducted;
  // Nobody was there to take — the barn itself is what the UFO has to show for it.
  if (target !== null && abducted.length === 0) game.barns[target]!.destroyed = true;

  for (const id of connected) {
    if (game.scores[id] === undefined) game.scores[id] = 0;
    if (!abducted.includes(id)) game.scores[id] += 1;
  }
}

/**
 * The current phase's deadline has passed. Advances choosing → revealing,
 * or revealing → the next round's choosing, or → `done` after the last one.
 */
export async function abductTick(ctx: Ctx): Promise<void> {
  const game = await ctx.load();
  if (!game || game.phase === 'done') return;
  const now = ctx.now();
  if (now < game.deadlineAt) return;

  if (game.phase === 'choosing') {
    resolveChoosing(game, await ctx.connected());
    game.phase = 'revealing';
    game.deadlineAt = now + ABDUCT_REVEAL_MS;
    await ctx.save(game);
    publish(ctx, game);
    await ctx.setAlarm(game.deadlineAt);
    return;
  }

  // phase === 'revealing'
  if (game.round >= ABDUCT_ROUNDS) {
    game.phase = 'done';
    game.winner = leader(game.scores);
    await ctx.save(game);
    publish(ctx, game);
    return;
  }

  game.round += 1;
  // Barns are NOT reset here — a destroyed barn stays destroyed for the rest
  // of the match (spec §2.1), so `game.barns` carries straight over.
  game.picks = {};
  game.target = randomValidBarn(game.barns);
  game.abducted = [];
  game.phase = 'choosing';
  game.deadlineAt = now + ABDUCT_CHOOSE_MS;
  await ctx.save(game);
  publish(ctx, game);
  await ctx.setAlarm(game.deadlineAt);
}
