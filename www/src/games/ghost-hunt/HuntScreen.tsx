import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Player, PlayerId } from '../../../../shared/protocol';
import { LOCK_CONE_DEG } from '../../../../shared/protocol';
import { GameMenu } from '../../core/ui/GameMenu';
import { heat, ranking, type HuntView, type LockState } from './game';
import { RING_PX } from './vision';

/**
 * The hunt, on one phone. Spec: docs/specs/games/ghost-hunt.md §4
 *
 * The screen is the live camera feed, dimmed, with the **detector ring** in the
 * middle showing the same feed as edges — white outlines on black, the room as a
 * wireframe. Outside the ring, your room. Inside it, the room a ghost lives in.
 *
 * That split does three jobs at once: it gives the hunt somewhere to look, it
 * carries the hot/cold signal in the ring itself so there is no separate meter to
 * glance at, and it keeps your eyes up rather than down on a dial — which is a
 * safety property, not a stylistic one (§9).
 *
 * The canvases are painted by the caller, which owns the camera and the sphere;
 * this component owns only the layout and the state readout.
 */
export function HuntScreen({
  state,
  players,
  myId,
  lock,
  secondsLeft,
  mode,
  title,
  concept,
  rules,
  onReAnchor,
  onSweepInstead,
  backdropRef,
  ringRef,
}: {
  state: HuntView;
  players: Player[];
  myId: PlayerId | undefined;
  lock: LockState;
  secondsLeft: number;
  /** What the backdrop actually is, which changes what the screen may promise. */
  mode: 'camera' | 'sphere' | 'dark';
  title: string;
  concept: string;
  rules: string[];
  onReAnchor: () => void;
  /** Switch to the sensor route mid-round. Null when it is not available. */
  onSweepInstead: (() => void) | null;
  backdropRef: (el: HTMLCanvasElement | null) => void;
  ringRef: (el: HTMLCanvasElement | null) => void;
}): JSX.Element {
  const byId = new Map(players.map((p) => [p.id, p]));
  const hot = heat(lock.error);
  const mine = myId ? (state.scores[myId] ?? 0) : 0;
  const near = lock.error <= LOCK_CONE_DEG;
  const flash = useFoundFlash(mine);

  return (
    <div
      class={`hunt hunt--${mode} ${near ? 'hunt--near' : ''} ${flash ? 'hunt--found' : ''}`}
      style={{ '--hot': hot.toFixed(3) } as JSX.CSSProperties}
    >
      <canvas class="hunt__backdrop" ref={backdropRef} aria-hidden="true" />
      <div class="hunt__veil" aria-hidden="true" />

      <div class="hunt__bar">
        <p class="hunt__label">
          {mine} found · {secondsLeft}s
        </p>
        <GameMenu title={title} concept={concept} rules={rules} />
      </div>

      <div class="hunt__ringwrap">
        <div class="hunt__ring" aria-hidden="true">
          <canvas class="hunt__edges" width={RING_PX} height={RING_PX} ref={ringRef} />
          {/*
            The dwell, drawn on the ring's own rim rather than as a bar somewhere
            else: the thing you are staring at is the thing telling you the answer.
          */}
          <svg class="hunt__rim" viewBox="0 0 100 100">
            <circle class="hunt__rim-track" cx="50" cy="50" r="47" />
            <circle
              class="hunt__rim-fill"
              cx="50"
              cy="50"
              r="47"
              style={{ strokeDasharray: `${(lock.dwell * 295).toFixed(1)} 295` }}
            />
          </svg>
        </div>

        {/*
          The number, and the only channel that works on its own. The ring's size,
          brightness and colour all say the same thing, but a player who cannot use
          any of them can still play from this (spec §11).
        */}
        <p class="hunt__reading" role="status" aria-live="polite">
          {Number.isFinite(lock.error) ? `${Math.round(lock.error)}° off` : 'looking…'}
        </p>
      </div>

      <div class="hunt__foot">
        <ul class="hunt__board">
          {ranking(state, players.map((p) => p.id)).slice(0, 4).map((id) => (
            <li key={id} class={`hunt__score ${id === myId ? 'hunt__score--me' : ''}`}>
              <span aria-hidden="true">{byId.get(id)?.avatar ?? '🙂'}</span>
              <span class="hunt__score-n">{state.scores[id] ?? 0}</span>
            </li>
          ))}
        </ul>

        {/*
          Re-anchoring is free and always available: yaw from a fused orientation
          estimate wanders, and a player who feels the sphere has slipped needs a
          way out that is not "lose the round" (spec §3).
        */}
        {mode !== 'sphere' && (
          <button class="btn hunt__reanchor" type="button" onClick={onReAnchor}>
            Re-centre
          </button>
        )}

        {/*
          And the route can still be changed once the round is under way.
          The picker lives in the lobby, but a player who follows a link into a room
          whose host starts immediately never sees it — they are simply put on the
          route that needs no permission. Making that a one-way door would strand
          exactly the players who did nothing wrong.
        */}
        {mode === 'sphere' && onSweepInstead && (
          <button class="btn hunt__reanchor" type="button" onClick={onSweepInstead}>
            Sweep instead
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The found beat, fired from the score going up rather than from the lock.
 *
 * The lock is a local guess; the score is the server agreeing. Celebrating the
 * first would occasionally celebrate a find the referee then refused.
 */
function useFoundFlash(score: number): boolean {
  const [on, setOn] = useState(false);
  const previous = useRef(score);

  useEffect(() => {
    if (score <= previous.current) {
      previous.current = score;
      return;
    }
    previous.current = score;
    setOn(true);
    const timer = setTimeout(() => setOn(false), 500);
    return () => clearTimeout(timer);
  }, [score]);

  return on;
}

/** The results screen: counts, and the fastest single find called out. */
export function HuntResults({
  state,
  players,
  myId,
  onAgain,
  canAgain,
}: {
  state: HuntView;
  players: Player[];
  myId: PlayerId | undefined;
  onAgain: () => void;
  canAgain: boolean;
}): JSX.Element {
  const byId = new Map(players.map((p) => [p.id, p]));
  const order = ranking(state, players.map((p) => p.id));
  const winner = order[0];

  return (
    <div class="hunt hunt--over">
      <p class="hunt__trophy" aria-hidden="true">
        {winner ? (byId.get(winner)?.avatar ?? '👻') : '👻'}
      </p>
      <p class="hunt__winner">
        {winner === myId ? 'You won' : `${byId.get(winner ?? ('' as PlayerId))?.name ?? 'Someone'} won`}
      </p>

      <ol class="hunt__placing">
        {order.map((id, i) => (
          <li key={id} class={`hunt__place ${id === myId ? 'hunt__place--me' : ''}`}>
            <span class="hunt__place-n">{i + 1}</span>
            <span aria-hidden="true">{byId.get(id)?.avatar ?? '🙂'}</span>
            <span class="hunt__place-who">{byId.get(id)?.name ?? 'Someone'}</span>
            <span class="hunt__place-at">
              {state.scores[id] ?? 0} found
            </span>
          </li>
        ))}
      </ol>

      {state.best && (
        <p class="hunt__best">
          Fastest find: {byId.get(state.best.player)?.name ?? 'Someone'} in{' '}
          {(state.best.ms / 1000).toFixed(1)}s
        </p>
      )}

      {canAgain ? (
        <button class="btn btn--primary btn--big hunt__again" type="button" onClick={onAgain}>
          Hunt again
        </button>
      ) : (
        <p class="hunt__note">The host starts the next one.</p>
      )}
    </div>
  );
}
