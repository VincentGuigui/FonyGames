import type { JSX } from 'preact';
import {
  BLINK_DURATION_CHOICES,
  BLINK_LIGHT_CHOICES,
  BLINK_MISS_LIMIT,
  type BlinkOptions,
} from '../../../../shared/protocol';
import { useGameText } from '../../core/i18n/gameText';

/**
 * The host's two choices, in the lobby. Spec: docs/specs/games/blink-tapper.md §3
 *
 * Options, not modes — they travel in the `start` payload. Read-only for
 * everybody but the host, the same call Math-o-matic's panel makes.
 */
export function BlinkOptionsPanel({
  value,
  onChange,
  editable,
}: {
  value: BlinkOptions;
  onChange: (next: BlinkOptions) => void;
  editable: boolean;
}): JSX.Element {
  const text = useGameText();
  const durationLabel = (ms: number): string =>
    ms === 0 ? text({ en: '∞', fr: '∞' }) : `${ms / 1000} s`;

  return (
    <div class="blink-options">
      <fieldset class="blink-options__group" disabled={!editable}>
        <legend class="blink-options__legend">{text({ en: 'Lights', fr: 'Lumières' })}</legend>
        <div class="blink-options__row">
          {BLINK_LIGHT_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              class={`blink-options__stop ${value.lights === n ? 'blink-options__stop--on' : ''}`}
              aria-pressed={value.lights === n}
              disabled={!editable}
              onClick={() => onChange({ ...value, lights: n })}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset class="blink-options__group" disabled={!editable}>
        <legend class="blink-options__legend">{text({ en: 'Duration', fr: 'Durée' })}</legend>
        <div class="blink-options__row">
          {BLINK_DURATION_CHOICES.map((ms) => (
            <button
              key={ms}
              type="button"
              class={`blink-options__stop ${value.duration === ms ? 'blink-options__stop--on' : ''}`}
              aria-pressed={value.duration === ms}
              aria-label={ms === 0 ? text({ en: 'Unlimited', fr: 'Illimité' }) : undefined}
              disabled={!editable}
              onClick={() => onChange({ ...value, duration: ms })}
            >
              {durationLabel(ms)}
            </button>
          ))}
        </div>
        <p class="blink-options__readout">
          {value.duration === 0
            ? text({ en: `Unlimited: ${BLINK_MISS_LIMIT} misses and you are out`, fr: `Illimité : ${BLINK_MISS_LIMIT} ratés et vous êtes éliminé` })
            : text({ en: `${value.duration / 1000} seconds of blinks`, fr: `${value.duration / 1000} secondes de clignotements` })}
        </p>
      </fieldset>

      {!editable && (
        <p class="howto__aside">{text({ en: 'The host sets these.', fr: 'L’hôte règle ces options.' })}</p>
      )}
    </div>
  );
}
