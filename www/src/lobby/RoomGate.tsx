import { useState } from 'preact/hooks';
import type { JSX, VNode } from 'preact';
import type { GameCard } from '../core/types';
import { readRoomHash } from '../core/room/useRoom';
import { NoSuchRoom } from './NoSuchRoom';
import { RoomChoice } from './RoomChoice';

/**
 * Which room, if any — the one entrance every game shares.
 * Spec: docs/specs/join.md §Landing on a game page
 *
 * ## Why this is a component and not five copies of an `if`
 *
 * Each of the five room screens had grown its own identical wrapper: read the hash, bail to
 * "this room doesn't exist", otherwise render the inner. Byte-identical apart from two
 * names, docblock included. Adding the chooser to five copies would have been five chances
 * for them to answer differently, which is the failure the shared `GameLobby` template
 * already exists to prevent one level down.
 *
 * The guard has to sit **outside** the component that calls `useRoom`, because hooks cannot
 * be skipped — which is why this is a wrapper taking children rather than an early return.
 *
 * `code` is state, not a value read once per render: entering from the chooser must not
 * depend on a navigation. The chooser has already written the code to the hash, so a reload
 * lands straight in the room; this only saves the round trip.
 */
export function RoomGate({
  game,
  children,
}: {
  game: GameCard;
  children: (code: string) => VNode;
}): JSX.Element {
  // Read once. The hash does change — the chooser writes to it — but through
  // `replaceState`, which fires no event, and re-reading on every render would be a way for
  // this to disagree with the room the player is already connected to.
  const [initial] = useState(readRoomHash);
  const [entered, setEntered] = useState<string | null>(
    initial.kind === 'code' ? initial.code : null,
  );

  /**
   * Enter a room, and make sure the URL says so.
   *
   * The hash is what a reload reads, so entering without writing it left the player one
   * refresh away from being dumped back on the chooser — which is the property the old
   * mint-on-arrival code had for free and the first thing this lost. Create has already
   * written it; **Join has not**, because it resolved a code someone typed.
   *
   * `replaceState`, so the room does not become a second history entry the back button lands
   * on. Guarded, so re-entering the same room does not stack identical states.
   */
  function enter(code: string): void {
    if (readRoomHash().kind !== 'code') {
      history.replaceState(null, '', `${location.pathname}#${code}`);
    }
    setEntered(code);
  }

  if (entered !== null) return children(entered);

  /*
   * A damaged link keeps its own screen rather than being folded into the chooser.
   *
   * The chooser would arguably do — its two choices are exactly NoSuchRoom's two exits — but
   * that screen exists to be unmistakable: a link that led nowhere must not look like a
   * normal landing, or the player never learns that the code they were sent was wrong.
   */
  if (initial.kind === 'invalid') return <NoSuchRoom card={game} />;

  return <RoomChoice card={game} onEnter={enter} />;
}
