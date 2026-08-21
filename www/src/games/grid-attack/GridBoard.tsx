import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { GRID_SIZE, GRID_TAPS, type GridCell, type Player, type PlayerId } from '../../../../shared/protocol';
import { StatusBar } from '../../core/ui/StatusBar';
import { useT } from '../../core/i18n/strings';
import { cellsOf, fuseProgress, livesOf, pulseMs, tapCounter, type GridView } from './game';

/**
 * The board: two four-by-four grids side by side, sideways.
 * Spec: docs/specs/games/grid-attack.md §4
 *
 * Left is yours and right is theirs, always, on both phones — the halves are named by
 * *whose they are*, never by which end of the room somebody is sitting at. A board that
 * mirrored itself would make "the top left one" mean two different cells in a game whose
 * whole content is two people shouting about cells.
 *
 * ## Why the fuse is drawn from the clock and not from a timer
 *
 * A cell carries `burstAt`, a server time. Everything about how it looks — how far through
 * it is, how fast it flashes — is computed from that against the shared clock on every
 * frame. So a phone that missed a frame, joined mid-fuse, or was backgrounded for a second
 * shows the same cell at the same moment as the other phone, rather than starting its own
 * two seconds whenever its copy of the news arrived.
 */
export function GridBoard({
  state,
  players,
  myId,
  theirId,
  title,
  concept,
  rules,
  accent,
  clock,
  onTap,
}: {
  state: GridView;
  players: Player[];
  myId: PlayerId;
  theirId: PlayerId;
  title: string;
  concept: string;
  rules: string[];
  accent: string;
  /**
   * The shared clock. `burstAt` is a SERVER time, so drawing a fuse against `Date.now()`
   * would run every phone's animation off by its own offset — and the two phones racing
   * on the same cell are precisely who must not disagree about how much of it is left.
   */
  clock: () => number;
  /** One tap. The referee counts them; this only reports. */
  onTap: (cell: number, side: 'mine' | 'theirs') => void;
}): JSX.Element {
  const now = useAnimationClock(clock);
  const t = useT();
  const name = (id: PlayerId): string => players.find((p) => p.id === id)?.name ?? 'Someone';

  return (
    <div class="grid-attack" style={{ '--game-accent': accent } as JSX.CSSProperties}>
      <div class="grid-attack__bar">
        <StatusBar
          score={{ value: livesOf(state, myId), label: t.common.lives }}
          status={`${name(theirId)}: ${livesOf(state, theirId)}`}
          title={title}
          concept={concept}
          rules={rules}
        />
      </div>

      <div class="grid-attack__halves">
        <Half
          side="mine"
          label="Yours — save it"
          cells={cellsOf(state, myId)}
          now={now}
          onTap={onTap}
        />
        <Half
          side="theirs"
          label={`${name(theirId)}'s — break it`}
          cells={cellsOf(state, theirId)}
          now={now}
          onTap={onTap}
        />
      </div>
    </div>
  );
}

/**
 * One player's grid.
 *
 * The tap counter is per half and lives in a ref, so the two sides count independently and
 * neither is reset by the other's re-render — you can be three taps into one of theirs
 * while two into saving one of yours, which is exactly the position the game wants you in.
 */
