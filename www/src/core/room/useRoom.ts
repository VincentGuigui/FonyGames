import { useEffect, useRef, useState } from 'preact/hooks';
import type { Player, RoomSnapshot, ServerMessage } from '../../../../shared/protocol';
import { RoomClient, type RoomStatus } from './client';
import { roomServerUrl } from './config';
import { loadSeat, saveSeat } from './seat';
import { generateRoomCode, isRoomCode, ROOM_CODE_GROUP, ROOM_CODE_LENGTH } from './code';
import { loadProfile, saveProfile } from '../profile';
import { clearActiveRoom, setActiveRoom, updateActiveSnapshot } from './active';

/**
 * What the URL hash says about which room we are in.
 * Spec: docs/specs/join.md §Landing on a game page
 *
 * | Hash | `kind` | What the caller shows |
 * | --- | --- | --- |
 * | empty | `empty` | the join-or-create chooser — **nothing is minted here** |
 * | a valid code | `code` | the lobby for that room |
 * | anything else | `invalid` | "this room doesn't exist" |
 */
export type RoomHash = { kind: 'code'; code: string } | { kind: 'empty' } | { kind: 'invalid' };

/**
 * Read a hash. **Pure** — takes the raw string rather than touching `location`, which is
 * the only reason it can be tested: this project has no DOM test runner, so the logic worth
 * asserting has to be reachable from node (`hash.test.ts`).
 *
 * An invalid hash is reported, never repaired. It used to mint a fresh code, which dropped
 * the player into a *different, empty room* with the bad code erased from the URL: they
 * believed they had joined, they were alone, and the evidence was gone. A chat app eating a
 * character, or a code copied one short, does exactly that. Leaving it in place is what lets
 * it still be compared against the code the sender meant to send.
 *
 * Lives here rather than in code.ts because that module is shared with the Worker, which has
 * no `location` and must stay DOM-free.
 */
