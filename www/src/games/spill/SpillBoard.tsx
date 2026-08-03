import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Player, PlayerId } from '../../../../shared/protocol';
import type { RoomClient } from '../../core/room/client';
import type { SpillGame } from './game';
import { startRenderer, type Renderer } from './render';
import { GameMenu } from '../../core/ui/GameMenu';
import { RulesPanel } from '../../core/ui/RulesPanel';
import { SeatMap } from './SeatMap';
import { screenAngleTo } from '../../../../shared/spillGeometry';
import type { Theme } from './themes';

/**
 * The playing surface. Spec: docs/specs/games/spill.md §3–§5
 *
 * Everything visible is the theme's; everything authoritative is the server's.
 * This component is the bit in between — it turns a finger into a `fling` or a
 * `catch`, and starts the render loop.
 *
 * Deliberately **not** re-rendered per frame: the canvas animates on its own
 * rAF loop reading the game object directly, so Preact only re-renders when the
 * chrome around it changes. A 60 fps virtual-DOM diff would be pure waste.
 */

/** Below this, a gesture was a tap and not a flick. */
const DRAG_SLOP_PX = 24;

/** The tap-a-seat fallback throws at a fixed, comfortable speed (spec §11). */
const FALLBACK_SPEED = 2.2;

/**
 * How far from the middle the peer markers sit, as a percentage of the board.
 *
 * Narrower vertically than horizontally so the marker straight ahead — the seat
 * opposite you, with four players — clears the count and the gear above it.
 */
const PEER_RADIUS_X = 34;
const PEER_RADIUS_Y = 26;

type Gesture = {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  x: number;
  y: number;
  t: number;
};

