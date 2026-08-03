import type { ComponentChildren, JSX } from 'preact';

/**
 * How to play: the concept, then the bullets.
 *
 * One component because this block appears in **three** places — the lobby, the
 * four-second pre-round panel, and the in-game gear menu — and all three must
 * show the same thing. Text comes from the game's registry entry and is never
 * retyped (docs/design/game-chrome.md §1).
 *
 * The concept leads because it is the thing you have to understand; the bullets
 * are the mechanics that follow from it. A player who grasps "shooing is not
 * free" can work out the rest, and one who only memorised the taps often
 * cannot.
 */
export function HowToPlay({
  concept,
  rules,
  /** `big` is the pre-round panel, which is read at arm's length in four seconds. */
  size = 'normal',
  children,
}: {
  concept: string;
  rules: string[];
  size?: 'normal' | 'big';
  children?: ComponentChildren;
}): JSX.Element {
  return (
    <div class={`howto ${size === 'big' ? 'howto--big' : ''}`}>
      <p class="howto__concept">{concept}</p>
      <ul class="rules">
        {rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {children}
    </div>
  );
}
