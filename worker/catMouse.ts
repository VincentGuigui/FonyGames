import {
  CM_CATCH_RADIUS,
  CM_CAT_COOLDOWN_MS,
  CM_GRACE_MS,
  CM_LIVES,
  CM_MAX_PLAYERS,
  CM_MIN_PLAYERS,
  CM_ROUND_CAP_MS,
  CM_TICK_MS,
  preroundFor,
  type CatMouseActor,
  type CatMouseState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';
import { CM_CENTRE, clampToFloor, dist, maxStep, truncate } from '../shared/catMouse';

/**
 * Cat and Mouse — the referee. Spec: docs/specs/games/cat-and-mouse.md
 *
 * Same shape as the other games: persisted state, everything through `Ctx`, and
 * lives change **only here**.
 *
 * What is different, and the reason this game was left until last: positions come
 * from clients. Nobody can simulate a finger, so the server cannot own movement
 * the way it owns a goat's arc. What it does own is everything that decides the
 * round — bounds, the speed limit, and every catch (spec §9). A cat that scored
 * its own catches would win instantly.
 *
 * The tick is a **broadcast** rate, not a simulation rate. Six players flicking
 * at once produce one frame per tick, which is what keeps this affordable
 * (spec §4).
 */

export type Mover = {
  x: number;
  y: number;
  lives: number;
  graceUntil: number;
  out: boolean;
  /** Server time of the last accepted `move`, for the speed limit. */
  movedAt: number;
};

export type CatMouse = {
  roundId: number;
  startsAt: number;
  catId: PlayerId;
  drag: 'direct' | 'capped';
  players: PlayerId[];
  at: Record<PlayerId, Mover>;
  /** Server time the cat may catch again (spec §6). */
  catchAgainAt: number;
  /** Server time of the next broadcast. */
  nextFrameAt: number;
  endsAt: number;
  phase: 'running' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<CatMouse | null>;
  save(state: CatMouse): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

function mice(s: CatMouse): PlayerId[] {
  return s.players.filter((p) => p !== s.catId);
}

function alive(s: CatMouse): PlayerId[] {
  return mice(s).filter((p) => !(s.at[p]?.out ?? true));
}

function actor(s: CatMouse, playerId: PlayerId): CatMouseActor {
  const m = s.at[playerId] ?? { x: CM_CENTRE.x, y: CM_CENTRE.y, lives: 0, graceUntil: 0, out: true, movedAt: 0 };
  return {
    playerId,
    x: m.x,
    y: m.y,
    lives: m.lives,
    graceUntil: m.graceUntil,
    out: m.out,
  };
}

export function toState(s: CatMouse): CatMouseState {
  return {
    roundId: s.roundId,
    startsAt: s.startsAt,
    catId: s.catId,
    drag: s.drag,
    actors: s.players.map((p) => actor(s, p)),
    endsAt: s.endsAt,
    phase: s.phase,
  };
}

function broadcastState(ctx: Ctx, s: CatMouse): void {
  ctx.broadcast({ t: 'cm', s: ctx.nextSeq(), d: toState(s) });
}

/**
 * Where each player starts.
 *
 * The cat goes in the centre and the mice on a ring around it, evenly spaced. Not
 * random: everyone should be able to see at a glance that nobody started closer
 * to the cat than anybody else, and a random scatter occasionally spawns a mouse
 * already inside `CM_CATCH_RADIUS`.
 */
function ring(index: number, count: number): { x: number; y: number } {
  // Straight up first, then clockwise, so a two-mouse round is top and bottom
  // rather than an arbitrary diagonal.
  const a = -Math.PI / 2 + (index / Math.max(1, count)) * Math.PI * 2;
  const r = 0.38;
  return clampToFloor({
    x: CM_CENTRE.x + Math.cos(a) * r,
    y: CM_CENTRE.y + Math.sin(a) * r,
  });
}

/**
 * Whose turn it is to be the cat.
 *
 * Rotates by round, so over a session everyone gets a turn — the fair option of
 * the two the spec leaves open (§13). "Whoever was caught last" is funnier and is
 * a change to this one line if a play test prefers it.
 */
function catFor(roundId: number, ids: PlayerId[]): PlayerId {
  return ids[(roundId - 1) % ids.length] ?? (ids[0] as PlayerId);
}

export async function startCatMouse(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  drag: 'direct' | 'capped',
  /** Solo test mode — see `enoughToStart` in shared/players.ts. */
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [CM_MIN_PLAYERS, CM_MAX_PLAYERS], solo)) {
    return false;
  }

  const now = ctx.now();
  const preround = preroundFor(roundId);
  const startsAt = now + preround;
  const catId = catFor(roundId, connected);
  const others = connected.filter((p) => p !== catId);

  const at: Record<PlayerId, Mover> = {};
  at[catId] = {
    ...CM_CENTRE,
    lives: 0,
    graceUntil: 0,
    out: false,
    movedAt: startsAt,
  };
  others.forEach((p, i) => {
    at[p] = {
      ...ring(i, others.length),
      lives: CM_LIVES,
      graceUntil: 0,
      out: false,
      movedAt: startsAt,
    };
  });

  const s: CatMouse = {
    roundId,
    startsAt,
    catId,
    drag,
    players: [...connected],
    at,
    // The cat cannot catch during the rules panel either — the gate is `startsAt`
    // below, but this keeps the two facts from being able to disagree.
    catchAgainAt: startsAt,
    nextFrameAt: startsAt,
    endsAt: startsAt + CM_ROUND_CAP_MS,
    phase: 'running',
  };

  await ctx.save(s);
  broadcastState(ctx, s);
  await ctx.setAlarm(nextDeadline(s));
  return true;
}

