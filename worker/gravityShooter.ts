import {
  GRAVITY_LIVES,
  GRAVITY_MAX_PLAYERS,
  GRAVITY_MAX_STRENGTH,
  GRAVITY_MIN_PLAYERS,
  GRAVITY_PLANET_ART_COUNT,
  GRAVITY_PLANET_INFLUENCE_RADIUS_FACTOR,
  GRAVITY_PLANET_MIN_GAP,
  GRAVITY_PLANET_MIN_SIZE_DIFF_RATIO,
  GRAVITY_PLANET_MIN_Y_DIFF,
  GRAVITY_PLANET_R_MAX,
  GRAVITY_PLANET_R_MIN,
  GRAVITY_PLANET_X_MARGIN,
  GRAVITY_PLANET_Y_MAX,
  GRAVITY_PLANET_Y_MIN,
  GRAVITY_SHIP_MARGIN,
  GRAVITY_SHOT_TIMEOUT_MS,
  type GravityPlanet,
  type GravityShooterState,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { enoughToStart } from '../shared/players';

/**
 * Gravity Shooter. Spec: docs/specs/games/gravity-shooter.md
 *
 * Kept out of Room.ts so neither file outgrows the 300-line guidance in
 * docs/conventions/code-style.md. Everything here is driven through `Ctx`,
 * which Room supplies — this module never touches a socket.
 *
 * **The hit decision is trusted, not refereed** (spec §8, by direct
 * instruction): a shot's own physics runs entirely on the shooter's phone,
 * and this file stores whatever `hit` a `gravity-shot` claims. What it DOES
 * own, same shape as Grid Attack's own two-fixed-seats rule: whose turn it
 * is, lives, the planets (rolled once, here, with the referee's own fair
 * `random()` — a phone cannot be the fairest source of a shared board it is
 * also playing, the same reasoning Squash Mosquitoes' own shuffle uses), and
 * forcing a silent shooter's turn forward rather than ever stalling the match.
 *
 * **Every per-side field is keyed by seat (0 or 1), never by player id.**
 * Solo mode (Tap Fighter's own idiom) puts the same connected player in both
 * `seats` — a player id cannot tell the two ships apart when there is only
 * one of it, so `lives`, `turn`, a shot's own `shooter`, and `winner` all
 * index by seat instead. A `gravity-shot` is still only ever accepted from
 * whoever `seats[turn]` actually is — which in solo is trivially the one
 * connected player, whichever seat is on turn.
 */

export type Gravity = GravityShooterState;

export type Ctx = {
  now(): number;
  nextSeq(): number;
  /** The one thing this referee needs that Grid Attack does not: a fair roll
   *  for the planets. */
  random(): number;
  broadcast(msg: ServerMessage): void;
  load(): Promise<Gravity | null>;
  save(g: Gravity): Promise<void>;
  setAlarm(at: number): Promise<void>;
};

/** Earliest thing the server still owes an answer for: the current shot's
 *  own timeout (spec §2.4) — there is no separate safety cap, since a shot
 *  that never arrives already forces the turn forward. */
export function nextDeadline(g: Gravity): number {
  return g.phase === 'running' ? g.resolvesAt : Infinity;
}

/**
 * One planet's own `x`, on the given half of the board and close enough to
 * the centre line for its own gravity to still matter there (follow-up after
 * issue #16 — see `GRAVITY_PLANET_INFLUENCE_RADIUS_FACTOR`'s own doc comment
 * for why "close enough" scales with `r`). The `Math.max`/`Math.min` against
 * the edge margin is defensive — a big enough planet's own influence already
 * reaches past the margin, so this never asks a planet to sit closer to the
 * ships than the margin already allows.
 */
function rollPlanetX(random: () => number, side: 'left' | 'right', r: number): number {
  const maxOffset = GRAVITY_PLANET_INFLUENCE_RADIUS_FACTOR * r;
  if (side === 'left') {
    const lo = Math.max(GRAVITY_PLANET_X_MARGIN, 0.5 - maxOffset);
    return lo + random() * (0.5 - lo);
  }
  const hi = Math.min(1 - GRAVITY_PLANET_X_MARGIN, 0.5 + maxOffset);
  return 0.5 + random() * (hi - 0.5);
}

/**
 * Both planets' own radii, guaranteed at least `GRAVITY_PLANET_MIN_SIZE_DIFF_RATIO`
 * apart (issue #16) — constructed directly rather than rolled independently
 * and rejected on a mismatch, so this never has to retry. The bigger one is
 * rolled first, from high enough in the range that shrinking it by the
 * required ratio can never push the smaller one below `GRAVITY_PLANET_R_MIN`;
 * which planet actually gets which radius is still a fair coin flip.
 */
function rollPlanetRadii(random: () => number): [number, number] {
  const minBig = GRAVITY_PLANET_R_MIN / (1 - GRAVITY_PLANET_MIN_SIZE_DIFF_RATIO);
  const big = minBig + random() * (GRAVITY_PLANET_R_MAX - minBig);
  const smallCeiling = big * (1 - GRAVITY_PLANET_MIN_SIZE_DIFF_RATIO);
  const small = GRAVITY_PLANET_R_MIN + random() * (smallCeiling - GRAVITY_PLANET_R_MIN);
  return random() < 0.5 ? [big, small] : [small, big];
}

/** Centre distance minus both radii — how far apart the two planets'
 *  own SURFACES actually sit (issue #16), never their centres alone. */
export function surfaceGap(a: GravityPlanet, b: GravityPlanet): number {
  return Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
}

/** Does this planet's own body cover the middle of the board? One of the two
 *  always must (spec §2.1), so the straight line between the ships is never
 *  a shot — every shot has to be curved around something. */
export function coversBoardCentre(p: GravityPlanet): boolean {
  return Math.hypot(p.x - 0.5, p.y - 0.5) <= p.r;
}

/**
 * How close to the board's own centre row the nearer planet is even allowed
 * to sit: pull one planet toward the middle and the other still has to fit
 * inside the `y` band a full `GRAVITY_PLANET_MIN_Y_DIFF` away, which is what
 * bounds how far in the first one may come. Derived rather than tuned, so
 * widening the band or relaxing the separation rule loosens this on its own.
 */
const CENTRE_OFFSET_MIN = Math.max(
  0,
  GRAVITY_PLANET_MIN_Y_DIFF - (GRAVITY_PLANET_Y_MAX - GRAVITY_PLANET_Y_MIN) / 2,
);

/**
 * The planet that covers the board's centre. Its `y` offset from the centre
 * row is rolled first — bounded below by `CENTRE_OFFSET_MIN` so the other
 * planet can still be placed legally, and above by its own radius, since a
 * planet sitting further from the centre row than it is wide could never
 * reach the centre at all — and then `x` inside whatever horizontal room the
 * radius has left over, on its own half of the board. The edge margin needs
 * no check here: reaching the centre already keeps it well inside.
 */
function rollCentreBlocker(random: () => number, r: number, side: 'left' | 'right'): { x: number; y: number } {
  const offsetMax = Math.min((GRAVITY_PLANET_Y_MAX - GRAVITY_PLANET_Y_MIN) / 2, r);
  const offset = CENTRE_OFFSET_MIN + random() * Math.max(0, offsetMax - CENTRE_OFFSET_MIN);
  const y = random() < 0.5 ? 0.5 + offset : 0.5 - offset;
  // Whatever is left of the radius once the vertical offset is spent is how
  // far off the centre column this planet may sit and still cover the centre.
  const reach = Math.sqrt(Math.max(0, r * r - offset * offset));
  const x = side === 'left' ? 0.5 - random() * reach : 0.5 + random() * reach;
  return { x, y };
}

/**
 * The other planet's own row: at least `GRAVITY_PLANET_MIN_Y_DIFF` from the
 * blocker's (issue #16's separation rule) and still inside the band. The
 * blocker sits near the middle, so usually only one side of it has any legal
 * room left at all; when both do, which one is a fair coin flip.
 */
function rollCompanionY(random: () => number, blockerY: number): number {
  const belowMax = blockerY - GRAVITY_PLANET_MIN_Y_DIFF;
  const aboveMin = blockerY + GRAVITY_PLANET_MIN_Y_DIFF;
  const belowFits = belowMax >= GRAVITY_PLANET_Y_MIN;
  const aboveFits = aboveMin <= GRAVITY_PLANET_Y_MAX;
  const below = belowFits && (!aboveFits || random() < 0.5);
  if (below) return GRAVITY_PLANET_Y_MIN + random() * (belowMax - GRAVITY_PLANET_Y_MIN);
  if (aboveFits) return aboveMin + random() * (GRAVITY_PLANET_Y_MAX - aboveMin);
  // Defensive: the offset rule above always leaves one side room, so this is
  // unreachable — but a referee must never throw rather than start a match.
  return blockerY >= 0.5 ? GRAVITY_PLANET_Y_MIN : GRAVITY_PLANET_Y_MAX;
}

/**
 * A coarse, worker-local re-implementation of the client's own gravity model
 * (`www/src/games/gravity-shooter/game.ts`'s `simulateShot`), used ONLY to
 * sanity-check a freshly-rolled map before it ships (issue #16's own open
 * question: "is it possible to simulate a winning trajectory from each
 * player's own position, to avoid generating an impossible map?" — yes, this
 * is that check). Deliberately a separate copy rather than shared code, the
 * same reasoning the client file's own header gives for keeping the real
 * physics out of `shared/`: the two never need to agree bit-for-bit, since
 * this one is not adjudicating a claimed hit (spec §8) — it only asks
 * "does at least one reasonable shot from here connect," a fuzzy yes/no a
 * slightly different constant here or there cannot get wrong in a way that
 * matters. If `game.ts`'s own `GRAVITY_G`/`GRAVITY_HIT_RADIUS`/
 * `GRAVITY_MAX_LAUNCH_SPEED`/`GRAVITY_MIN_LAUNCH_SPEED` are ever retuned,
 * update these to match, or this check quietly stops meaning what its own
 * name says.
 */
const FAIRNESS_G = 0.24;
const FAIRNESS_HIT_RADIUS = 0.06;
/** Same board-height-over-target-duration derivation as `game.ts`'s own
 *  `GRAVITY_MAX_LAUNCH_SPEED`/`GRAVITY_MIN_LAUNCH_SPEED`. */
const FAIRNESS_BOARD_HEIGHT = 1 - 2 * GRAVITY_SHIP_MARGIN;
const FAIRNESS_LAUNCH_SPEED = FAIRNESS_BOARD_HEIGHT / 3;
const FAIRNESS_MIN_LAUNCH_SPEED = FAIRNESS_BOARD_HEIGHT / 6;
const FAIRNESS_STEP_S = 1 / 60;
/** 8s of flight — generous even for the slowest sampled pull (up to 6s
 *  straight-line at the true floor, more once gravity curves it, more still
 *  on a diagonal); this check only needs to find ONE connecting shot, not
 *  describe the whole flight. */
const FAIRNESS_MAX_STEPS = 480;
/** Same wide margin `GRAVITY_SIM_BOUNDS_MIN/MAX` gives the real simulation
 *  (spec §2.3/§7), so a shot that would genuinely loop back in is not
 *  written off as unreachable just because this coarse check gave up early. */
const FAIRNESS_BOUNDS_MIN = -0.5;
const FAIRNESS_BOUNDS_MAX = 1.5;

function fairnessShipPosition(seat: 0 | 1): { x: number; y: number } {
  return { x: 0.5, y: seat === 0 ? 1 - GRAVITY_SHIP_MARGIN : GRAVITY_SHIP_MARGIN };
}

/** One sampled shot: does it reach within `FAIRNESS_HIT_RADIUS` of the
 *  opponent's own ship before it is absorbed, wanders off, or runs out of
 *  simulated time? */
function fairnessShotConnects(planets: readonly [GravityPlanet, GravityPlanet], shooterSeat: 0 | 1, angle: number, strength: number): boolean {
  const start = fairnessShipPosition(shooterSeat);
  const target = fairnessShipPosition(shooterSeat === 0 ? 1 : 0);
  const speed = FAIRNESS_MIN_LAUNCH_SPEED + strength * (FAIRNESS_LAUNCH_SPEED - FAIRNESS_MIN_LAUNCH_SPEED);
  const localVx = Math.sin(angle) * speed;
  const localVy = -Math.cos(angle) * speed;
  let x = start.x;
  let y = start.y;
  let vx = shooterSeat === 0 ? localVx : -localVx;
  let vy = shooterSeat === 0 ? localVy : -localVy;

  for (let i = 0; i < FAIRNESS_MAX_STEPS; i++) {
    let ax = 0;
    let ay = 0;
    for (const p of planets) {
      const dx = p.x - x;
      const dy = p.y - y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);
      if (dist <= p.r) return false; // swallowed
      const a = (FAIRNESS_G * p.r * p.r) / Math.max(distSq, p.r * p.r);
      ax += (a * dx) / dist;
      ay += (a * dy) / dist;
    }
    vx += ax * FAIRNESS_STEP_S;
    vy += ay * FAIRNESS_STEP_S;
    x += vx * FAIRNESS_STEP_S;
    y += vy * FAIRNESS_STEP_S;
    if (Math.hypot(x - target.x, y - target.y) <= FAIRNESS_HIT_RADIUS) return true;
    if (x < FAIRNESS_BOUNDS_MIN || x > FAIRNESS_BOUNDS_MAX || y < FAIRNESS_BOUNDS_MIN || y > FAIRNESS_BOUNDS_MAX) return false;
  }
  return false;
}

