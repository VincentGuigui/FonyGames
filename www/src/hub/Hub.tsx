import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { catalogue } from '../games/registry';
import { GameCardTile } from './GameCardTile';
import { isRoomCode, normaliseRoomCode } from '../core/room/code';
import { lookupRoom } from '../core/room/lookup';

/**
 * The hub: a stranger should want to play something within ten seconds.
 * Spec: docs/specs/hub.md
 *
 * The hub is inert — no permission request, no sensor listener, no socket.
 * Those only ever happen inside a game lobby.
 */
export function Hub(): JSX.Element {
  const games = catalogue();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const anyPlayable = games.some((g) => g.status !== 'soon');

  /**
   * Route a typed code to the right lobby (hub spec §4).
   *
   * The code carries no hint of which game it is, so this asks the room server
   * and then navigates. `location.assign` rather than client-side routing: each
   * game is its own page (architecture.md §3), so this is a real navigation.
   */
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
      setError('A room code is 4 letters or numbers.');
      return;
    }

    setChecking(true);
    setError(null);
    const found = await lookupRoom(value);
    setChecking(false);

    if (found.found) {
      location.assign(`/${found.game}/#${value}`);
      return;
    }
    setError(
      found.reason === 'unknown'
        ? `No room called ${value}. Check the code, or ask for the link.`
        : 'Could not reach the game server. Check your connection and try again.',
    );
  }

  return (
    <div class="hub">
      <header class="hub__header">
        <h1 class="hub__wordmark">FonyGames</h1>
        <p class="hub__tagline">
          Silly multiplayer games for the phone already in your pocket.
        </p>
      </header>

      <form class="join" onSubmit={onJoin}>
        <label class="join__label" for="room-code">
          Got a code from a friend?
        </label>
        <div class="join__row">
          <input
            id="room-code"
            name="room-code"
            class="join__input"
            type="text"
            inputMode="text"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck={false}
            maxLength={4}
            placeholder="ABCD"
            value={code}
            disabled={checking}
            aria-describedby={error ? 'join-error' : undefined}
            onInput={(e) => {
              setCode(normaliseRoomCode((e.target as HTMLInputElement).value));
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

      {!anyPlayable && (
        <p class="hub__notice">
          Nothing is playable yet — this is the shell. Cards show what's coming.
        </p>
      )}

      <ul class="hub__grid">
        {games.map((game) => (
          <GameCardTile key={game.slug} game={game} />
        ))}
      </ul>

      <footer class="hub__footer">
        <p>
          No install, no account. Nothing you do is stored — positions and
          sensor readings never leave the room you're playing in.
        </p>
        <p>
          <a href="https://github.com/VincentGuigui/FonyGames">Source on GitHub</a>
        </p>
      </footer>
    </div>
  );
}
