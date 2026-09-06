import {
  GRAVITY_LIVES,
  GRAVITY_MAX_PLAYERS,
  GRAVITY_MIN_LANDING_SHOTS,
  GRAVITY_MAX_AIM_DISTANCE,
  GRAVITY_MAX_STRENGTH,
  GRAVITY_MIN_AIM_DISTANCE,
  GRAVITY_MIN_PLAYERS,
  GRAVITY_PLANET_ART_COUNT,
  GRAVITY_PLANET_COUNT,
  GRAVITY_PLANET_MIN_GAP,
  GRAVITY_PLANET_MIN_SIZE_DIFF_RATIO,
  GRAVITY_PLANET_MIN_Y_DIFF,
  GRAVITY_PLANET_R_MAX,
  GRAVITY_PLANET_R_MIN,
  GRAVITY_PLANET_X_MARGIN,
  GRAVITY_PLANET_Y_MAX,
  GRAVITY_PLANET_Y_MIN,
  GRAVITY_SHIP_MARGIN,
  GRAVITY_SHOTS_PER_MAP,
  GRAVITY_MAX_FLIGHT_MS,
  GRAVITY_SHOT_TIMEOUT_MS,
  GRAVITY_STAR_R_MAX,
  GRAVITY_STAR_R_MIN,
  gravityBodies,
  type GravityPlanet,
  type GravityPlanetTrio,
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
 * One planet's own `x`: anywhere on its own half of the board inside the edge
 * margin, and nothing else. Two rules have been tried here and both are gone —
 * pinning a planet CLOSE to the centre so its gravity reached it, then pushing
 * it far enough out to clear the star. A planet may now sit over the middle of
 * the board and overlap the star outright; only the other planet is owed room
 * (`GRAVITY_PLANET_MIN_GAP`).
 */
function rollPlanetX(random: () => number, side: 'left' | 'right'): number {
  if (side === 'left') return GRAVITY_PLANET_X_MARGIN + random() * (0.5 - GRAVITY_PLANET_X_MARGIN);
  return 0.5 + random() * (0.5 - GRAVITY_PLANET_X_MARGIN);
}

/**
 * Both planets' own radii, guaranteed at least `GRAVITY_PLANET_MIN_SIZE_DIFF_RATIO`
 * apart (issue #16) — constructed directly rather than rolled independently
 * and rejected on a mismatch, so this never has to retry. The bigger one is
 * rolled first, from high enough in the range that shrinking it by the
 * required ratio can never push the smaller one below `GRAVITY_PLANET_R_MIN`;
 * which planet actually gets which radius is still a fair coin flip.
 */
function rollPlanetRadii(random: () => number): [number, number, number] {
  const shrink = 1 - GRAVITY_PLANET_MIN_SIZE_DIFF_RATIO;
  // The biggest is rolled from high enough in the range that shrinking it
  // twice can still never push the smallest below the floor — with three
  // planets that is two shrinks of headroom, not one.
  const minBig = GRAVITY_PLANET_R_MIN / (shrink * shrink);
  const big = minBig + random() * (GRAVITY_PLANET_R_MAX - minBig);
  // Each next one is rolled between the floor (with its own remaining
  // headroom) and its predecessor's shrunk ceiling, so the chain is
  // constructed rather than rolled and rejected.
  const midFloor = GRAVITY_PLANET_R_MIN / shrink;
  const mid = midFloor + random() * (big * shrink - midFloor);
  const small = GRAVITY_PLANET_R_MIN + random() * (mid * shrink - GRAVITY_PLANET_R_MIN);
  return [big, mid, small];
}

/** Fisher-Yates over the referee's own `random()` — which planet gets which
 *  of the three sizes is a fair shuffle, so the crowded side is not always
 *  the one holding the big one. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** Centre distance minus both radii — how far apart the two planets'
 *  own SURFACES actually sit (issue #16), never their centres alone. */
export function surfaceGap(a: GravityPlanet, b: GravityPlanet): number {
  return Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
}

/**
 * The two rows for the planets that SHARE a side, at least
 * `GRAVITY_PLANET_MIN_Y_DIFF` apart (issue #16) and inside the band —
 * constructed rather than rejected: pick the lower one from a range that
 * still leaves the higher one room above it.
 *
 * Only the crowded side needs this. Three rows that far apart do not fit in
 * the band at all, and the lone planet across the centre line is already a
 * board-width and a star away from both of these.
 */
function rollSideYs(random: () => number): [number, number] {
  const span = GRAVITY_PLANET_Y_MAX - GRAVITY_PLANET_Y_MIN;
  const gap = Math.min(GRAVITY_PLANET_MIN_Y_DIFF, span);
  const low = GRAVITY_PLANET_Y_MIN + random() * (span - gap);
  const high = low + gap + random() * (GRAVITY_PLANET_Y_MAX - low - gap);
  return random() < 0.5 ? [low, high] : [high, low];
}

/** The lone planet's own row: anywhere in the band, with nobody to avoid. */
function rollPlanetY(random: () => number): number {
  return GRAVITY_PLANET_Y_MIN + random() * (GRAVITY_PLANET_Y_MAX - GRAVITY_PLANET_Y_MIN);
}

/** The star's own size for this board — its position never changes. */
function rollStarRadius(random: () => number): number {
  return GRAVITY_STAR_R_MIN + random() * (GRAVITY_STAR_R_MAX - GRAVITY_STAR_R_MIN);
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
/** Half the ship's own drawn width, matching `game.ts`'s own
 *  `GRAVITY_HIT_RADIUS` (= `GRAVITY_SHIP_WIDTH / 2`): the whole ship image is
 *  the target, so this coarse check has to be as generous as the real one. */
const FAIRNESS_HIT_RADIUS = 0.11;
/** Same board-height-over-target-duration derivation as `game.ts`'s own
 *  `GRAVITY_MAX_LAUNCH_SPEED`/`GRAVITY_MIN_LAUNCH_SPEED`. */
const FAIRNESS_BOARD_HEIGHT = 1 - 2 * GRAVITY_SHIP_MARGIN;
const FAIRNESS_LAUNCH_SPEED = FAIRNESS_BOARD_HEIGHT / 3;
const FAIRNESS_MIN_LAUNCH_SPEED = FAIRNESS_BOARD_HEIGHT / 12;
const FAIRNESS_STEP_S = 1 / 60;
/** 8s of flight — generous even for the slowest sampled pull (up to 6s
 *  straight-line at the true floor, more once gravity curves it, more still
 *  on a diagonal); this check only needs to find ONE connecting shot, not
 *  describe the whole flight. */
const FAIRNESS_MAX_STEPS = 480;
function fairnessShipPosition(seat: 0 | 1): { x: number; y: number } {
  return { x: 0.5, y: seat === 0 ? 1 - GRAVITY_SHIP_MARGIN : GRAVITY_SHIP_MARGIN };
}

/** The ship's own drawn height, matching `game.ts`'s `GRAVITY_SHIP_HEIGHT`
 *  (= `GRAVITY_SHIP_WIDTH / 2`): a shot leaves the nose, not the hull's
 *  middle (issue #37), and this check has to sample from the same place. */
const FAIRNESS_SHIP_HEIGHT = 0.11;

function fairnessLaunchPosition(seat: 0 | 1): { x: number; y: number } {
  const ship = fairnessShipPosition(seat);
  return { x: ship.x, y: seat === 0 ? ship.y - FAIRNESS_SHIP_HEIGHT : ship.y + FAIRNESS_SHIP_HEIGHT };
}

/** One sampled shot: does it reach within `FAIRNESS_HIT_RADIUS` of the
 *  opponent's own ship before it is absorbed, wanders off, or runs out of
 *  simulated time? */
function fairnessShotConnects(bodies: readonly GravityPlanet[], shooterSeat: 0 | 1, angle: number, strength: number): boolean {
  const start = fairnessLaunchPosition(shooterSeat);
  const target = fairnessShipPosition(shooterSeat === 0 ? 1 : 0);
  const speed = FAIRNESS_MIN_LAUNCH_SPEED + strength * (FAIRNESS_LAUNCH_SPEED - FAIRNESS_MIN_LAUNCH_SPEED);
  const localVx = Math.sin(angle) * speed;
  const localVy = -Math.cos(angle) * speed;
  let x = start.x;
  let y = start.y;
  let vx = shooterSeat === 0 ? localVx : -localVx;
  let vy = shooterSeat === 0 ? localVy : -localVy;
  /** Which way "toward the opponent" is, in world y — what "flew past it"
   *  below is measured against, same test the real `lifetimeZone` uses. */
  const travelDirection = Math.sign(target.y - start.y);

  for (let i = 0; i < FAIRNESS_MAX_STEPS; i++) {
    let ax = 0;
    let ay = 0;
    for (const p of bodies) {
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
    // Both of these are deliberately STRICTER than the real simulation, and
    // that is the whole point: the real flight would allow this shot to leave
    // the board and curve back in, or to overshoot the target's row and come
    // back — but only for as long as its lifetime budgets allow (spec §2.3),
    // and a shot this check accepted on the strength of a return trip is
    // exactly the shot the real flight kills mid-air. Measured: with the
    // bounds rule alone, 5 of 600 seat-boards shipped whose "guaranteed" shot
    // the real simulation never lands, every one of them a missile that
    // crossed the opponent's row and ran out its 1s `past` budget on the way
    // back. A trajectory that stays on the board, never crosses the target's
    // row, and lands inside `FAIRNESS_MAX_STEPS` cannot be ended early by any
    // budget or wall — so the guarantee is a guarantee.
    if (x < 0 || x > 1 || y < 0 || y > 1) return false;
    if (Math.sign(y - target.y) === travelDirection) return false; // flew past it
  }
  return false;
}

/**
 * The fan the search starts from, in **finger space**: 25 directions from -84°
 * to +84° at 7 distances out from the ship's nose, evenly spaced across the
 * aim ramp. 175 cheap integrations per seat.
 *
 * Finger space rather than angle/strength because that is where the answer has
 * to be measured (`aimTolerance` below): a person aims by putting a thumb
 * somewhere, and "how much room for error does this board leave" is a distance
 * on their screen, not a spread in a parameter the game never shows them.
 */
const FAIRNESS_DIRECTIONS_DEG = [
  -84, -77, -70, -63, -56, -49, -42, -35, -28, -21, -14, -7,
  0,
  7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77, 84,
];
const FAIRNESS_DISTANCE_STEPS = 6;

/** One finger offset, in the shooter's own local view units, out from the nose
 *  at `deg` from straight up. The same geometry `aimFromFinger` reads. */
function fingerAt(deg: number, distance: number): { dx: number; dy: number } {
  const a = (deg * Math.PI) / 180;
  return { dx: Math.sin(a) * distance, dy: -Math.cos(a) * distance };
}

/** A finger offset turned into a shot, exactly as the client's own
 *  `aimFromFinger` does it — floor band, linear ramp, cap. */
function fairnessAim(dx: number, dy: number): { angle: number; strength: number } {
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { angle: 0, strength: 0 };
  const reach = GRAVITY_MAX_AIM_DISTANCE - GRAVITY_MIN_AIM_DISTANCE;
  const strength = Math.min(GRAVITY_MAX_STRENGTH, Math.max(0, (distance - GRAVITY_MIN_AIM_DISTANCE) / reach));
  return { angle: Math.atan2(dx, -dy), strength };
}

function fairnessFingerLands(bodies: readonly GravityPlanet[], seat: 0 | 1, dx: number, dy: number): boolean {
  const { angle, strength } = fairnessAim(dx, dy);
  return fairnessShotConnects(bodies, seat, angle, strength);
}

/**
 * How many of the sampled shots actually land — the board's own answer to "how
 * much room for error does this seat get", and the accept condition for a
 * fresh roll (spec §2.1).
 *
 * **A count, not just existence.** The old rule stopped at the first hit, which
 * asked the wrong question: a hairline the sampling grid happened to fall on
 * passed it exactly as well as a wide open lane. Scanning the real winning
 * region finely on 50 rolled seat-boards showed why that matters — the median
 * board offers a window about 22px by 11° on a 400px board, but the worst
 * fifth offer 4-14px by 3-8°, which is not an aim, it is a coincidence.
 *
 * The fan's own hit count is a good, and nearly free, estimate of that window's
 * size: the grid is uniform over the aim disc, so the share of it that lands is
 * the share of the disc that lands. It is noisy per board — a small window can
 * fall between grid lines — but every error is a false rejection, and a
 * rejection only costs a re-roll.
 */
export function seatLandingShots(
  planets: readonly GravityPlanet[],
  seat: 0 | 1,
  starRadius: number,
): number {
  const bodies = gravityBodies(starRadius, planets);
  const span = GRAVITY_MAX_AIM_DISTANCE - GRAVITY_MIN_AIM_DISTANCE;
  let landed = 0;
  for (const deg of FAIRNESS_DIRECTIONS_DEG) {
    for (let step = 0; step <= FAIRNESS_DISTANCE_STEPS; step++) {
      const { dx, dy } = fingerAt(deg, GRAVITY_MIN_AIM_DISTANCE + (span * step) / FAIRNESS_DISTANCE_STEPS);
      if (fairnessFingerLands(bodies, seat, dx, dy)) landed += 1;
    }
  }
  return landed;
}

/** Does this seat have a shot a person could actually find (spec §2.1)? */
export function seatCanReachOpponent(
  planets: readonly GravityPlanet[],
  seat: 0 | 1,
  starRadius: number,
): boolean {
  return seatLandingShots(planets, seat, starRadius) >= GRAVITY_MIN_LANDING_SHOTS;
}

/**
 * How many whole map geometries (positions and sizes both) to try before
 * falling back. Far higher than the 8 it was: a board now has to carry a
 * landing shot for BOTH seats to ship at all (see `rollBoard`), so this is no
 * longer "improve the odds" but the actual search, and every attempt is a few
 * hundred cheap integrations rather than a rendered frame.
 */
const GRAVITY_WINNABILITY_ATTEMPTS = 200;
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
 * selecting for small planets. Three planets share one board now, so the
 * geometry is tighter again and there are three pairs to keep apart.
 */
const GRAVITY_SPACING_ATTEMPTS = 60;

/** A whole board: the star's own size, plus the three planets around it. */
export type GravityBoard = { starRadius: number; planets: GravityPlanetTrio };

/** Every pair of planets keeps its own 50px of clear space (spec §2.1) —
 *  including the two that share a side, which is the tight one. */
function allSurfacesClear(planets: readonly GravityPlanet[]): boolean {
  for (let i = 0; i < planets.length; i++) {
    for (let j = i + 1; j < planets.length; j++) {
      const a = planets[i];
      const b = planets[j];
      if (!a || !b) continue;
      if (surfaceGap(a, b) < GRAVITY_PLANET_MIN_GAP) return false;
    }
  }
  return true;
}

/**
 * One candidate geometry: three planets, two on one side and one on the
 * other, every placement rule satisfied except winnability — which is the
 * caller's business, because it is the expensive half.
 *
 * Returns null when this roll could not be spaced legally at all, rather than
 * shipping an overlapping board the way the two-planet version's fallback
 * did: with a guaranteed board behind it (`rollBoard`) there is no longer any
 * reason to accept a bad one.
 */
function rollGeometry(random: () => number): GravityBoard | null {
  for (let spacing = 0; spacing < GRAVITY_SPACING_ATTEMPTS; spacing++) {
    const starRadius = rollStarRadius(random);
    const radii = shuffled(rollPlanetRadii(random), random);
    const art = Array.from({ length: GRAVITY_PLANET_COUNT }, () => Math.floor(random() * GRAVITY_PLANET_ART_COUNT));
    // Which half holds the pair is a fair coin flip, so neither player learns
    // to expect the crowded side on their left.
    const crowded = random() < 0.5 ? 'left' : 'right';
    const lonely = crowded === 'left' ? 'right' : 'left';
    const [yLow, yHigh] = rollSideYs(random);

    const planets: GravityPlanetTrio = [
      { x: rollPlanetX(random, crowded), y: yLow, r: radii[0] ?? GRAVITY_PLANET_R_MIN, art: art[0] ?? 0 },
      { x: rollPlanetX(random, crowded), y: yHigh, r: radii[1] ?? GRAVITY_PLANET_R_MIN, art: art[1] ?? 0 },
      { x: rollPlanetX(random, lonely), y: rollPlanetY(random), r: radii[2] ?? GRAVITY_PLANET_R_MIN, art: art[2] ?? 0 },
    ];

    // The planets owe each other room; none owes the star any — a planet is
    // free to sit over the middle of the board and overlap it.
    if (allSurfacesClear(planets)) return { starRadius, planets };
  }
  return null;
}

/**
 * A whole board, rolled with the referee's own fair `random()` (spec §2.1).
 *
 * The **star** is the fixed point: always dead centre, only its size rolled.
 * It is what makes the straight line between the two ships a non-shot, which
 * is a job the planets used to share awkwardly — one of them was pinned to
 * cover the centre, and both were pulled close to the centre line so their
 * gravity reached it. Both of those rules are gone: the star does the work,
 * and the planets are free to roam their own halves.
 *
 * **Three planets, two on one side and one on the other** (coin flip which),
 * with everything issue #16 asked for still guaranteed rather than merely
 * likely: no two radii within 30% of each other down the whole chain
 * (`rollPlanetRadii`), the two that share a side 100px apart vertically
 * (`rollSideYs`), and every pair 50px of clear surface apart
 * (`allSurfacesClear`).
 *
 * **And a landing shot, for both seats, guaranteed.** This used to be best
 * effort — eight tries and then ship whatever the last one was. It is now the
 * accept condition: a geometry is only returned once `seatCanReachOpponent`
 * finds a trajectory from EACH seat that reaches the other ship without ever
 * leaving the visible board, which the real simulation cannot then end early
 * for any reason. A crowded board is much easier to seal off than a
 * two-planet one was, so this is the rule that keeps three planets fair.
 *
 * If 200 attempts somehow all fail, `GRAVITY_FALLBACK_BOARD` ships instead —
 * a fixed board whose own landing shots are asserted by the referee's tests.
 * Never an unwinnable one, and never a match refused over a roll.
 */
export function rollBoard(random: () => number): GravityBoard {
  for (let attempt = 0; attempt < GRAVITY_WINNABILITY_ATTEMPTS; attempt++) {
    const candidate = rollGeometry(random);
    if (!candidate) continue;
    if (
      seatCanReachOpponent(candidate.planets, 0, candidate.starRadius)
      && seatCanReachOpponent(candidate.planets, 1, candidate.starRadius)
    ) {
      return candidate;
    }
  }
  return { starRadius: GRAVITY_FALLBACK_BOARD.starRadius, planets: [...GRAVITY_FALLBACK_BOARD.planets] as GravityPlanetTrio };
}

/**
 * The board of last resort. Legal under every §2.1 rule and comfortably past
 * the landing-shot bar — `worker/gravityShooter.test.ts` asserts both, which is
 * the only reason it is safe to ship without checking it at runtime.
 *
 * Not hand-placed: it is the most generous board in the first 400 seeded rolls,
 * offering its weaker seat 9 landing shots where the bar is 3. If the roller
 * ever does fall through to it, the board it falls through to should be the
 * easiest one to aim on, not merely a legal one.
 */
export const GRAVITY_FALLBACK_BOARD: GravityBoard = {
  starRadius: 0.0762,
  planets: [
    { x: 0.8092, y: 0.6898, r: 0.0519, art: 2 },
    { x: 0.8324, y: 0.3359, r: 0.0752, art: 1 },
    { x: 0.1675, y: 0.4411, r: 0.1097, art: 2 },
  ],
};

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
  const board = rollBoard(ctx.random);
  const g: Gravity = {
    roundId,
    startsAt: now,
    seats: [host, other],
    planets: board.planets,
    starRadius: board.starRadius,
    shots: 0,
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
  /** How long this shot will be on screen — the next turn's clock waits it out
   *  (issue #34). Clamped, so a client cannot claim its way to a longer turn. */
  flightMs: number,
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
  const watching = Number.isFinite(flightMs) ? Math.max(0, Math.min(GRAVITY_MAX_FLIGHT_MS, flightMs)) : 0;

  g.lastShot = { shooter, angle: safeAngle, strength: safeStrength, hit: landed, timedOut: false };
  if (landed) g.lives[opponent] = Math.max(0, g.lives[opponent] - 1);

  if (g.lives[opponent] <= 0) {
    await finish(ctx, g, shooter);
    return;
  }

  // The opponent's shot clock starts when the missile lands, not when it was
  // fired (issue #34): until then they are watching someone else's flight, and
  // a 10s trajectory used to eat almost their whole turn — then `tick` took a
  // life off them for a shot they never had time to aim.
  g.turn = opponent;
  g.resolvesAt = ctx.now() + watching + GRAVITY_SHOT_TIMEOUT_MS;
  countShotAndMaybeReroll(ctx, g);
  await ctx.save(g);
  broadcast(ctx, g);
  await ctx.setAlarm(g.resolvesAt);
}

/**
 * A resolved shot's own bookkeeping, shared by a real shot and a timed-out one:
 * count it, and roll a whole fresh board once both seats have spent a shot on
 * this one (spec §2.1) — never mid-exchange, so neither player aims at a map
 * the other never faced.
 *
 * Called only where the match CONTINUES. A match-ending shot skips it: the
 * board it was won on is the board both phones are still animating the winning
 * flight and explosion against.
 */
function countShotAndMaybeReroll(ctx: Ctx, g: Gravity): void {
  g.shots += 1;
  if (g.shots % GRAVITY_SHOTS_PER_MAP !== 0) return;
  const board = rollBoard(ctx.random);
  g.planets = board.planets;
  g.starRadius = board.starRadius;
}

/**
 * The alarm — the shot clock running out (spec §2.4). Taking too long is no
 * longer free: the missile goes off in the dawdler's own hands and costs THEM
 * a life, which can end the match on the spot. The turn still passes either
 * way, so a phone that has simply gone quiet cannot stall anything.
 *
 * `lastShot.timedOut` is the marker for it, which is how a client tells this
 * apart from a real miss: nobody aimed it, so nothing is animated flying
 * (`game.ts`'s own `apply`), and the blast is drawn on the shooter's own ship.
 */
export async function tick(ctx: Ctx): Promise<boolean> {
  const g = await ctx.load();
  if (!g || g.phase !== 'running') return false;
  if (ctx.now() < g.resolvesAt) return false;

  const shooter = g.turn;
  const opponent = otherSeat(shooter);

  g.lastShot = { shooter, angle: 0, strength: 0, hit: false, timedOut: true };
  g.lives[shooter] = Math.max(0, g.lives[shooter] - 1);

  if (g.lives[shooter] <= 0) {
    await finish(ctx, g, opponent);
    return false;
  }

  g.turn = opponent;
  g.resolvesAt = ctx.now() + GRAVITY_SHOT_TIMEOUT_MS;
  countShotAndMaybeReroll(ctx, g);
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
