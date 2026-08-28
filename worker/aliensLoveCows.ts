import {
  ABDUCT_BARN_COUNT,
  ABDUCT_COUNTDOWN_MS,
  ABDUCT_FLEE_MS,
  ABDUCT_MAX_PLAYERS,
  ABDUCT_MIN_PLAYERS,
  ABDUCT_REVEAL_MS,
  ABDUCT_WAIT_MS,
  type AbductBarn,
  type AbductState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart, lastStanding } from '../shared/players';

/**
 * Aliens love cows. Spec: docs/specs/games/aliens-love-cows.md
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
   * round's own resolution (who is safe, who scores, who is still in) depends
   * on this at TICK time, not only at start — a late joiner is meant to start
   * scoring the moment they are on the roster, whether or not they have
   * tapped yet (spec §7), and the match's own end condition (last one
   * standing) is read fresh off the live roster too. Every other game
   * freezes its roster at `start`; this is the one new thing Aliens love cows
   * needs from `Ctx`.
   */
  connected(): Promise<PlayerId[]>;
};

function freshBarns(): AbductBarn[] {
  return Array.from({ length: ABDUCT_BARN_COUNT }, () => ({ destroyed: false }));
}

/**
 * One of the barns still standing. If every barn has somehow been destroyed
 * already, every barn resets fresh first rather than returning nothing to
 * draw from.
 *
 * Not reachable through ordinary play: `abductTick` only ever draws a new
 * round while at least two barns are still standing — the moment only one
 * is left, the match ends by fleeing instead (spec §2, §7), never asking
 * this for a barn count of one. It stays as a defensive fallback rather
 * than an assumed invariant — a barn count change, or a future rule that
 * skips a round's destruction, would make it reachable again.
 */
function randomValidBarn(barns: AbductBarn[]): number {
  let valid = barns.reduce<number[]>((acc, b, i) => (b.destroyed ? acc : [...acc, i]), []);
  if (valid.length === 0) {
    for (const b of barns) b.destroyed = false;
    valid = barns.map((_, i) => i);
  }
  return valid[Math.floor(Math.random() * valid.length)]!;
}

/** Connected players who have not yet been abducted — the ones still playing. */
function active(game: Abduct, connected: PlayerId[]): PlayerId[] {
  return connected.filter((id) => !game.out.includes(id));
}

/** Does every active, connected player already have a barn of their own? */
function everyoneReady(game: Abduct, connected: PlayerId[]): boolean {
  const who = active(game, connected);
  return who.length > 0 && who.every((id) => game.picks[id] !== null && game.picks[id] !== undefined);
}

/**
 * The public frame is the whole state minus `solo`, which never leaves the
 * room — plus one more thing withheld before a round's own reveal: `target`
 * is drawn the instant `waiting` opens (spec §2, §8), not at any deadline,
 * but a client is never told it before `revealing`. Nulling it out here,
 * rather than not drawing it yet, is what keeps that promise — the internal
 * state and the wire state simply disagree about it until then.
 */
export function toState(game: Abduct): AbductState {
  const { solo: _solo, ...state } = game;
  return state.phase === 'waiting' || state.phase === 'countdown' ? { ...state, target: null } : state;
}

function publish(ctx: Ctx, game: Abduct): void {
  ctx.broadcast({ t: 'abduct', s: ctx.nextSeq(), d: toState(game) });
}

/** When this room next owes Aliens love cows an answer. Never, once the match is done. */
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
    phase: 'waiting',
    deadlineAt: now + ABDUCT_WAIT_MS,
    barns,
    picks: {},
    // Drawn now, not at any deadline — see `toState`'s own doc for why that
    // is safe: nothing on the wire leaks it before this round's own reveal.
    target: randomValidBarn(barns),
    abducted: [],
    out: [],
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
 * A phone tapped a barn. Sendable any number of times while a barn is still
 * choosable — during `waiting` or the final `countdown` — only the latest
 * one before the reveal is ever honoured (spec §8). Ignored outright for a
 * player already abducted (spec §2.2): once out, always out.
 *
 * The moment every active, connected player has a barn, `waiting` ends right
 * here rather than waiting out its own deadline (spec §2) — the deadline is
 * only a ceiling for stragglers.
 */
export async function onPick(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  round: number,
  barn: number,
): Promise<void> {
  const game = await ctx.load();
  if (!game || (game.phase !== 'waiting' && game.phase !== 'countdown')) return;
  // A pick belongs to the round it was made in. Without this, a stale frame
  // from a previous round — or a forged one — moves a barn nobody is at now.
  if (game.roundId !== roundId || game.round !== round) return;
  if (game.out.includes(playerId)) return;
  if (!Number.isInteger(barn) || barn < 0 || barn >= ABDUCT_BARN_COUNT) return;
  // A destroyed barn cannot be used for the rest of the match (spec §2.1) — the
  // client already disables tapping one, this is the referee's own copy of that
  // rule for a client that skips the button.
  if (game.barns[barn]?.destroyed) return;

  game.picks[playerId] = barn;
  // A late joiner's first pick is also their first appearance in the score
  // table (spec §7) — they start at nil, same as everyone at kick-off.
  if (game.scores[playerId] === undefined) game.scores[playerId] = 0;

  if (game.phase === 'waiting') {
    const connected = await ctx.connected();
    if (everyoneReady(game, connected)) {
      game.phase = 'countdown';
      game.deadlineAt = ctx.now() + ABDUCT_COUNTDOWN_MS;
      await ctx.save(game);
      publish(ctx, game);
      await ctx.setAlarm(game.deadlineAt);
      return;
    }
  }

  await ctx.save(game);
  publish(ctx, game);
}

