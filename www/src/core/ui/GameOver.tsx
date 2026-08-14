import type { ComponentChildren, JSX } from 'preact';
import type { PlayerId } from '../../../../shared/protocol';
import { StatusBar } from './StatusBar';
import type { Me } from './Scoreboard';

/**
 * The end of a round, in every game.
 * Spec: docs/design/game-chrome.md §8
 *
 * Nine games had nine endings. Four of them dropped back to the **lobby** with a small
 * "Result" panel wedged between the room code and the avatar picker — so finishing a game
 * looked like leaving it, and the thing you actually wanted (play again) sat under two
 * panels of joining furniture. The other five each grew their own screen, with their own
 * trophy, their own placing list and their own class names: `rush__place`, `hunt__place`,
 * `spill` standings, `scoreline`. Same three facts every time — who won, how everyone did,
 * what happens next — laid out four ways.
 *
 * One shape now, and a game supplies only the facts:
 *
 *     ┌──────────────────────────────┐   border: the game's accent
 *     │             🦊               │   winner, centred
 *     │           You won            │
 *     │  🦊 Ana              12 left │   every player, the winner in bold
 *     │  🐢 Bo                4 left │
 *     │      [ Next round ]          │   or [ Play again ] + [ Leave game ]
 *     └──────────────────────────────┘
 *
 * ## What each game still decides
 *
 * The **order of the rows** — this component never sorts. Ranking is a game's own rule and
 * a fiddly one: fewest cabbages loses in one game and wins in the next, Ghost Hunt ranks by
 * catches and then by time, Cat and Mouse has a side that cannot place at all. A component
 * that guessed would be wrong in three of nine and silently.
 *
 * The **unit**, per row, so a game can mix numbers and words: "12 left" beside "caught".
 * The unit is dropped for a row whose value is a word, because "caught left" is nonsense.
 *
 * ## Multi-round versus one and done
 *
 * A game in the middle of a match gets ONE button, the next round, because that is the only
 * thing anybody wants at that moment — Tap Duel at 6–4 does not want to be asked whether to
 * play again. A finished match gets two: play again, and leave. Leave is a real link rather
 * than a button: dropping the socket is what frees the seat.
 */

export type OverRow = {
  id: PlayerId;
  /** Emoji. Decorative — the name carries it. */
  avatar: string;
  name: string;
  /** The number, or a word for a game whose result is not one ("caught", "home"). */
  value: string | number;
  /** What the number counts. Ignored when the value is a word. */
  unit?: string;
  /** Out, caught, flooded. Dimmed *and* struck through, never colour alone. */
  out?: boolean;
};

/** Is this value a number, and therefore something a unit can follow? */
function numeric(value: string | number): boolean {
  return typeof value === 'number' || (value.trim() !== '' && Number.isFinite(Number(value)));
}

