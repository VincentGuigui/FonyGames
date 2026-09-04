import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { art } from '../../core/art/sprites';
import shipArtA from './art/ship-a.png?url&no-inline';
import shipArtB from './art/ship-b.png?url&no-inline';
import planetArtA from './art/planet-a.png?url&no-inline';
import planetArtB from './art/planet-b.png?url&no-inline';
import planetArtC from './art/planet-c.png?url&no-inline';
import missileArt from './art/missile.png?url&no-inline';
import { GRAVITY_SHOT_TIMEOUT_MS, gravityBodies, type GravityPlanet } from '../../../../shared/protocol';
import {
  GRAVITY_EXPLOSION_GIF_MS,
  GRAVITY_SHIP_WIDTH,
  GRAVITY_STEP_MS,
  GravityGame,
  aimFromFinger,
  shipPosition,
  contactPoint,
  headingBetween,
  otherSeat,
  shotClockPulseAlpha,
  simulateShot,
  viewTransform,
  type Seat,
  type Vec,
} from './game';

/**
 * Gravity Shooter's own board. Spec: docs/specs/games/gravity-shooter.md §2, §4
 *
 * `FightCanvas.tsx`'s pattern: a `latest` prop ref plus one `requestAnimationFrame`
 * loop, DPR-aware (same shape `TilesCanvas.tsx` already follows). The one thing
 * genuinely new here is `viewTransform` (spec §2.2): every world point — planets,
 * both ships, a shot's own path — is flipped for whichever seat is NOT at world
 * `y = 1`, right here at the moment it is drawn, so a single canonical board can
 * be shown two ways without ever existing twice.
 */

const PLANET_ART = [planetArtA, planetArtB, planetArtC].map((url) => art(url));
/** One art file per ship colour (spec's own two-colour brief) — `isSelf` in
 *  `drawShip` picks between them, the same shape Tap Fighter's own
 *  `fighter1.png`/`fighter2.png` pair already uses. */
const SHIP_ART: [ReturnType<typeof art>, ReturnType<typeof art>] = [art(shipArtA), art(shipArtB)];
const missileSprite = art(missileArt);

const BG_TOP = '#0a0a18';
const BG_LOW = '#161033';
const SHIP_COLORS: [string, string] = ['#38BDF8', '#F472B6'];
const PLANET_FALLBACK = ['#94A3B8', '#A78BFA', '#FCA5A5'];
/** How much of the shooter's own screen the aim preview covers, measured
 *  from the shooter's own edge: solid across the near third, fading through
 *  the middle third, gone for the last third before the opponent (spec §2.2). */
const AIM_FRACTION_SOLID = 1 / 3;
const AIM_FRACTION_FADE = 2 / 3;

export type FlightEnd = {
  hit: boolean;
  /** Where the missile actually stopped, in the viewer's own local space. */
  local: Vec;
  /** The ship it was aimed at, same local space — the centre of the blast when
   *  that ship is destroyed. */
  target: Vec;
  /** Where the flight actually met the hull, same local space (`contactPoint`)
   *  — the impact's own place, which is neither where the simulation stopped
   *  (a hit radius short, floating above the ship) nor the ship's centre. */
  contact: Vec;
  /** Where a planet swallowed the missile, same local space — null for every
   *  other ending. A planet's own absorption radius is its drawn radius, so
   *  this needs no `contactPoint` walk-back the way a ship's hit does. */
  planetImpact: Vec | null;
};

/** The ship that just lost the match, and when its explosion started — it
 *  fades out across `GRAVITY_EXPLOSION_GIF_MS` while that GIF plays (spec §4). */
export type DyingShip = { seat: Seat; startedAt: number };

type Props = {
  game: GravityGame;
  /** The shot just finished animating — the caller decides any impact GIF (spec §4). */
  onFlightEnd: (end: FlightEnd) => void;
  onShoot: (payload: { roundId: number; angle: number; strength: number; hit: boolean }) => void;
  dying?: DyingShip | null;
};