export function roomFromHash(raw: string): RoomHash {
  const trimmed = raw.replace(/^#/, '').trim();

  // Whitespace-only is an empty hash, not a damaged one: `#` followed by a stray space
  // survives a copy-paste and means nothing was chosen.
  if (trimmed === '') return { kind: 'empty' };

  /*
   * `isRoomCode` on the WHOLE value, deliberately not `normaliseRoomCode` — which is right
   * for a field being typed into and wrong here, because it is lossy in two ways: it drops
   * characters outside the alphabet and truncates to length.
   *
   * That combination silently rewrote damaged links into valid ones. `#lobby` was truncated
   * to five characters; an over-long hash was truncated to a shorter valid code. Both
   * are the failure this whole three-way answer exists to prevent — a link that arrived
   * damaged dropping the player into a *different* room, alone, with nothing left to
   * compare. Found by `hash.test.ts` on the day it was written.
   *
   * Two transformations ARE forgiven, and neither is a guess:
   *
   * - **Case**, because some clients lowercase a URL in transit.
   * - **The grouping dash, in exactly the position we print it.** `FON-GAM` is the form
   *   shown on the code card, so somebody typing what they can see is not sending a
   *   damaged link; there is exactly one code it can mean. Anything else containing a
   *   dash — `TA-K`, `T-AKOBE`, `TAK-OB` — is still invalid, because accepting those
   *   would be back to repairing rather than reading.
   */
  const upper = trimmed.toUpperCase();
  const bare = upper.length === ROOM_CODE_LENGTH + 1 && upper[ROOM_CODE_GROUP] === '-'
    ? upper.slice(0, ROOM_CODE_GROUP) + upper.slice(ROOM_CODE_GROUP + 1)
    : upper;

  return isRoomCode(bare) ? { kind: 'code', code: bare } : { kind: 'invalid' };
}

/** The same, for the live page. */
export function readRoomHash(): RoomHash {
  return roomFromHash(location.hash);
}

/**
 * Mint a room code.
 *
 * Called when the player chooses **Create**, not on arrival — opening a game page used to
 * do this unconditionally, so browsing the catalogue created rooms nobody entered
 * (docs/specs/join.md).
 *
 * **It does not touch the URL.** It used to `replaceState` the fresh code into the hash,
 * which quietly made it the second thing that decided the page's history — and `RoomGate`'s
 * `enter` skips writing a hash that already says what it was about to say, so the moment
 * entering a room became a `pushState` the Create path silently kept the old behaviour and
 * back still jumped off the game. Minting is minting; the URL has one owner.
 */
export function mintRoomCode(): string {
  return generateRoomCode();
}

/**
 * Connect to a room and keep the presence state fresh. Everything a game screen
 * needs before it can start being a game.
 *
 * Game-specific frames are handed to `onGame` through a ref, so a component can
 * pass an inline closure without the socket being torn down and rebuilt on
 * every render.
 */
export type Room = {
  client: RoomClient | null;
  status: RoomStatus;
  room: RoomSnapshot | null;
  error: string | null;
  setError: (message: string | null) => void;
  me: Player | undefined;
  isHost: boolean;
  connected: number;
  /**
   * Change your name, your avatar, or both, in one frame.
   *
   * One call rather than the `rename()` and `setAvatar()` it replaces, because the lobby
   * now edits both together in one sheet and two frames for one Save is two chances for
   * the room to see a half-finished player. `rename()` was also a native `prompt()` — an
   * OS dialog in the middle of a game, which some browsers refuse outright.
   */
  setProfile: (next: { name?: string; avatar?: string }) => void;
};

export function useRoom(
  code: string,
  /** Slug of this game, recorded server-side so the hub can route a pasted code. */
  game: string,
  onGame?: (msg: ServerMessage) => void,
): Room {
  const [status, setStatus] = useState<RoomStatus>('connecting');
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<RoomClient | null>(null);
  const gameRef = useRef(onGame);
  gameRef.current = onGame;

  useEffect(() => {
    // Recovering the seat from storage is what makes a refresh rejoin as the
    // same player instead of spawning a ghost alongside the old one.
    const client = new RoomClient(roomServerUrl(), code, game, loadSeat(code));
    clientRef.current = client;
    setActiveRoom({ client, code, game, room: null });
    client.on('status', setStatus);
    client.on('presence', (next) => { setRoom(next); updateActiveSnapshot(next); });
    client.on('error', setError);
    client.on('seat', (id) => saveSeat(code, id));
    client.on('game', (msg) => gameRef.current?.(msg));
    client.connect(loadProfile());
    return () => { clearActiveRoom(client); client.close(); };
  }, [code, game]);

  const me = room?.players.find((p) => p.id === clientRef.current?.playerId);

  return {
    client: clientRef.current,
    status,
    room,
    error,
    setError,
    me,
    isHost: !!me && room?.hostId === me.id,
    connected: room?.players.filter((p) => p.connected).length ?? 0,
    setProfile: (next) => {
      // Trimmed here rather than in the sheet: whatever calls this, a name of spaces is
      // not a name, and the server would take it.
      const name = next.name?.trim();
      const d = {
        ...(name ? { name } : {}),
        ...(next.avatar ? { avatar: next.avatar } : {}),
      };
      if (Object.keys(d).length === 0) return;
      clientRef.current?.send({ t: 'set-profile', d });
      // Remembered for the next room, so a player names themselves once per phone.
      saveProfile(d);
    },
  };
}

/**
 * The share link and its two buttons — everything `CodeCard` needs.
 *
 * Every room screen had grown its own copy of this: the same two `useState`s, the same
 * `joinUrl` template, the same `share()` with the same 2000 ms reset of the "Link copied"
 * label. Five identical copies, so a fix to the copy-failure message reached one of them.
 *
 * `setError` is optional because the chooser has nowhere to put an error — it is showing the
 * code before anyone has connected, so there is no room state to attach one to. In the lobby
 * it goes to the room's error line.
 */
export function useShareRoom(
  code: string,
  title: string,
  setError?: (message: string | null) => void,
): {
  joinUrl: string;
  copied: boolean;
  showQr: boolean;
  share: () => Promise<void>;
  toggleQr: () => void;
} {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  // From `location`, not from config: the link has to point at the host the player is
  // actually on, which is how one code works on dev and prod without knowing which it is.
  const joinUrl = `${location.origin}${location.pathname}#${code}`;

  return {
    joinUrl,
    copied,
    showQr,
    toggleQr: () => setShowQr((v) => !v),
    share: async () => {
      const outcome = await shareRoom(title, code, joinUrl);
      if (outcome === 'copied') {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else if (outcome === 'failed') {
        // Not silence: the button appeared to do nothing, and the code is still readable on
        // screen, so say how to get it by hand.
        setError?.('Could not copy — long-press the code to select it.');
      }
    },
  };
}

/** The room connection and share controls every game lobby opens together. */
export function useGameRoom(
  code: string,
  game: { slug: string; title: string },
  onGame?: (msg: ServerMessage) => void,
): { room: Room } & ReturnType<typeof useShareRoom> {
  const room = useRoom(code, game.slug, onGame);
  const sharing = useShareRoom(code, game.title, room.setError);
  return { room, ...sharing };
}

/** Share the join link, falling back to the clipboard when there is no share sheet. */
export async function shareRoom(
  title: string,
  code: string,
  joinUrl: string,
): Promise<'shared' | 'copied' | 'failed'> {
  if (navigator.share) {
    try {
      await navigator.share({ title: `FonyGames — ${title}`, text: `Join my ${title} room: ${code}`, url: joinUrl });
      return 'shared';
    } catch {
      // Cancelled, or the browser refused. Fall through to copying.
    }
  }
  try {
    await navigator.clipboard.writeText(joinUrl);
    return 'copied';
  } catch {
    return 'failed';
  }
}
