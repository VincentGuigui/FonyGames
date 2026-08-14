import type { JSX } from 'preact';
import type { PlayerId } from '../../../../shared/protocol';

/**
 * Everyone's score, in one panel, in every game.
 * Spec: docs/design/game-chrome.md §6
 *
 * This replaced two things that were trying to be it: a single "them" slot on the
 * status bar, which only worked in a two-player round and had to be recomputed by
 * every screen, and an `OpponentScores` strip that hid itself whenever there was
 * exactly one opponent so the two would not collide. Between them a player got a
 * different answer to "how am I doing" at two, three and four players.
 *
 * One panel, always the same shape, always containing everybody:
 *
 *     [avatar] [name]            score
 *
 * ## The two rules that make it readable at a glance
 *
 * - **You are always the top row.** Not sorted by score — a list that reorders while
 *   you are playing is a list you have to re-read, and the one row you look for most
 *   is your own. Everyone else keeps room order, which is stable.
 * - **The leader is bold**, and only when there is exactly one. At the start of a
 *   round every score is level, and bolding a four-way tie says nothing while making
 *   the panel look like it is shouting.
 *
 * ## It renders nothing for a lone player
 *
 * A panel listing one score, next to a status bar already showing that score, is
 * furniture. Solo testing (docs/specs/backoffice.md §6) hits this constantly.
 */

export type ScoreRow = {
  id: PlayerId;
  /** Emoji. Decorative — the name carries the meaning. */
  avatar: string;
  name: string;
  /**
   * The number — or a word, for a game that has no score.
   *
   * Pass the Bomb has none until somebody is out; what its players want to know is
   * whether the thing is in their hands, so it passes "has it" / "clear". A game like
   * that ranks nobody, which is what `best: 'none'` is for.
   */
  value: string | number;
  /** Out, away, eliminated. Dimmed *and* struck through, never colour alone. */
  out?: boolean;
};

/**
 * Which corner the panel sits in. **A per-game setting**, defaulting to bottom left.
 *
 * It has to be per game because the bottom left is not free everywhere: Goat Siege
 * keeps its lob bar down there, Sling Puck's own half of the board is the bottom of
 * the screen. Every game states its own, and the ones that say nothing get the
 * default, so the answer is uniform until a layout forces it not to be.
 */
export type ScoreCorner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

/** Which way winning is, or `none` for a game with nothing to rank. */
export type BestIs = 'high' | 'low' | 'none';

export type ArrangedRow = ScoreRow & { me: boolean; best: boolean };

/**
 * Who is holding the phone — `null` included, because that is what a room client
 * reports before it has been given a seat. A board that renders during those few
 * frames simply has no "me" row to lift, which is correct.
 */
export type Me = PlayerId | null | undefined;

/**
 * Put the rows in order and mark the leader. Pure, so it is tested without a DOM.
 *
 * The leader is decided on **numbers only**: a game whose value is a word has nothing
 * to compare, and `Number('has it')` is `NaN`, which loses every comparison silently
 * rather than loudly. Players who are out are never the leader — being knocked out
 * with the most cabbages left is not a thing that can happen, but a game where it
 * could should still not call them the best.
 */
export function arrange(
  rows: ScoreRow[],
  me: Me,
  best: BestIs,
  /**
   * The leader, when the game knows better than this file does.
   *
   * `best` ranks one value in one direction, which covers every game but Ghost Hunt:
   * there the score is time spent searching and the lowest wins, **but only among
   * players who have caught the same number of ghosts** — a player who has found
   * nothing has spent no time, so `'low'` would bold whoever had not started. A game
   * whose rule needs two values passes the answer in.
   */
  leader?: PlayerId | null,
): ArrangedRow[] {
  const mine = rows.filter((r) => r.id === me);
  const others = rows.filter((r) => r.id !== me);
  const ordered = [...mine, ...others];

  const ahead = leader === undefined ? leaderOf(rows, best) : leader;
  return ordered.map((r) => ({ ...r, me: r.id === me, best: ahead !== null && r.id === ahead }));
}

/** The single player in front, or null when there is a tie, no ranking, or no scores. */
function leaderOf(rows: ScoreRow[], best: BestIs): PlayerId | null {
  if (best === 'none') return null;

  const ranked = rows
    .filter((r) => r.out !== true)
    .map((r) => ({ id: r.id, n: typeof r.value === 'number' ? r.value : Number(r.value) }))
    .filter((r) => Number.isFinite(r.n));
  if (ranked.length < 2) return null;

  const extreme = ranked.reduce((a, b) => (best === 'high' ? (b.n > a.n ? b : a) : b.n < a.n ? b : a));
  // Exactly one, or nobody. A four-way tie at nil is the state every round starts in.
  const sharing = ranked.filter((r) => r.n === extreme.n);
  return sharing.length === 1 ? extreme.id : null;
}

export function Scoreboard({
  rows,
  me,
  unit,
  best = 'high',
  leader,
  corner = 'bottom-left',
}: {
  rows: ScoreRow[];
  me: Me;
  /**
   * What the number counts — "lives", "cabbages". For screen readers, and said once
   * per row rather than drawn: at this size the words would cost more room than they
   * buy, and the panel's heading cannot carry it because there is no heading.
   */
  unit: string;
  best?: BestIs;
  /** An explicit leader, for a game whose rule is not one value in one direction. */
  leader?: PlayerId | null;
  corner?: ScoreCorner;
}): JSX.Element | null {
  if (rows.length < 2) return null;

  return (
    <ul class={`scores scores--${corner}`} aria-label={`Scores, in ${unit}`}>
      {arrange(rows, me, best, leader).map((r) => (
        <li
          key={r.id}
          class={
            'scores__row' +
            (r.me ? ' scores__row--me' : '') +
            (r.best ? ' scores__row--best' : '') +
            (r.out ? ' scores__row--out' : '')
          }
        >
          <span class="scores__avatar" aria-hidden="true">
            {r.avatar}
          </span>
          <span class="scores__name">{r.name}</span>
          <span class="scores__value">
            {r.value}
            <span class="visually-hidden"> {unit}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