export function SpillBoard({
  game,
  title,
  concept,
  rules,
  theme,
  client,
  me,
  players,
}: {
  game: SpillGame;
  title: string;
  concept: string;
  rules: string[];
  theme: Theme;
  client: RoomClient | null;
  me: PlayerId | null;
  players: Player[];
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  // Seeded from the game, not from 0: zero is the *winning* number, so a board
  // that starts at zero flashes "you won" for a moment at the top of a round.
  const [count, setCount] = useState(() => game.view(1, 1).count);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !client) return;

    const renderer = startRenderer(
      canvas,
      game,
      theme,
      () => client.now(),
      () => {
        const g = gestureRef.current;
        if (!g) return null;
        const dx = g.x - g.x0;
        const dy = g.y - g.y0;
        if (Math.hypot(dx, dy) < DRAG_SLOP_PX) return null;
        const angle = Math.atan2(dx, -dy);
        const hit = game.target(angle);
        return { angle, hit, bounces: game.seatCount === 2 && hit !== null };
      },
    );
    rendererRef.current = renderer;
    return () => {
      renderer.stop();
      rendererRef.current = null;
    };
    // `theme` is deliberately absent: swapping it must not restart the loop.
    // The effect below hands the new one to the running renderer instead.
  }, [game, client]);

  useEffect(() => {
    rendererRef.current?.setTheme(theme);
  }, [theme]);

  // A cheap 4 Hz tick keeps the readout and the lock state honest without
  // re-rendering the tree every frame. Runs once immediately so a remount never
  // shows a quarter-second of stale state.
  useEffect(() => {
    if (!client) return;
    const tick = (): void => {
      const v = game.view(1, 1);
      setCount(v.count);
      setLocked(v.lockedUntil > client.now());
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [game, client]);

  const roundId = game.state?.roundId ?? 0;

  function send(angle: number, speed: number): void {
    if (!client) return;
    const dropId = game.heldId();
    client.send({
      t: 'fling',
      d: dropId === null ? { angle, speed, roundId } : { angle, speed, roundId, dropId },
    });
  }

  function onDown(e: PointerEvent): void {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    gestureRef.current = { id: e.pointerId, x0: x, y0: y, t0: e.timeStamp, x, y, t: e.timeStamp };
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent): void {
    const g = gestureRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!g || g.id !== e.pointerId || !rect) return;
    g.x = e.clientX - rect.left;
    g.y = e.clientY - rect.top;
    g.t = e.timeStamp;
  }

  function onUp(e: PointerEvent): void {
    const g = gestureRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    gestureRef.current = null;
    if (!g || g.id !== e.pointerId || !rect || !client) return;

    const dx = g.x - g.x0;
    const dy = g.y - g.y0;

    // A tap is a catch attempt; only a real drag throws. Trying the catch first
    // matters — during an approach the same finger means "grab that", and a
    // 3-pixel wobble must not launch your water instead.
    if (Math.hypot(dx, dy) < DRAG_SLOP_PX) {
      const hit = game.catchAt(g.x0, g.y0, rect.width, rect.height);
      if (hit) client.send({ t: 'catch', d: { dropId: hit.dropId, roundId } });
      return;
    }

    const { angle, speed } = game.fling(dx, dy, e.timeStamp - g.t0, rect.height);
    send(angle, speed);
  }

  const state = game.state;
  const seats = state?.seats ?? [];
  const mySeat = game.seat;
  const out = state?.out ?? [];
  // Read straight from the state: every frame that changes a level (`drop`,
  // `land`, `spill`) re-renders this component, so there is nothing to mirror.
  const levels = state?.levels ?? {};

  return (
    // The board follows the *theme's* accent, not the hub card's: the card
    // colour identifies the game in the grid, but on screen the chrome should
    // match what the theme is drawing.
    <div class="spill" style={{ '--game-accent': theme.accent } as JSX.CSSProperties}>
      <canvas
        ref={canvasRef}
        class="spill__canvas"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          gestureRef.current = null;
        }}
      />

      {/*
        Everyone else's count, drawn **where they actually are** (spec §4b).
        Every other seat is across the table from you, and your top edge points at
        the table centre, so every one of these lands in the upper part of the
        screen — never over the throw row at the bottom.
      */}
      <div class="spill__peers" aria-hidden="true">
        {seats.map((id, seat) => {
          if (seat === mySeat || mySeat < 0) return null;
          const p = players.find((q) => q.id === id);
          const bearing = screenAngleTo(mySeat, seat, seats.length);
          const gone = out.includes(id);
          return (
            <span
              key={id}
              class={`spill__peer${gone ? ' spill__peer--out' : ''}`}
              style={{
                left: `${50 + Math.sin(bearing) * PEER_RADIUS_X}%`,
                top: `${50 - Math.cos(bearing) * PEER_RADIUS_Y}%`,
              }}
            >
              <span class="spill__peer-who">{gone ? '·' : (p?.avatar ?? '?')}</span>
              <strong class="spill__peer-count">{levels[id] ?? '–'}</strong>
            </span>
          );
        })}
      </div>

      <div class="spill__hud">
        <p class="spill__count">
          <strong>{count}</strong>
          <span>{theme.words.unitPlural} left</span>
        </p>
        <GameMenu title={title} concept={concept} rules={rules}>
          {state && me && (
            <>
              <h3 class="gamemenu__label">Where to put your phone</h3>
              <p class="howto__aside">
                Flat, screen up, <strong>top edge towards the middle</strong>.
              </p>
              <SeatMap
                seats={state.seats}
                players={players}
                me={me}
                out={state.out}
                size={200}
              />
            </>
          )}
        </GameMenu>
      </div>

      {/*
        The flick is the good input, but a directional drag excludes people
        (spec §11). These buttons are always here, not hidden behind a setting:
        slower to play, fully playable.
      */}
      <div class="spill__aimbar">
        <span class="aimbar__label">Throw at</span>
        {seats.map((id, seat) => {
          if (seat === mySeat) return null;
          const p = players.find((q) => q.id === id);
          const gone = out.includes(id);
          return (
            <button
              key={id}
              class="btn spill__aim"
              type="button"
              disabled={locked || gone}
              onClick={() => send(game.angleToSeat(seat), FALLBACK_SPEED)}
            >
              <span aria-hidden="true">{gone ? '·' : (p?.avatar ?? '?')}</span>
              <span class="spill__aim-name">{gone ? 'out' : (p?.name ?? `seat ${seat + 1}`)}</span>
            </button>
          );
        })}
      </div>

      <p class="spill__hint">
        {me === null
          ? 'Watching.'
          : locked
            ? 'Wait for it to leave your screen…'
            : `Flick towards someone to ${theme.words.verb.toLowerCase()} a ${theme.words.unit}. Tap an incoming one to catch it.`}
      </p>

      {/* Keyed on the round so "Play again" always shows a fresh panel. */}
      {state && (
        <RulesPanel
          key={state.roundId}
          title={title}
          concept={concept}
          rules={rules}
          startsAt={state.startsAt}
          now={() => client?.now() ?? Date.now()}
        />
      )}
    </div>
  );
}
