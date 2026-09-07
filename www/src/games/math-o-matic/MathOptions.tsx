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
        <legend class="math-options__legend">{text({ en: 'Operations', fr: 'Opérations' })}</legend>
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

      <Stops
        legend={text({ en: 'Digits per number', fr: 'Chiffres par nombre' })}
        value={value.digits}
        choices={MATH_DIGIT_CHOICES}
        editable={editable}
        onChange={(digits) => onChange({ ...value, digits })}
      />
      <Stops
        legend={text({ en: 'Operators per sum', fr: 'Opérateurs par calcul' })}
        value={value.operators}
        choices={MATH_OPERATOR_CHOICES}
        editable={editable}
        onChange={(operators) => onChange({ ...value, operators })}
      />

      {!editable && (
        <p class="howto__aside">{text({ en: 'The host sets the sums.', fr: 'L’hôte règle les calculs.' })}</p>
      )}
    </div>
  );
}

/**
 * A set of stops, ticked one by one — the same control as the operations row
 * above it, and for the same reason.
 *
 * It was a two-ended range first, and that was the odd one out: three controls
 * on one panel, two of them nudged from the ends and one of them ticked. It
 * also could not say "two or four digits, never three", which is a perfectly
 * reasonable room. Tapping a stop toggles it; the last one on refuses to go,
 * exactly as the last operation does.
 */
function Stops({
  legend,
  value,
  choices,
  editable,
  onChange,
}: {
  legend: string;
  value: readonly number[];
  choices: readonly number[];
  editable: boolean;
  onChange: (next: readonly number[]) => void;
}): JSX.Element {
  const text = useGameText();
  const on = (n: number): boolean => value.includes(n);

  return (
    <fieldset class="math-options__group" disabled={!editable}>
      <legend class="math-options__legend">{legend}</legend>
      <div class="math-options__range" role="group" aria-label={legend}>
        {choices.map((n) => (
          <button
            key={n}
            type="button"
            class={`math-options__stop ${on(n) ? 'math-options__stop--on' : ''}`}
            aria-pressed={on(n)}
            // The last one on is not removable, so it says so rather than
            // shrugging.
            disabled={!editable || (on(n) && value.length === 1)}
            onClick={() => {
              // Kept in the game's own order rather than tap order, so the
              // readout below reads left to right.
              const next = on(n) ? value.filter((v) => v !== n) : choices.filter((v) => v === n || value.includes(v));
              if (next.length === 0) return;
              onChange(next);
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <p class="math-options__readout">
        {value.length === 1
          ? text({ en: `exactly ${value[0]}`, fr: `exactement ${value[0]}` })
          : value.length === choices.length
            ? text({ en: 'any', fr: 'au choix' })
            : value.join(', ')}
      </p>
    </fieldset>
  );
}
