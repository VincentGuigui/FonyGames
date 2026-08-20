import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX, RefObject } from 'preact';
import type { Player, PlayerId } from '../../../../shared/protocol';
import { RADAR_FOV_DEG } from '../../../../shared/protocol';
import { StatusBar } from '../../core/ui/StatusBar';
import { GameOverScreen } from '../../core/ui/GameOver';
import { Scoreboard } from '../../core/ui/Scoreboard';
import {
  findTimesLine,
  heat,
  leaderOf,
  pointsOf,
  ranking,
  type HuntView,
  type LockState,
} from './game';
import { DragFingerIcon, TurnPhoneIcon } from './icons';
import { RADAR_PX } from './vision';

/**
 * The hunt, on one phone. Spec: docs/specs/games/ghost-hunt.md §4
 *
 * The screen is the live camera feed — your own room, full bleed — with the
 * **radar** in the middle of it: a dial showing the same feed traced out as
 * outlines. Outside the radar, the room. Inside it, the room a ghost lives in.
 *
 * That split does three jobs at once: it gives the hunt somewhere to look, it
 * carries the hot/cold signal in the radar itself so there is no separate meter to
 * glance at, and it keeps your eyes up rather than down on a dial — which is a
 * safety property, not a stylistic one (§9).
 *
 * Two marks on the dial, and they answer different questions:
 *
 * - The **triangle on the rim** always says *which way to turn*. It slides around
 *   the rim to the ghost's bearing and is the only thing on screen that helps when
 *   the ghost is behind you.
 * - The **ghost itself** appears inside the dial once it is within
 *   `RADAR_FOV_DEG`, at its own place in there, and wanders. Keeping it on the dial
 *   is the game; the rim fills while you do.
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
  accent,
  title,
  concept,
  rules,
  backdropRef,
  radarRef,
  aiming,
  onAiming,
}: {
  state: HuntView;
  players: Player[];
  myId: PlayerId | undefined;
  lock: LockState;
  secondsLeft: number;
  /** What the backdrop actually is, which changes what the screen may promise. */
  mode: 'camera' | 'sphere' | 'dark';
  /**
   * The game's accent, set as `--game-accent` on the root.
   *
   * The lobby template does this for its own screens, and the round screen is not
   * inside it — so without this line every accented thing here fell back to the
   * site accent and the radar came out orange in a green game.
   */
  accent: string;
  title: string;
  concept: string;
  rules: string[];
  /**
   * Ref **objects**, not callbacks.
   *
   * This screen re-renders at sensor rate, and an inline `ref={(el) => …}` is a new
   * function on every one of those renders, so Preact detaches and re-attaches it each
   * time. The caller's callback sized the canvas — and setting `canvas.width` clears
   * it — so the background was wiped roughly 60 times a second, immediately after
   * being painted. The feed was being drawn correctly and had never once been visible.
   *
   * A ref object has a stable identity, so nothing re-runs, and sizing moved to an
   * effect in the caller where it belongs.
   */
  backdropRef: RefObject<HTMLCanvasElement>;
  radarRef: RefObject<HTMLCanvasElement>;
  /**
   * How you are looking around, in the virtual room only — absent on the camera route,
   * where there is no choice to offer: the picture is wherever the phone is pointing.
   */
  aiming?: 'sensor' | 'drag' | undefined;
  onAiming?: ((next: 'sensor' | 'drag') => void) | undefined;
}): JSX.Element {
  const hot = heat(lock.error);
  const mine = myId ? (state.scores[myId] ?? 0) : 0;
  const myPoints = myId ? pointsOf(state, myId) : 0;
  const near = lock.error <= RADAR_FOV_DEG;
  const flash = useFoundFlash(mine);

  return (
    <div
      class={`hunt hunt--${mode} ${near ? 'hunt--near' : ''} ${flash ? 'hunt--found' : ''}`}
      style={{ '--hot': hot.toFixed(3), '--game-accent': accent } as JSX.CSSProperties}
    >
      <canvas class="hunt__backdrop" ref={backdropRef} aria-hidden="true" />
      <div class="hunt__veil" aria-hidden="true" />

      <div class="hunt__bar">
        {/*
          Points, because points are what wins it, and the clock beside them because the
          hunt is a hundred seconds and nothing else ends it (spec §2). The catch count
          is one row down in the panel, where everybody else's is.
        */}
        <StatusBar
          score={{ value: myPoints, label: 'points' }}
          status={`${secondsLeft}s`}
          title={title}
          concept={concept}
          rules={rules}
        />
      </div>

      {aiming && onAiming && (
        /*
         * Turn the phone, or drag it — the virtual room can be looked around either way,
         * and which one suits depends on where the player is sitting rather than on what
         * their phone can do. On the round screen rather than in the lobby because it is
         * the kind of thing you change once you have tried the other one.
         */
        <div class="hunt__aim" role="group" aria-label="How to look around">
          <button
            class={`btn hunt__aim-pick ${aiming === 'sensor' ? 'hunt__aim-pick--on' : ''}`}
            type="button"
            aria-pressed={aiming === 'sensor'}
            onClick={() => onAiming('sensor')}
          >
            <TurnPhoneIcon />
            <span class="hunt__aim-label">Turn</span>
          </button>
          <button
            class={`btn hunt__aim-pick ${aiming === 'drag' ? 'hunt__aim-pick--on' : ''}`}
            type="button"
            aria-pressed={aiming === 'drag'}
            onClick={() => onAiming('drag')}
          >
            <DragFingerIcon />
            <span class="hunt__aim-label">Drag</span>
          </button>
        </div>
      )}

      <div class="hunt__radarwrap">
        <div class="hunt__radar" aria-hidden="true">
          <canvas class="hunt__edges" width={RADAR_PX} height={RADAR_PX} ref={radarRef} />

          <svg class="hunt__dial" viewBox="-50 -50 100 100">
            {/*
              The hold, drawn on the radar's own rim rather than as a bar somewhere
              else: the thing you are staring at is the thing telling you the answer.
              Hidden at zero rather than drawn empty — a round-capped arc of length
              zero still paints a dot, and a dot parked at twelve o'clock reads as an
              indicator pointing north.
            */}
            <circle class="hunt__rim-track" cx="0" cy="0" r="47" />
            {/*
              Rotated on its own `g`, not on the whole svg: a dash pattern starts at
              three o'clock, and the hold should start at twelve — but the arrow below
              is an absolute bearing from up, so rotating everything together would
              have it pointing 90° wide.
            */}
            {lock.dwell > 0 && (
              <g transform="rotate(-90)">
                <circle
                  class="hunt__rim-fill"
                  cx="0"
                  cy="0"
                  r="47"
                  style={{ strokeDasharray: `${(lock.dwell * 295).toFixed(1)} 295` }}
                />
              </g>
            )}

            {/*
              Which way to turn. Rotated about the centre so the triangle travels
              around the rim, and it stays put rather than vanishing when the ghost
              is on the dial: the direction is still true, and a mark that
              disappears at the moment you succeed reads as something breaking.
            */}
            {lock.bearing !== null && (
              <g transform={`rotate(${lock.bearing.toFixed(1)})`}>
                {/* Apex outward, and outside the rim — see the CSS on why. */}
                <polygon class="hunt__arrow" points="0,-64 -6,-54 6,-54" />
              </g>
            )}

            {/* The ghost, where it actually is on the dial. */}
            {lock.spot && <Ghost x={lock.spot.x * 40} y={-lock.spot.y * 40} />}
          </svg>
        </div>

      </div>

      {/*
        Points, highest first — and `best="high"` rather than the explicit leader this
        used to need. The score was the time spent searching with the lowest winning, so
        the panel's own "bold the biggest number" rule would have crowned whoever had
        played least, and the game had to hand it an answer. One number going one way
        needs no such help, and a player who has caught nothing reads 0 rather than a
        dash, which in a column where high is good is simply true.
      */}
      <Scoreboard
        rows={players.map((p) => ({
          id: p.id,
          avatar: p.avatar,
          name: p.name,
          value: pointsOf(state, p.id),
        }))}
        me={myId}
        unit="points"
        best="high"
      />
    </div>
  );
}

