import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { PREROUND_MS } from '../../../../shared/protocol';
import { HowToPlay } from './HowToPlay';

/**
 * The four-second panel at the top of a round: how to play, in two or three
 * lines, before anyone has to do anything.
 *
 * Text comes from the game's `rules` in the registry — the same array the lobby
 * and the in-game menu render, so the three can never disagree.
 *
 * It covers the whole screen on purpose. For Spill and Goat Siege that is what
 * stops an early flick or lob getting through while people are still reading
 * (the server enforces the same window, so a modified client gains nothing).
 *
 * Mount it keyed on the round id, so a new round always shows a fresh panel
 * rather than reusing a dismissed one.
 *
 * **It does not appear on "Play again."** The server gives a replay a zero-length
 * pre-round window (`preroundFor` in the protocol), so `startsAt` has already
 * passed and this renders nothing. Nobody needs the rules a second time, and the
 * window collapsing with the panel is what stops the replacement being four
 * silent seconds of a live-looking board.
 */
export function RulesPanel({
  title,
  concept,
  rules,
  /** Server time the round starts. The countdown is against the server clock. */
  startsAt,
  now,
}: {
  title: string;
  concept: string;
  rules: string[];
  startsAt: number;
  now: () => number;
}): JSX.Element | null {
  const [left, setLeft] = useState(() => startsAt - now());

  useEffect(() => {
    const id = setInterval(() => setLeft(startsAt - now()), 100);
    return () => clearInterval(id);
  }, [startsAt, now]);

  // A window this short is not a window: `preroundFor` gives replays zero, and
  // our estimate of the clock offset can put `startsAt` a few tens of
  // milliseconds in the future anyway — enough for the panel to flash up and
  // vanish, which is worse than either showing it or not.
  if (left <= MIN_PANEL_MS) return null;
  // Clamped to the panel's own duration. The server sets `startsAt` to its own
  // clock plus PREROUND_MS, and our estimate of the offset can be a few tens of
  // milliseconds behind — enough for `left` to exceed 4000 and for a four-second
  // wait to open by announcing "5".
  const remaining = Math.min(left, PREROUND_MS);
  const seconds = Math.ceil(remaining / 1000);

  return (
    <div class="preround" role="dialog" aria-live="polite" aria-label={`${title}: how to play`}>
      <div class="preround__card">
        <h2 class="preround__title">{title}</h2>
        <HowToPlay concept={concept} rules={rules} size="big" />
        <p class="preround__count" aria-hidden="true">
          {seconds}
        </p>
        {/* The bar is the honest version of the countdown: a number alone is
            easy to miss, and this shows how much reading time is left. */}
        <div class="preround__bar">
          <span style={{ width: `${(remaining / PREROUND_MS) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

/** Below this the panel would be a flicker rather than something to read. */
const MIN_PANEL_MS = 400;