export function GravityCanvas({ game, onFlightEnd, onShoot, dying = null }: Props): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ game, onFlightEnd, onShoot, dying });
  latest.current = { game, onFlightEnd, onShoot, dying };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let frame = 0;

    const draw = (): void => {
      const { game, onFlightEnd, dying } = latest.current;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (width === 0 || height === 0) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (element.width !== pixelWidth || element.height !== pixelHeight) {
        element.width = pixelWidth;
        element.height = pixelHeight;
      }
      const ctx = element.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const state = game.state;
      const viewSeat: Seat = game.mySeat ?? 0;
      const toLocal = (p: Vec): Vec => viewTransform(viewSeat, p);
      const toPixel = (p: Vec): Vec => ({ x: p.x * width, y: p.y * height });

      // Sky.
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, BG_TOP);
      sky.addColorStop(1, BG_LOW);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      if (state) {
        // `displayedPlanets`, not `state.planets`: a re-rolled board waits for
        // the shot in flight to land and then eases into place (spec §2.1).
        // Only the drawing uses it — every simulation stays on `state.planets`.
        const drawnBoard = game.displayedBoard();
        const drawnPlanets = drawnBoard.planets;
        const starPx = toPixel(toLocal({ x: 0.5, y: 0.5 }));
        drawStar(ctx, starPx.x, starPx.y, drawnBoard.starRadius * width);
        const planetPx = drawnPlanets.map((p: GravityPlanet) => ({ ...toPixel(toLocal(p)), r: p.r * width }));
        for (let i = 0; i < drawnPlanets.length; i++) {
          const planet = drawnPlanets[i];
          const px = planetPx[i];
          if (!planet || !px) continue;
          drawPlanet(ctx, px.x, px.y, px.r, planet.art, dpr);
        }

        const mySeat = game.mySeat;
        // The shot clock's own countdown (spec §2.4): the ship whose turn it
        // is starts blinking `GRAVITY_SHOT_BLINK_START_MS` in, faster as
        // `resolvesAt` gets closer. Timed off `state.resolvesAt` itself
        // rather than a locally-tracked start, so both phones blink the same
        // shooter in step without agreeing on anything but that one number.
        const turnElapsedMs = GRAVITY_SHOT_TIMEOUT_MS - (state.resolvesAt - game.now());
        const shipSeats: Seat[] = [0, 1];
        for (const seat of shipSeats) {
          const world = shipPosition(seat);
          const local = toLocal(world);
          const px = toPixel(local);
          // The self ship always draws nearest local y=1 (bottom), by construction.
          const isSelf = mySeat !== null && seat === mySeat;
          // The destroyed ship fades out under its own explosion rather than
          // vanishing when the results screen replaces the board.
          const fade = dying && dying.seat === seat
            ? 1 - Math.min(1, Math.max(0, (performance.now() - dying.startedAt) / GRAVITY_EXPLOSION_GIF_MS))
            : state.phase === 'running' && seat === state.turn
              ? shotClockPulseAlpha(turnElapsedMs)
              : 1;
          drawShip(ctx, px.x, px.y, width, isSelf, local.y > 0.5, dpr, fade);
        }

        // A live drag can outlive its own shot clock — `canAim` catches the
        // deadline passing, and this is where that gets acted on: cancelled
        // rather than left to release into a shot the referee will reject.
        if (game.aim && !game.canAim) game.cancelAim();

        // The fading aim preview (spec §2), while a drag is live.
        const aim = game.aim;
        if (aim && mySeat !== null) {
          const preview = simulatePreviewPath(game, aim);
          drawDashedPath(ctx, preview.map((p) => toPixel(toLocal(p))), width, height);
          // The missile itself, sitting at the top-centre of the ship's own
          // sprite and swinging to face the finger as it moves — the shot's
          // own start, shown before it is taken rather than appearing out of
          // nowhere on release. Drawn in LOCAL space directly: the shooter
          // always sees themselves at the bottom, so the launch point is seat
          // 0's own position and the aim angle needs no view flip. The
          // vertical offset comes from the ship sprite's OWN rasterised
          // height (same lookup `drawShip` itself uses), not a fraction of
          // the board's width assumed to match it — a real PNG whose aspect
          // ratio drifts from 2:1 would otherwise float the missile off the
          // hull.
          const launchPx = toPixel(shipPosition(0));
          const shipPxWidth = width * GRAVITY_SHIP_WIDTH;
          const ownShip = SHIP_ART[0].at(shipPxWidth, dpr);
          const shipPxHeight = ownShip ? ownShip.h : shipPxWidth / 2;
          drawMissile(ctx, launchPx.x, launchPx.y - shipPxHeight, width, dpr, aimFromFinger(aim.x, aim.y).angle);
        }

        // The missile in flight, or resolving (spec §2.3).
        const shot = game.activeShot;
        if (shot) {
          const elapsed = game.shotElapsedMs() ?? 0;
          const flightMs = Math.max(1, (shot.result.path.length - 1) * GRAVITY_STEP_MS);
          const idx = Math.min(shot.result.path.length - 1, Math.floor((elapsed / flightMs) * (shot.result.path.length - 1)));
          const point = shot.result.path[idx];
          if (point) {
            const trail = shot.result.path.slice(0, idx + 1).map((p) => toPixel(toLocal(p)));
            drawTrail(ctx, trail, viewSeat === shot.seat ? SHIP_COLORS[0] : SHIP_COLORS[1]);
            const px = toPixel(toLocal(point));
            // Nose along the tangent: the step it just took, or the step it is
            // about to take on the very first frame, when there is no previous.
            const previous = shot.result.path[Math.max(0, idx - 1)] ?? point;
            const next = shot.result.path[idx + 1] ?? point;
            const from = idx > 0 ? toPixel(toLocal(previous)) : px;
            const to = idx > 0 ? px : toPixel(toLocal(next));
            drawMissile(ctx, px.x, px.y, width, dpr, headingBetween(from, to));
          }
          if (elapsed >= flightMs) {
            const end = shot.result.path.at(-1);
            if (end) {
              const targetLocal = toLocal(shipPosition(otherSeat(shot.seat)));
              const endPx = toPixel(toLocal(end));
              const shipPx = toPixel(targetLocal);
              const shipW = width * GRAVITY_SHIP_WIDTH;
              const hull = contactPoint(endPx, shipPx, shipW, shipW / 2);
              onFlightEnd({
                hit: shot.result.hit,
                local: toLocal(end),
                target: targetLocal,
                contact: { x: hull.x / width, y: hull.y / height },
                planetImpact: shot.result.absorbedAt ? toLocal(shot.result.absorbedAt) : null,
              });
            }
            game.clearActiveShot();
          }
        }
      }

      frame = requestAnimationFrame(draw);
    };

    let dragging = false;

    const localPoint = (event: PointerEvent): Vec => {
      const rect = element.getBoundingClientRect();
      return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    };

    const onPointerDown = (event: PointerEvent): void => {
      const { game } = latest.current;
      if (!game.beginAim()) return;
      dragging = true;
      const p = localPoint(event);
      const anchor = shipPosition(0); // the shooter's own local anchor is always seat 0's own world position
      game.updateAim(p.x - anchor.x, p.y - anchor.y);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!dragging) return;
      const p = localPoint(event);
      const anchor = shipPosition(0);
      latest.current.game.updateAim(p.x - anchor.x, p.y - anchor.y);
    };

    const onPointerUp = (): void => {
      if (!dragging) return;
      dragging = false;
      const { game, onShoot } = latest.current;
      const payload = game.releaseAim();
      if (payload) onShoot(payload);
    };

    const onPointerCancel = (): void => {
      dragging = false;
      latest.current.game.cancelAim();
    };

    element.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, []);

  return <canvas ref={canvas} class="gravity-canvas" />;
}