/**
 * The ghost on the dial.
 *
 * A dome with three scallops along the bottom — the shape everyone draws when asked
 * to draw a ghost — sized so it fits the dial several times over, because the thing
 * being judged is whether it is *on* the dial and a blob that fills it would make
 * that unreadable. `y` is negated by the caller: the dial's y grows downwards and
 * elevation grows up.
 */
function Ghost({ x, y }: { x: number; y: number }): JSX.Element {
  return (
    <g class="hunt__ghost" transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}>
      <path d="M0,-9 C5,-9 8,-5 8,0 L8,7 L5.3,4.5 L2.7,7 L0,4.5 L-2.7,7 L-5.3,4.5 L-8,7 L-8,0 C-8,-5 -5,-9 0,-9 Z" />
      <circle class="hunt__ghost-eye" cx="-2.8" cy="-2.6" r="1.5" />
      <circle class="hunt__ghost-eye" cx="2.8" cy="-2.6" r="1.5" />
    </g>
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
  slug,
  title,
  concept,
  rules,
  accent,
  onAgain,
  canAgain,
}: {
  state: HuntView;
  players: Player[];
  myId: PlayerId | undefined;
  /** Threaded through to `GameOverScreen` — nowhere else here needs it. */
  slug: string;
  title: string;
  concept: string;
  rules: string[];
  /** Same reason as the round screen: this is outside the lobby template too. */
  accent: string;
  onAgain: () => void;
  canAgain: boolean;
}): JSX.Element {
  const byId = new Map(players.map((p) => [p.id, p]));
  const order = ranking(state, players.map((p) => p.id));

  return (
    <GameOverScreen
      slug={slug}
      accent={accent}
      title={title}
      concept={concept}
      rules={rules}
      status="Hunt over"
      /*
       * Points in the column, the catch count beside them, and the three times underneath.
       *
       * The times are the part of a hunt worth talking about afterwards — one lucky ghost
       * that fell into the radar, one that took half the round — and none of them belongs
       * in the figure, which has to stay the thing that decides the order. `detail` is the
       * small line under the name, which exists for exactly this.
       */
      rows={order.map((id) => {
        const line = findTimesLine(state, id);
        return {
          id,
          avatar: byId.get(id)?.avatar ?? '👻',
          name: byId.get(id)?.name ?? 'Someone',
          value: pointsOf(state, id),
          unit: `pts · ${state.scores[id] ?? 0} found`,
          ...(line === undefined ? {} : { detail: line }),
        };
      })}
      me={myId}
      winner={leaderOf(state, order) ?? null}
      onAgain={onAgain}
      againLabel="Hunt again"
      canAct={canAgain}
    />
  );
}

