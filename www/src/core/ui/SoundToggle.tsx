import type { JSX } from 'preact';

/** The same immediate mute toggle in every game's gear menu. */
export function SoundToggle({
  on,
  onChange,
  onLabel,
  offLabel,
  className,
  activeClassName,
  heading,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  onLabel: string;
  offLabel: string;
  className: string;
  activeClassName?: string;
  heading: string;
}): JSX.Element {
  return (
    <>
      <h3 class="gamemenu__label">{heading}</h3>
      <button
        class={`btn ${className} ${on && activeClassName ? activeClassName : ''}`}
        type="button"
        aria-pressed={on}
        onClick={() => onChange(!on)}
      >
        <span aria-hidden="true">{on ? '🔊' : '🔇'}</span>
        {on ? onLabel : offLabel}
      </button>
    </>
  );
}