/** A coarse fan of angles/strengths — wide enough to catch an obviously
 *  reachable shot without costing more than a few dozen cheap simulations. */
const FAIRNESS_ANGLES_DEG = [-60, -40, -20, 0, 20, 40, 60];
/** Widened after this follow-up's own launch-speed/gravity retune: a
 *  full-strength-only-ish fan (the old `[0.5, 0.75, 1]`) missed a lot more
 *  real shots once the speed range dropped and `GRAVITY_G` doubled — a
 *  weaker pull now spends much longer exposed to a much stronger pull, so a
 *  reachable shot is more likely to sit at the gentler end of the range. */
const FAIRNESS_STRENGTHS = [0.15, 0.35, 0.5, 0.75, 1];

/** Can at least one reasonable shot from `seat` reach the opponent? */
export function seatCanReachOpponent(planets: readonly [GravityPlanet, GravityPlanet], seat: 0 | 1): boolean {
  for (const deg of FAIRNESS_ANGLES_DEG) {
    for (const strength of FAIRNESS_STRENGTHS) {
      if (fairnessShotConnects(planets, seat, (deg * Math.PI) / 180, strength)) return true;
    }
  }
  return false;
}

/** How many whole map geometries (positions and sizes both) to try before
 *  accepting whatever the last one was — never blocks a match from starting
 *  over a fairness heuristic, only improves the odds. */
