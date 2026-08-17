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
        <MosquitoIcon squashed={squashed} />
      </button>
    </div>
  );
}

/** Ink and eye-white, shared by both states so alive and squashed read as the same bug. */
const INK = '#16222e';
const EYE_WHITE = '#f4f6f8';

/**
 * The mosquito: big googly eyes, a thin proboscis, two arched outline wings, three bent
 * legs — one alive, one just squashed. Two separate drawings rather than one path set
 * with a modifier, because the whole point of squashing something is that it stops
 * looking like the thing it was: a live bug is a clean silhouette that reads as
 * "here", and a squashed one is a jagged splat with its eyes crossed out and a wing
 * visibly cracked, which reads as "already dealt with" from across the board.
 *
 * The blood itself is drawn separately, behind this, in CSS (`::before`/`::after`) —
 * this component only ever draws the bug.
 */
function MosquitoIcon({ squashed }: { squashed: boolean }): JSX.Element {
  return squashed ? <SquashedBug /> : <LiveBug />;
}

function LiveBug(): JSX.Element {
  return (
    <svg viewBox="0 0 34 22" class="squash__bug" aria-hidden="true">
      {/* Body, tapering from the head to a fine point — the abdomen a mosquito lands on. */}
      <path
        d="M8 11 C8 7.6 11.8 6 15.8 6.6 C22 7.4 30.5 9.2 30.5 11
           C30.5 12.8 22 14.6 15.8 15.4 C11.8 16 8 14.4 8 11 Z"
        fill={INK}
      />

      {/* Two arched, overlapping wings — outline only, so the body reads through them. */}
      <ellipse cx="19" cy="3.2" rx="7" ry="3" transform="rotate(18 19 3.2)" fill="none" stroke={INK} stroke-width="1" />
      <ellipse cx="21" cy="4.6" rx="6.2" ry="2.6" transform="rotate(6 21 4.6)" fill="none" stroke={INK} stroke-width="1" />

      {/* Three bent legs, trailing under the abdomen. */}
      <path
        d="M13 15.4 L12 18.5 L10 20.5 M17 15.7 L16.5 19 L14.5 21 M21 15.5 L21.5 18.8 L19.5 20.8"
        fill="none"
        stroke={INK}
        stroke-width="0.9"
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      {/* The head, and the proboscis every mosquito is known by. */}
      <circle cx="7" cy="11" r="3.6" fill={INK} />
      <path d="M4 13 L0.8 17.5" stroke={INK} stroke-width="0.9" stroke-linecap="round" />

      {/* Googly eyes: a bigger one behind, a smaller one in front, each with its own pupil. */}
      <circle cx="5.3" cy="9.3" r="2.1" fill={EYE_WHITE} stroke={INK} stroke-width="0.5" />
      <circle cx="4.7" cy="8.7" r="0.8" fill={INK} />
      <circle cx="7.6" cy="10.8" r="1.55" fill={EYE_WHITE} stroke={INK} stroke-width="0.45" />
      <circle cx="7.1" cy="10.3" r="0.58" fill={INK} />
    </svg>
  );
}

function SquashedBug(): JSX.Element {
  return (
    <svg viewBox="0 0 34 22" class="squash__bug" aria-hidden="true">
      {/* The body, flattened into an irregular splat rather than a clean capsule. */}
      <path
        d="M8 10.5 C7.4 7.6 11.5 6.3 15 7 C17 5.8 21 6.6 23 8.4
           C26.5 8 30.8 9.6 30 11.6 C31 13.4 27.5 15.6 24 15
           C21.5 17 16.5 17.4 14.5 15.4 C11 16.4 7.2 13.6 8 10.5 Z"
        fill={INK}
      />

      {/* One wing intact, one visibly cracked across the middle. */}
      <ellipse cx="19" cy="3.2" rx="7" ry="3" transform="rotate(18 19 3.2)" fill="none" stroke={INK} stroke-width="1" />
      <ellipse cx="21" cy="4.6" rx="6.2" ry="2.6" transform="rotate(6 21 4.6)" fill="none" stroke={INK} stroke-width="1" />
      <path d="M18 3.6 L19.4 5.4 L18.3 5.9 L20 7.6" fill="none" stroke={INK} stroke-width="0.7" stroke-linecap="round" />

      {/* Legs splayed at the wrong angles, not tucked neatly under the body. */}
      <path
        d="M13 15.4 L11 17.5 L13.5 19.5 M17 15.7 L19 18.5 L16 20.5 M21 15.5 L23.5 17.3 L20.5 19.8"
        fill="none"
        stroke={INK}
        stroke-width="0.9"
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <circle cx="7" cy="11" r="3.6" fill={INK} />
      <path d="M4 13 L1.6 15.2 L0.8 17.5" fill="none" stroke={INK} stroke-width="0.9" stroke-linecap="round" />

      {/* The same two eyes, gone dark: a white socket with an X where the pupil was. */}
      <circle cx="5.3" cy="9.3" r="2.1" fill={EYE_WHITE} stroke={INK} stroke-width="0.5" />
      <path d="M3.9 8.5 L5.5 10.1 M5.5 8.5 L3.9 10.1" stroke={INK} stroke-width="0.6" stroke-linecap="round" />
      <circle cx="7.6" cy="10.8" r="1.55" fill={EYE_WHITE} stroke={INK} stroke-width="0.45" />
      <path d="M6.9 10.1 L8.3 11.5 M8.3 10.1 L6.9 11.5" stroke={INK} stroke-width="0.5" stroke-linecap="round" />

      {/*
        Two thin cracks in the body, in the skin tone behind it — a hairline of "not
        mosquito any more" rather than another dark line the eye would read as a leg.
      */}
      <path
        d="M13 9 L14.5 11 L13.5 11.6 L15 13.5 M20 9.5 L21.3 11.2 L20 11.8"
        fill="none"
        stroke="#f0beac"
        stroke-width="0.55"
        stroke-linecap="round"
        opacity="0.85"
      />

      {/*
        A few drops beyond the main splat, drawn here rather than as a CSS background —
        a `radial-gradient` sized as a percentage circle is invalid CSS and silently
        does nothing, and even fixed the wire-up needed the same coordinate space as the
        bug itself to sit precisely rather than drift with whatever box the button ends
        up being. `var(--game-accent, …)` so re-theming still recolours them with the rest.
      */}
      <g fill="var(--game-accent, #e11d48)">
        <circle cx="2" cy="2.6" r="0.9" />
        <circle cx="32.4" cy="1.8" r="0.7" />
        <circle cx="33.2" cy="19.5" r="0.9" />
        <circle cx="3" cy="20.5" r="0.6" />
        <circle cx="17.5" cy="21.3" r="0.55" />
      </g>
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
