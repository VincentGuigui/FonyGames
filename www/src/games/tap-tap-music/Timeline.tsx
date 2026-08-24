import type { JSX } from 'preact';
import { TAPTAP_CHECKPOINT, TAPTAP_TOTAL } from '../../../../shared/protocol';
import { useGameText } from '../../core/i18n/gameText';

/**
 * The progress line above the grid. Spec: docs/specs/games/tap-tap-music.md §4
 *
 * A hundred marks, one per cell in the shared order — not per grid cell, so it
 * reads the same "how far along am I" whichever of the (up to five) physical
 * cells happens to be lit right now. Every tenth mark is a checkpoint (spec
 * §2.2) and is drawn a little larger, so the line doubles as a legible map of
 * where a rewind can land.
 *
 * A mark's own state is `order[i]` being in `cleared` or not — **not** a
 * contiguous prefix. Five cells are live at once and tappable in any order
 * (spec §2), so a player can clear position 47 before position 12; the mark
 * at 12 stays un-passed until it is actually reached, exactly reflecting that
 * gap rather than pretending progress is a single number. Preact only ever
 * adds or removes the `--passed` class on a given mark, never toggles it back
 * and forth on an unrelated re-render, so the CSS pulse defined on that class
 * (`tap-tap-music.css`) plays exactly once per crossing — including a
 * second time if a mark is un-passed by a rewind and then correctly
 * re-reached, which is the point: it says "reached", not "reached once, ever".
 */
export function Timeline({
  order,
  cleared,
}: {
  order: readonly number[];
  cleared: readonly number[];
}): JSX.Element {
  const text = useGameText();
  const done = new Set(cleared);
  return (
    <div
      class="taptap__timeline"
      role="img"
      aria-label={text({ en: `Progress: ${cleared.length} of ${TAPTAP_TOTAL} cells cleared`, fr: `Progression : ${cleared.length} cases effacées sur ${TAPTAP_TOTAL}` })}
    >
      {order.map((cell, i) => {
        const major = i % TAPTAP_CHECKPOINT === 0;
        const passed = done.has(cell);
        return (
          <span
            key={cell}
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