function Half({
  side,
  label,
  cells,
  now,
  onTap,
}: {
  side: 'mine' | 'theirs';
  label: string;
  cells: GridCell[];
  now: number;
  onTap: (cell: number, side: 'mine' | 'theirs') => void;
}): JSX.Element {
  const taps = useRef(tapCounter());
  const [, redraw] = useState(0);

  /**
   * Is there anything for a tap on this cell to do?
   *
   * Attacking is always on: any of theirs that is still standing can be lit. **Defending
   * is not** — a cell of yours that is not going off has nothing to be saved from, and the
   * referee ignores the tap (`onGridTap`: "defending an unarmed one does nothing").
   *
   * Without this the fill drew on both halves, so mashing your own quiet grid lit it up
   * cell by cell as though something were happening. On the half you are meant to be
   * *watching*, that is the worst possible lie: it looks exactly like the thing you are
   * watching for.
   */
  const doesSomething = (cell: GridCell): boolean =>
    !cell.gone && (side === 'theirs' ? cell.burstAt === 0 : cell.burstAt > 0);

  return (
    <section class={`grid-attack__half grid-attack__half--${side}`}>
      <p class="grid-attack__label">{label}</p>
      <div class="grid-attack__grid" style={{ '--cols': GRID_SIZE }}>
        {cells.map((cell, i) => (
          <Cell
            key={i}
            cell={cell}
            index={i}
            side={side}
            now={now}
            showing={doesSomething(cell) ? taps.current.showing(i, now) : 0}
            onTap={() => {
              if (doesSomething(cell)) {
                taps.current.tap(i, now);
                redraw((n) => n + 1);
              }
              /*
               * Sent either way. This copy of the rule is a guess made against a frame that
               * may be one round-trip old, and the frame it is most likely to be wrong about
               * is the one where a cell has just lit up — which is exactly the tap a defender
               * cannot afford to have swallowed. The referee decides; this only draws.
               */
              onTap(i, side);
            }}
          />
        ))}
      </div>
    </section>
  );
}

function Cell({
  cell,
  index,
  side,
  now,
  showing,
  onTap,
}: {
  cell: GridCell;
  index: number;
  side: 'mine' | 'theirs';
  now: number;
  showing: number;
  onTap: () => void;
}): JSX.Element {
  const fuse = fuseProgress(cell, now);
  const row = Math.floor(index / GRID_SIZE) + 1;
  const column = (index % GRID_SIZE) + 1;

  if (cell.gone) {
    return (
      <div
        class="grid-attack__cell grid-attack__cell--gone"
        aria-label={`Row ${row}, column ${column}: gone`}
      />
    );
  }

  /*
   * Two inline numbers, both continuous, both per frame.
   *
   * `--fill` is how far a run of taps has got: the cell fills from the middle outwards,
   * bigger and more opaque with each tap, so the finger's own progress is the cell rather
   * than a badge on it. `animation-duration` is the pulse, which has to be continuous for
   * the same reason — a handful of `--fast` / `--faster` steps would read as three
   * different animations rather than one thing running out of time.
   */
  const style = {
    ...(showing > 0 ? { '--fill': showing / GRID_TAPS } : {}),
    ...(fuse === null ? {} : { animationDuration: `${Math.round(pulseMs(fuse))}ms` }),
  } as JSX.CSSProperties;

  return (
    <button
      type="button"
      class={
        'grid-attack__cell' +
        (fuse === null ? '' : ' grid-attack__cell--lit') +
        (showing > 0 ? ` grid-attack__cell--tapped-${showing}` : '')
      }
      style={style}
      aria-label={
        `Row ${row}, column ${column}` +
        (fuse === null
          ? side === 'mine'
            ? ''
            : ': tap three times to attack'
          : side === 'mine'
            ? ': going off, tap three times to save it'
            : ': going off')
      }
      onPointerDown={(e) => {
        // `pointerdown`, not `click`: this is a mashing game, and a click waits for the
        // release. `preventDefault` stops the browser turning a fast run of taps into a
        // double-tap zoom, which on a phone eats every second tap.
        e.preventDefault();
        onTap();
      }}
    >
      {/*
        The fill itself is a layer rather than the cell's own background, so it can grow
        from the middle without disturbing the border — and so the pulse, which animates
        the background underneath, has something to animate.
      */}
      {showing > 0 && <span class="grid-attack__fill" aria-hidden="true" />}
    </button>
  );
}

/**
 * A clock that ticks every animation frame while the tab is visible.
 *
 * The fuses are the only moving thing and they are pure functions of the time, so the
 * board is redrawn from one number. `requestAnimationFrame` rather than an interval
 * because it stops dead when the tab is hidden — a backgrounded phone should not be
 * repainting a board nobody is looking at, and the next frame after it comes back is
 * correct anyway, being computed from the clock rather than accumulated.
 */
function useAnimationClock(clock: () => number): number {
  const [now, setNow] = useState(clock);
  const read = useRef(clock);
  read.current = clock;

  useEffect(() => {
    let raf = 0;
    const frame = (): void => {
      setNow(read.current());
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return now;
}
