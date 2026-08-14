import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { formatRoomCode, isRoomCode, normaliseRoomCode, ROOM_CODE_LENGTH } from '../room/code';
import { lookupRoom } from '../room/lookup';

/**
 * "Got a code from a friend?" — the one place a typed room code is taken.
 * Spec: docs/specs/join.md §1, docs/specs/hub.md §4
 *
 * Used by the hub **and** by every game's join-or-create chooser. It lived inline in
 * `Hub.tsx` until the chooser needed it; copying it would have meant two places deciding
 * what a valid code is and what to do with one, and the second copy would have drifted.
 *
 * The code carries no hint of which game it belongs to, so this asks the room server and
 * then goes there. That is the property that lets someone paste a code without knowing what
 * their friends picked.
 *
 * **The markup is server-rendered on the hub** (docs/specs/seo.md §4), so it must stay
 * hydration-identical: same elements, same classes, same order. Styles live in `join.css`,
 * which both `hub.css` and `lobby.css` import — a game page never loads `hub.css`, and
 * without that import this form is unstyled everywhere except the hub.
 */
export function JoinByCode({
  label = 'Got a code from a friend?',
  /**
   * Called instead of navigating when the code turns out to belong to **this** page's game.
   *
   * Without it the chooser silently does nothing: `location.assign('/tap-duel/#AB2C')` from
   * `/tap-duel/` changes only the hash, which does **not** reload the page, so the chooser
   * would stay on screen with the URL now pointing at a room nobody entered. The hub omits
   * this and always navigates, because from there every code is a different page.
   */
  onSameGame,
  /** This page's game slug. Required for `onSameGame` to mean anything. */
  slug,
}: {
  label?: string;
  onSameGame?: (code: string) => void;
  slug?: string;
} = {}): JSX.Element {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function onJoin(event: Event): Promise<void> {
    event.preventDefault();
    // Read the field, not the state. A paste followed immediately by Enter can
    // submit before the input event's render has committed, and then this would
    // act on the *previous* value — the code before last, or nothing at all.
    const form = event.currentTarget as HTMLFormElement;
    const field = form.elements.namedItem('room-code');
    const typed = field instanceof HTMLInputElement ? field.value : code;
    const value = normaliseRoomCode(typed);
    setCode(value);

    if (!isRoomCode(value)) {
      setError(`A room code is ${ROOM_CODE_LENGTH} letters or numbers.`);
      return;
    }

    setChecking(true);
    setError(null);
    const found = await lookupRoom(value);
    setChecking(false);

    if (found.found) {
      if (onSameGame && found.game === slug) {
        onSameGame(value);
        return;
      }
      location.assign(`/${found.game}/#${value}`);
      return;
    }
    setError(
      found.reason === 'unknown'
        ? `No room called ${formatRoomCode(value)}. Check the code, or ask for the link.`
        : 'Could not reach the game server. Check your connection and try again.',
    );
  }

  return (
    <form class="join" onSubmit={onJoin}>
      <label class="join__label" for="room-code">
        {label}
      </label>
      <div class="join__row">
        {/*
          The field shows the grouped form, `ABC-DEF`, while `code` stays the bare six
          characters — the dash is presentation and must never reach a URL. `maxLength`
          counts the dash, hence +1.

          The value is written back on every keystroke so the dash appears as the fourth
          character is typed. `normaliseRoomCode` drops the dash on the way in, so a
          pasted `ABC-DEF`, `abcdef` or `ABC DEF` all arrive the same.
        */}
        <input
          id="room-code"
          name="room-code"
          class="join__input"
          type="text"
          inputMode="text"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck={false}
          maxLength={ROOM_CODE_LENGTH + 1}
          placeholder="ABC-DEF"
          value={formatRoomCode(code)}
          disabled={checking}
          aria-describedby={error ? 'join-error' : undefined}
          onInput={(e) => {
            const field = e.target as HTMLInputElement;
            const bare = normaliseRoomCode(field.value);
            // Written directly as well as through state: Preact skips the DOM update
            // when the new value matches its last render, which happens when the only
            // change was a character this strips — and the field would then keep
            // showing what was typed rather than what was accepted.
            field.value = formatRoomCode(bare);
            setCode(bare);
            setError(null);
          }}
        />
        <button class="join__button" type="submit" disabled={checking}>
          {checking ? 'Looking…' : 'Join'}
        </button>
      </div>
      {error && (
        <p class="join__error" id="join-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