const GRAVITY_WINNABILITY_ATTEMPTS = 8;
/**
 * Within one geometry, how many times to re-roll the sizes and positions if
 * the surface-gap rule (spec's own 50px) isn't met yet — every attempt is
 * pure arithmetic, so this is far cheaper than the winnability check above.
 *
 * Raised from 10 once a planet had to cover the board's centre: pinning one
 * planet to the middle while the other still owes it 100px of vertical
 * separation leaves genuinely tight geometry, and 10 attempts left the two
 * planets overlapping in 4.2% of maps (measured across 5000 seeded rolls).
 * 30 brought that to 0.02% and 60 to none at all, with the mean radius
 * essentially unmoved (0.0886 → 0.0878), so the retries are not quietly
 * selecting for small planets.
 */
const GRAVITY_SPACING_ATTEMPTS = 60;

/**
 * Both planets, rolled once with the referee's own fair `random()` (spec
 * §2.1): one always covering the board's own centre (`rollCentreBlocker`, so
 * no shot can ever just fly straight up the middle), the other on the
 * opposite half and close enough to the centre line for its own gravity to
 * matter there (`rollPlanetX`, the no-dead-zone rule), sized and spaced apart
 * enough to read as two different obstacles rather than one blob
 * (`rollPlanetRadii`/`rollCompanionY`/`surfaceGap`, issue #16), and — best
 * effort, never a hard requirement — checked against `seatCanReachOpponent`
 * for BOTH players before shipping, so a genuinely impossible map is rare
 * rather than merely unlikely.
 *
 * Everything is rolled together in the inner loop rather than once per outer
 * attempt, because each step now depends on the one before it: the blocker's
 * `x` depends on its own radius and row, and the companion's row depends on
 * the blocker's.
 */
