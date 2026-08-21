import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { PlayerId } from '../../../../shared/protocol';
import { StatusBar } from './StatusBar';
import type { Me } from './Scoreboard';
import { track } from '../analytics';
import { useT } from '../i18n/strings';
import type { Room } from '../room/useRoom';
import { guestsReady } from '../../../../shared/readiness';
import { ReadyButton } from './ReadyButton';

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
 * a fiddly one: fewest cabbages loses in one game and wins in the next, Pass the Bomb ranks
 * on lives in a duel and on rounds won above that, Cat and Mouse has a side that cannot
 * place at all. A component that guessed would be wrong in three of nine and silently.
 *
 * The **unit**, per row, so a game can mix numbers and words: "12 left" beside "caught".
 * The unit is dropped for a row whose value is a word, because "caught left" is nonsense.
 *
 * The **detail**, per row and optional: a second line under the figure for the story behind
 * it — Ghost Hunt's fastest, slowest and average find.
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
  /**
   * A second line under the name, small and dim — the story behind the figure.
   *
   * For the things worth reading afterwards that must not compete with the number that
   * decides the order: Ghost Hunt's fastest, slowest and average find. Optional, and
   * omitted rather than blank for a row that has nothing to say, so the list keeps its
   * rhythm at one line per player when no game is using it.
   */
  detail?: string;
  /** Out, caught, flooded. Dimmed *and* struck through, never colour alone. */
  out?: boolean;
};

/** Is this value a number, and therefore something a unit can follow? */
function numeric(value: string | number): boolean {
  return typeof value === 'number' || (value.trim() !== '' && Number.isFinite(Number(value)));
}

/**
 * How long the panel refuses to be tapped.
 *
 * Long enough to outlast the tail of a mashing round — fingers do not stop the instant a
 * screen changes — and short enough that a player who *is* reaching for Play again barely
 * notices. Two seconds is also about how long it takes to read a name and a number, which
 * is the thing the panel is there to show.
 */
const SETTLE_MS = 2_000;

/**
 * False for the first `SETTLE_MS` after the panel appears, then true for good.
 *
 * Keyed on nothing: the component is remounted for each round (games key their end screen
 * on the round, or swap it in and out of the tree), so mounting *is* the event.
 */
function useSettled(): boolean {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, []);

  return settled;
}

