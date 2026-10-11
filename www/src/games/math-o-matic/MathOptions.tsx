import type { JSX } from 'preact';
import {
  MATH_DIGIT_CHOICES,
  MATH_OPERATOR_CHOICES,
  MATH_OPS,
  type MathOp,
  type MathOptions as Options,
} from '../../../../shared/mathQuestion';
import { useGameText } from '../../core/i18n/gameText';

/**
 * The host's calculus toggles, in the lobby. Spec: docs/specs/games/math-o-matic.md §3
 *
 * **Read-only for everybody who is not the host**, rather than hidden: a player
 * who is about to meet five-digit division deserves to see it coming, and a
 * panel that appears out of nowhere when you happen to be host is worse than
 * one that is simply not yours to touch.
 *
 * These are options, not modes — they travel in the `start` payload and never
 * in the mode slug, the same relationship Cat and Mouse's drag setting has.
 */
export function MathOptionsPanel({
  value,
  onChange,
  editable,
}: {
  value: Options;
  onChange: (next: Options) => void;
  editable: boolean;
}): JSX.Element {
  const text = useGameText();

  const label: Record<MathOp, string> = {
    '+': text({ en: 'Add', fr: 'Addition' }),
    '-': text({ en: 'Subtract', fr: 'Soustraction' }),
    '*': text({ en: 'Multiply', fr: 'Multiplication' }),
    '/': text({ en: 'Divide', fr: 'Division' }),
  };
  const glyph: Record<MathOp, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

  const toggle = (op: MathOp): void => {
    const on = value.ops.includes(op);
    const next = on ? value.ops.filter((o) => o !== op) : MATH_OPS.filter((o) => o === op || value.ops.includes(o));
    // The last operation cannot be unticked — the same shape as the lobby
    // refusing to start you alone (spec §3). Enforced here so the button is
    // visibly disabled rather than silently ignored.
    if (next.length === 0) return;
    onChange({ ...value, ops: next });
  };

  return (
    <div class="math-options">
      <fieldset class="math-options__group" disabled={!editable}>
        <legend class="math-options__legend">{text({ en: 'Operators', fr: 'Opérateurs' })}</legend>
        <div class="math-options__ops">
          {MATH_OPS.map((op) => {
            const on = value.ops.includes(op);
            return (
              <button
                key={op}
                type="button"
                class={`math-options__op ${on ? 'math-options__op--on' : ''}`}
                aria-pressed={on}
                aria-label={label[op]}
                // The last one on is not removable, so it says so rather than
                // shrugging.
                disabled={!editable || (on && value.ops.length === 1)}
                onClick={() => toggle(op)}
              >
                <span aria-hidden="true">{glyph[op]}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <Choice
        legend={text({ en: 'Digits per number', fr: 'Chiffres par nombre' })}
        value={value.digits[0]}
        choices={MATH_DIGIT_CHOICES}
        editable={editable}
        onChange={(n) => onChange({ ...value, digits: [n] })}
        describe={(n) => text({ en: `${n}-digit numbers`, fr: `nombres à ${n} chiffre${n > 1 ? 's' : ''}` })}
      />
      <Choice
        legend={text({ en: 'Operations per sum', fr: 'Opérations par calcul' })}
        value={value.operators[0]}
        choices={MATH_OPERATOR_CHOICES}
        editable={editable}
        onChange={(n) => onChange({ ...value, operators: [n] })}
        describe={(n) => text({ en: `${n} operation${n > 1 ? 's' : ''} per sum`, fr: `${n} opération${n > 1 ? 's' : ''} par calcul` })}
      />

      {!editable && (
        <p class="howto__aside">{text({ en: 'The host sets the sums.', fr: 'L’hôte règle les calculs.' })}</p>
      )}
    </div>
  );
}

/**
 * One of a few numbers, exactly one at a time: tapping a stop selects it and
 * there is nothing to untick, so it can never be empty. Digits and operations
 * per sum are single choices (spec §3); operators are the one set.
 */
function Choice({
  legend,
  value,
  choices,
  editable,
  onChange,
  describe,
}: {
  legend: string;
  value: number | undefined;
  choices: readonly number[];
  editable: boolean;
  onChange: (next: number) => void;
  describe: (n: number) => string;
}): JSX.Element {
  return (
    <fieldset class="math-options__group" disabled={!editable}>
      <legend class="math-options__legend">{legend}</legend>
      <div class="math-options__range" role="radiogroup" aria-label={legend}>
        {choices.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            class={`math-options__stop ${value === n ? 'math-options__stop--on' : ''}`}
            aria-checked={value === n}
            disabled={!editable}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <p class="math-options__readout">{value === undefined ? '' : describe(value)}</p>
    </fieldset>
  );
}
