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
          <li key={r}>{highlighted(r)}</li>
        ))}
      </ul>
      {children}
    </div>
  );
}

/**
 * A rule can colour one of its own words to match the board — Grid Attack's
 * "green"/"purple" name its two grids, and colour is the one thing a player
 * reading four short lines at arm's length cannot get from the word alone
 * (docs/design/ui-guidelines.md §2: colour reinforces the label, never
 * replaces it, and the word is what carries the meaning here regardless).
 *
 * `{{#hex|word}}` in the source string renders `word` in that colour; a rule
 * with no marker passes through untouched, which is every rule for every
 * other game. The colour travels inside the marker rather than through a CSS
 * variable such as `--game-accent`, because this same string also renders
 * inside `GameMenu`'s sheet, and a sheet mounted through a portal is not
 * guaranteed to inherit a custom property set on the board underneath it.
 */
function highlighted(text: string): ComponentChildren {
  if (!text.includes('{{')) return text;

  const marker = /\{\{(#[0-9a-fA-F]{6})\|([^}]+)\}\}/g;
  const parts: ComponentChildren[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <span key={match.index} style={{ color: match[1] }}>
        {match[2]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));

  return parts;
}
