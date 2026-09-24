import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  ABDUCT_BARN_COUNT,
  ABDUCT_COUNTDOWN_MS,
  ABDUCT_REVEAL_MS,
  ABDUCT_WAIT_MS,
  type Player,
  type PlayerId,
} from '../../../../shared/protocol';
import { StatusBar } from '../../core/ui/StatusBar';
import { Scoreboard, type ScoreRow } from '../../core/ui/Scoreboard';
import { useGameText } from '../../core/i18n/gameText';
import { barnCenterAt, cowGridSlot, ufoAnimFrame, ufoDriftAt, ufoHoverAt, UFO_ANIM_FRAMES, type AbductView } from './game';
import cowArt from './art/cow.png?url&no-inline';
import barnArt from './art/barn.png?url&no-inline';
import barnDestroyedArt from './art/barn_destroyed.png?url&no-inline';
import ufoAnimArt from './art/ufo_anim.png?url&no-inline';

/**
 * The round screen: five barns, everyone's cow, one drifting UFO.
 * Spec: docs/specs/games/aliens-love-cows.md §4
 *
 * Positions are plain percentages of the stage, written to inline `style` from a
 * `requestAnimationFrame` loop for anything that moves every frame (Squash
 * Mosquitoes' own reasoning: that does not belong in Preact state) and from
 * render for everything driven by the server frame itself, which only ever
 * changes on a broadcast.
 *
 * `waiting` and `countdown` are both "nothing is decided yet, as far as this
 * screen is allowed to say" phases — the UFO just drifts through both. The
 * reveal is its own three-beat choreography, all of it presentational — the
 * referee has already decided everything by the time this plays (spec §8):
 *
 * 1. `ABDUCT_HOVER_MS` — the UFO keeps sweeping the whole row, faster than it
 *    drifted before.
 * 2. `ABDUCT_TRANSIT_MS` — it flies in to the target barn and drops to a low
 *    altitude just above it.
 * 3. Whatever is left of `ABDUCT_REVEAL_MS` — parked there, cone open, pulling
 *    up every cow caught underneath it one at a time.
 *
 * `fleeing` is its own short coda rather than a fourth reveal beat — it
 * only ever follows a `revealing` whose target barn was NOT this match's
 * last one standing, so there is nothing left to choreograph over a barn.
 * The UFO's own last position (wherever the raf loop above left it) is
 * simply where `.abduct__ufo--fleeing`'s CSS transition starts from.
 */
const ABDUCT_HOVER_MS = 2_000;
const ABDUCT_TRANSIT_MS = 700;
const ABDUCT_LOCK_AT_MS = ABDUCT_HOVER_MS + ABDUCT_TRANSIT_MS;

/** How many full out-and-back bounces the hover sweep makes across its own
 *  `ABDUCT_HOVER_MS` — the period fed to `ufoHoverAt` is derived from this,
 *  not hardcoded, so the two numbers can never drift apart (game.test.ts
 *  pins the count down directly). */
const ABDUCT_HOVER_BOUNCES = 3;
const ABDUCT_HOVER_PERIOD_MS = ABDUCT_HOVER_MS / ABDUCT_HOVER_BOUNCES;

/** How far apart, in stage-height percent, each abducted cow's rise starts. */
const ABDUCT_STAGGER_MS = 350;

/** Sky altitude while drifting/hovering, versus parked low over the target. */
const UFO_TOP_HOVER = 8;
const UFO_TOP_LOCKED = 34;

/** How much of the hover→locked descent the hover beat itself covers —
 *  "almost" the abduction altitude, not all the way: the transit beat still
 *  owns the final approach and the exact horizontal lock onto the target. */
const ABDUCT_HOVER_DESCENT = 0.8;
const UFO_TOP_HOVER_END = UFO_TOP_HOVER + (UFO_TOP_LOCKED - UFO_TOP_HOVER) * ABDUCT_HOVER_DESCENT;

/** The sprite sheet's own pace, one tier per beat: a lazy drift while nobody
 *  has committed to anything yet, quicker once the reveal starts building
 *  suspense, and fastest once the beam is actually on. */
