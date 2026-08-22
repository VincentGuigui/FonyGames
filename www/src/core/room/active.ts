import { useEffect, useState } from 'preact/hooks';
import type { RoomSnapshot } from '../../../../shared/protocol';
import type { RoomClient } from './client';

export type ActiveRoom = { client: RoomClient; code: string; game: string; room: RoomSnapshot | null };
let active: ActiveRoom | null = null;
const listeners = new Set<() => void>();

export function setActiveRoom(next: ActiveRoom): void { active = next; listeners.forEach((listener) => listener()); }
export function updateActiveSnapshot(room: RoomSnapshot): void { if (active) { active = { ...active, room }; listeners.forEach((listener) => listener()); } }
export function clearActiveRoom(client: RoomClient): void { if (active?.client === client) { active = null; listeners.forEach((listener) => listener()); } }
export function useActiveRoom(): ActiveRoom | null {
  const [value, setValue] = useState(active);
  useEffect(() => { const refresh = () => setValue(active); listeners.add(refresh); return () => { listeners.delete(refresh); }; }, []);
  return value;
}
