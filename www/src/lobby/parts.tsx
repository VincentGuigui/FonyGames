import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Player, PlayerId, RoomSnapshot } from '../../../shared/protocol';
import type { RoomStatus } from '../core/room/client';
import { AVATARS } from '../../../shared/names';
import { QrCode } from '../core/ui/QrCode';
import { Sheet } from '../core/ui/Sheet';
import { formatRoomCode } from '../core/room/code';

/**
 * The chrome every room screen shares: connection state, the join card, the
 * player list, the avatar picker.
 *
 * Extracted when the second game arrived. Each game's room screen composes
 * these rather than inheriting a lobby, because the *middle* of the screen —
 * the part that is actually the game — differs completely between them while
 * the edges never do.
 *
 * Presentational only. Nothing here opens a socket or knows a rule.
 */

export function ConnectionBanner({ status }: { status: RoomStatus }): JSX.Element | null {
  if (status === 'open') return null;
  const text: Record<Exclude<RoomStatus, 'open'>, string> = {
    connecting: 'Connecting…',
    reconnecting: 'Connection lost — reconnecting…',
    closed: 'Disconnected.',
  };
  return (
    <p class={`banner banner--${status}`} role="status">
      {text[status]}
    </p>
  );
}

export function CodeCard({
  code,
  joinUrl,
  copied,
  showQr,
  onShare,
  onToggleQr,
}: {
  code: string;
  joinUrl: string;
  copied: boolean;
  showQr: boolean;
  onShare: () => void;
  onToggleQr: () => void;
}): JSX.Element {
  return (
    <section class="code-card">
      <p class="code-card__label">Room code</p>
      {/*
        Grouped for reading — `TAK-OBE`. The dash is presentation only; `code` itself
        stays bare everywhere it matters, and the share link and QR below are built
        from that. A long-press copies the dash too, which is harmless: the join field
        strips anything outside the alphabet, so pasting it back works.
      */}
      <p class="code-card__code">{formatRoomCode(code)}</p>
      <div class="code-card__actions">
        <button class="btn btn--primary" type="button" onClick={onShare}>
          {copied ? 'Link copied' : 'Share link'}
        </button>
        <button class="btn" type="button" aria-expanded={showQr} onClick={onToggleQr}>
          {showQr ? 'Hide QR' : 'Show QR'}
        </button>
      </div>
      {showQr && (
        <div class="code-card__qr">
          <QrCode value={joinUrl} size={220} />
          <p class="code-card__hint">Point a phone camera at this.</p>
        </div>
      )}
    </section>
  );
}

export function PlayerList({
  room,
  me,
  onChange,
  /** Extra tag per player — Spill uses it to print the seat number. */
  tagFor,
}: {
  room: RoomSnapshot | null;
  me: Player | undefined;
  /** Opens the profile sheet. Only your own row offers it. */
  onChange: () => void;
  tagFor?: (id: PlayerId) => string | null;
}): JSX.Element {
  return (
    <ul class="players__list">
      {(room?.players ?? []).map((p) => {
        const extra = tagFor?.(p.id) ?? null;
        return (
          <li
            key={p.id}
            class={`player ${p.connected ? '' : 'player--away'} ${
              p.id === me?.id ? 'player--me' : ''
            }`}
          >
            <span class="player__avatar" aria-hidden="true">
              {p.avatar}
            </span>
            <span class="player__name">{p.name}</span>
            {extra && <span class="player__tag">{extra}</span>}
            {room?.hostId === p.id && <span class="player__tag">host</span>}
            {!p.connected && <span class="player__tag">away</span>}
            {/*
              One button for both halves of "who am I". It said `rename` and opened a
              native prompt, and the avatar lived in a twelve-button grid sitting open
              under the list — 123px of the lobby, permanently, for a thing each player
              does once. Both are behind this now.
            */}
            {p.id === me?.id && (
              <button class="btn player__change" type="button" onClick={onChange}>
                Change
              </button>
            )}
          </li>
        );
      })}
      {!room && <li class="player player--ghost">Connecting…</li>}
    </ul>
  );
}

/**
 * Name and avatar, in a sheet, saved together.
 *
 * Both at once because they are one decision — "who am I in this room" — and because two
 * frames for one Save gives the room a moment to show a half-changed player. The name is
 * held locally until Save so a half-typed one never reaches anybody else's screen; the
 * avatar is too, for the same reason and so Cancel means cancel.
 */
export function ProfileSheet({
  me,
  onSave,
  onClose,
}: {
  me: Player;
  onSave: (next: { name: string; avatar: string }) => void;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(me.name);
  const [avatar, setAvatar] = useState(me.avatar);
  const trimmed = name.trim();

  function save(event: Event): void {
    event.preventDefault();
    // An empty field keeps the name you had rather than clearing it: somebody who opened
    // this to change their avatar should not have to retype their name to get out.
    onSave({ name: trimmed === '' ? me.name : trimmed, avatar });
    onClose();
  }

  return (
    <Sheet label="Your name and avatar" onClose={onClose}>
      <form class="profile" onSubmit={save}>
        <div class="gamemenu__head">
          <h2 class="gamemenu__title">You</h2>
          <button class="btn gamemenu__close" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>

        <label class="profile__label" for="profile-name">
          Your name
        </label>
        <input
          id="profile-name"
          class="profile__name"
          type="text"
          value={name}
          maxLength={20}
          autocomplete="nickname"
          spellcheck={false}
          // Not `autofocus`: on a phone it throws the keyboard up over the avatars, which
          // are the other half of what this sheet is for.
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />

        <AvatarPicker current={avatar} onPick={setAvatar} />

        <button class="btn btn--big profile__save" type="submit">
          Save
        </button>
      </form>
    </Sheet>
  );
}

export function AvatarPicker({
  current,
  onPick,
}: {
  current: string;
  onPick: (avatar: string) => void;
}): JSX.Element {
  return (
    <div class="avatar-picker">
      <p class="avatar-picker__label">Your avatar</p>
      <div class="avatar-picker__row">
        {AVATARS.map((a) => (
          <button
            key={a}
            type="button"
            class={`avatar-picker__btn ${current === a ? 'avatar-picker__btn--on' : ''}`}
            aria-label={`Use ${a}`}
            aria-pressed={current === a}
            onClick={() => onPick(a)}
          >
            {a}
          </button>
        ))}
      </div>
    </div>
  );
}
