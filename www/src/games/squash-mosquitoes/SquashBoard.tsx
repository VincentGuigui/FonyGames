import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  SQUASH_FLY_SCALE,
  SQUASH_GRID_COLS,
  SQUASH_GRID_ROWS,
  SQUASH_TOTAL,
  type Player,
  type PlayerId,
} from '../../../../shared/protocol';
import { StatusBar } from '../../core/ui/StatusBar';
import { Scoreboard, type ScoreRow } from '../../core/ui/Scoreboard';
import { RulesPanel } from '../../core/ui/RulesPanel';
import { wander, type SquashGame } from './game';

/**
 * The board: 66 mosquitoes, on an invisible 9×13 grid. Spec: docs/specs/games/squash-mosquitoes.md §4
 *
 * All 66 pattern cells are **real, always-mounted `<button>`s**, keyed on their pattern
 * index for the whole round rather than created and destroyed as they spawn — a mosquito
 * that flies now and one that is still dormant are the same element with a different
 * class, which is what lets a flying one animate by writing to a DOM node directly (see
 * below) instead of round-tripping through Preact sixty times a second.
 *
 * The other 51 cells of the 9×13 grid never spawn anything and have no element at all:
 * once the pattern is known, exactly which 66 of the 117 cells matter is known too, and a
 * cell nothing will ever use needs nothing rendered into it.
 */
