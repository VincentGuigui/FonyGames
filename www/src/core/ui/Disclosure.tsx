import type { ComponentChildren, JSX } from 'preact';

/**
 * A panel that expands and collapses, with the panel heading as its control.
 *
 * Built on native `<details>`/`<summary>` rather than a button and a piece of state, which
 * buys three things for nothing: it works before hydration, the keyboard and screen-reader
 * behaviour is the platform's rather than ours to get wrong, and browser find-in-page can
 * open it to reveal a match.
 *
 * `open` is the *initial* state only — after that the element owns it. That is the point on
 * the two screens using this: How to play leads the chooser open, because you read the rules
 * before deciding to create or join, and arrives collapsed in the lobby, where you have read
 * them and want the room code and the player list instead.
 */
export function Disclosure({
  heading,
  open = false,
  children,
}: {
  heading: string;
  open?: boolean;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <details class="panel disclosure" open={open}>
      {/*
        `.panel__heading` keeps it typographically identical to the headings on the panels
        that do not collapse, so the lobby does not look like two kinds of section.
      */}
      <summary class="panel__heading disclosure__summary">
        {heading}
        <span class="disclosure__chevron" aria-hidden="true" />
      </summary>
      <div class="disclosure__body">{children}</div>
    </details>
  );
}