export function GameOver({
  rows,
  me,
  winner,
  headline,
  note,
  onNext,
  nextLabel = 'Next round',
  onAgain,
  againLabel = 'Play again',
  canAct,
  waiting = 'The host starts the next one.',
}: {
  /** Everyone, in the game's own ranking order. Never re-sorted here. */
  rows: OverRow[];
  /** `Me`, shared with the score panel: `null` is what a client reports before a seat. */
  me: Me;
  /** Whose avatar and name go at the top, or null when nobody won. */
  winner: PlayerId | null;
  /**
   * Overrides "X won" for a game whose winner is a side rather than a player.
   *
   * `| undefined` explicitly, like every computed prop under `exactOptionalPropertyTypes`:
   * a caller works this out from its own state and would otherwise have to spread the
   * prop in conditionally.
   */
  headline?: string | undefined;
  /** One extra line under the list — Ghost Hunt's fastest find, who was the cat. */
  note?: ComponentChildren | undefined;
  /** Mid-match: the only button, and it starts the next round. */
  onNext?: (() => void) | undefined;
  nextLabel?: string | undefined;
  /** The match is over: play again, beside a way out. */
  onAgain?: (() => void) | undefined;
  againLabel?: string | undefined;
  /** Host only. Everybody else is told who they are waiting for. */
  canAct: boolean;
  waiting?: string | undefined;
}): JSX.Element {
  const champion = winner === null ? null : (rows.find((r) => r.id === winner) ?? null);
  const said =
    headline ??
    (champion === null
      ? 'Nobody won that one'
      : winner === me
        ? 'You won'
        : `${champion.name} won`);

  return (
    <section class="gameover" aria-label="Result">
      <p class="gameover__crest" aria-hidden="true">
        {champion?.avatar ?? '🏁'}
      </p>
      {/*
        `aria-live` here and nowhere else on this screen: the result is the one thing a
        screen reader has to be told without being asked, and the list below repeats
        everything it would otherwise need to announce.
      */}
      <p class="gameover__headline" aria-live="polite">
        {said}
      </p>

      <ul class="gameover__rows">
        {rows.map((r) => (
          <li
            key={r.id}
            class={
              'gameover__row' +
              (r.id === winner ? ' gameover__row--won' : '') +
              (r.id === me ? ' gameover__row--me' : '') +
              (r.out ? ' gameover__row--out' : '')
            }
          >
            <span class="gameover__avatar" aria-hidden="true">
              {r.avatar}
            </span>
            <span class="gameover__name">{r.name}</span>
            <span class="gameover__score">
              <span class="gameover__value">{r.value}</span>
              {r.unit && numeric(r.value) && <span class="gameover__unit"> {r.unit}</span>}
            </span>
          </li>
        ))}
      </ul>

      {note && <p class="gameover__note">{note}</p>}

      {canAct ? (
        <div class="gameover__actions">
          {onNext ? (
            <button class="btn btn--big gameover__go" type="button" onClick={onNext}>
              {nextLabel}
            </button>
          ) : (
            <>
              <button class="btn btn--big gameover__go" type="button" onClick={onAgain}>
                {againLabel}
              </button>
              {/*
                A link, not a router call: leaving the page is what drops the socket and
                frees the seat. Same reason the gear menu's exit is one.
              */}
              <a class="btn btn--big gameover__leave" href="/">
                Leave game
              </a>
            </>
          )}
        </div>
      ) : (
        <>
          <p class="gameover__waiting">{waiting}</p>
          {/* Not being the host is not a reason to be trapped in the room. */}
          <div class="gameover__actions">
            <a class="btn btn--big gameover__leave" href="/">
              Leave game
            </a>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The whole end screen: the game's chrome, the panel, and anything the game puts above it.
 *
 * Every game was writing the same three lines around its ending — a root that sets
 * `--game-accent`, a `StatusBar` so the menu and the rules stay reachable, and then the
 * result. The accent in particular is the one that keeps being forgotten: the round screen
 * is outside the lobby template, so without it a green game's ending is drawn in the site's
 * orange (that is exactly how Ghost Hunt shipped).
 */
export function GameOverScreen({
  accent,
  title,
  concept,
  rules,
  status = 'Round over',
  menu,
  children,
  ...over
}: Parameters<typeof GameOver>[0] & {
  accent: string;
  title: string;
  concept: string;
  rules: string[];
  /** The word on the status bar. "Finish", "Boom", "Time". */
  status?: string | undefined;
  /** Extra panels inside the gear menu — Shake Rush's sound toggle. */
  menu?: ComponentChildren;
  /** Anything the game shows above the panel — Pass the Bomb's explosion. */
  children?: ComponentChildren;
}): JSX.Element {
  return (
    <div class="over" style={{ '--game-accent': accent } as JSX.CSSProperties}>
      <StatusBar status={status} title={title} concept={concept} rules={rules}>
        {menu}
      </StatusBar>
      {children}
      <GameOver {...over} />
    </div>
  );
}
