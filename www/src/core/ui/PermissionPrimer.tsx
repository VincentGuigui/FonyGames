import type { ComponentChildren, JSX } from 'preact';

/** Shared shell for a sensor explanation, its resolved state, and its one action. */
export function PermissionPrimer({
  heading,
  body,
  enabled = false,
  action,
  optOut,
}: {
  heading: string;
  body: ComponentChildren;
  enabled?: boolean;
  action?: { label: string; onClick: () => void };
  optOut?: ComponentChildren;
}): JSX.Element {
  return (
    <section class="panel primer">
      <h2 class="panel__heading">{heading}</h2>
      <p class={`primer__body ${enabled ? 'primer__body--on' : ''}`}>{body}</p>
      {action && (
        <button class="btn btn--primary primer__enable" type="button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {optOut && <p class="primer__opt-out">{optOut}</p>}
    </section>
  );
}
