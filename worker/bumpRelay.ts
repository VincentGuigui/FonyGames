import {
  BUMP_MUTE_MS,
  BUMP_PAIR_WINDOW_MS,
  BUMP_QUOTA,
  BUMP_QUOTA_WINDOW_MS,
  BUMP_RELAY_MIN_PLAYERS,
  BUMP_ROUND_CAP_MS,
  CLOCK_SKEW_TOLERANCE_MS,
  FUSE_FLOOR_MAX_MS,
  FUSE_FLOOR_MIN_MS,
  FUSE_MAX_MS,
  FUSE_MIN_MS,
  FUSE_SHRINK,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';

/**
 * Bump Relay — `classic` mode. Spec: docs/specs/games/bump-relay.md
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md. Everything here is driven through `Ctx`,
 * which Room supplies — this module never touches a socket directly.
 */

export type Relay = {
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
  phase: 'running' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  sendTo(playerId: PlayerId, msg: ServerMessage): void;
  load(): Promise<Relay | null>;
  save(relay: Relay): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

function drawFuse(min: number, max: number, now: number): number {
  return now + min + Math.floor(Math.random() * (max - min));
}

/** Host pressed start. Returns false when the room is not eligible. */
export async function startRelay(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
): Promise<boolean> {
  if (connected.length < BUMP_RELAY_MIN_PLAYERS) return false;

  const now = ctx.now();
  const holder = connected[Math.floor(Math.random() * connected.length)] as PlayerId;

  const relay: Relay = {
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
  };

  await ctx.save(relay);
  // The remaining time is never sent — that is the whole game (spec §2.1).
  ctx.broadcast({
    t: 'bomb',
    s: ctx.nextSeq(),
    d: { roundId, holder, alive: relay.alive },
  });
  await ctx.setAlarm(relay.fuseAt);
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
  const relay = await ctx.load();
  if (!relay || relay.phase !== 'running') return;
  // A bump belongs to the round it was felt in. Without this, a stale frame
  // from a previous round — or a forged one — moves the current bomb.
  if (relay.roundId !== roundId) return;
  if (!relay.alive.includes(playerId)) return;

  const now = ctx.now();

  if ((relay.mutedUntil[playerId] ?? 0) > now) return;

  // Never trust a client timestamp beyond a small skew allowance.
  const at = Math.min(Number.isFinite(clientAt) ? clientAt : now, now + CLOCK_SKEW_TOLERANCE_MS);

  // Anti-spam: shaking wildly produces a stream of spikes. Exceeding the quota
  // mutes this player briefly rather than ending their round (spec §8).
  const recent = (relay.quota[playerId] ?? []).filter(
    (t) => now - t < BUMP_QUOTA_WINDOW_MS,
  );
  recent.push(now);
  relay.quota[playerId] = recent;
  if (recent.length > BUMP_QUOTA) {
    relay.mutedUntil[playerId] = now + BUMP_MUTE_MS;
    await ctx.save(relay);
    ctx.sendTo(playerId, {
      t: 'calm-down',
      d: { untilServerTime: now + BUMP_MUTE_MS },
    });
    return;
  }

  // Drop bumps too old to pair with anything, so `pending` cannot grow without
  // bound over a long round.
  for (const [other, t] of Object.entries(relay.pending)) {
    if (at - t > BUMP_PAIR_WINDOW_MS) delete relay.pending[other];
  }

  // Look for a partner: someone else whose bump landed within the window.
  let partner: PlayerId | null = null;
  for (const [other, t] of Object.entries(relay.pending)) {
    if (other === playerId) continue;
    if (Math.abs(at - t) <= BUMP_PAIR_WINDOW_MS && relay.alive.includes(other)) {
      partner = other;
      break;
    }
  }

  if (!partner) {
    relay.pending[playerId] = at;
    await ctx.save(relay);
    return;
  }

  delete relay.pending[partner];
  delete relay.pending[playerId];

  // Exactly one of the pair must be holding the bomb; the other receives it.
  const receiver =
    relay.holder === playerId ? partner : relay.holder === partner ? playerId : null;
  if (!receiver) {
    await ctx.save(relay);
    return;
  }

  relay.holder = receiver;
  await ctx.save(relay);
  // Passing does NOT reset the fuse — the alarm stays where it was.
  ctx.broadcast({
    t: 'bomb',
    s: ctx.nextSeq(),
    d: { roundId: relay.roundId, holder: receiver, alive: relay.alive },
  });
}

/** Touch fallback for a player whose device has no usable motion sensor. */
export async function onPass(
  ctx: Ctx,
  from: PlayerId,
  roundId: number,
  to: PlayerId,
): Promise<void> {
  const relay = await ctx.load();
  if (!relay || relay.phase !== 'running') return;
  if (relay.roundId !== roundId) return;
  if (relay.holder !== from) return;
  if (from === to || !relay.alive.includes(to)) return;

  relay.holder = to;
  await ctx.save(relay);
  ctx.broadcast({
    t: 'bomb',
    s: ctx.nextSeq(),
    d: { roundId: relay.roundId, holder: to, alive: relay.alive },
  });
}

/**
 * The fuse expired, or the round hit its safety cap.
 * Returns true when the round is over.
 */
export async function onFuse(ctx: Ctx): Promise<boolean> {
  const relay = await ctx.load();
  if (!relay || relay.phase !== 'running') return false;

  const now = ctx.now();
  const victim = relay.holder;
  relay.alive = relay.alive.filter((p) => p !== victim);
  relay.pending = {};

  ctx.broadcast({
    t: 'boom',
    s: ctx.nextSeq(),
    d: { roundId: relay.roundId, victim, alive: relay.alive },
  });

  // Last player standing, or the safety cap hit — either way we stop.
  if (relay.alive.length <= 1 || now >= relay.endsAt) {
    relay.phase = 'done';
    await ctx.save(relay);
    return true;
  }

  // Shrink the fuse so each round tightens, with a floor so it stays playable.
  relay.fuseMin = Math.max(FUSE_FLOOR_MIN_MS, Math.round(relay.fuseMin * FUSE_SHRINK));
  relay.fuseMax = Math.max(FUSE_FLOOR_MAX_MS, Math.round(relay.fuseMax * FUSE_SHRINK));
  relay.holder = relay.alive[Math.floor(Math.random() * relay.alive.length)] as PlayerId;
  relay.fuseAt = drawFuse(relay.fuseMin, relay.fuseMax, now);

  await ctx.save(relay);
  ctx.broadcast({
    t: 'bomb',
    s: ctx.nextSeq(),
    d: { roundId: relay.roundId, holder: relay.holder, alive: relay.alive },
  });
  await ctx.setAlarm(Math.min(relay.fuseAt, relay.endsAt));
  return false;
}

/**
 * A player vanished. If they were holding the bomb it must move, or the round
 * stalls until the fuse blows on someone who is not there.
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const relay = await ctx.load();
  if (!relay || relay.phase !== 'running') return;
  if (!relay.alive.includes(playerId)) return;

  relay.alive = relay.alive.filter((p) => p !== playerId);
  delete relay.pending[playerId];

  if (relay.alive.length <= 1) {
    relay.phase = 'done';
    await ctx.save(relay);
    ctx.broadcast({
      t: 'boom',
      s: ctx.nextSeq(),
      d: { roundId: relay.roundId, victim: playerId, alive: relay.alive },
    });
    return;
  }

  if (relay.holder === playerId) {
    relay.holder = relay.alive[Math.floor(Math.random() * relay.alive.length)] as PlayerId;
  }
  await ctx.save(relay);
  ctx.broadcast({
    t: 'bomb',
    s: ctx.nextSeq(),
    d: { roundId: relay.roundId, holder: relay.holder, alive: relay.alive },
  });
}
