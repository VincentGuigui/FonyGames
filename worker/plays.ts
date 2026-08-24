import type { ServerMessage } from '../shared/protocol';

/**
 * Counting a finished game, for the hub's HOT badge.
 * Spec: docs/specs/backoffice.md §7 · docs/specs/hub.md §2
 *
 * The Durable Object is the only thing in the system that knows a round ended, and MySQL
 * is the only thing that can remember it across rooms. They cannot speak to each other
 * directly — shared hosting binds MySQL to localhost (docs/database.md §3) — so the
 * Object posts to `api/played.php` over HTTPS and PHP does the write. This file is the
 * decision half of that: **what counts as a game played**, and nothing about sockets.
 *
 * ## One frame per round says "somebody won"
 *
 * Every game ends by broadcasting its own end frame, and each one already carries the
 * answer — a winner id, a survivor list, a finish order. So the rule is read off the frame
 * rather than tracked separately, which means a game cannot be counted twice and a game
 * whose round fizzled out is not counted at all.
 *
 * **A round with no winner does not count.** Everyone leaving mid-round, a duel where
 * both players false-started, a hunt where nobody found a ghost: those happened, but they
 * are not games played, and counting them would make an abandoned game look popular.
 */

/**
 * Does this frame end a round that somebody won?
 *
 * Pure, and tested against a table of frames — the alternative is discovering months later
 * that one game has been counting every tick.
 */
export function endsRound(msg: ServerMessage): boolean {
  switch (msg.t) {
    /*
     * Tap Duel counts the MATCH, not the duel.
     *
     * A `result` frame goes out for every single duel, and a match is first to ten
     * (`DUEL_MATCH_TARGET`). Counting each duel would make Tap Duel ten times as popular
     * as any other game for the same time at the table — the unit has to be "a game
     * played", and here that is the match.
     */
    case 'result':
      return msg.d.matchWinnerId !== null;

    /*
     * Pass the Bomb, like Tap Duel, is played as a MATCH — three lives at two players, five
     * rounds above that — so the round that ends it is the game played, not each of the five.
     * A match with no champion is a draw or an abandoned room; neither is a win.
     */
    case 'boom':
      return msg.d.match.done && msg.d.match.champion !== null;

    case 'steady-end':
      return msg.d.winner !== null;

    /*
     * Grid Attack ends when somebody runs out of lives, and the frame that says so is the
     * same one that carries every other change — so the test is the phase AND a winner,
     * not the phase alone. A round that hit the safety cap level has no winner and is not
     * a game anybody played to the end.
     */
    case 'grid':
      return msg.d.phase === 'done' && msg.d.winner !== null;

    /*
     * Squash Mosquitoes ends the same way Grid Attack does — a phase and a winner in
     * the same frame — and a round the safety cap ended in a tie has no winner and
     * is not a game anybody finished.
     */
    case 'squash':
      return msg.d.phase === 'done' && msg.d.winner !== null;

    /*
     * Ghost Hunt has no single winner field: the ranking is catches first, then time
     * (`ghost-hunt/game.ts`). A round where nobody caught anything ranks everyone equally
     * on nothing, so the test is that somebody caught something.
     */
    case 'hunt-end':
      return Object.values(msg.d.scores).some((n) => n > 0);

    /*
     * Shake Rush always has an `order` — it falls back to "the furthest of the rest" when
     * the clock runs out — so the leader having travelled at all is what separates a race
     * from a room of phones sitting still.
     */
    case 'rush-end': {
      const leader = msg.d.order[0];
      return leader !== undefined && (msg.d.at[leader] ?? 0) > 0;
    }

    case 'spill-over':
    case 'siege-over':
    case 'sling-over':
      return msg.d.winnerId !== null;

    /*
     * Cat and Mouse is the one game where both sides can win: the cat catches everyone,
     * or the clock runs out with a mouse still going. Only a round that ended with
     * neither — everybody gone — is uncounted.
     */
    case 'cm-over':
      return msg.d.catWins || msg.d.survivors.length > 0;

    /*
     * Neon Fall ends the same way Grid Attack and Squash Mosquitoes do — a phase
     * and a winner in the same frame. The defensive safety cap always names the
     * glider (worker/neonFall.ts), so it still counts; only a round nobody
     * finished (both seats never filled, or a player left before either role
     * was assigned) has no winner at all.
     */
    case 'neon':
      return msg.d.phase === 'done' && msg.d.winner !== null;

    /*
     * Tap Tap Music ends the same way — a phase and a winner in the same
     * frame. The safety cap can still end in a tie (`leader()` in
     * worker/tapTapMusic.ts), and a tie has no winner: that round is not
     * counted.
     */
    case 'taptap':
      return msg.d.phase === 'done' && msg.d.winner !== null;

    case 'fighter':
      return msg.d.phase === 'match-over' && msg.d.matchWinner !== null;

    default:
      return false;
  }
}

/**
 * A key identifying the round this frame ended, so one round is counted once.
 *
 * The end frame is broadcast once, so this is belt and braces — but the belt is cheap and
 * the failure it guards is invisible: a resend during a reconnect would quietly inflate
 * one game's count, and nothing downstream could tell that apart from popularity.
 */
export function roundKey(msg: ServerMessage): string | null {
  if (!endsRound(msg)) return null;
  const round = (msg as { d?: { roundId?: number } }).d?.roundId;
  return `${msg.t}:${round ?? 0}`;
}

/**
 * Where the counter lives, derived from where the flags live.
 *
 * Both are on the same web host — `flags.json` in the root, `api/` beside it — so
 * deriving one from the other means there is no second URL to configure and no way for a
 * dev Worker to end up counting into production's database because one var was updated
 * and the other was not.
 */
export function playsUrl(flagsUrl: string | undefined): string | null {
  if (!flagsUrl) return null;
  try {
    return new URL('/api/played.php', flagsUrl).toString();
  } catch {
    // A malformed FLAGS_URL already means the Worker is failing open on flags; it must
    // not additionally throw out of a round-end broadcast.
    return null;
  }
}

/**
 * Tell the host a game was played. Fire and forget, and never throws.
 *
 * **Nothing about a round waits for this.** The result is already on every screen by the
 * time it runs, and a host that is slow, down, or has no schema yet must not delay or
 * break the end of a game — the counter is a merchandising signal, and the room is the
 * product.
 */
export async function reportPlay(
  slug: string,
  opts: {
    url: string;
    token?: string | undefined;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<boolean> {
  const fetcher = opts.fetcher ?? fetch;
  const timeout = opts.timeoutMs ?? 4_000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetcher(opts.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Only when there is one. An empty header would be a claim to have a token.
          ...(opts.token ? { 'X-Plays-Token': opts.token } : {}),
        },
        body: JSON.stringify({ slug }),
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}