/** The `waiting` deadline passed with stragglers left. Hiding nowhere is not
 *  the same as being safe (spec §7) — an undecided cow ends up somewhere,
 *  same as everyone else's. */
function assignStragglers(game: Abduct, connected: PlayerId[]): void {
  for (const id of active(game, connected)) {
    if (game.picks[id] === null || game.picks[id] === undefined) {
      game.picks[id] = randomValidBarn(game.barns);
    }
  }
}

/**
 * The countdown has run out. `game.target` was already drawn the moment this
 * round's own `waiting` opened — this is everything that falls out of it:
 * who is abducted, and — cows there or not — the target barn is destroyed
 * for the rest of the match (spec §2.1). An abducted player is added to
 * `out` for good (spec §2.2); everyone else still in scores a point.
 *
 * Scores and eliminations only ever move for currently CONNECTED players: a
 * disconnected player's last score simply stands (spec §7) rather than
 * continuing to tick up, or down, while nobody is there to see it.
 */
function resolveCountdown(game: Abduct, connected: PlayerId[]): void {
  const target = game.target!;
  const inPlay = active(game, connected);
  const abducted = inPlay.filter((id) => game.picks[id] === target);

  game.abducted = abducted;
  game.barns[target]!.destroyed = true;
  for (const id of abducted) game.out.push(id);

  for (const id of inPlay) {
    if (game.scores[id] === undefined) game.scores[id] = 0;
    if (!abducted.includes(id)) game.scores[id] += 1;
  }
}

/**
 * The current phase's deadline has passed. Advances `waiting` → `countdown`,
 * `countdown` → `revealing`, and `revealing` → the next round's `waiting` —
 * unless only one cow (or none) is left standing, or only one barn is left
 * standing, either of which ends the match (spec §2, §7) whatever round it
 * happens to be. `fleeing` → `done` needs no further decision: the UFO
 * leaving is itself the whole event.
 */
export async function abductTick(ctx: Ctx): Promise<void> {
  const game = await ctx.load();
  if (!game || game.phase === 'done') return;
  const now = ctx.now();
  if (now < game.deadlineAt) return;
  const connected = await ctx.connected();

  if (game.phase === 'waiting') {
    assignStragglers(game, connected);
    game.phase = 'countdown';
    game.deadlineAt = now + ABDUCT_COUNTDOWN_MS;
    await ctx.save(game);
    publish(ctx, game);
    await ctx.setAlarm(game.deadlineAt);
    return;
  }

  if (game.phase === 'countdown') {
    resolveCountdown(game, connected);
    game.phase = 'revealing';
    game.deadlineAt = now + ABDUCT_REVEAL_MS;
    await ctx.save(game);
    publish(ctx, game);
    await ctx.setAlarm(game.deadlineAt);
    return;
  }

  if (game.phase === 'fleeing') {
    game.phase = 'done';
    game.winner = null;
    await ctx.save(game);
    publish(ctx, game);
    return;
  }

  // phase === 'revealing'
  const stillIn = active(game, connected);
  if (lastStanding(stillIn.length, game.solo)) {
    game.phase = 'done';
    game.winner = stillIn[0] ?? null;
    await ctx.save(game);
    publish(ctx, game);
    return;
  }

  // With only one barn left standing, a new round could only ever force
  // every still-in player onto it — an outcome decided before it is even
  // played. Rather than run that round for show, the UFO gives up and
  // leaves (spec §2, §7): nobody wins, and the barn is never touched.
  const standing = game.barns.filter((b) => !b.destroyed).length;
  if (standing <= 1) {
    game.phase = 'fleeing';
    game.deadlineAt = now + ABDUCT_FLEE_MS;
    await ctx.save(game);
    publish(ctx, game);
    await ctx.setAlarm(game.deadlineAt);
    return;
  }

  game.round += 1;
  // Barns are NOT reset here — a destroyed barn stays destroyed for the rest
  // of the match (spec §2.1); the flee branch above is what keeps this from
  // ever needing `randomValidBarn`'s own replenish fallback.
  game.picks = {};
  game.target = randomValidBarn(game.barns);
  game.abducted = [];
  game.phase = 'waiting';
  game.deadlineAt = now + ABDUCT_WAIT_MS;
  await ctx.save(game);
  publish(ctx, game);
  await ctx.setAlarm(game.deadlineAt);
}
