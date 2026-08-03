import { useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';

/**
 * The in-game menu: a gear in the corner of every game, opening a sheet.
 *
 * Every game has one, and every one contains the same two things — how to play,
 * and a way out to the hub. A player who is lost mid-round should never have to
 * guess which corner this game hid its exit in, so the affordance is identical
 * everywhere and lives here rather than in each game.
 *
 * `children` is the slot for whatever else that game needs (Spill puts the
 * table diagram and the theme picker there).
 */
export function GameMenu({
  title,
  rules,
  children,
}: {
  title: string;
  /** The single source in the game's registry entry — never retyped here. */
  rules: string[];
  children?: ComponentChildren;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        class="gamemenu__gear"
        type="button"
        aria-label="Game menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Gear />
      </button>

      {open && (
        <div class="gamemenu">
          {/* A tap outside closes it — the usual sheet behaviour, and it means a
              mis-tap on the gear costs nothing mid-round. */}
          <button
            class="gamemenu__scrim"
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div class="gamemenu__sheet" role="dialog" aria-modal="true" aria-label={`${title} menu`}>
            <div class="gamemenu__head">
              <h2 class="gamemenu__title">{title}</h2>
              <button class="btn gamemenu__close" type="button" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            <h3 class="gamemenu__label">How to play</h3>
            <ul class="rules">
              {rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>

            {children}

            {/* A real link, not a router call: leaving the page is what drops
                the socket and frees the seat. */}
            <a class="btn btn--big gamemenu__exit" href="/">
              Leave game
            </a>
          </div>
        </div>
      )}
    </>
  );
}

function Gear(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      />
      <path
        d="M19.4 13a7.7 7.7 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.7 7.7 0 0 0-1.7-1l-.3-2.5h-4l-.3 2.5a7.7 7.7 0 0 0-1.7 1l-2.3-1-2 3.4L6.6 11a7.7 7.7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.7 7.7 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7.7 7.7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5Z"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </svg>
  );
}
