import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { TAPTAP_GRID_SIZE, TAPTAP_TOTAL, type Player, type PlayerId } from '../../../../shared/protocol';
import { StatusBar } from '../../core/ui/StatusBar';
import { Scoreboard, type ScoreRow } from '../../core/ui/Scoreboard';
import { RulesPanel } from '../../core/ui/RulesPanel';
import { formatClock, elapsedMs, type TapTapGame } from './game';
import { Timeline } from './Timeline';

/**
 * The board: a hundred circles on a 10×10 grid. Spec: docs/specs/games/tap-tap-revolution.md §4
 *
 * Unlike Squash Mosquitoes' board, every cell is always tappable, gone ones
 * included — tapping a gone cell is exactly as wrong as tapping any other cell
 * that is not one of the up to five live ones (spec §2, §7), and the referee
 * is the only thing that tells the difference. There is nothing here for the
 * client to guess at.
 */
export function TapTapBoard({
  game,
  players,
  me,
  title,
  concept,
  rules,
  accent,
  clock,
  onTap,
  sound,
  onSound,
}: {
  game: TapTapGame;
  players: Player[];
  me: PlayerId | null;
  title: string;
  concept: string;
  rules: string[];
  accent: string;
  /** The shared clock — the running time reads from it, never from `Date.now()`. */
  clock: () => number;
  /** One tap on grid position `cell`. The referee decides whether it was right. */
  onTap: (cell: number) => void;
  sound: boolean;
  onSound: (on: boolean) => void;
}): JSX.Element {
  const state = game.state;
  const lit = new Set(game.litCells());
  const gone = game.goneCells();

  /*
   * The running clock is written straight to the DOM every frame, the same reason
   * SquashBoard writes a mosquito's position that way: at hundredths of a second,
   * routing it through Preact state would re-render the whole hundred-cell grid
   * sixty times a second for a number nothing else on the board needs.
   */
  const clockRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let raf = 0;
    const frame = (): void => {
      raf = requestAnimationFrame(frame);
      const s = game.state;
      if (!s || !clockRef.current) return;
      clockRef.current.textContent = formatClock(elapsedMs(s, clock()));
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // `game` and `clock` are both stable for the life of the round; re-running this
    // per render would restart the loop, same reasoning SquashBoard's rAF effect gives.
  }, [game, clock]);

  return (
    <div
      class="taptap"
      style={{ '--game-accent': accent, '--taptap-grid': TAPTAP_GRID_SIZE } as JSX.CSSProperties}
    >
      <div class="taptap__bar">
        <StatusBar
          score={{ value: game.remaining, label: `/ ${TAPTAP_TOTAL} left` }}
          title={title}
          concept={concept}
          rules={rules}
        >
          <SoundToggle on={sound} onChange={onSound} />
        </StatusBar>
        {/* The clock: not a score — no game is ranked on it while it runs — so it sits
            beside the status bar rather than inside its `score` slot (spec §12). */}
        <p class="taptap__clock" aria-hidden="true">
          <strong ref={clockRef}>00.00</strong>
        </p>
      </div>

      <Timeline order={state?.order ?? []} cleared={game.clearedCells()} />

      <div class="taptap__grid-wrap">
        <div class="taptap__grid" role="group" aria-label="The board">
          {Array.from({ length: TAPTAP_TOTAL }, (_, cell) => {
            const isLit = lit.has(cell);
            const isGone = gone.has(cell);
            const s = isGone ? 'gone' : isLit ? 'lit' : 'idle';
            const row = Math.floor(cell / TAPTAP_GRID_SIZE) + 1;
            const col = (cell % TAPTAP_GRID_SIZE) + 1;
            return (
              <button
                key={cell}
                type="button"
                class={`taptap__cell taptap__cell--${s}`}
                style={{ gridRow: row, gridColumn: col }}
                aria-label={
                  isLit
                    ? `Row ${row}, column ${col}: lit — tap it`
                    : isGone
                      ? `Row ${row}, column ${col}: cleared`
                      : `Row ${row}, column ${col}`
                }
                onPointerDown={(e) => {
                  e.preventDefault();
                  onTap(cell);
                }}
              />
            );
          })}
        </div>
      </div>

      <Scoreboard
        rows={rows(players, game.remainingByPlayer())}
        me={me}
        unit={`/ ${TAPTAP_TOTAL} left`}
        best="low"
        corner="bottom-right"
      />

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

/**
 * Everyone's remaining count, for the shared panel. `best="low"` above — fewer
 * left is better, the reversed convention a "no score, just a clock" game needs
 * (spec §12).
 */
function rows(players: Player[], remaining: Record<PlayerId, number>): ScoreRow[] {
  return players.map((p) => ({
    id: p.id,
    avatar: p.avatar,
    name: p.name,
    value: remaining[p.id] ?? TAPTAP_TOTAL,
  }));
}

/**
 * The mute toggle, in the gear menu. Same shape as Shake Rush's own — a button
 * with `aria-pressed`, not a checkbox, since it acts immediately with no form
 * around it.
 */
export function SoundToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }): JSX.Element {
  return (
    <>
      <h3 class="gamemenu__label">Sound</h3>
      <button
        class={`btn taptap__sound ${on ? 'taptap__sound--on' : ''}`}
        type="button"
        aria-pressed={on}
        onClick={() => onChange(!on)}
      >
        <span aria-hidden="true">{on ? '🔊' : '🔇'}</span>
        {on ? 'A note per tap' : 'Silent'}
      </button>
    </>
  );
}
