import { useEffect, useState } from 'preact/hooks';
import type { JSX, VNode } from 'preact';
import type { GameCard } from '../core/types';
import { readRoomHash } from '../core/room/useRoom';
import { useHeldPhone } from '../core/screen';
import { NoSuchRoom } from './NoSuchRoom';
import { ArrivedByLink } from './arrival';
import { RoomChoice } from './RoomChoice';

/** Which room the player is in, and how they got there. */
type Entered = { code: string; byLink: boolean };

/**
 * Which room, if any — the one entrance every game shares.
 * Spec: docs/specs/join.md §Landing on a game page
 *
 * ## Why this is a component and not five copies of an `if`
 *
 * Each of the five room screens had grown its own identical wrapper: read the hash, bail to
 * "this room doesn't exist", otherwise render the inner. Byte-identical apart from two names,
 * docblock included. Adding the chooser to five copies would have been five chances for them to
 * answer differently, which is the failure the shared `GameLobby` template already exists to
 * prevent one level down.
 *
 * The guard has to sit **outside** the component that calls `useRoom`, because hooks cannot be
 * skipped — which is why this is a wrapper taking children rather than an early return.
 */
export function RoomGate({
  game,
  children,
}: {
  game: GameCard;
  children: (code: string) => VNode;
}): JSX.Element {
  /*
   * Keep the screen awake and upright for as long as a game page is open.
   *
   * Here rather than in each game because this is the one component all nine pass through
   * (lobby and round alike), and rather than in each ROUND screen because a lobby is
   * exactly where a phone sits untouched on a table waiting for friends to join.
   * Best effort on both counts — see core/screen.ts.
   */
  useHeldPhone();

  const [hash, setHash] = useState(readRoomHash);
  const [entered, setEntered] = useState<Entered | null>(() => {
    const initial = readRoomHash();
    return initial.kind === 'code' ? { code: initial.code, byLink: true } : null;
  });

  /**
   * Follow the hash when the *player* changes it.
   *
   * Reading it once was not enough, and the gap was a dead primary button: `NoSuchRoom`'s
   * "Start a new room" links from `/<slug>/#AB2` to `/<slug>/#`, which differs only in the
   * hash, so the browser does not reload and this component kept its first answer — the player
   * tapped the button and the screen sat there. The same applies to the back button between two
   * rooms, and to anyone editing the URL by hand.
   *
   * Safe to listen for, because `replaceState` — how the chooser and `enter` write the hash —
   * does **not** fire `hashchange`. So this hears real navigations and never our own writes.
   */
  useEffect(() => {
    function onHashChange(): void {
      const next = readRoomHash();
      setHash(next);
      // A hash naming a room is a link being followed, even mid-session: the rules have not
      // been read in this room, so the lobby should open them.
      setEntered(next.kind === 'code' ? { code: next.code, byLink: true } : null);
    }

    addEventListener('hashchange', onHashChange);
    return () => removeEventListener('hashchange', onHashChange);
  }, []);

  /**
   * Enter a room, and make sure the URL says so.
   *
   * The hash is what a reload reads, so entering without writing it left the player one refresh
   * away from being dumped back on the chooser — the property the old mint-on-arrival code had
   * for free and the first thing this lost.
   *
   * The comparison is against the code itself, not merely "is there a code there" — a hash left
   * over from a room the player minted but did not enter would otherwise survive while they sat
   * in a different one, and a reload would take them to the wrong room.
   *
   * `replaceState`, so the room does not become a second history entry the back button lands on.
   */
  function enter(code: string): void {
    const current = readRoomHash();
    if (!(current.kind === 'code' && current.code === code)) {
      history.replaceState(null, '', `${location.pathname}#${code}`);
    }
    setHash({ kind: 'code', code });
    setEntered({ code, byLink: false });
  }

  /*
   * Arriving with the code already in the hash means a link was followed, so the rules have not
   * been read — the lobby opens How to play for those players and leaves it collapsed for
   * whoever came through the chooser and read them there (lobby/arrival.ts).
   */
  if (entered !== null) {
    return (
      <ArrivedByLink.Provider value={entered.byLink}>
        {children(entered.code)}
        <Upright />
      </ArrivedByLink.Provider>
    );
  }

  /*
   * A damaged link keeps its own screen rather than being folded into the chooser.
   *
   * The chooser would arguably do — its two choices are exactly NoSuchRoom's two exits — but
   * that screen exists to be unmistakable: a link that led nowhere must not look like a normal
   * landing, or the player never learns that the code they were sent was wrong.
   */
  if (hash.kind === 'invalid') return <NoSuchRoom card={game} />;

  return <RoomChoice card={game} onEnter={enter} />;
}

/**
 * "Turn your phone back", for the phones the orientation API cannot reach.
 *
 * Always rendered on a game page and shown by CSS alone (`.upright` in game-chrome.css),
 * only when the viewport is both landscape and short — a phone on its side, never a desktop
 * window. `screen.orientation.lock()` is asked for first and is the better answer, but iOS
 * Safari does not have it and Android Chrome only honours it in fullscreen, so on most
 * phones this notice IS the feature.
 *
 * It covers rather than pauses: the round is still running underneath, the socket is still
 * open, and nothing is lost by the two seconds it takes to turn the phone back.
 */
function Upright(): JSX.Element {
  return (
    <div class="upright" role="alert">
      <p class="upright__icon" aria-hidden="true">
        🔄
      </p>
      <p class="upright__say">Turn your phone upright</p>
      <p class="upright__note">
        These games are played in portrait — the round is still going, it just does not fit
        sideways.
      </p>
    </div>
  );
}
