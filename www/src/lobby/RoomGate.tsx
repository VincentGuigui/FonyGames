import { useEffect, useState } from 'preact/hooks';
import type { JSX, VNode } from 'preact';
import type { GameCard } from '../core/types';
import { readRoomHash } from '../core/room/useRoom';
import { useHeldPhone } from '../core/screen';
import { NoSuchRoom } from './NoSuchRoom';
import { ArrivedByLink } from './arrival';
import { RoomChoice } from './RoomChoice';
import { useLocale } from '../core/i18n/LocaleContext';
import { useT } from '../core/i18n/strings';
import { localizeCard } from '../core/i18n/localizeCard';
import { track } from '../core/analytics';

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
  /** Receives the game's card already localized — see the note above `localized` below. */
  children: (code: string, card: GameCard) => VNode;
}): JSX.Element {
  const { locale } = useLocale();
  /*
   * Localized once, here, rather than in every room screen: this is the one component all
   * of them pass through (`RoomChoice`/`NoSuchRoom` below, and every `<XxxRoom>`'s own inner
   * component via `children`), so it is the single place that needs to know `localizeCard`
   * exists at all.
   */
  const localized = localizeCard(game, locale);
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

  /*
   * Once per page load: this game's own page was opened, and — if it opened straight into
   * a room — that room was joined rather than created. `[]` deps means this reads `entered`
   * exactly as `useState` first computed it, which is the initial URL rather than whatever
   * the hash becomes after (`RoomChoice`'s own Create/Join taps track their own actions).
   *
   * `byLink` covers both a shared link followed from outside AND a code typed for a
   * DIFFERENT game in `JoinByCode`, which navigates here the same way — from this
   * component's position, the two are indistinguishable and equally a join.
   */
  useEffect(() => {
    track('game_select', game.slug);
    if (entered !== null && entered.byLink) {
      track('room_join', game.slug);
    }
  }, []);

  /**
   * Follow the hash when the *player* changes it.
   *
   * Reading it once was not enough, and the gap was a dead primary button: `NoSuchRoom`'s
   * "Start a new room" links from `/<slug>/#AB2` to `/<slug>/#`, which differs only in the
   * hash, so the browser does not reload and this component kept its first answer — the player
   * tapped the button and the screen sat there. The same applies to the back button between two
   * rooms, and to anyone editing the URL by hand.
   *
   * Safe to listen for, because neither `pushState` nor `replaceState` fires `hashchange` — so
   * this hears real navigations and never our own writes. It is what turns the back button out
   * of a room into a return to the game page: the hash empties, and this puts the chooser back
   * up. `LobbyInner` unmounts with it, which is what closes the socket and frees the seat.
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
   * **`pushState`, so back leaves the room and lands on the game's own page.** This was
   * `replaceState` on the reasoning that the chooser and the room it minted are one step. In
   * use they are not: the lobby is somewhere you sit and wait, and it is the screen people
   * press back from — and back took them clean off the game, past the page they had just come
   * through, because that step had been folded away.
   *
   * Only this transition pushes. Someone who arrived on a link has no game page behind them,
   * and synthesising one would mean back no longer returns to wherever they were — the
   * messages app they tapped the link in, which is genuinely where they came from.
   */
  function enter(code: string): void {
    const current = readRoomHash();
    if (!(current.kind === 'code' && current.code === code)) {
      history.pushState(null, '', `${location.pathname}#${code}`);
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
        {children(entered.code, localized)}
        <Upright />
        <Sideways />
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
  if (hash.kind === 'invalid') return <NoSuchRoom card={localized} />;

  return <RoomChoice card={localized} onEnter={enter} />;
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
/**
 * And the same notice the other way up, for a game whose board is sideways.
 *
 * Only one of the two is ever showable: `.upright` is hidden while `data-landscape` is on
 * the root element and `.sideways` is hidden while it is not (`useLandscapeRound` in
 * core/screen.ts). Rendered here beside its twin rather than inside the one game that
 * needs it, because a player who turns their phone in a lobby and a player who turns it
 * mid-round should be told the same thing in the same place.
 */
function Sideways(): JSX.Element {
  const t = useT();
  return (
    <div class="sideways" role="alert">
      <p class="sideways__icon" aria-hidden="true">
        🔄
      </p>
      <p class="upright__say">{t.orientation.turnSideways}</p>
      <p class="upright__note">{t.orientation.turnSidewaysNote}</p>
    </div>
  );
}

function Upright(): JSX.Element {
  const t = useT();
  return (
    <div class="upright" role="alert">
      <p class="upright__icon" aria-hidden="true">
        🔄
      </p>
      <p class="upright__say">{t.orientation.turnUpright}</p>
      <p class="upright__note">{t.orientation.turnUprightNote}</p>
    </div>
  );
}
