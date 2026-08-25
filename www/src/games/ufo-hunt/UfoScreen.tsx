import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX, RefObject } from 'preact';
import type { Player, PlayerId } from '../../../../shared/protocol';
import { UFOHUNT_KIND_COUNT } from '../../../../shared/protocol';
import { StatusBar } from '../../core/ui/StatusBar';
import { Scoreboard } from '../../core/ui/Scoreboard';
import { scoreOf, type UfoHuntView } from './game';
import { cornerBeams, LASER_GAP_PX } from './beam';
import { useGameText } from '../../core/i18n/gameText';
import saucerArt from './art/ufo.svg?url&no-inline';

/**
 * The hunt, on one phone. Spec: docs/specs/games/ufo-hunt.md §4
 *
 * The screen is the live camera feed — your own sky, full bleed — with a fixed
 * **crosshair** dead centre: unlike Ghost Hunt's own dial, the reticle never moves,
 * and it is the saucer that is drawn wherever it currently sits relative to your
 * aim. **Tap anywhere to fire** — the whole screen is the trigger, so there is no
 * separate shoot button to find under pressure.
 *
 * The health bar is the shared saucer's, and it moves on anyone's shot — that is
 * the co-op half of the game, seen the instant it happens. The scoreboard beneath
 * it is the competitive half: everyone's own running score.
 *
 * All positioning is computed by the caller (`UfoRoom.tsx`, from `scope.ts`); this
 * component only lays it out.
 */
export function UfoScreen({
  state,
  players,
  myId,
  spot,
  bearing,
  hot,
  secondsLeft,
  accent,
  title,
  concept,
  rules,
  videoRef,
  onShoot,
  shotId,
}: {
  state: UfoHuntView;
  players: Player[];
  myId: PlayerId | undefined;
  /** Where the saucer sits on screen, −1…1 of each axis, or null when off screen. */
  spot: { x: number; y: number } | null;
  /** Which way to turn to bring it into view, degrees clockwise from up. */
  bearing: number | null;
  /** 0…1, how close the crosshair currently is to the saucer — the scope's own glow. */
  hot: number;
  secondsLeft: number;
  /** Set as `--game-accent` on the root — this screen is outside the lobby template. */
  accent: string;
  title: string;
  concept: string;
  rules: string[];
  /** The camera's own `<video>` element, sized by CSS `object-fit: cover`. */
  videoRef: RefObject<HTMLVideoElement>;
  /** One tap, anywhere on the play area. */
  onShoot: () => void;
  /** Bumped by the caller on every shot actually fired. Keying the laser burst on
   *  this replays its animation from scratch each time, with no timer to manage. */
  shotId: number;
}): JSX.Element {
  const text = useGameText();
  const mine = myId ? scoreOf(state, myId) : 0;
  const flash = useHitFlash(mine);
  const wave = state.wave;
  const healthPct = wave.maxHealth > 0 ? Math.max(0, Math.min(1, wave.health / wave.maxHealth)) : 0;
  const kind = ((wave.kind % UFOHUNT_KIND_COUNT) + UFOHUNT_KIND_COUNT) % UFOHUNT_KIND_COUNT;

  return (
    <div
      class={`ufohunt ${flash ? 'ufohunt--hit' : ''}`}
      style={{ '--hot': hot.toFixed(3), '--game-accent': accent } as JSX.CSSProperties}
    >
      <video class="ufohunt__backdrop" ref={videoRef} autoPlay playsInline muted aria-hidden="true" />
      <div class="ufohunt__veil" aria-hidden="true" />

      {/*
        Tap anywhere to fire (spec §2.3): its own full-bleed layer, under the bar and
        scoreboard which sit above it — `position: relative` beats an absolutely
        positioned layer beneath it purely by DOM order, the same reasoning Ghost
        Hunt's own `.hunt__bar` states for its backdrop.
      */}
      <button
        type="button"
        class="ufohunt__tapzone"
        onClick={onShoot}
        aria-label={text({ en: 'Fire', fr: 'Tirer' })}
      />

      <div class="ufohunt__bar">
        <StatusBar
          score={{ value: Math.round(mine), label: text({ en: 'score', fr: 'score' }) }}
          status={`${secondsLeft}s`}
          title={title}
          concept={concept}
          rules={rules}
        />
      </div>

      <div
        class="ufohunt__health"
        role="meter"
        aria-valuenow={Math.round(healthPct * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={text({ en: 'Saucer health', fr: 'Vie de la soucoupe' })}
      >
        <div class="ufohunt__health-fill" style={{ width: `${(healthPct * 100).toFixed(1)}%` }} />
      </div>

      <div class="ufohunt__scope" aria-hidden="true">
        <svg class="ufohunt__reticle" viewBox="-50 -50 100 100">
          <circle class="ufohunt__reticle-ring" cx="0" cy="0" r="28" />
          <path class="ufohunt__reticle-cross" d="M0,-44 L0,-30 M0,30 L0,44 M-44,0 L-30,0 M30,0 L44,0" />
        </svg>

        {/* Which way to turn — only shown while the saucer is not on screen at all,
            the same "off the dial" case Ghost Hunt's own rim arrow answers. */}
        {bearing !== null && !spot && (
          <svg class="ufohunt__bearing" viewBox="-50 -50 100 100">
            <g transform={`rotate(${bearing.toFixed(1)})`}>
              <polygon class="ufohunt__arrow" points="0,-47 -6,-37 6,-37" />
            </g>
          </svg>
        )}

        {spot && (
          <img
            src={saucerArt}
            class={`ufohunt__saucer ufohunt__saucer--kind-${kind}`}
            style={{ left: `${(50 + spot.x * 50).toFixed(2)}%`, top: `${(50 - spot.y * 50).toFixed(2)}%` }}
            alt=""
          />
        )}
      </div>

      {/* One burst per shot fired (spec §2.3): four neon beams, one from each
          screen corner, stopping short of the crosshair rather than covering it. */}
      {shotId > 0 && <LaserBurst key={shotId} />}

      <Scoreboard
        rows={players.map((p) => ({
          id: p.id,
          avatar: p.avatar,
          name: p.name,
          value: Math.round(scoreOf(state, p.id)),
        }))}
        me={myId}
        unit={text({ en: 'score', fr: 'score' })}
        best="high"
      />
    </div>
  );
}

/**
 * The muzzle flash: four neon beams converging on the crosshair from the four
 * corners of the screen, in the game's own accent colour. Purely decorative —
 * the shot itself was already sent by the time this mounts (`UfoRoom.tsx`'s
 * `onShoot`) — so a `window`-less render (SSR, or a test harness) simply skips it.
 */
function LaserBurst(): JSX.Element | null {
  if (typeof window === 'undefined') return null;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const beams = cornerBeams(w, h, LASER_GAP_PX);

  return (
    <svg class="ufohunt__lasers" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {beams.map((b, i) => (
        <line key={i} class="ufohunt__laserbeam" x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} />
      ))}
    </svg>
  );
}

/**
 * The hit beat, fired from the shared health bar dropping — anyone's shot, not
 * just this player's own, the same "co-op, seen live" idea the health bar itself
 * carries. Named for the score going up would be wrong here: a hit that someone
 * ELSE landed should still register on screen.
 */
function useHitFlash(myScore: number): boolean {
  const [on, setOn] = useState(false);
  const previous = useRef(myScore);

  useEffect(() => {
    if (myScore <= previous.current) {
      previous.current = myScore;
      return;
    }
    previous.current = myScore;
    setOn(true);
    const timer = setTimeout(() => setOn(false), 300);
    return () => clearTimeout(timer);
  }, [myScore]);

  return on;
}