export function GameOver({
  slug,
  rows,
  me,
  winner,
  headline,
  note,
  onNext,
  nextLabel,
  onAgain,
  againLabel,
  canAct,
  waiting,
  room,
  readyBlocked = false,
  onReadySetup,
}: {
  /**
   * For the two activity events this screen is solely responsible for reporting:
   * `game_played` the moment it mounts, `game_start` if its own button is tapped.
   * Nothing downstream of `GameLobby` needs to know analytics exists at all otherwise.
   */
  slug: string;
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
  /** Host-only start eligibility. Guests get the shared Ready control when `room` is present. */
  canAct: boolean;
  waiting?: string | undefined;
  /** The same ready gate as the lobby, so a replay cannot bypass a fresh signal. */
  room?: Room | undefined;
  /** Sensor setup local to this phone. */
  readyBlocked?: boolean | undefined;
  /** Lets a late spectator answer the sensor primer without leaving the result. */
  onReadySetup?: (() => void) | undefined;
}): JSX.Element {
  const settled = useSettled();
  const t = useT();

  /*
   * Mounting IS the event, same reasoning `useSettled` already relies on: a game keys
   * this component on the round (or swaps it in and out of the tree), so there is no
   * other moment that means "a result just landed on screen".
   */
  useEffect(() => {
    track('game_played', slug);
  }, []);

  const champion = winner === null ? null : (rows.find((r) => r.id === winner) ?? null);
  const said =
    headline ??
    (champion === null ? t.common.nobodyWon : winner === me ? t.common.youWon : t.common.someoneWon(champion.name));
  const everybodyReady = guestsReady(room?.room?.players ?? [], room?.room?.hostId ?? null);
  const hostView = room?.isHost ?? canAct;
  const hostCanAct = canAct && !readyBlocked && everybodyReady;

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
            {/*
              A sibling of the name rather than a child of it, so it can have the whole
              width of the row. Nested inside the name cell it was squeezed into the
              column left over by the score and wrapped mid-number — "fastest 17.5s ·
              slowest" / "17.5s · avg 17.5s", which is worse than no second line at all.
            */}
            {r.detail && <span class="gameover__detail">{r.detail}</span>}
          </li>
        ))}
      </ul>

      {note && <p class="gameover__note">{note}</p>}

      {/*
        Nothing here takes a tap for the first `SETTLE_MS`.

        Half the catalogue ends a round while a thumb is still going: Grid Attack and Pass
        the Bomb are mashing games, Tap Duel is a reaction game whose whole skill is
        tapping the instant something appears, and the panel lands under the finger doing
        it. The first stray tap hit "Play again" and the next round started before anybody
        had read who won — the result of the round they just played, skipped by the round
        they just played.

        `inert` rather than `disabled`, and this is the part worth getting right: `disabled`
        would grey both controls out and read as "not your turn", which is a different and
        wrong message on a panel where the buttons are about to work perfectly well. `inert`
        also takes the anchor with it, which `disabled` cannot do at all — and Leave game
        needs it as much as Play again, since leaving by accident is worse.
      */}
      <div class="gameover__gate" inert={!settled}>
        {hostView ? (
          <div class="gameover__actions">
            {readyBlocked && <p class="gameover__waiting">{t.lobby.finishSetup}</p>}
            {readyBlocked && onReadySetup && (
              <button class="btn btn--big" type="button" onClick={onReadySetup}>
                {t.lobby.setUpControls}
              </button>
            )}
            {!readyBlocked && !everybodyReady && (
              <p class="gameover__waiting" role="status">{t.lobby.waitingReady}</p>
            )}
            {onNext ? (
              <button
                class="btn btn--big gameover__go"
                type="button"
                disabled={!hostCanAct}
                onClick={() => {
                  track('game_start', slug);
                  onNext();
                }}
              >
                {nextLabel ?? t.common.nextRound}
              </button>
            ) : (
              <>
                <button
                  class="btn btn--big gameover__go"
                  type="button"
                  disabled={!hostCanAct}
                  onClick={() => {
                    track('game_start', slug);
                    onAgain?.();
                  }}
                >
                  {againLabel ?? t.common.playAgain}
                </button>
                {/*
                  A link, not a router call: leaving the page is what drops the socket and
                  frees the seat. Same reason the gear menu's exit is one.
                */}
                <a class="btn btn--big gameover__leave" href="/">
                  {t.common.leaveGame}
                </a>
              </>
            )}
          </div>
        ) : room ? (
          <>
            <p class="gameover__waiting">
              {readyBlocked ? t.lobby.finishSetup : (waiting ?? t.common.waitingHost)}
            </p>
            <div class="gameover__actions">
              {readyBlocked && onReadySetup && (
                <button class="btn btn--big" type="button" onClick={onReadySetup}>
                  {t.lobby.setUpControls}
                </button>
              )}
              <ReadyButton room={room} blocked={readyBlocked} />
              <a class="btn btn--big gameover__leave" href="/">
                {t.common.leaveGame}
              </a>
            </div>
          </>
        ) : (
          <>
            <p class="gameover__waiting">{waiting ?? t.common.waitingHost}</p>
            {/* Not being the host is not a reason to be trapped in the room. */}
            <div class="gameover__actions">
              <a class="btn btn--big gameover__leave" href="/">
                {t.common.leaveGame}
              </a>
            </div>
          </>
        )}
      </div>
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
  status,
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
  const t = useT();
  return (
    <div class="over" style={{ '--game-accent': accent } as JSX.CSSProperties}>
      <StatusBar status={status ?? t.common.roundOver} title={title} concept={concept} rules={rules}>
        {menu}
      </StatusBar>
      {children}
      <GameOver {...over} />
    </div>
  );
}
