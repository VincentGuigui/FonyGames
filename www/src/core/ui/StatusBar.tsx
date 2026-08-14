import type { ComponentChildren, JSX } from 'preact';
import type { Player, PlayerId } from '../../../../shared/protocol';
import { GameMenu } from './GameMenu';

/**
 * The one row across the top of every game screen.
 * Spec: docs/design/game-chrome.md §7
 *
 * Every game had grown its own: `.steady__bar`, `.rush__bar`, `.hunt__bar`,
 * `.spill__hud` — the same three things (where I stand, where my opponent stands,
 * the menu) in four arrangements, at four sizes, in four places. Learning your way
 * around one game's chrome taught you nothing about the next, and Spill put the
 * other player's score *nowhere near the top* in a two-player round because its
 * positional display is designed for a table of four.
 *
 * So the arrangement is fixed here and a game chooses only what to put in it:
 *
 *   [ my score / status ]        [ opponent ]   [ ☰ ]
 *
 * ## The opponent slot is for TWO-player rounds only
 *
 * With three or more, a single "them" is a lie — and games that seat players
 * physically (Spill, Goat Siege) already draw everyone where they actually sit,
 * which is better information than a row of numbers. `opponentOf()` below returns
 * a player only when there are exactly two, so a game can hand it the whole roster
 * and let the rule decide rather than counting seats itself.
 */

export type StatusScore = {
  /** The number that matters. A string so a game can pass "0.42" or "12s". */
  value: string | number;
  /** What it counts. Omitted when the number speaks for itself. */
  label?: string;
};

export type StatusOpponent = {
  avatar: string;
  name: string;
  value: string | number;
  /** Dim them: out, away, disconnected. */
  dim?: boolean;
};

/**
 * The other player, but only in a two-player round.
 *
 * Returns null for one player (solo testing) and for three or more, which is what
 * keeps the decision out of every game's screen. `players` is the live roster, so a
 * round that started with two and lost one collapses to null on its own.
 */
export function opponentOf(players: Player[], me: PlayerId | undefined): Player | null {
  if (players.length !== 2) return null;
  return players.find((p) => p.id !== me) ?? null;
}

/**
 * The lone opponent from an `OpponentScores` list, or null.
 *
 * Three games already build that list — Sling Puck, Goat Siege, Cat and Mouse —
 * and it is exactly the right input: it already excludes the player themselves and
 * already carries who is out. This just applies the two-player rule to it, so those
 * games do not each re-derive "is it a duel".
 */
export function fromScores(
  scores: { avatar: string; name: string; score: number; out?: boolean }[],
): StatusOpponent | null {
  if (scores.length !== 1) return null;
  const only = scores[0] as { avatar: string; name: string; score: number; out?: boolean };
  return { avatar: only.avatar, name: only.name, value: only.score, dim: only.out === true };
}

export function StatusBar({
  score,
  status,
  opponent,
  title,
  concept,
  rules,
  children,
}: {
  /*
   * `| undefined` on each, deliberately: `exactOptionalPropertyTypes` is on, and
   * every one of these is COMPUTED by the caller — `opponentOf()` returns null, a
   * status is conditional on the phase. Without it each of the nine call sites
   * would have to spread the prop in conditionally, which is noise around the one
   * thing this component exists to make uniform.
   */
  score?: StatusScore | undefined;
  /** Free text for a game whose state is not a number — "3 still in". */
  status?: string | undefined;
  opponent?: StatusOpponent | null | undefined;
  title: string;
  concept: string;
  rules: string[];
  /** Extra panels inside the menu, e.g. Spill's seat map. */
  children?: ComponentChildren | undefined;
}): JSX.Element {
  return (
    <div class="statusbar">
      <div class="statusbar__mine">
        {score && (
          <p class="statusbar__score">
            <strong class="statusbar__value">{score.value}</strong>
            {score.label && <span class="statusbar__label">{score.label}</span>}
          </p>
        )}
        {status && <p class="statusbar__status">{status}</p>}
      </div>

      {/*
        Announced rather than silent: a score changing is the one thing on this bar
        worth telling a screen reader about, and `polite` means it waits for a gap
        instead of interrupting whatever the game is saying.
      */}
      {opponent && (
        <p
          class={`statusbar__them${opponent.dim ? ' statusbar__them--dim' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true">{opponent.avatar}</span>
          <span class="statusbar__them-name">{opponent.name}</span>
          <strong class="statusbar__them-value">{opponent.value}</strong>
        </p>
      )}

      <GameMenu title={title} concept={concept} rules={rules}>
        {children}
      </GameMenu>
    </div>
  );
}
