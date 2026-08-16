import type { ComponentChildren, JSX } from 'preact';

/**
 * A panel that slides up from the bottom over whatever was there.
 *
 * Extracted from `GameMenu`, which had the only one, the moment a second thing needed the
 * same behaviour — the lobby's "Change" sheet. Copying fifteen lines of scrim positioning
 * would have meant two places deciding what a sheet is, and the second copy would have
 * been the one that forgot the tap-outside-to-close or the safe-area padding.
 *
 * Three things it is responsible for and a caller is not:
 *
 * - **A tap outside closes it.** The usual sheet behaviour, and it means a mis-tap costs
 *   nothing. It is a `<button>` rather than a div with a handler so it is reachable
 *   without a pointer.
 * - **It does not cover the whole screen.** Seeing the page behind it is what makes it
 *   read as a pause rather than as having gone somewhere else.
 * - **The bottom padding clears the home indicator**, which is the sort of thing that is
 *   correct in the component everybody uses and forgotten in the copy.
 *
 * What it does NOT do is trap focus or handle Escape. Neither is right to add here
 * without also adding it to every other overlay in the app, and both are the kind of
 * half-measure that reads as done — see the note in docs/design/game-chrome.md §7.
 */
export function Sheet({
  label,
  onClose,
  children,
}: {
  /** Names the dialog for a screen reader. Usually the heading inside it. */
  label: string;
  onClose: () => void;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <div class="sheet">
      <button class="sheet__scrim" type="button" aria-label="Close" onClick={onClose} />
      <div class="sheet__panel" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
