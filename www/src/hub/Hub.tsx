import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { catalogue } from '../games/registry';
import { GameCardTile } from './GameCardTile';
import { isRoomCode, normaliseRoomCode } from '../core/room/code';

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

  const anyPlayable = games.some((g) => g.status !== 'soon');

  function onJoin(event: Event): void {
    event.preventDefault();
    const value = normaliseRoomCode(code);

    if (!isRoomCode(value)) {
      setError('A room code is 4 letters or numbers.');
      return;
    }
    // Resolving CODE -> game needs the room server (hub spec §4). Until the
    // first game ships there is nothing to resolve, and saying so is better
    // than a spinner that never resolves.
    setError('No rooms yet — the first game is still being built.');
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
            class="join__input"
            type="text"
            inputMode="text"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck={false}
            maxLength={4}
            placeholder="ABCD"
            value={code}
            aria-describedby={error ? 'join-error' : undefined}
            onInput={(e) => {
              setCode(normaliseRoomCode((e.target as HTMLInputElement).value));
              setError(null);
            }}
          />
          <button class="join__button" type="submit">
            Join
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