export function SquashBoard({
  game,
  players,
  me,
  title,
  concept,
  rules,
  accent,
  clock,
  onTap,
}: {
  game: SquashGame;
  players: Player[];
  me: PlayerId | null;
  title: string;
  concept: string;
  rules: string[];
  accent: string;
  /** The shared clock — the wander is drawn from it, never from `Date.now()` (spec §6). */
  clock: () => number;
  /** One tap. The referee counts it; this only reports the cell (spec §6). */
  onTap: (position: number) => void;
}): JSX.Element {
  const state = game.state;
  const pattern = state?.pattern ?? [];

  const refs = useRef(new Map<number, HTMLButtonElement>());

  /*
   * The flying wander, written straight to each button's `style` from a rAF loop rather
   * than through Preact state — the same reason Tap Duel's drifting target and Spill's
   * canvas both bypass the virtual DOM for a 60fps animation of a handful of numbers.
   *
   * Each button is anchored at its cell's own centre by CSS (`top/left: 50%`); the pixel
   * offset added here is measured against THAT SAME BUTTON's cell, read fresh every frame
   * so a resize is never stale. A CSS `%` on `transform` would resolve against the
   * button's own (tiny) box, not its cell's, which is why this is pixels computed in JS
   * rather than a percentage in the transform itself.
   */
  useEffect(() => {
    let raf = 0;
    const frame = (): void => {
      raf = requestAnimationFrame(frame);
      const now = clock();
      for (const v of game.active()) {
        if (!v.flying) continue;
        const el = refs.current.get(v.index);
        const cell = el?.parentElement;
        if (!el || !cell) continue;
        const { dx, dy } = wander(v.index, now);
        const travelX = cell.clientWidth * (1 - SQUASH_FLY_SCALE);
        const travelY = cell.clientHeight * (1 - SQUASH_FLY_SCALE);
        el.style.transform = `translate(-50%, -50%) translate(${(dx * travelX).toFixed(1)}px, ${(dy * travelY).toFixed(1)}px)`;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // `game` is a stable ref-held instance for the life of the round; `clock` likewise
    // never changes identity mid-round. Re-running this per render would restart the loop.
  }, [game, clock]);

  // A cheap 4Hz tick keeps the status bar's own count honest without redrawing the
  // whole 66-button grid every frame — that grid already redraws itself on every
  // `squash-board` frame via the parent's `redraw()`.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  const activeViews = game.active();
  const activeSet = new Set(activeViews.map((v) => v.index));
  const flyingSet = new Set(activeViews.filter((v) => v.flying).map((v) => v.index));
  const squashedSet = new Set(game.squashed().map((v) => v.index));

  function tap(index: number, position: number): void {
    // Nothing to do for a cell this phone already knows is dormant or squashed — the
    // native `disabled` on the button already stops the pointer event, this is the
    // second, cheaper layer (spec §8 is the real one: the referee decides).
    if (!activeSet.has(index)) return;
    onTap(position);
  }

  return (
    <div
      class="squash"
      style={
        {
          '--game-accent': accent,
          '--squash-cols': SQUASH_GRID_COLS,
          '--squash-rows': SQUASH_GRID_ROWS,
        } as JSX.CSSProperties
      }
    >
      <div class="squash__bar">
        <StatusBar
          score={{ value: game.mySquashed, label: `/ ${SQUASH_TOTAL} squashed` }}
          title={title}
          concept={concept}
          rules={rules}
        />
      </div>

      <div class="squash__grid" role="group" aria-label="The swarm">
        {pattern.map((position, index) => {
          const row = Math.floor(position / SQUASH_GRID_COLS) + 1;
          const col = (position % SQUASH_GRID_COLS) + 1;
          const active = activeSet.has(index);
          const squashed = squashedSet.has(index);
          const flying = flyingSet.has(index);

          return (
            <MosquitoCell
              key={index}
              row={row}
              col={col}
              active={active}
              squashed={squashed}
              flying={flying}
              elRef={(el) => {
                if (el) refs.current.set(index, el);
                else refs.current.delete(index);
              }}
              onTap={() => tap(index, position)}
            />
          );
        })}
      </div>

      <Scoreboard
        rows={rows(players, game.scores())}
        me={me}
        unit={`/ ${SQUASH_TOTAL}`}
        best="high"
        corner="top-left"
      />

      {/*
        Nothing squashes before this clears (worker/squashMosquitoes.ts refuses any tap
        before `startsAt`), so the swarm sits still and unreadable-as-a-race until it does
        — keyed on the round so "Play again" always shows a fresh panel.
      */}
      {state && (
        <RulesPanel
          key={state.roundId}
          title={title}
          concept={concept}
          rules={rules}
          startsAt={state.startsAt}
          now={clock}
        />
      )}
    </div>
  );
}

function MosquitoCell({
  row,
  col,
  active,
  squashed,
  flying,
  elRef,
  onTap,
}: {
  row: number;
  col: number;
  active: boolean;
  squashed: boolean;
  flying: boolean;
  elRef: (el: HTMLButtonElement | null) => void;
  onTap: () => void;
}): JSX.Element {
  const state = squashed ? 'squashed' : active ? (flying ? 'flying' : 'static') : 'dormant';

  return (
    <div class="squash__cell" style={{ gridRow: row, gridColumn: col }}>
      <button
        ref={elRef}
        type="button"
        class={`squash__mosquito squash__mosquito--${state}`}
        disabled={!active}
        aria-label={
          squashed
            ? `Row ${row}, column ${col}: squashed`
            : active
              ? `Row ${row}, column ${col}: mosquito — tap to squash`
              : `Row ${row}, column ${col}: empty`
        }
        onPointerDown={(e) => {
          // Mashing game: `pointerdown`, not `click`, which waits for the release —
          // and `preventDefault` stops a fast run of taps reading as a double-tap
          // zoom, the same reasoning Grid Attack's cells already settled on.
          e.preventDefault();
          onTap();
        }}
      >
        <MosquitoIcon />
      </button>
    </div>
  );
}

/**
 * The mosquito, drawn once and reused for every state.
 *
 * Always black (spec §4) — squashed adds a red trace *behind* it via `::before` in CSS
 * rather than a second element here, since the blood needs no shape of its own beyond a
 * soft blot.
 */
function MosquitoIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" class="squash__bug" aria-hidden="true">
      <ellipse cx="12" cy="13.5" rx="3.2" ry="6.2" />
      <circle cx="12" cy="5.2" r="1.7" />
      <path d="M12 3.5 L12 0.5" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
      <ellipse cx="6.4" cy="10.5" rx="4.6" ry="2" transform="rotate(-24 6.4 10.5)" opacity="0.5" />
      <ellipse cx="17.6" cy="10.5" rx="4.6" ry="2" transform="rotate(24 17.6 10.5)" opacity="0.5" />
    </svg>
  );
}

/**
 * Everyone's squashed count, for the shared panel.
 *
 * `best="high"` — more squashed is better, unlike Spill's water — and the value is a
 * plain number rather than "N / 66": the unit already says what it counts, and a row
 * of "43 / 66" beside "51 / 66" is slower to compare at a glance than "43" beside "51".
 */
function rows(players: Player[], scores: Record<PlayerId, number>): ScoreRow[] {
  return players.map((p) => ({
    id: p.id,
    avatar: p.avatar,
    name: p.name,
    value: scores[p.id] ?? 0,
  }));
}
