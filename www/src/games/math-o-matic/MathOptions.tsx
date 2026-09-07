import type { JSX } from 'preact';
import {
  MATH_DIGITS_MAX,
  MATH_DIGITS_MIN,
  MATH_OPERATORS_MAX,
  MATH_OPERATORS_MIN,
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

      <Range
        legend={text({ en: 'Digits per number', fr: 'Chiffres par nombre' })}
        value={value.digits}
        min={MATH_DIGITS_MIN}
        max={MATH_DIGITS_MAX}
        editable={editable}
        onChange={(digits) => onChange({ ...value, digits })}
      />
      <Range
        legend={text({ en: 'Operators per sum', fr: 'Opérateurs par calcul' })}
        value={value.operators}
        min={MATH_OPERATORS_MIN}
        max={MATH_OPERATORS_MAX}
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
 * A two-ended range, as two number pickers rather than a slider pair.
 *
 * A double-thumb slider is a fiddly thing to hit with a thumb and there are at
 * most five stops, so the honest control is the stops themselves: tap the low
 * end, tap the high end. Dragging one past the other pushes rather than
 * refusing, which is what a player expects and what stops an empty range.
 */
function Range({
  legend,
  value,
  min,
  max,
  editable,
  onChange,
}: {
  legend: string;
  value: readonly [number, number];
  min: number;
  max: number;
  editable: boolean;
  onChange: (next: readonly [number, number]) => void;
}): JSX.Element {
  const text = useGameText();
  const stops = [];
  for (let n = min; n <= max; n++) stops.push(n);

  return (
    <fieldset class="math-options__group" disabled={!editable}>
      <legend class="math-options__legend">{legend}</legend>
      <div class="math-options__range" role="group" aria-label={legend}>
        {stops.map((n) => {
          const inside = n >= value[0] && n <= value[1];
          return (
            <button
              key={n}
              type="button"
              class={`math-options__stop ${inside ? 'math-options__stop--on' : ''}`}
              aria-pressed={inside}
              disabled={!editable}
              onClick={() => {
                // Nearest end moves to the tap, and pushes the other along if
                // it would cross it. Never produces a backwards range.
                const toLow = Math.abs(n - value[0]);
                const toHigh = Math.abs(n - value[1]);
                if (toLow <= toHigh) onChange([n, Math.max(n, value[1])]);
                else onChange([Math.min(n, value[0]), n]);
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
      <p class="math-options__readout">
        {value[0] === value[1]
          ? text({ en: `exactly ${value[0]}`, fr: `exactement ${value[0]}` })
          : text({ en: `${value[0]} to ${value[1]}`, fr: `${value[0]} à ${value[1]}` })}
      </p>
    </fieldset>
  );
}