export function rollPlanets(random: () => number): [GravityPlanet, GravityPlanet] {
  let candidate: [GravityPlanet, GravityPlanet] | null = null;

  for (let attempt = 0; attempt < GRAVITY_WINNABILITY_ATTEMPTS; attempt++) {
    const artA = Math.floor(random() * GRAVITY_PLANET_ART_COUNT);
    const artB = Math.floor(random() * GRAVITY_PLANET_ART_COUNT);

    for (let spacing = 0; spacing < GRAVITY_SPACING_ATTEMPTS; spacing++) {
      const [ra, rb] = rollPlanetRadii(random);
      // The bigger planet can always reach the centre from a legal row; the
      // smaller one only sometimes, so the coin flip only gets a say when it
      // actually can — nothing should read as "the big one is the middle one"
      // any more than as "the left one".
      const big = Math.max(ra, rb);
      const small = Math.min(ra, rb);
      const blockSmall = small > CENTRE_OFFSET_MIN && random() < 0.5;
      const rBlock = blockSmall ? small : big;
      const rFree = blockSmall ? big : small;

      const blockLeft = random() < 0.5;
      const block = rollCentreBlocker(random, rBlock, blockLeft ? 'left' : 'right');
      const blocker: GravityPlanet = { x: block.x, y: block.y, r: rBlock, art: artA };
      const free: GravityPlanet = {
        x: rollPlanetX(random, blockLeft ? 'right' : 'left', rFree),
        y: rollCompanionY(random, block.y),
        r: rFree,
        art: artB,
      };

      // Which slot each lands in is a coin flip of its own, so neither index
      // means "the blocker" to anything downstream.
      candidate = random() < 0.5 ? [blocker, free] : [free, blocker];
      if (surfaceGap(blocker, free) >= GRAVITY_PLANET_MIN_GAP) break;
      // Otherwise this attempt's geometry is kept as the fallback and the
      // loop tries again — never leaves `candidate` unset.
    }

    if (candidate && seatCanReachOpponent(candidate, 0) && seatCanReachOpponent(candidate, 1)) return candidate;
  }

  // Fail-soft: every attempt above is a courtesy, not a guarantee — ship the
  // last geometry rather than ever refusing to start a match over it.
  return candidate as [GravityPlanet, GravityPlanet];
}

