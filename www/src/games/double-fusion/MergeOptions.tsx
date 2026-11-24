import type { JSX } from 'preact';
import { MERGE_MODES, MERGE_TARGETS, type MergeMode, type MergeOptions } from '../../../../shared/protocol';
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
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={value.mode === mode}
              class={`merge-options__mode ${value.mode === mode ? 'merge-options__mode--on' : ''}`}
              disabled={!editable}
              onClick={() => pick(mode)}
            >
              <b>{text(modeName(mode, value.target))}</b>
              <span>{text(modeBlurb(mode, value.target))}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {value.mode === 'race' && (
        <fieldset class="merge-options__group merge-options__race" disabled={!editable}>
          <label class="merge-options__target">
            <span>{text({ en: 'First to make', fr: 'Le premier à faire' })}</span>
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
        </fieldset>
      )}

      {!editable && (
        <p class="howto__aside">{text({ en: 'The host picks the mode.', fr: 'L’hôte choisit le mode.' })}</p>
      )}
    </div>
  );
}
