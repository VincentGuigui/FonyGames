import {
  preroundFor,
  SLING_MIN_GAP_MS,
  SLING_PLAYERS,
  SLING_ROUND_CAP_MS,
  SLING_SPEED_MAX,
  SLING_START_PUCKS,
  type PlayerId,
  type ServerMessage,
  type SlingState,
} from '../shared/protocol';

/**
 * Sling Puck — the referee. Spec: docs/specs/games/sling-puck.md
 *
 * Same shape as spill.ts and goatSiege.ts, but with far less to do, and that is
 * the whole design. The physics lives on the phones (spec §4): each one
 * simulates its own half at 60 fps, nobody else can see it, so there is nothing
 * here to simulate and nothing to keep in sync.
 *
 * What is left is bookkeeping and a rotation:
 *
 * - the **count** on each side, which is the score and the win condition;
 * - turning a crossing in the sender's frame into one in the receiver's, because
 *   the phones lie nose to nose and are therefore 180° apart;
 * - the conservation rule that makes the counts mean something — a crossing
 *   moves exactly one puck, and you cannot pass one you do not have.
 *
 * The honest limit of that is stated in spec §10 and not papered over here.
 */

export type Sling = {
  roundId: number;
  /** Server time play begins. The rules panel owns the window before it. */
  startsAt: number;
  players: PlayerId[];
  pucks: Record<PlayerId, number>;
  /** Earliest server time each player's next crossing is accepted. */
  gate: Record<PlayerId, number>;
  endsAt: number;
  phase: 'running' | 'done';
};

export type Ctx = {
  now(): number;
  nextSeq(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<Sling | null>;
  save(sling: Sling): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

export function toState(s: Sling): SlingState {
  return {
    roundId: s.roundId,
    startsAt: s.startsAt,
    players: s.players,
    pucks: s.pucks,
    phase: s.phase,
  };
}

function broadcastState(ctx: Ctx, s: Sling): void {
  ctx.broadcast({ t: 'sling', s: ctx.nextSeq(), d: toState(s) });
}

export async function startSling(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
): Promise<boolean> {
  // Exactly two. A third phone has nowhere to lie and no gap of its own.
  if (connected.length !== SLING_PLAYERS) return false;

  const now = ctx.now();
  // Only the first round of a room gets a rules panel (protocol.ts).
  const preround = preroundFor(roundId);
  const pucks: Record<PlayerId, number> = {};
  for (const p of connected) pucks[p] = SLING_START_PUCKS;

  const sling: Sling = {
    roundId,
    startsAt: now + preround,
    players: [...connected],
    pucks,
    gate: {},
    // The cap runs from the start of play, not from the panel.
    endsAt: now + preround + SLING_ROUND_CAP_MS,
    phase: 'running',
  };

  await ctx.save(sling);
  broadcastState(ctx, sling);
  await ctx.setAlarm(sling.endsAt);
  return true;
}

/**
 * A puck left `from`'s half through the gap.
 *
 * Everything about the incoming frame is treated as a claim, not a fact: the
 * count is checked, the rate is gated, and the coordinates are clamped into the
 * board before they go anywhere near the other player's simulation.
 */
export async function onCross(
  ctx: Ctx,
  from: PlayerId,
  roundId: number,
  claim: { x: number; vx: number; vy: number },
): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running' || s.roundId !== roundId) return;
  if (!s.players.includes(from)) return;

  const now = ctx.now();
  // Nothing crosses while the rules are still on screen (see spill.ts, siege).
  if (now < s.startsAt) return;
  if ((s.gate[from] ?? 0) > now) return;

  // Conservation: you cannot pass a puck you do not have. This is what keeps the
  // two counts adding up to the number the round started with.
  if ((s.pucks[from] ?? 0) <= 0) return;

  const to = s.players.find((p) => p !== from);
  if (to === undefined) return;

  s.pucks[from] = (s.pucks[from] ?? 0) - 1;
  s.pucks[to] = (s.pucks[to] ?? 0) + 1;
  s.gate[from] = now + SLING_MIN_GAP_MS;

  const arrival = rotate(claim);

  ctx.broadcast({
    t: 'puck',
    s: ctx.nextSeq(),
    d: { from, to, x: arrival.x, vx: arrival.vx, vy: arrival.vy, at: now, pucks: s.pucks },
  });

  if (s.pucks[from] === 0) {
    await finish(ctx, s, from);
    return;
  }

  await ctx.save(s);
  await ctx.setAlarm(nextDeadline(s));
}

/**
 * A crossing in the sender's frame, as the receiver's frame (spec §4).
 *
 * The phones are nose to nose, so one is upside down relative to the other: a
 * puck leaving the top of my board arrives at the top of yours travelling *down*
 * it, and my left is your right. That is a 180° rotation, which in normalised
 * coordinates is three sign flips and nothing else — no trigonometry, and no
 * dependence on how big either screen is.
 *
 * Clamping happens here rather than at the sender, because a forged frame is
 * exactly the case that matters: a puck must not be able to arrive outside the
 * board or moving faster than the sling could ever throw it.
 */
export function rotate(c: { x: number; vx: number; vy: number }): {
  x: number;
  vx: number;
  vy: number;
} {
  const x = clamp(1 - safe(c.x, 0.5), 0, 1);
  let vx = -safe(c.vx, 0);
  let vy = -safe(c.vy, -0.5);

  // Cap the *speed*, not each axis, so clamping cannot bend a shot sideways.
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed > SLING_SPEED_MAX) {
    const k = SLING_SPEED_MAX / speed;
    vx *= k;
    vy *= k;
  }

  // It came through the gap, so it is heading into the receiver's half. A frame
  // claiming otherwise would push a puck straight back out of the board.
  if (vy <= 0) vy = Math.max(0.1, Math.abs(vy));

  return { x, vx, vy };
}

/** Only the round cap; between crossings the server has nothing to wake up for. */
export async function tick(ctx: Ctx): Promise<boolean> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return false;

  if (ctx.now() >= s.endsAt) {
    await finish(ctx, s, leader(s));
    return true;
  }

  await ctx.setAlarm(nextDeadline(s));
  return false;
}

/** A player vanished. Two players is the whole game, so the round ends (spec §9). */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const s = await ctx.load();
  if (!s || s.phase !== 'running') return;
  if (!s.players.includes(playerId)) return;

  await finish(ctx, s, s.players.find((p) => p !== playerId) ?? null);
}

/** Fewest pucks left when the clock runs out; null on a draw (spec §9). */
function leader(s: Sling): PlayerId | null {
  const [a, b] = s.players;
  if (a === undefined) return null;
  if (b === undefined) return a;
  const pa = s.pucks[a] ?? 0;
  const pb = s.pucks[b] ?? 0;
  if (pa === pb) return null;
  return pa < pb ? a : b;
}

async function finish(ctx: Ctx, s: Sling, winnerId: PlayerId | null): Promise<void> {
  s.phase = 'done';
  await ctx.save(s);
  ctx.broadcast({
    t: 'sling-over',
    s: ctx.nextSeq(),
    d: { roundId: s.roundId, winnerId, pucks: s.pucks },
  });
}

export function nextDeadline(s: Sling): number {
  return s.endsAt;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A non-finite number from the wire would poison the receiver's simulation. */
function safe(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