/** Host pressed start. Returns false when the room is not eligible.
 *
 * **Solo mode is a hotseat, not a second player.** The one connected phone
 * takes both seats, alternating which ship it aims each turn — the same
 * idiom Tap Fighter's own solo already uses (`worker/tapFighter.ts`). */
export async function startGravityShooter(
  ctx: Ctx,
  roundId: number,
  connected: PlayerId[],
  solo = false,
): Promise<boolean> {
  if (!enoughToStart(connected.length, [GRAVITY_MIN_PLAYERS, GRAVITY_MAX_PLAYERS], solo)) return false;
  const host = connected[0];
  const other = solo ? host : connected[1];
  if (!host || !other) return false;

  const now = ctx.now();
  const g: Gravity = {
    roundId,
    startsAt: now,
    seats: [host, other],
    planets: rollPlanets(ctx.random),
    lives: [GRAVITY_LIVES, GRAVITY_LIVES],
    turn: 0,
    resolvesAt: now + GRAVITY_SHOT_TIMEOUT_MS,
    lastShot: null,
    winner: null,
    phase: 'running',
    solo,
  };

  await ctx.save(g);
  broadcast(ctx, g);
  await ctx.setAlarm(g.resolvesAt);
  return true;
}

function otherSeat(seat: 0 | 1): 0 | 1 {
  return seat === 0 ? 1 : 0;
}

