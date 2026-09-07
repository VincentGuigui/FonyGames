import type { JSX } from 'preact';
import type { Room } from '../room/useRoom';
import { useT } from '../i18n/strings';

/** The guest's one reusable ready toggle, used before the first and later rounds. */
export function ReadyButton({ room, blocked = false, onBeforeReady }: {
  room: Room;
  blocked?: boolean;
  /**
   * Runs when this guest readies UP, before the flag is sent, and resolving false
   * abandons the tap. A game whose sensor has no fallback asks for it here rather
   * than behind its own button (device-capabilities.md §2) — so this must call the
   * permission API synchronously, before its first `await`, or iOS has already
   * discarded the gesture by the time it is asked.
   */
  onBeforeReady?: (() => Promise<boolean>) | undefined;
}): JSX.Element | null {
  const t = useT();
  if (room.isHost) return null;

  const ready = room.me?.ready ?? false;
  const send = (next: boolean): void => { room.client?.send({ t: 'set-ready', d: { ready: next } }); };
  return (
    <button
      class={`btn btn--big ready-button ${ready ? 'ready-button--on' : ''}`}
      type="button"
      aria-pressed={ready}
      disabled={blocked || room.status !== 'open' || !room.me?.connected}
      onClick={() => {
        // Standing down never asks for anything: the setup belongs to saying yes.
        if (ready || !onBeforeReady) return send(!ready);
        void onBeforeReady().then((go) => { if (go) send(true); });
      }}
    >
      {ready ? t.lobby.readyOn : t.lobby.ready}
    </button>
  );
}
