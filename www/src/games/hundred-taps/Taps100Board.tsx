import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { TAPS100_GRID_SIZE, TAPS100_TOTAL, type Player, type PlayerId } from '../../../../shared/protocol';
import { StatusBar } from '../../core/ui/StatusBar';
import { Scoreboard, type ScoreRow } from '../../core/ui/Scoreboard';
import { RulesPanel } from '../../core/ui/RulesPanel';
import { formatClock, elapsedMs, cellColor, type Taps100Game } from './game';
import { Timeline } from './Timeline';
import { useGameText } from '../../core/i18n/gameText';
import { SoundToggle as SharedSoundToggle } from '../../core/ui/SoundToggle';

/**
 * The board: a hundred numbered circles on a 10×10 grid. Spec: docs/specs/games/hundred-taps.md §4
 *
 * Unlike Tap Tap Music's board, a cell's own printed number is always shown, gone
 * ones included — nothing here is ever "lit". What IS limited is which cells a
 * tap can land on: only the next `TAPS100_WINDOW_SIZE` due are enabled at once
 * (`game.enabledCells()`), everything else is a real disabled button. Inside that
 * window, the referee is still the only thing that knows which single cell is
 * currently correct (spec §2, §7) — the other nine are tappable and wrong, same
 * checkpoint-rewind cost as before.
 */
export function Taps100Board({
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
  game: Taps100Game;
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
  const text = useGameText();
  const state = game.state;
  const numbers = game.numbers();
  const gone = game.goneCells();
  const enabled = game.enabledCells();

  /*
   * The running clock is written straight to the DOM every frame, the same reason
   * Tap Tap Music's board does: at hundredths of a second, routing it through
   * Preact state would re-render the whole hundred-cell grid sixty times a second
   * for a number nothing else on the board needs.
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
  }, [game, clock]);

  return (
    <div class="taps100" style={{ '--game-accent': accent, '--taps100-grid': TAPS100_GRID_SIZE } as JSX.CSSProperties}>
      <div class="taps100__bar">
        <StatusBar
          score={{ value: game.remaining, label: `/ ${TAPS100_TOTAL} ${text({ en: 'left', fr: 'restantes' })}` }}
          title={title}
          concept={concept}
          rules={rules}
        >
          <SoundToggle on={sound} onChange={onSound} />
        </StatusBar>
        <p class="taps100__clock" aria-hidden="true">
          <strong ref={clockRef}>00.00</strong>
        </p>
      </div>

      <Timeline order={state?.order ?? []} cleared={game.clearedCells()} />

      <div class="taps100__grid-wrap">
        <div class="taps100__grid" role="group" aria-label={text({ en: 'The board', fr: 'Le plateau' })}>
          {Array.from({ length: TAPS100_TOTAL }, (_, cell) => {
            const isGone = gone.has(cell);
            const isEnabled = enabled.has(cell);
            const number = numbers[cell];
            const row = Math.floor(cell / TAPS100_GRID_SIZE);
            const col = cell % TAPS100_GRID_SIZE;
            return (
              <button
                key={cell}
                type="button"
                disabled={!isEnabled}
                class={`taps100__cell${isGone ? ' taps100__cell--gone' : ''}${!isGone && !isEnabled ? ' taps100__cell--locked' : ''}`}
                style={{
                  gridRow: row + 1,
                  gridColumn: col + 1,
                  '--cell-color': cellColor(row, col, TAPS100_GRID_SIZE),
                } as JSX.CSSProperties}
                aria-label={
                  isGone
                    ? text({ en: `${number}: cleared`, fr: `${number} : effacé` })
                    : isEnabled
                      ? text({ en: `${number}`, fr: `${number}` })
                      : text({ en: `${number}: not due yet`, fr: `${number} : pas encore` })
                }
                onPointerDown={(e) => {
                  e.preventDefault();
                  if (!isEnabled) return;
                  onTap(cell);
                }}
              >
                {number}
              </button>
            );
          })}
        </div>
      </div>

      <Scoreboard
        rows={rows(players, game.remainingByPlayer())}
        me={me}
        unit={`/ ${TAPS100_TOTAL} ${text({ en: 'left', fr: 'restantes' })}`}
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
 * left is better, the reversed convention a "no score, just a clock" game needs.
 */
function rows(players: Player[], remaining: Record<PlayerId, number>): ScoreRow[] {
  return players.map((p) => ({
    id: p.id,
    avatar: p.avatar,
    name: p.name,
    value: remaining[p.id] ?? TAPS100_TOTAL,
  }));
}

/** The mute toggle, in the gear menu. Same shape as Tap Tap Music's own. */
export function SoundToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }): JSX.Element {
  const text = useGameText();
  return <SharedSoundToggle on={on} onChange={onChange} heading={text({ en: 'Sound', fr: 'Son' })}
    onLabel={text({ en: 'A note per tap', fr: 'Une note par touche' })} offLabel={text({ en: 'Silent', fr: 'Silencieux' })}
    className="taps100__sound" activeClassName="taps100__sound--on" />;
}
