import { createContext } from 'preact';

/**
 * How the player got into this room: **true** if they arrived on a link with the code already
 * in the hash, false if they came through the chooser.
 *
 * It exists for one decision — whether the lobby's How to play panel starts open. Collapsing
 * it unconditionally was wrong: the reasoning was "you read the rules on the way in", which
 * holds for whoever created the room and passed the chooser, and is false for everyone who
 * tapped a friend's link. In a party game that is most of the table, and they were landing on
 * a lobby with the rules folded shut.
 *
 * A context rather than a prop because the answer is known in `RoomGate` and needed in
 * `GameLobby`, and every one of the five game screens sits in between — threading it would
 * mean five files carrying a prop none of them has any use for.
 */
export const ArrivedByLink = createContext(false);
