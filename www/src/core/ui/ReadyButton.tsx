import type { JSX } from 'preact';
import type { Room } from '../room/useRoom';
import { useT } from '../i18n/strings';

/** The guest's one reusable ready toggle, used before the first and later rounds. */
export function ReadyButton({ room, blocked = false }: { room: Room; blocked?: boolean }): JSX.Element | null {
  const t = useT();
  if (room.isHost) return null;

  const ready = room.me?.ready ?? false;
  return (
    <button
      class={`btn btn--big ready-button ${ready ? 'ready-button--on' : ''}`}
      type="button"
      aria-pressed={ready}
      disabled={blocked || room.status !== 'open' || !room.me?.connected}
      onClick={() => room.client?.send({ t: 'set-ready', d: { ready: !ready } })}
    >
      {ready ? t.lobby.readyOn : t.lobby.ready}
    </button>
  );
}
