import { useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { HowToPlay } from './HowToPlay';
import { Sheet } from './Sheet';
import { useT } from '../i18n/strings';

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
  concept,
  rules,
  children,
}: {
  title: string;
  /** Both come from the game's registry entry — never retyped here. */
  concept: string;
  rules: string[];
  children?: ComponentChildren;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const t = useT();

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
        <Sheet label={`${title} menu`} onClose={() => setOpen(false)}>
          <div class="gamemenu__head">
            <h2 class="gamemenu__title">{title}</h2>
            <button class="btn gamemenu__close" type="button" onClick={() => setOpen(false)}>
              {t.common.close}
            </button>
          </div>

          <h3 class="gamemenu__label">{t.common.howToPlay}</h3>
          <HowToPlay concept={concept} rules={rules} />

          {children}

          {/* A real link, not a router call: leaving the page is what drops
              the socket and frees the seat. */}
          <a class="btn btn--big gamemenu__exit" href="/">
            {t.common.leaveGame}
          </a>
        </Sheet>
      )}
    </>
  );
}

/**
 * The gear.
 *
 * Generated from a centre and two radii rather than drawn by hand, because the
 * hand-drawn one was not symmetric: its body sat about one unit right of centre
 * while the hub circle was at 12,12, so the inner circle read as off-centre. Eight
 * teeth, tips at r=9.3 and roots at r=6.9, bounding box 2.87..21.13 in **both**
 * axes — so it is centred on 12,12 by construction and cannot drift again.
 */
function Gear(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        d="M21.13 10.23A9.3 9.3 0 0 1 21.13 13.77L18.7 13.67A6.9 6.9 0 0 1 17.91 15.55L19.71 17.2A9.3 9.3 0 0 1 17.2 19.71L15.55 17.91A6.9 6.9 0 0 1 13.67 18.7L13.77 21.13A9.3 9.3 0 0 1 10.23 21.13L10.33 18.7A6.9 6.9 0 0 1 8.45 17.91L6.8 19.71A9.3 9.3 0 0 1 4.29 17.2L6.09 15.55A6.9 6.9 0 0 1 5.3 13.67L2.87 13.77A9.3 9.3 0 0 1 2.87 10.23L5.3 10.33A6.9 6.9 0 0 1 6.09 8.45L4.29 6.8A9.3 9.3 0 0 1 6.8 4.29L8.45 6.09A6.9 6.9 0 0 1 10.33 5.3L10.23 2.87A9.3 9.3 0 0 1 13.77 2.87L13.67 5.3A6.9 6.9 0 0 1 15.55 6.09L17.2 4.29A9.3 9.3 0 0 1 19.71 6.8L17.91 8.45A6.9 6.9 0 0 1 18.7 10.33Z"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
      />
      <circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="2" />
    </svg>
  );
}
