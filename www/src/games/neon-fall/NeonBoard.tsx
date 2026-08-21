import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { NEON_LANES, NEON_TICK_MS, type Player, type PlayerId } from '../../../../shared/protocol';
import type { RoomClient } from '../../core/room/client';
import { StatusBar } from '../../core/ui/StatusBar';
import { trackSteer, type SteerTracker } from '../../core/sensors/steer';
import type { NeonGame } from './game';
import { startRenderer, type Renderer } from './render';

/**
 * The fall. Spec: docs/specs/games/neon-fall.md §4
 *
 * As in Goat Siege and Spill, the canvas animates on its own rAF loop and Preact
 * only re-renders the chrome around it.
 *
 * One steer source drives the wire either way (spec §5): tilt when it is on, or
 * a held tap zone when it is not. Both produce the same −1..1 number, sent the
 * same way, at the same rate — the referee cannot tell, and does not need to.
 */
export function NeonBoard({
  game,
  myId,
  title,
  concept,
  rules,
  accent,
  client,
  players,
  orientationOn,
}: {
  game: NeonGame;
  myId: PlayerId | undefined;
  title: string;
  concept: string;
  rules: string[];
  accent: string;
  client: RoomClient | null;
  players: Player[];
  /** Whether tilt is available for the glider. False falls back to held tap zones. */
  orientationOn: boolean;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const state = game.state;
  const roundId = state?.roundId ?? 0;

  const iAmGlider = !!myId && game.isGlider(myId);
  const iAmProtector = !!myId && game.isProtector(myId);

  // Held while a tap zone is down; read only when tilt is unavailable.
  const heldRef = useRef(0);
  const tiltRef = useRef<SteerTracker | null>(null);

  useEffect(() => {
    if (!orientationOn) return;
    const tracker = trackSteer();
    tiltRef.current = tracker;
    // The round's own mount is the "hold your phone how you like" moment —
    // the same pre-round window the rules panel occupies (spec §5).
    tracker.calibrate();
    return () => {
      tracker.stop();
      tiltRef.current = null;
    };
  }, [orientationOn, roundId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !client) return;
    const r = startRenderer(canvas, () => game.state, () => client.now(), () => game.explodedAt);
    rendererRef.current = r;
    return () => {
      r.stop();
      rendererRef.current = null;
    };
  }, [game, client]);

  /*
   * The glider's whole input, sent every tick regardless of whether it changed —
   * a held tilt (or a held tap zone) keeps moving the lane, so silence would
   * read as "centre the stick", not "nothing new to say" (spec §6).
   */
  useEffect(() => {
    if (!iAmGlider || !client) return;
    const timer = setInterval(() => {
      const value = orientationOn ? (tiltRef.current?.read() ?? 0) : heldRef.current;
      client.send({ t: 'neon-steer', d: { roundId, steer: value } });
    }, NEON_TICK_MS);
    return () => clearInterval(timer);
  }, [iAmGlider, client, roundId, orientationOn]);

  function shoot(lane: number): void {
    client?.send({ t: 'neon-shoot', d: { roundId, lane } });
  }

  const name = (id: PlayerId): string => players.find((p) => p.id === id)?.name ?? 'Someone';
  const myLives = state?.lives ?? 0;
  const otherRole = iAmGlider ? 'protector' : 'glider';
  const otherId = state ? (iAmGlider ? state.protectorId : state.gliderId) : undefined;
  // The round is over the instant the fatal hit lands; this board keeps rendering
  // only to hold the death explosion on screen (spec §4) — nothing is tappable
  // any more, so the controls that would suggest otherwise are hidden.
  const running = state?.phase === 'running';

  return (
    <div class="neon" style={{ '--game-accent': accent } as JSX.CSSProperties}>
      <canvas ref={canvasRef} class="neon__canvas" />

      <div class="neon__hud">
        <StatusBar
          score={
            iAmGlider
              ? { value: myLives, label: 'lives' }
              : { value: state?.ammo ?? 0, label: 'shots' }
          }
          status={otherId ? `${name(otherId)}: ${otherRole}` : undefined}
          title={title}
          concept={concept}
          rules={rules}
        />
      </div>

      {iAmProtector && running && state && (
        <Triggers ammo={state.ammo} cooling={state.cooldownUntil > 0} onShoot={shoot} />
      )}
      {iAmGlider && running && !orientationOn && <TapZones heldRef={heldRef} />}
    </div>
  );
}

/** The protector's five lane-aligned triggers. Real buttons, same reasoning as
 *  Squash Mosquitoes' always-mounted cells: native tap targets, no hand-rolled
 *  hit-testing. */
function Triggers({
  ammo,
  cooling,
  onShoot,
}: {
  ammo: number;
  cooling: boolean;
  onShoot: (lane: number) => void;
}): JSX.Element {
  return (
    <div class="neon__triggers" role="group" aria-label="Fire">
      {Array.from({ length: NEON_LANES }, (_, lane) => (
        <button
          key={lane}
          type="button"
          class="neon__trigger"
          disabled={ammo <= 0}
          aria-label={`Lane ${lane + 1}${ammo <= 0 ? ': reloading' : ''}`}
          onPointerDown={(e) => {
            e.preventDefault();
            onShoot(lane);
          }}
        >
          <span class="neon__trigger-dot" aria-hidden="true" />
        </button>
      ))}
      <div class="neon__ammo" aria-hidden="true">
        {Array.from({ length: ammo }, (_, i) => (
          <span key={i} class="neon__ammo-pip" />
        ))}
        {cooling && <span class="neon__ammo-cooling">reloading…</span>}
      </div>
    </div>
  );
}

/**
 * The glider's fallback: two held zones instead of a tilt.
 *
 * Held, not tapped — the tilt this replaces is a continuous velocity, and a
 * discrete "step one lane" would be a different, lesser feel than the thing it
 * is standing in for (spec §5).
 */
function TapZones({ heldRef }: { heldRef: { current: number } }): JSX.Element {
  const hold = (dir: -1 | 0 | 1) => (): void => {
    heldRef.current = dir;
  };
  return (
    <div class="neon__tapzones" aria-hidden="true">
      <button
        type="button"
        class="neon__tapzone neon__tapzone--left"
        onPointerDown={hold(-1)}
        onPointerUp={hold(0)}
        onPointerLeave={hold(0)}
        onPointerCancel={hold(0)}
      />
      <button
        type="button"
        class="neon__tapzone neon__tapzone--right"
        onPointerDown={hold(1)}
        onPointerUp={hold(0)}
        onPointerLeave={hold(0)}
        onPointerCancel={hold(0)}
      />
    </div>
  );
}
