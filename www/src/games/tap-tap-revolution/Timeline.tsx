import type { JSX } from 'preact';
import { TAPTAP_CHECKPOINT, TAPTAP_TOTAL } from '../../../../shared/protocol';

/**
 * The progress line above the grid. Spec: docs/specs/games/tap-tap-revolution.md §4
 *
 * A hundred marks, one per cell in the shared order — not per grid cell, so it
 * reads the same "how far along am I" whichever of the 100 physical cells happens
 * to be lit right now. Every tenth mark is a checkpoint (spec §2.2) and is drawn a
 * little larger, so the line doubles as a legible map of where a rewind can land.
 *
 * `progress < i` (not yet reached), `progress === i` implicitly (the next mark
 * along), and `progress > i` (passed) are the only three states, and only the
 * third gets colour: passed marks turn green, everything else stays the game's own
 * accent. Preact only ever adds or removes the `--passed` class, never toggles it
 * back and forth on an unrelated re-render, so the CSS pulse defined on that class
 * (`tap-tap-revolution.css`) plays exactly once per crossing — including a second
 * time if a mark is un-passed by a rewind and then correctly re-reached, which is
 * the point: it says "reached", not "reached once, ever".
 */
export function Timeline({ progress }: { progress: number }): JSX.Element {
  return (
    <div
      class="taptap__timeline"
      role="img"
      aria-label={`Progress: ${progress} of ${TAPTAP_TOTAL} cells cleared`}
    >
      {Array.from({ length: TAPTAP_TOTAL }, (_, i) => {
        const major = i % TAPTAP_CHECKPOINT === 0;
        const passed = i < progress;
        return (
          <span
            key={i}
            class={
              'taptap__mark' +
              (major ? ' taptap__mark--major' : '') +
              (passed ? ' taptap__mark--passed' : '')
            }
          />
        );
      })}
    </div>
  );
}
