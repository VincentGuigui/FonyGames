import type { JSX } from 'preact';
import type { GameCard } from '../core/types';

/**
 * What a damaged join link lands on.
 *
 * The hash held something that is not a room code, so there is nothing to join. The
 * old behaviour was to quietly mint a fresh code instead, which put the player in a
 * *different, empty room* with the bad code wiped from the URL — they believed they
 * had joined, they were alone, and the evidence was gone.
 *
 * The copy says **"This room doesn't exist"** rather than naming the real cause. From
 * where the player is standing that is the whole truth: they followed a link and there
 * is no room at the end of it, and whether the code was malformed or merely unused
 * changes nothing they can act on.
 *
 * Two ways out, because a dead end with no exit is the thing this replaces: start a
 * fresh room of this game, or go back and type the code again.
 */
export function NoSuchRoom({ card }: { card: GameCard }): JSX.Element {
  return (
    <div class="nosuchroom" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
      <a class="lobby__back" href="/">
        ← All games
      </a>

      <h1 class="nosuchroom__title">This room doesn't exist</h1>
      <p class="nosuchroom__body">
        The link may have been cut short or changed on its way to you. Ask for it again,
        or type the code by hand.
      </p>

      {/*
        `#` alone, not the bare path: landing with an empty hash is what means "start a
        room", so this mints a code the same way opening the game fresh does.
      */}
      <a class="btn btn--primary btn--big nosuchroom__cta" href={`/${card.slug}/#`}>
        Start a new {card.title} room
      </a>
      <a class="btn nosuchroom__cta" href="/">
        Enter a code
      </a>
    </div>
  );
}
