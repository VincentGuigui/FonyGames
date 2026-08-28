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
import { cowGridSlot, ufoDriftAt, ufoHoverAt, type AbductView } from './game';
import cowArt from './art/cow.png?url&no-inline';
import barnArt from './art/barn.png?url&no-inline';
import barnDestroyedArt from './art/barn_destroyed.png?url&no-inline';
import ufoArt from './art/ufo.svg?url&no-inline';

/**
 * The round screen: five barns, everyone's cow, one drifting UFO.
 * Spec: docs/specs/games/abduct-moo.md §4
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
 */
const ABDUCT_HOVER_MS = 2_000;
const ABDUCT_TRANSIT_MS = 700;
const ABDUCT_LOCK_AT_MS = ABDUCT_HOVER_MS + ABDUCT_TRANSIT_MS;

/** How far apart, in stage-height percent, each abducted cow's rise starts. */
const ABDUCT_STAGGER_MS = 350;

/** Sky altitude while drifting/hovering, versus parked low over the target. */
const UFO_TOP_HOVER = 8;
const UFO_TOP_LOCKED = 34;

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
  const ufoRef = useRef<HTMLDivElement>(null);

  const waiting = state.phase === 'waiting';
  const countdown = state.phase === 'countdown';
  const revealing = state.phase === 'revealing';
  const canPick = waiting || countdown;
  const driftStartedAt = state.deadlineAt - (waiting ? ABDUCT_WAIT_MS : countdown ? ABDUCT_COUNTDOWN_MS : 0);
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

    const frame = (): void => {
      raf = requestAnimationFrame(frame);

      if (waiting || countdown) {
        place(barnX(ufoDriftAt(now() - driftStartedAt) * (ABDUCT_BARN_COUNT - 1)), UFO_TOP_HOVER);
        return;
      }

      const target = state.target ?? 0;
      const elapsed = now() - revealStartedAt;
      if (elapsed < ABDUCT_HOVER_MS) {
        place(barnX(ufoHoverAt(elapsed) * (ABDUCT_BARN_COUNT - 1)), UFO_TOP_HOVER);
        return;
      }
      if (elapsed < ABDUCT_LOCK_AT_MS) {
        const t = easeOutCubic((elapsed - ABDUCT_HOVER_MS) / ABDUCT_TRANSIT_MS);
        const from = ufoHoverAt(ABDUCT_HOVER_MS) * (ABDUCT_BARN_COUNT - 1);
        place(barnX(from + (target - from) * t), UFO_TOP_HOVER + (UFO_TOP_LOCKED - UFO_TOP_HOVER) * t);
        return;
      }
      place(barnX(target), UFO_TOP_LOCKED);
      if (!wasLocked) {
        wasLocked = true;
        setLocked(true);
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

      <div class="abduct__stage" role="group" aria-label={text({ en: 'The barns', fr: 'Les granges' })}>
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

        {revealing && locked && (
          <div
            class="abduct__cone"
            style={{ left: `${barnX(state.target ?? 0)}%`, top: `${UFO_TOP_LOCKED}%` }}
            aria-hidden="true"
          />
        )}

        <div ref={ufoRef} class="abduct__ufo" style={{ left: '50%', top: `${UFO_TOP_HOVER}%` }} aria-hidden="true">
          <img src={ufoArt} alt="" />
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
              x = barnX(barn) + slot.col * COW_COL_GAP_PCT;
              y = COW_GRID_TOP_PCT + slot.row * COW_ROW_GAP_PCT;
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

/** Barn `i`'s own x, as a percentage across the stage — evenly spaced (spec §4).
 *  Accepts a fractional `i` too: the UFO's own path is continuous, not discrete. */
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