/**
 * The shooter's own turn, resolved. `hit` is trusted as reported — the
 * referee already holds everything a verification would need (the planets
 * it rolled itself, plus `angle`/`strength`) but deliberately does not
 * re-derive it, by direct instruction (spec §8). `angle`/`strength` are
 * still clamped to finite, sane ranges: a cheap defence against a malformed
 * payload producing `NaN`/`Infinity` in the other phone's own replay, not
 * a check on the claimed outcome.
 *
 * The sender must be whoever `seats[turn]` actually is — in solo that is
 * always the one connected player, on either seat, so nothing extra is
 * needed to let a hotseat player fire for both ships in their own turn.
 */
export async function onGravityShot(
  ctx: Ctx,
  playerId: PlayerId,
  roundId: number,
  angle: number,
  strength: number,
  hit: boolean,
): Promise<void> {
  const g = await ctx.load();
  if (!g || g.phase !== 'running' || g.roundId !== roundId) return;
  if (g.seats[g.turn] !== playerId) return;
  if (ctx.now() >= g.resolvesAt) return; // the tick has already timed this turn out

  const shooter = g.turn;
  const opponent = otherSeat(shooter);

  const safeAngle = Number.isFinite(angle) ? angle : 0;
  const safeStrength = Number.isFinite(strength) ? Math.max(0, Math.min(GRAVITY_MAX_STRENGTH, strength)) : 0;
  const landed = hit === true;

  g.lastShot = { shooter, angle: safeAngle, strength: safeStrength, hit: landed };
  if (landed) g.lives[opponent] = Math.max(0, g.lives[opponent] - 1);

  if (g.lives[opponent] <= 0) {
    await finish(ctx, g, shooter);
    return;
  }

  g.turn = opponent;
  g.resolvesAt = ctx.now() + GRAVITY_SHOT_TIMEOUT_MS;
  await ctx.save(g);
  broadcast(ctx, g);
  await ctx.setAlarm(g.resolvesAt);
}

/**
 * The alarm. A shooter who never sent `gravity-shot` costs them the turn,
 * not the match (spec §2.4) — resolved as a miss, same as Tap Fighter's own
 * no-lock-in default for a silent planning phase.
 */
export async function tick(ctx: Ctx): Promise<boolean> {
  const g = await ctx.load();
  if (!g || g.phase !== 'running') return false;
  if (ctx.now() < g.resolvesAt) return false;

  const shooter = g.turn;
  const opponent = otherSeat(shooter);

  g.lastShot = { shooter, angle: 0, strength: 0, hit: false };
  g.turn = opponent;
  g.resolvesAt = ctx.now() + GRAVITY_SHOT_TIMEOUT_MS;
  await ctx.save(g);
  broadcast(ctx, g);
  await ctx.setAlarm(g.resolvesAt);
  return false;
}

/**
 * A player vanished. The other one wins outright — two fixed seats, the
 * same rule Grid Attack/Neon Fall use, not Steady Hand's "continue without
 * them" (which only applies at 3+ players).
 */
export async function onPlayerGone(ctx: Ctx, playerId: PlayerId): Promise<void> {
  const g = await ctx.load();
  if (!g || g.phase !== 'running') return;
  const seat = g.seats[0] === playerId ? 0 : g.seats[1] === playerId ? 1 : null;
  if (seat === null) return;

  await finish(ctx, g, otherSeat(seat));
}

async function finish(ctx: Ctx, g: Gravity, winner: 0 | 1 | null): Promise<void> {
  g.phase = 'done';
  g.winner = winner;
  await ctx.save(g);
  broadcast(ctx, g);
}

export function toState(g: Gravity): GravityShooterState {
  return g;
}

function broadcast(ctx: Ctx, g: Gravity): void {
  ctx.broadcast({ t: 'gravity', s: ctx.nextSeq(), d: toState(g) });
}
