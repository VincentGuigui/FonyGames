import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  ABDUCT_BARN_COUNT,
  ABDUCT_CHOOSE_MS,
  type Player,
  type PlayerId,
} from '../../../../shared/protocol';
import { StatusBar } from '../../core/ui/StatusBar';
import { Scoreboard, type ScoreRow } from '../../core/ui/Scoreboard';
import { useGameText } from '../../core/i18n/gameText';
import { ufoDriftAt, type AbductView } from './game';
import cowArt from './art/cow.svg?url&no-inline';
import barnArt from './art/barn.svg?url&no-inline';
import ufoArt from './art/ufo.svg?url&no-inline';

/**
 * The round screen: five barns, everyone's cow, one drifting UFO.
 * Spec: docs/specs/games/abduct-moo.md §4
 *
 * Positions are plain percentages of the stage, written to inline `style` from a
 * `requestAnimationFrame` loop for the UFO's drift (Squash Mosquitoes' own reasoning:
 * a value that changes every frame does not belong in Preact state) and from render
 * for everything driven by the server frame itself, which only ever changes on a
 * broadcast.
 */
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
  /** The shared clock — the UFO's drift is drawn from it, never from `Date.now()`. */
  now: () => number;
  onPick: (barn: number) => void;
}): JSX.Element {
  const text = useGameText();
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [ufoX, setUfoX] = useState(50);
  const ufoRef = useRef<HTMLImageElement>(null);

  const choosing = state.phase === 'choosing';
  const revealing = state.phase === 'revealing';
  const choosingStartedAt = state.deadlineAt - ABDUCT_CHOOSE_MS;

  /* The countdown redraws on a plain interval — it only needs whole seconds. */
  useEffect(() => {
    const tick = (): void => setSecondsLeft(Math.max(0, Math.ceil((state.deadlineAt - now()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [state.deadlineAt, now]);

  /*
   * The UFO's own decorative drift, choosing only — during revealing it is locked over
   * the target barn instead (spec §4). A raf loop, not Preact state, for the same
   * reason Squash Mosquitoes' own wander is: it changes every frame.
   */
  useEffect(() => {
    if (!choosing) return;
    let raf = 0;
    const frame = (): void => {
      raf = requestAnimationFrame(frame);
      const x = barnX(ufoDriftAt(now() - choosingStartedAt) * (ABDUCT_BARN_COUNT - 1));
      setUfoX(x);
      if (ufoRef.current) ufoRef.current.style.left = `${x}%`;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [choosing, choosingStartedAt, now]);

  const targetX = state.target !== null ? barnX(state.target) : ufoX;

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
          status={text({ en: `Round ${state.round} / 3`, fr: `Manche ${state.round} / 3` })}
          score={{ value: secondsLeft, label: text({ en: 's left', fr: 's' }) }}
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

        {revealing && (
          <div
            class="abduct__cone"
            style={{ left: `${targetX}%` }}
            aria-hidden="true"
          />
        )}

        <img
          ref={ufoRef}
          class="abduct__ufo"
          src={ufoArt}
          alt=""
          aria-hidden="true"
          style={{ left: `${revealing ? targetX : ufoX}%` }}
        />

        <div class="abduct__barns">
          {Array.from({ length: ABDUCT_BARN_COUNT }, (_, i) => i).map((barn) => {
            const destroyed = state.barns[barn]?.destroyed ?? false;
            return (
              <button
                key={barn}
                type="button"
                class={`abduct__barn${destroyed ? ' abduct__barn--destroyed' : ''}`}
                disabled={!choosing}
                onClick={() => onPick(barn)}
                aria-label={
                  destroyed
                    ? text({ en: `Barn ${barn + 1}: wrecked`, fr: `Grange ${barn + 1} : détruite` })
                    : text({ en: `Send your cow to barn ${barn + 1}`, fr: `Envoyer votre vache vers la grange ${barn + 1}` })
                }
              >
                <img src={barnArt} alt="" aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <div class="abduct__cows">
          {players.map((p, i) => {
            const barn = state.picks[p.id];
            const placed = barn !== null && barn !== undefined;
            const abducted = revealing && state.abducted.includes(p.id);
            const mine = p.id === myId;

            const slot = placed ? (occupants.get(barn)?.indexOf(p.id) ?? 0) : i;
            const spread = placed ? (occupants.get(barn)?.length ?? 1) : players.length;
            const x = placed ? barnX(barn) + jitter(slot, spread) : startX(i, players.length);
            const y = abducted ? 8 : placed ? 46 : 88;

            return (
              <img
                key={p.id}
                class={
                  'abduct__cow' +
                  (mine ? ' abduct__cow--mine' : '') +
                  (abducted ? ' abduct__cow--abducted' : '')
                }
                src={cowArt}
                alt=""
                aria-hidden="true"
                style={{ left: `${x}%`, top: `${y}%` }}
              />
            );
          })}
        </div>
      </div>

      <Scoreboard
        rows={rows(players, state.scores)}
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

/** Barn `i`'s own x, as a percentage across the stage — evenly spaced (spec §4). */
function barnX(i: number): number {
  return ((i + 0.5) / ABDUCT_BARN_COUNT) * 100;
}

/** An unplaced cow's own waiting slot along the start line — stable per room order. */
function startX(i: number, total: number): number {
  return ((i + 0.5) / Math.max(total, 1)) * 100;
}

/** Spreads cows sharing one barn a few points apart so they do not fully overlap. */
function jitter(slot: number, of: number): number {
  if (of <= 1) return 0;
  const span = 10;
  return (slot / (of - 1) - 0.5) * span;
}

function rows(players: Player[], scores: Record<PlayerId, number>): ScoreRow[] {
  return players.map((p) => ({ id: p.id, avatar: p.avatar, name: p.name, value: scores[p.id] ?? 0 }));
}