const UFO_ANIM_FPS_DRIFT = 2;
const UFO_ANIM_FPS_SUSPENSE = 4;
const UFO_ANIM_FPS_BEAM = 16;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function AbductScreen({
  state,
  players,
  myId,
  title,
  concept,
  rules,
  accent,
  now,
  onPick,
}: {
  state: AbductView;
  players: Player[];
  myId: PlayerId | null | undefined;
  title: string;
  concept: string;
  rules: string[];
  accent: string;
  /** The shared clock — every animation here is drawn from it, never from `Date.now()`. */
  now: () => number;
  onPick: (barn: number) => void;
}): JSX.Element {
  const text = useGameText();
  const [secondsLeft, setSecondsLeft] = useState(0);
  /* Only the locked/not-locked edge is Preact state — it is the one thing that
   * needs a re-render (mounting the cone, swapping the destroyed art in). `x`/
   * `top` change every frame, which is exactly the case Squash Mosquitoes' own
   * wander avoids state for: they are written straight to the element's style
   * from the raf loop instead. */
  const [locked, setLocked] = useState(false);
  /* The cone's own top: `UFO_TOP_LOCKED` plus the UFO's real rendered height,
   * measured once the UFO locks rather than assumed — its width is a percent
   * of the stage's WIDTH but `top` is a percent of the stage's HEIGHT, and
   * nothing here can convert one to the other without asking the DOM (same
   * reasoning UFO Hunt's own reticle measurement uses). Defaults to
   * `UFO_TOP_LOCKED` itself until that first measurement lands. */
  const [coneTop, setConeTop] = useState(UFO_TOP_LOCKED);
  const ufoRef = useRef<HTMLDivElement>(null);
  const ufoSpriteRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const barnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /* Each barn's own screen centre, as a stage-percent — `.abduct__barns` lays
   * barns out with flexbox `space-evenly` plus its own padding, so this can
   * only come from the DOM (see `barnCenterAt` in game.ts). Seeded with the
   * naive even-split formula so there is something to draw before the first
   * measurement lands; `barnCentersRef` is what the raf loop below actually
   * reads, kept in sync with this state so a resize/orientation change
   * doesn't need to restart that loop. */
  const [barnCenters, setBarnCenters] = useState<number[]>(() =>
    Array.from({ length: ABDUCT_BARN_COUNT }, (_, i) => barnX(i)),
  );
  const barnCentersRef = useRef(barnCenters);

  useEffect(() => {
    const stageEl = stageRef.current;
    if (!stageEl) return;

    const measure = (): void => {
      const stageRect = stageEl.getBoundingClientRect();
      if (stageRect.width === 0) return;
      const next: number[] = [];
      for (const el of barnRefs.current) {
        if (!el) return; // not every barn mounted yet — the next observation retries
        const rect = el.getBoundingClientRect();
        next.push(((rect.left + rect.width / 2 - stageRect.left) / stageRect.width) * 100);
      }
      barnCentersRef.current = next;
      setBarnCenters(next);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stageEl);
    return () => observer.disconnect();
  }, []);

  const waiting = state.phase === 'waiting';
  const countdown = state.phase === 'countdown';
  const revealing = state.phase === 'revealing';
  const fleeing = state.phase === 'fleeing';
  const canPick = waiting || countdown;
  /* Anchored to when `waiting` itself began, not to whichever phase is
   * current: `countdown`'s own `deadlineAt` is `waiting`'s end plus
   * `ABDUCT_COUNTDOWN_MS` (worker/aliensLoveCows.ts), so subtracting only
   * `ABDUCT_COUNTDOWN_MS` here recovered a instant `ABDUCT_WAIT_MS` later
   * than `waiting`'s own start — a discontinuity in `now() - driftStartedAt`
   * the moment countdown opened, which read as the UFO's drift jumping back
   * to an earlier point in its cycle. Subtracting both durations recovers
   * the same T0 in either phase, so the drift is one continuous motion
   * across the boundary. */
  const driftStartedAt = state.deadlineAt - (waiting ? ABDUCT_WAIT_MS : countdown ? ABDUCT_COUNTDOWN_MS + ABDUCT_WAIT_MS : 0);
  const revealStartedAt = state.deadlineAt - ABDUCT_REVEAL_MS;
  const amOut = myId != null && state.out.includes(myId);

  /* The countdown redraws on a plain interval — it only needs whole seconds. */
  useEffect(() => {
    const tick = (): void => setSecondsLeft(Math.max(0, Math.ceil((state.deadlineAt - now()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [state.deadlineAt, now]);

  /*
   * The UFO's own path, every phase — a raf loop, not Preact state for every
   * frame, same reason Squash Mosquitoes' own wander is one: hovering/drifting
   * changes every frame, and only the reveal's own three beats above (spec §4)
   * care about anything coarser.
   */
  useEffect(() => {
    if (!waiting && !countdown && !revealing) return;
    let raf = 0;
    let wasLocked = false;

    const place = (x: number, top: number): void => {
      const el = ufoRef.current;
      if (el) {
        el.style.left = `${x}%`;
        el.style.top = `${top}%`;
      }
    };

    /* The sheet's own frame, off the wall clock (`ufoAnimFrame` in game.ts) —
     * only `fps` changes between the three beats below, so the animation
     * keeps running smoothly across a phase change rather than resetting to
     * frame 0 every time the UFO's own pace does. */
    const setAnimFps = (fps: number): void => {
      const el = ufoSpriteRef.current;
      if (el) {
        const spriteFrame = ufoAnimFrame(now(), fps);
        el.style.backgroundPositionX = `${(spriteFrame / (UFO_ANIM_FRAMES - 1)) * 100}%`;
      }
    };

    const frame = (): void => {
      raf = requestAnimationFrame(frame);
      const centers = barnCentersRef.current;

      if (waiting || countdown) {
        place(barnCenterAt(centers, ufoDriftAt(now() - driftStartedAt) * (ABDUCT_BARN_COUNT - 1)), UFO_TOP_HOVER);
        setAnimFps(UFO_ANIM_FPS_DRIFT);
        return;
      }

      const target = state.target ?? 0;
      const elapsed = now() - revealStartedAt;
      if (elapsed < ABDUCT_HOVER_MS) {
        const descend = easeOutCubic(elapsed / ABDUCT_HOVER_MS);
        place(
          barnCenterAt(centers, ufoHoverAt(elapsed, ABDUCT_HOVER_PERIOD_MS) * (ABDUCT_BARN_COUNT - 1)),
          UFO_TOP_HOVER + (UFO_TOP_HOVER_END - UFO_TOP_HOVER) * descend,
        );
        setAnimFps(UFO_ANIM_FPS_SUSPENSE);
        return;
      }
      if (elapsed < ABDUCT_LOCK_AT_MS) {
        const t = easeOutCubic((elapsed - ABDUCT_HOVER_MS) / ABDUCT_TRANSIT_MS);
        const from = ufoHoverAt(ABDUCT_HOVER_MS, ABDUCT_HOVER_PERIOD_MS) * (ABDUCT_BARN_COUNT - 1);
        place(barnCenterAt(centers, from + (target - from) * t), UFO_TOP_HOVER_END + (UFO_TOP_LOCKED - UFO_TOP_HOVER_END) * t);
        setAnimFps(UFO_ANIM_FPS_SUSPENSE);
        return;
      }
      place(barnCenterAt(centers, target), UFO_TOP_LOCKED);
      setAnimFps(UFO_ANIM_FPS_BEAM);
      if (!wasLocked) {
        wasLocked = true;
        setLocked(true);
        const ufoEl = ufoRef.current;
        const stageEl = stageRef.current;
        const stageHeight = stageEl?.getBoundingClientRect().height ?? 0;
        if (ufoEl && stageHeight > 0) {
          const ufoHeightPct = (ufoEl.getBoundingClientRect().height / stageHeight) * 100;
          setConeTop(UFO_TOP_LOCKED + ufoHeightPct);
        }
      }
    };

    setLocked(false);
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [waiting, countdown, revealing, driftStartedAt, revealStartedAt, state.target, now]);

  /* Who is standing where: unplaced cows share a stable waiting slot along the
   * bottom, keyed on room order so a cow never jumps sideways for no reason. */
  const occupants = new Map<number, PlayerId[]>();
  for (const p of players) {
    const barn = state.picks[p.id];
    if (barn === null || barn === undefined) continue;
    const list = occupants.get(barn) ?? [];
    list.push(p.id);
    occupants.set(barn, list);
  }

  return (
    <div class="abduct" style={{ '--game-accent': accent } as JSX.CSSProperties}>
      <div class="abduct__bar">
        <StatusBar
          status={text({ en: `Round ${state.round}`, fr: `Manche ${state.round}` })}
          title={title}
          concept={concept}
          rules={rules}
        />
      </div>

      <div ref={stageRef} class="abduct__stage" role="group" aria-label={text({ en: 'The barns', fr: 'Les granges' })}>
        <div class="abduct__sky" aria-hidden="true">
          {STARS.map(([x, y, r], i) => (
            <span key={i} class="abduct__star" style={{ left: `${x}%`, top: `${y}%`, width: `${r}px`, height: `${r}px` }} />
          ))}
        </div>

        {waiting && !amOut && (
          <p class="abduct__countdown" role="status">
            {text({ en: 'Hide your cow behind a barn!', fr: 'Cachez votre vache derrière une grange !' })}
          </p>
        )}
        {countdown && !amOut && (
          <p class="abduct__countdown abduct__countdown--number" role="status" aria-live="polite">
            {Math.max(1, Math.min(3, secondsLeft))}
          </p>
        )}
        {amOut && (waiting || countdown) && (
          <p class="abduct__countdown" role="status">
            {text({ en: 'You were abducted — watch how the rest plays out.', fr: 'Vous avez été enlevé·e — regardez la suite.' })}
          </p>
        )}
        {/* Only one barn left standing: the UFO gives up rather than force
            everyone onto it (spec §2, §7) — the dolphins' own farewell line,
            quoted from Douglas Adams; the French is that book's own
            published title, not a fresh translation of the English one. */}
        {fleeing && (
          <p class="abduct__countdown" role="status" aria-live="polite">
            {text({ en: 'So Long, and Thanks for All the Cow', fr: 'Salut, et encore merci pour la vache !' })}
          </p>
        )}

        {revealing && locked && (
          <div
            class="abduct__cone"
            style={{ left: `${barnCenterAt(barnCenters, state.target ?? 0)}%`, top: `${coneTop}%` }}
            aria-hidden="true"
          />
        )}

        <div
          ref={ufoRef}
          class={`abduct__ufo${fleeing ? ' abduct__ufo--fleeing' : ''}`}
          style={{ left: '50%', top: `${UFO_TOP_HOVER}%` }}
          aria-hidden="true"
        >
          <div ref={ufoSpriteRef} class="abduct__ufo-sprite" style={{ backgroundImage: `url(${ufoAnimArt})` }} />
        </div>

        <div class="abduct__barns">
          {Array.from({ length: ABDUCT_BARN_COUNT }, (_, i) => i).map((barn) => {
            const destroyed = state.barns[barn]?.destroyed ?? false;
            // This round's own target stays looking intact until the cone
            // actually appears over it — the wire already knows it is gone,
            // but the picture only catches up once the UFO has arrived.
            const revealDelayed = revealing && !locked && barn === state.target;
            const showDestroyed = destroyed && !revealDelayed;
            return (
              <button
                key={barn}
                ref={(el) => {
                  barnRefs.current[barn] = el;
                }}
                type="button"
                class={`abduct__barn${showDestroyed ? ' abduct__barn--destroyed' : ''}`}
                disabled={!canPick || destroyed || amOut}
                onClick={() => onPick(barn)}
                aria-label={
                  destroyed
                    ? text({ en: `Barn ${barn + 1}: wrecked, cannot be used again this match`, fr: `Grange ${barn + 1} : détruite, inutilisable pour le reste de la partie` })
                    : text({ en: `Send your cow to barn ${barn + 1}`, fr: `Envoyer votre vache vers la grange ${barn + 1}` })
                }
              >
                <img src={showDestroyed ? barnDestroyedArt : barnArt} alt="" aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <div class="abduct__cows">
          {players.map((p, i) => {
            // Out from an earlier round: gone for good, nothing left to draw —
            // except for the one round its own abduction is still playing.
            const abducted = revealing && state.abducted.includes(p.id);
            if (state.out.includes(p.id) && !abducted) return null;

            const barn = state.picks[p.id];
            const placed = barn !== null && barn !== undefined;
            const mine = p.id === myId;

            let x: number;
            let y: number;
            let delayMs = 0;
            if (placed) {
              const list = occupants.get(barn) ?? [p.id];
              const slot = cowGridSlot(list.indexOf(p.id), list.length);
              x = barnCenterAt(barnCenters, barn) + slot.col * COW_COL_GAP_PCT;
              // An abducted cow rises to meet the UFO itself, not past it —
              // the barn's own target is already this cow's barn (it could
              // not be caught otherwise), so `x` above already lines up.
              y = abducted ? UFO_TOP_LOCKED : COW_GRID_TOP_PCT + slot.row * COW_ROW_GAP_PCT;
              if (abducted) delayMs = ABDUCT_LOCK_AT_MS + state.abducted.indexOf(p.id) * ABDUCT_STAGGER_MS;
            } else {
              x = startX(i, players.length);
              y = COW_START_TOP_PCT;
            }

            return (
              <img
                key={p.id}
                class={
                  'abduct__cow' +
                  (mine ? ' abduct__cow--mine' : '') +
                  (placed ? ' abduct__cow--placed' : '') +
                  (abducted ? ' abduct__cow--abducted' : '')
                }
                src={cowArt}
                alt=""
                aria-hidden="true"
                style={{ left: `${x}%`, top: `${y}%`, transitionDelay: abducted ? `${delayMs}ms` : undefined }}
              />
            );
          })}
        </div>
      </div>

      <Scoreboard
        rows={rows(players, state.scores, state.out)}
        me={myId}
        unit={text({ en: 'points', fr: 'points' })}
        best="high"
        corner="bottom-right"
      />
    </div>
  );
}

/** A few fixed stars — decoration only, so there is no need for them to move. */
const STARS: Array<[number, number, number]> = [
  [8, 10, 2], [20, 6, 1.5], [34, 14, 2], [52, 5, 1.5], [66, 12, 2],
  [80, 7, 1.5], [92, 15, 2], [14, 22, 1.5], [46, 20, 1.5], [74, 24, 1.5],
];

/** An assumed even split of the stage — only a seed for `barnCenters` before
 *  the real DOM measurement above lands (spec §4 still calls for the barns
 *  evenly spaced; `.abduct__barns`' own flexbox layout is what actually
 *  delivers that, this is not the source of truth for where they end up).
 *  Accepts a fractional `i` too, same as `barnCenterAt`. */
function barnX(i: number): number {
  return ((i + 0.5) / ABDUCT_BARN_COUNT) * 100;
}

/** An unplaced cow's own waiting slot along the start line — stable per room order. */
function startX(i: number, total: number): number {
  return ((i + 0.5) / Math.max(total, 1)) * 100;
}

/** Where an unplaced cow waits, and where a placed one's own grid starts. */
const COW_START_TOP_PCT = 88;
const COW_GRID_TOP_PCT = 79;
const COW_ROW_GAP_PCT = 6;
const COW_COL_GAP_PCT = 7;

function rows(players: Player[], scores: Record<PlayerId, number>, out: PlayerId[]): ScoreRow[] {
  return players.map((p) => ({ id: p.id, avatar: p.avatar, name: p.name, value: scores[p.id] ?? 0, out: out.includes(p.id) }));
}
