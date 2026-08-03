import { useEffect, useRef, useState } from 'preact/hooks';
import type { Player, RoomSnapshot, ServerMessage } from '../../../../shared/protocol';
import { RoomClient, type RoomStatus } from './client';
import { roomServerUrl } from './config';
import { loadSeat, saveSeat } from './seat';
import { generateRoomCode, isRoomCode, normaliseRoomCode } from './code';
import { loadProfile, saveProfile } from '../profile';

/**
 * The room code lives in the URL hash so the page is shareable as-is. Landing
 * here without one means you are starting a room, so we mint a code and put it
 * in the URL immediately — before anyone connects — so a reload rejoins the
 * same room instead of silently creating a second one.
 *
 * Lives here rather than in code.ts because that module is shared with the
 * Worker, which has no `location` and must stay DOM-free.
 */
export function codeFromLocation(): string {
  const fromHash = normaliseRoomCode(location.hash.replace(/^#/, ''));
  if (isRoomCode(fromHash)) return fromHash;

  const fresh = generateRoomCode();
  history.replaceState(null, '', `${location.pathname}#${fresh}`);
  return fresh;
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
  rename: () => void;
  setAvatar: (avatar: string) => void;
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
    client.on('status', setStatus);
    client.on('presence', setRoom);
    client.on('error', setError);
    client.on('seat', (id) => saveSeat(code, id));
    client.on('game', (msg) => gameRef.current?.(msg));
    client.connect(loadProfile());
    return () => client.close();
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
    rename: () => {
      const next = prompt('Your name', me?.name ?? '')?.trim();
      if (!next) return;
      clientRef.current?.send({ t: 'set-profile', d: { name: next } });
      saveProfile({ name: next });
    },
    setAvatar: (avatar) => {
      clientRef.current?.send({ t: 'set-profile', d: { avatar } });
      saveProfile({ avatar });
    },
  };
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
