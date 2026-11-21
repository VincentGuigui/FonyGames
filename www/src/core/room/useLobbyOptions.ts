import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Room } from './useRoom';

/**
 * A game's lobby options, shared with the room. Spec: docs/specs/join.md
 *
 * The host edits a local value and every change is sent to the room; everyone
 * else reads what the host last sent. Without this a guest's panel showed the
 * panel's own defaults, because a choice lived on the host's phone until Start.
 *
 * `normalise` is the game's own sanitiser: what comes off the wire is shown
 * through it, so a malformed value can only ever land on something legal.
 *
 * A player who becomes host mid-lobby adopts what the room already holds, so
 * the panel does not jump back to defaults under everybody; a host with nothing
 * stored yet publishes their default, so a guest who joins later sees it too.
 */
export function useLobbyOptions<T extends object>(
  room: Room,
  normalise: (raw: unknown) => T,
  initial: T,
): [T, (next: T) => void] {
  const [local, setLocal] = useState<T>(initial);
  const stored = room.room?.options;
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const clientRef = useRef(room.client);
  clientRef.current = room.client;

  const publish = useCallback((next: T) => {
    clientRef.current?.send({ t: 'lobby-options', d: { options: next } });
  }, []);

  const isHost = room.isHost;
  const connected = room.client !== null && room.room !== null;
  useEffect(() => {
    if (!isHost || !connected) return;
    if (storedRef.current !== undefined) setLocal(normalise(storedRef.current));
    else publish(local);
    // Only the moment of becoming host (or connecting as one) matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, connected]);

  const set = useCallback(
    (next: T) => {
      setLocal(next);
      publish(next);
    },
    [publish],
  );

  const value = isHost ? local : stored === undefined ? initial : normalise(stored);
  return [value, set];
}
