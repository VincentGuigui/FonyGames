import { hydrate, render } from 'preact';
import { Hub } from './hub/Hub';
import type { GameFlag } from '../../shared/flags';
import './core/ui/theme.css';
import './hub/hub.css';

/**
 * Mounts the hub.
 * Spec: docs/specs/seo.md §4
 *
 * Two modes, decided by what is already in the DOM:
 *
 * - **Served by `index.php`** — the grid is already there, rendered from the same
 *   components with the same flags, so this is a real `hydrate()`: Preact adopts the
 *   existing nodes instead of replacing them, there is no second paint, and the flags
 *   arrive *in the page* rather than in a fetch nobody has to wait for.
 * - **`vite dev`** — plain `index.html` with an empty `#app`, so `render()`.
 *
 * ## The branch is intent, not a workaround — measured, not assumed
 *
 * I first wrote this claiming that getting it wrong is silently broken. It is not, on the
 * Preact this project ships: both directions were tested in a real browser and both work.
 * `render()` over server markup does **not** throw it away — Preact 10 diffs against the
 * container's existing children and adopts the matching ones — and `hydrate()` into an
 * empty container renders all thirteen cards perfectly well.
 *
 * So the branch stays for two smaller, real reasons: `hydrate()` skips setting attributes
 * it can assume already match, which is the cheaper path on a phone; and it says which
 * situation the code believes it is in, which the next person reading it will want to
 * know. What it is NOT is load-bearing, and pretending otherwise would send someone
 * hunting for a bug that is not there.
 */

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

/**
 * The flags the server used, inlined by `index.php`.
 *
 * A `<script type="application/json">` rather than a global: its contents are never
 * executed, so a `reason` string containing `</script>` or a quote cannot become code.
 * Anything malformed means an empty map — every game active, the same fail-open rule as
 * everywhere else (`shared/flags.ts`).
 */
function inlinedFlags(): { flags: Record<string, GameFlag>; showAll: boolean } {
  const node = document.getElementById('fony-flags');
  if (!node?.textContent) return { flags: {}, showAll: false };

  try {
    const parsed = JSON.parse(node.textContent) as {
      flags?: Record<string, GameFlag>;
      showAll?: boolean;
    };
    return {
      flags: typeof parsed.flags === 'object' && parsed.flags !== null ? parsed.flags : {},
      showAll: parsed.showAll === true,
    };
  } catch {
    return { flags: {}, showAll: false };
  }
}

const { flags, showAll } = inlinedFlags();

// `firstElementChild`, not `innerHTML`: whitespace between tags is a text node, so a
// server-rendered page and a blank one both have child nodes but only one has an element.
const serverRendered = root.firstElementChild !== null;
const mount = serverRendered ? hydrate : render;

mount(<Hub flags={flags} showAll={showAll} />, root);
