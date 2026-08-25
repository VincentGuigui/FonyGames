import type { JSX } from 'preact';
import { TAPS100_CHECKPOINT, TAPS100_TOTAL } from '../../../../shared/protocol';
import { useGameText } from '../../core/i18n/gameText';

/**
 * The progress line above the grid. Spec: docs/specs/games/hundred-taps.md §4
 *
 * Reused near-verbatim from Tap Tap Music's own `Timeline.tsx` — same hundred
 * marks, one per position in the shared order, every tenth a checkpoint drawn a
 * little larger. A mark's own state is `order[i]` being in `cleared` or not, so a
 * checkpoint rewind un-passes every mark past the landing point at once, the same
 * unmissable visual beat Tap Tap Music's own timeline gives a miss.
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
      class="taps100__timeline"
      role="img"
      aria-label={text({ en: `Progress: ${cleared.length} of ${TAPS100_TOTAL} cells cleared`, fr: `Progression : ${cleared.length} cases effacées sur ${TAPS100_TOTAL}` })}
    >
      {order.map((cell, i) => {
        const major = i % TAPS100_CHECKPOINT === 0;
        const passed = done.has(cell);
        return (
          <span
            key={cell}
            class={
              'taps100__mark' +
              (major ? ' taps100__mark--major' : '') +
              (passed ? ' taps100__mark--passed' : '')
            }
          />
        );
      })}
    </div>
  );
}