/**
 * A client reports where its icon is now.
 *
 * Accepted with two bounds and no simulation: clamped onto the floor, and
 * truncated to how far this role could have travelled since its last accepted
 * move. Nothing is broadcast here — the tick does that, so a player flicking at
 * 120 Hz cannot make everyone else's phone work harder (spec §4).
 */
export async function onMove(
  ctx: Ctx,
  from: PlayerId,
  roundId: number,
  to: { x: number; y: number },
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running' || s.roundId !== roundId) return;

  const me = s.at[from];
  if (!me || me.out) return;

  const now = ctx.now();
  // Nobody moves while the rules are still on screen — the same gate spill and
  // goat-siege use, so a client that skipped the panel gets no head start.
  if (now < s.startsAt) return;

  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return;

  const limit = maxStep(from === s.catId, now - me.movedAt, s.drag);
  const p = truncate({ x: me.x, y: me.y }, to, limit);

  me.x = p.x;
  me.y = p.y;
  me.movedAt = now;
  await ctx.save(s);
}

/**
 * One tick: broadcast positions, then settle any catch.
 *
 * Catches are resolved **here**, on the server's own clock and against the
 * positions the server holds, rather than when a `move` arrives. Two reasons: a
 * catch is a fact about two icons and only the tick sees both at one instant, and
 * doing it per-message would let the player who sends most often win the tie.
 *
 * Returns true when the round is over.
 */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return false;

  const now = ctx.now();
  if (now < s.startsAt) {
    await ctx.setAlarm(nextDeadline(s));
    return false;
  }

  const cat = s.at[s.catId];

  // A catch, if the cat has one available. One per tick at most: the cooldown is
  // what stops a cat parking on a mouse and taking three lives in a quarter of a
  // second, and it is the anti-scribble lever for `direct` (spec §6).
  if (cat && now >= s.catchAgainAt) {
    for (const id of alive(s)) {
      const m = s.at[id];
      if (!m || now < m.graceUntil) continue;
      if (dist({ x: cat.x, y: cat.y }, { x: m.x, y: m.y }) > CM_CATCH_RADIUS) continue;

      m.lives = Math.max(0, m.lives - 1);
      m.out = m.lives === 0;
      // Back to the centre, and untouchable for a moment it can already drag out
      // of. The grace is the point: they leave under their own control instead of
      // being handed back as a sitting duck (spec §6).
      m.x = CM_CENTRE.x;
      m.y = CM_CENTRE.y;
      m.movedAt = now;
      m.graceUntil = m.out ? 0 : now + CM_GRACE_MS;
      s.catchAgainAt = now + CM_CAT_COOLDOWN_MS;

      ctx.broadcast({
        t: 'cm-catch',
        s: ctx.nextSeq(),
        d: {
          roundId: s.roundId,
          victim: id,
          lives: m.lives,
          graceUntil: m.graceUntil,
          out: m.out,
          x: m.x,
          y: m.y,
        },
      });
      break;
    }
  }

  if (alive(s).length === 0) {
    await finish(ctx, s, true, now);
    return true;
  }
  if (now >= s.endsAt) {
    await finish(ctx, s, false, now);
    return true;
  }

  const pos: Record<PlayerId, [number, number]> = {};
  for (const id of s.players) {
    const m = s.at[id];
    // An eliminated mouse leaves the floor rather than sitting there as scenery.
    if (!m || m.out) continue;
    pos[id] = [round3(m.x), round3(m.y)];
  }
  ctx.broadcast({ t: 'cm-frame', s: ctx.nextSeq(), d: { roundId: s.roundId, at: now, pos } });

  // Absolute schedule, not `now + CM_TICK_MS`: a late alarm must not push every
  // later tick late as well.
  s.nextFrameAt = Math.max(now + 1, s.nextFrameAt + CM_TICK_MS);
  await ctx.save(s);
  await ctx.setAlarm(nextDeadline(s));
  return false;
}

/**
 * A player vanished.
 *
 * The cat leaving ends the round and the mice win — there is no game without a
 * cat, and the alternative (promote a mouse) would hand someone the cat's job
 * mid-chase (spec §8).
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return;
  if (!s.players.includes(playerId)) return;

  const now = ctx.now();
  if (playerId === s.catId) {
    await finish(ctx, s, false, now);
    return;
  }

  const m = s.at[playerId];
  if (!m || m.out) return;
  m.out = true;
  m.lives = 0;

  if (alive(s).length === 0) {
    // Last mouse gone: the cat wins by default rather than the round hanging.
    await finish(ctx, s, true, now);
    return;
  }

  broadcastState(ctx, s);
  await ctx.save(s);
  await ctx.setAlarm(nextDeadline(s));
}

async function finish(
  ctx: Ctx,
  s: CatMouse,
  catWins: boolean,
  now: number,
): Promise<void> {
  s.phase = 'done';
  await ctx.save(s);
  ctx.broadcast({
    t: 'cm-over',
    s: ctx.nextSeq(),
    d: {
      roundId: s.roundId,
      catWins,
      survivors: catWins ? [] : alive(s),
      lastedMs: Math.max(0, now - s.startsAt),
    },
  });
}

export function nextDeadline(s: CatMouse): number {
  return Math.min(s.endsAt, Math.max(s.startsAt, s.nextFrameAt));
}

/** Three decimals is a tenth of a `CM_CATCH_RADIUS` — plenty, and it halves the frame. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
