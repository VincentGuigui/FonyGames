import {
  BUMP_MUTE_MS,
  BUMP_PAIR_WINDOW_MS,
  BUMP_QUOTA,
  BUMP_QUOTA_WINDOW_MS,
  BOMB_CLASSIC_ROUNDS,
  BOMB_DUEL_ROUNDS,
  BOMB_MAX_PLAYERS,
  BOMB_MIN_PLAYERS,
  BUMP_ROUND_CAP_MS,
  CLOCK_SKEW_TOLERANCE_MS,
  FUSE_FLOOR_MAX_MS,
  FUSE_FLOOR_MIN_MS,
  FUSE_MAX_MS,
  FUSE_MIN_MS,
  FUSE_SHRINK,
  type BombMatch,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart, lastStanding } from '../shared/players';

/**
 * Pass the Bomb — `classic` mode. Spec: docs/specs/games/pass-the-bomb.md
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md. Everything here is driven through `Ctx`,
 * which Room supplies — this module never touches a socket directly.
 */

export type Bomb = {
  roundId: number;
  holder: PlayerId;
  /** Server time at which the bomb goes off unless it is passed on. */
  fuseAt: number;
  /** Still in the round. Eliminated players drop out of this list. */
  alive: PlayerId[];
  /** Current fuse bounds; they shrink after every elimination. */
  fuseMin: number;
  fuseMax: number;
  /** Unpaired bumps waiting for a partner: playerId -> server time. */
  pending: Record<PlayerId, number>;
  /** Bump timestamps per player, for the anti-spam quota. */
  quota: Record<PlayerId, number[]>;
  /** Players whose bumps are ignored until this server time. */
  mutedUntil: Record<PlayerId, number>;
  /** Hard cap on the whole round (safety rule). */
  endsAt: number;
  /**
   * Started in solo test mode, so "last one standing" does not end the round.
   *
   * Alone you ARE the last one standing at kick-off, so the round would finish in the
   * tick it began and there would be nothing to look at — which is the whole point of
   * the mode (`enoughToStart` in shared/players.ts). The time cap still ends it and
   * nothing else changes. Stored on the ROUND rather than read from a flag, so a round
   * that began solo stays solo even if somebody joins halfway through.
   */
  solo: boolean;
  phase: 'running' | 'done';
  /** Wins and how far through — see `BombMatch` in shared/protocol.ts. */
  match: BombMatch;
  /**
   * Who the match was started with.
   *
   * A match only continues while the same people are playing it. Somebody joining or
   * leaving between rounds is a new evening, not a mid-match substitution, and carrying
   * three rounds of standings over a changed room would put a player on the board who was
   * not there for any of it.
   */
  roster: PlayerId[];
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  sendTo(playerId: PlayerId, msg: ServerMessage): void;
  load(): Promise<Bomb | null>;
  save(bomb: Bomb): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

function drawFuse(min: number, max: number, now: number): number {
  return now + min + Math.floor(Math.random() * (max - min));
}

/* ------------------------------------------------------------------ */
/* The match around the round                                          */
/* ------------------------------------------------------------------ */

/**
 * A duel is anything two phones can play — which includes one, in solo test mode.
 *
 * The distinction is not "how many players" for its own sake, it is whether *elimination*
 * can carry a round: with three or more, players go out one at a time and the round has
 * somewhere to go, so one round — played to a last player standing — is the whole match.
 * With two it is over on the first boom, so the match is three of those instead.
 */
function isDuel(players: number): boolean {
  return players <= 2;
}

/** Standings at nil-nil. */
function freshMatch(connected: PlayerId[]): BombMatch {
  return {
    round: 1,
    rounds: isDuel(connected.length) ? BOMB_DUEL_ROUNDS : BOMB_CLASSIC_ROUNDS,
    wins: Object.fromEntries(connected.map((id) => [id, 0])),
    champion: null,
    done: false,
  };
}

/** The same people, in any order. */
function sameRoster(a: PlayerId[], b: PlayerId[]): boolean {
  return a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ');
}

/** Continue the match in progress, or start a new one. */
function nextMatch(prev: Bomb | null, connected: PlayerId[]): BombMatch {
  if (!prev || prev.match.done || !sameRoster(prev.roster, connected)) return freshMatch(connected);
  return { ...prev.match, round: prev.match.round + 1 };
}

/**
 * Who is ahead, or null when nobody is.
 *
 * A tie has no champion and neither does a table of zeroes: a five-round match that ends
 * three-all is a draw, and the end screen says "nobody won that one" rather than picking
 * whoever the object happened to list first.
 */
function leader(table: Record<PlayerId, number>): PlayerId | null {
  let best: PlayerId | null = null;
  let bestN = 0;
  let tied = false;
  for (const [id, n] of Object.entries(table)) {
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

/**
 * Book the round that has just finished, and decide whether the match has finished with it.
 *
 * Mutates the match in place; the caller broadcasts it. Called from both endings — the fuse
 * and a player walking out — because a round that ends either way still counts.
 */
function closeRound(bomb: Bomb): void {
  const m = bomb.match;
  // The survivor takes the round. Nobody left (solo, or a room that emptied) takes nothing,
  // which is what makes a draw possible.
  const survivor = bomb.alive.length === 1 ? bomb.alive[0] : undefined;
  if (survivor !== undefined) m.wins[survivor] = (m.wins[survivor] ?? 0) + 1;

  m.done = m.round >= m.rounds;
  if (m.done) m.champion = leader(m.wins);
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startBomb(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  // Both ends, from shared/players.ts. The maximum was missing, so a ninth and tenth
  // player could join and start a round the card had promised was 3-8.
  if (!enoughToStart(connected.length, [BOMB_MIN_PLAYERS, BOMB_MAX_PLAYERS], solo)) return false;

  const now = ctx.now();
  const holder = connected[Math.floor(Math.random() * connected.length)] as PlayerId;
  // Reads the round that just finished, which is how a match survives being played one
  // "start" at a time: the host pressing Next round is the same frame as Play again.
  const match = nextMatch(await ctx.load(), connected);

  const bomb: Bomb = {
    roundId,
    holder,
    fuseAt: drawFuse(FUSE_MIN_MS, FUSE_MAX_MS, now),
    alive: [...connected],
    fuseMin: FUSE_MIN_MS,
    fuseMax: FUSE_MAX_MS,
    pending: {},
    quota: {},
    mutedUntil: {},
    endsAt: now + BUMP_ROUND_CAP_MS,
    phase: 'running',
    solo,
    match,
    roster: [...connected],
  };

  await ctx.save(bomb);
  // The remaining time is never sent — that is the whole game (spec §2.1).
  ctx.broadcast({
    t: 'bomb',
    s: ctx.nextSeq(),
    d: { roundId, holder, alive: bomb.alive, match },
  });
  await ctx.setAlarm(bomb.fuseAt);
  return true;
}

/**
 * A player's phone felt a knock.
 *
 * A lone bump means nothing: it only becomes a transfer when a second player
 * bumps within BUMP_PAIR_WINDOW_MS **and one of the pair is the bomb holder**.
 * That is what stops someone tapping their own phone to pass the bomb away.
 */
export async function onBump(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  clientAt: number,
): Promise<void> {
  const bomb = await ctx.load();
  if (!bomb || bomb.phase !== 'running') return;
  // A bump belongs to the round it was felt in. Without this, a stale frame
  // from a previous round — or a forged one — moves the current bomb.
  if (bomb.roundId !== roundId) return;
  if (!bomb.alive.includes(playerId)) return;

  const now = ctx.now();

  if ((bomb.mutedUntil[playerId] ?? 0) > now) return;

  // Never trust a client timestamp beyond a small skew allowance.
  const at = Math.min(Number.isFinite(clientAt) ? clientAt : now, now + CLOCK_SKEW_TOLERANCE_MS);

  // Anti-spam: shaking wildly produces a stream of spikes. Exceeding the quota
  // mutes this player briefly rather than ending their round (spec §8).
  const recent = (bomb.quota[playerId] ?? []).filter(
    (t) => now - t < BUMP_QUOTA_WINDOW_MS,
  );
  recent.push(now);
  bomb.quota[playerId] = recent;
  if (recent.length > BUMP_QUOTA) {
    bomb.mutedUntil[playerId] = now + BUMP_MUTE_MS;
    await ctx.save(bomb);
    ctx.sendTo(playerId, {
      t: 'calm-down',
      d: { untilServerTime: now + BUMP_MUTE_MS },
    });
    return;
  }

  // Drop bumps too old to pair with anything, so `pending` cannot grow without
  // bound over a long round.
  for (const [other, t] of Object.entries(bomb.pending)) {
    if (at - t > BUMP_PAIR_WINDOW_MS) delete bomb.pending[other];
  }

  // Look for a partner: someone else whose bump landed within the window.
  let partner: PlayerId | null = null;
  for (const [other, t] of Object.entries(bomb.pending)) {
    if (other === playerId) continue;
    if (Math.abs(at - t) <= BUMP_PAIR_WINDOW_MS && bomb.alive.includes(other)) {
      partner = other;
      break;
    }
  }

  if (!partner) {
    bomb.pending[playerId] = at;
    await ctx.save(bomb);
    return;
  }

  delete bomb.pending[partner];
  delete bomb.pending[playerId];

  // Exactly one of the pair must be holding the bomb; the other receives it.
  const receiver =
    bomb.holder === playerId ? partner : bomb.holder === partner ? playerId : null;
  if (!receiver) {
    await ctx.save(bomb);
    return;
  }

  bomb.holder = receiver;
  await ctx.save(bomb);
  // Passing does NOT reset the fuse — the alarm stays where it was.
  ctx.broadcast({
    t: 'bomb',
    s: ctx.nextSeq(),
    d: { roundId: bomb.roundId, holder: receiver, alive: bomb.alive, match: bomb.match },
  });
}

/** Touch fallback for a player whose device has no usable motion sensor. */
export async function onPass(
  ctx: Ctx,
  from: PlayerId,
  roundId: number,
  to: PlayerId,
): Promise<void> {
  const bomb = await ctx.load();
  if (!bomb || bomb.phase !== 'running') return;
  if (bomb.roundId !== roundId) return;
  if (bomb.holder !== from) return;
  if (from === to || !bomb.alive.includes(to)) return;

  bomb.holder = to;
  await ctx.save(bomb);
  ctx.broadcast({
    t: 'bomb',
    s: ctx.nextSeq(),
    d: { roundId: bomb.roundId, holder: to, alive: bomb.alive, match: bomb.match },
  });
}

/**
 * The fuse expired, or the round hit its safety cap.
 * Returns true when the round is over.
 */
export async function onFuse(ctx: Ctx): Promise<boolean> {
  const bomb = await ctx.load();
  if (!bomb || bomb.phase !== 'running') return false;

  const now = ctx.now();
  const victim = bomb.holder;
  bomb.alive = bomb.alive.filter((p) => p !== victim);
  bomb.pending = {};

  // With two people this is already true the moment the fuse blows: nobody is left to pass
  // to. With three or more it is the same check the classic round always used — it just
  // used to reset for another round afterwards, and now it does not (§2.2).
  const over = lastStanding(bomb.alive.length, bomb.solo) || now >= bomb.endsAt;
  if (over) closeRound(bomb);

  ctx.broadcast({
    t: 'boom',
    s: ctx.nextSeq(),
    d: { roundId: bomb.roundId, victim, alive: bomb.alive, over, match: bomb.match },
  });

  if (over) {
    bomb.phase = 'done';
    await ctx.save(bomb);
    return true;
  }

  // Shrink the fuse so each round tightens, with a floor so it stays playable.
  bomb.fuseMin = Math.max(FUSE_FLOOR_MIN_MS, Math.round(bomb.fuseMin * FUSE_SHRINK));
  bomb.fuseMax = Math.max(FUSE_FLOOR_MAX_MS, Math.round(bomb.fuseMax * FUSE_SHRINK));
  bomb.holder = bomb.alive[Math.floor(Math.random() * bomb.alive.length)] as PlayerId;
  bomb.fuseAt = drawFuse(bomb.fuseMin, bomb.fuseMax, now);

  await ctx.save(bomb);
  ctx.broadcast({
    t: 'bomb',
    s: ctx.nextSeq(),
    d: { roundId: bomb.roundId, holder: bomb.holder, alive: bomb.alive, match: bomb.match },
  });
  await ctx.setAlarm(Math.min(bomb.fuseAt, bomb.endsAt));
  return false;
}

/**
 * A player vanished. If they were holding the bomb it must move, or the round
 * stalls until the fuse blows on someone who is not there.
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const bomb = await ctx.load();
  if (!bomb || bomb.phase !== 'running') return;
  if (!bomb.alive.includes(playerId)) return;

  bomb.alive = bomb.alive.filter((p) => p !== playerId);
  delete bomb.pending[playerId];

  if (lastStanding(bomb.alive.length, bomb.solo)) {
    closeRound(bomb);
    /*
     * And the match with it. The next round would be played by a different set of people,
     * so `nextMatch` would start a fresh one regardless — saying so here means the end
     * screen offers "play again" rather than a next round that would not be the same match.
     */
    bomb.match.done = true;
    bomb.match.champion = leader(bomb.match.wins);
    bomb.phase = 'done';
    await ctx.save(bomb);
    ctx.broadcast({
      t: 'boom',
      s: ctx.nextSeq(),
      d: {
        roundId: bomb.roundId,
        victim: playerId,
        alive: bomb.alive,
        over: true,
        match: bomb.match,
      },
    });
    return;
  }

  if (bomb.holder === playerId) {
    bomb.holder = bomb.alive[Math.floor(Math.random() * bomb.alive.length)] as PlayerId;
  }
  await ctx.save(bomb);
  ctx.broadcast({
    t: 'bomb',
    s: ctx.nextSeq(),
    d: { roundId: bomb.roundId, holder: bomb.holder, alive: bomb.alive, match: bomb.match },
  });
}
