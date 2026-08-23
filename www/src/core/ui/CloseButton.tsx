import type { JSX } from 'preact';

export function CloseButton({ label, onClose }: { label: string; onClose: () => void }): JSX.Element {
  return (
    <button class="sheet__close" type="button" aria-label={label} onClick={onClose}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
        <path d="M5 5l14 14M19 5L5 19" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
      </svg>
    </button>
  );
}