/** The live drag's own path, purely for the fading preview — the exact same
 *  simulation the eventual shot will run, so the preview is never a lie
 *  about the shot (spec §2). */
function simulatePreviewPath(game: GravityGame, aim: Vec): Vec[] {
  const state = game.state;
  const seat = game.mySeat;
  if (!state || seat === null) return [];
  if (aim.x === 0 && aim.y === 0) return [shipPosition(seat)];
  const { angle, strength } = aimFromFinger(aim.x, aim.y);
  return simulateShot(gravityBodies(state.starRadius, state.planets), seat, angle, strength).path;
}

/** The dashed preview: solid for the near third of the screen, fading out
 *  across the middle third, gone for the last third before the opponent
 *  (spec §2.2) — drawn per-segment since canvas has no built-in
 *  gradient-along-a-path. */
function drawDashedPath(ctx: CanvasRenderingContext2D, points: Vec[], width: number, height: number): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = Math.max(1, width * 0.006);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    // Opacity by where the segment actually SITS on the shooter's own screen,
    // not by how far along the path it is — the fade is a screen distance
    // (spec §2.2), so a slow or hard-curving shot has to fade in the same
    // place a fast straight one does.
    const alpha = opacityFor(b.y / height);
    // A shot that loops back toward the shooter can re-enter the visible
    // band, so this cannot stop at the first faded segment.
    if (alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = SHIP_COLORS[0];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function opacityFor(localY: number): number {
  const fromEdge = 1 - localY; // 0 at the shooter's own edge, 1 at the far edge
  if (fromEdge <= AIM_FRACTION_SOLID) return 1;
  if (fromEdge >= AIM_FRACTION_FADE) return 0;
  return 1 - (fromEdge - AIM_FRACTION_SOLID) / (AIM_FRACTION_FADE - AIM_FRACTION_SOLID);
}

/** The missile's own already-flown trail, solid, in the shooter's own colour. */
function drawTrail(ctx: CanvasRenderingContext2D, points: Vec[], color: string): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const first = points[0];
  if (!first) {
    ctx.restore();
    return;
  }
  ctx.moveTo(first.x, first.y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.restore();
}

function drawPlanet(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, artIndex: number, dpr: number): void {
  const sheet = PLANET_ART[artIndex % PLANET_ART.length];
  const sprite = sheet?.at(r * 2, dpr);
  if (sprite) {
    ctx.drawImage(sprite.source, x - sprite.w / 2, y - sprite.h / 2, sprite.w, sprite.h);
    return;
  }
  ctx.save();
  ctx.fillStyle = PLANET_FALLBACK[artIndex % PLANET_FALLBACK.length] ?? PLANET_FALLBACK[0]!;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The star at the middle of the board (spec §2.1). Drawn procedurally rather
 * than from a sprite, for the reason `docs/design/illustrations.md` gives:
 * sprites may only be translated, scaled and rotated, and this one's radius is
 * re-rolled every couple of shots and eased between sizes as it changes — a
 * shape that genuinely changes over time stays code, not art. A corona twice
 * the body's own radius sells the heat without pretending to be a light source
 * the rest of the board reacts to.
 */
function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  if (r <= 0) return;
  ctx.save();
  const corona = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2);
  corona.addColorStop(0, 'rgba(253, 224, 71, 0.42)');
  corona.addColorStop(0.5, 'rgba(249, 115, 22, 0.16)');
  corona.addColorStop(1, 'rgba(249, 115, 22, 0)');
  ctx.fillStyle = corona;
  ctx.beginPath();
  ctx.arc(x, y, r * 2, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.15, x, y, r);
  body.addColorStop(0, '#fffbeb');
  body.addColorStop(0.45, '#fde047');
  body.addColorStop(1, '#f97316');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A half-circle-domed ship, 256x128 art (spec's own dimensions) — the dome
 *  points toward the opponent, i.e. away from local y = 1. */
function drawShip(ctx: CanvasRenderingContext2D, x: number, y: number, boardWidth: number, isSelf: boolean, domeUp: boolean, dpr: number, alpha = 1): void {
  if (alpha <= 0) return;
  // `GRAVITY_SHIP_WIDTH`, not a literal: the hit radius is defined as half of
  // it (`game.ts`), so a ship drawn at some other size would be a ship whose
  // hitbox no longer matches its own image.
  const w = boardWidth * GRAVITY_SHIP_WIDTH;
  const sprite = SHIP_ART[isSelf ? 0 : 1].at(w, dpr);
  if (sprite) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    // The art faces one way; the opponent's own ship is drawn dome-down by
    // flipping the y axis rather than keeping a second, mirrored sprite.
    if (!domeUp) ctx.scale(1, -1);
    ctx.drawImage(sprite.source, -sprite.w / 2, domeUp ? -sprite.h : 0, sprite.w, sprite.h);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = SHIP_COLORS[isSelf ? 0 : 1];
  ctx.beginPath();
  ctx.arc(x, y, w / 2, Math.PI, 0, !domeUp);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * The missile, nose-first along `heading` — the angle its travel makes with
 * straight-up, positive clockwise, the same convention `aimFromFinger` uses.
 * The art is drawn pointing up, so the rotation is the heading itself.
 */
function drawMissile(ctx: CanvasRenderingContext2D, x: number, y: number, boardWidth: number, dpr: number, heading = 0): void {
  const w = boardWidth * 0.05;
  const sprite = missileSprite.at(w, dpr);
  if (sprite) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.drawImage(sprite.source, -sprite.w / 2, -sprite.h / 2, sprite.w, sprite.h);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.arc(x, y, Math.max(2, w / 2), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

