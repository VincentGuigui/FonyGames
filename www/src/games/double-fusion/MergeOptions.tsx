import type { JSX } from 'preact';
import { MERGE_MODES, MERGE_SERIES, MERGE_TARGETS, type MergeMode, type MergeOptions, type MergeSeries } from '../../../../shared/protocol';
import { useGameText } from '../../core/i18n/gameText';
import { modeBlurb, modeName, targetLabel } from './modes';

/**
 * The host's mode, in the lobby. Spec: docs/specs/games/double-fusion.md §3
 *
 * Read-only for everybody but the host, the same call every other options
 * panel in the catalogue makes. A race also picks its target tile, from a
 * dropdown to keep the panel short, and whether it is aggressive (§3.1).
 */
export function MergeOptionsPanel({
  value,
  onChange,
  editable,
}: {
  value: MergeOptions;
  onChange: (next: MergeOptions) => void;
  editable: boolean;
}): JSX.Element {
  const text = useGameText();
  const pick = (mode: MergeMode): void => onChange({ ...value, mode });

  return (
    <div class="merge-options">
      <fieldset class="merge-options__group" disabled={!editable}>
        <legend class="merge-options__legend">{text({ en: 'Mode', fr: 'Mode' })}</legend>
        <div class="merge-options__modes" role="radiogroup">
          {MERGE_MODES.map((mode) => (
            <div key={mode} class={`merge-options__card${value.mode === mode ? ' merge-options__card--on' : ''}`}>
              <button
                type="button"
                role="radio"
                aria-checked={value.mode === mode}
                class="merge-options__mode"
                disabled={!editable}
                onClick={() => pick(mode)}
              >
                <b>{text(modeName(mode, value.target))}</b>
                <span>{text(modeBlurb(mode, value.target))}</span>
              </button>
              {mode === 'race' && value.mode === 'race' && (
                <div class="merge-options__race">
                  <label class="merge-options__target">
                    <span>{text({ en: 'Target tile', fr: 'Tuile à atteindre' })}</span>
                    <select
                      value={String(value.target)}
                      disabled={!editable}
                      onChange={(e) => onChange({ ...value, target: Number((e.currentTarget as HTMLSelectElement).value) })}
                    >
                      {MERGE_TARGETS.map((t) => (
                        <option key={t} value={String(t)}>
                          {targetLabel(t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="merge-options__aggressive">
                    <input
                      type="checkbox"
                      checked={value.aggressive}
                      disabled={!editable}
                      onChange={(e) => onChange({ ...value, aggressive: (e.currentTarget as HTMLInputElement).checked })}
                    />
                    <span>
                      <b>{text({ en: 'Aggressive mode', fr: 'Mode agressif' })}</b>
                      {text({
                        en: 'Merging into 64 or more unlocks a malus: drag it onto a rival to send it',
                        fr: 'Fusionner en 64 ou plus débloque un malus : glissez-le sur un adversaire pour l’envoyer',
                      })}
                    </span>
                  </label>
                </div>
              )}
              {mode === 'highlander' && value.mode === 'highlander' && (
                <div class="merge-options__race">
                  <label class="merge-options__target">
                    <span>{text({ en: 'Series', fr: 'Série' })}</span>
                    <select
                      value={value.series}
                      disabled={!editable}
                      onChange={(e) => onChange({ ...value, series: (e.currentTarget as HTMLSelectElement).value as MergeSeries })}
                    >
                      {MERGE_SERIES.map((s) => (
                        <option key={s} value={s}>
                          {text(s === 'ten' ? { en: '10 rounds', fr: '10 manches' } : { en: 'Endless', fr: 'Sans fin' })}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      </fieldset>

      {!editable && (
        <p class="howto__aside">{text({ en: 'The host picks the mode.', fr: 'L’hôte choisit le mode.' })}</p>
      )}
    </div>
  );
}
