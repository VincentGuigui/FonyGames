# Code style

> Applies to everything under `www/`. Tooling (linter/formatter) is proposed in
> [../architecture.md](../architecture.md) and not yet installed — the rules
> below hold regardless of tooling.

## Language

- **TypeScript**, `strict: true`. No `any` without a comment saying why.
- ES modules only. No default exports (named exports grep better).
- Prefer plain functions and plain objects over classes; classes are fine for
  long-lived stateful things (a room client, a game loop).
- No dependency without maintainer validation (AGENTS.md §3.3). The bar is
  high: if it's < 100 lines, write it.

## Naming

| Thing | Convention | Example |
| --- | --- | --- |
| Files & folders | kebab-case | `bump-relay/`, `room-client.ts` |
| Game slug | kebab-case, matches folder and URL | `tilt-arena` |
| Functions, variables | camelCase | `startRound` |
| Types, interfaces | PascalCase, no `I` prefix | `GameCard` |
| Constants | SCREAMING_SNAKE | `BUMP_THRESHOLD` |
| Network message types | short lowercase strings | `'join'`, `'bump'` |
| CSS classes | BEM-ish, kebab-case | `.game-card__pitch` |

## File layout

- One game per folder under `www/src/games/<slug>/`; a game never imports from
  another game.
- Shared code lives in `www/src/core/`. If two games need the same thing, it
  moves to `core/` in a `refactor:` commit.
- Keep files under ~300 lines. Split by responsibility, not by arbitrary size.

## CSS

- Plain CSS with custom properties for the theme; no preprocessor.
- Design tokens (`--color-*`, `--space-*`, `--radius-*`) declared once in
  `core/ui/theme.css`. Never hardcode a colour in a game.
- Mobile-first; media queries only to *add* for larger screens.
- Use `dvh`, `env(safe-area-inset-*)`, `clamp()` for type.
- **To move content along a flex column, use `justify-content`.**
  `align-content` does nothing to a **single-line** flex container, so on the usual
  full-screen `flex-direction: column` game screen it silently has no effect — the
  rule looks right, reads right in review, and changes nothing. It cost time twice
  on the duel screens, where centred text sat on top of the target.

## Game art and cards

- **A `card.ts` is a leaf.** It may import only `core/types`, `shared/players` and
  its own `art/`. The hub imports every card, so one import of a game's runtime
  drags every game into the hub chunk — `www/src/games/cards.test.ts` guards it.
- **Art is a file, never inline SVG in a component.** `games/<slug>/art/*.svg`,
  imported with `?url&no-inline`. And it uses literal hexes: an `<img>`-loaded SVG
  cannot see the page's CSS, so `currentColor` renders black and `var(--…)`
  disappears. Full contract: [../design/illustrations.md](../design/illustrations.md).

## Game code rules

- **The loop**: one `requestAnimationFrame` loop per game, driven by delta time.
  Never assume 60 fps.
- **State**: a single plain state object per game; render is a function of
  state. No state hidden in the DOM.
- **Derived UI is read during render, never copied out on a timer.** A HUD that
  polls (`setInterval(() => setPucks(game.pucks))`) is wrong twice: it lags the
  event that changed the number by up to a tick, and a backgrounded tab throttles
  the interval so the count freezes outright while the game carries on. Read the
  game object where you draw it. Both Sling Puck's and Spill's counters shipped as
  polls first and had to be undone.
- **Sensors**: subscribe through `core/sensors/*` only, always unsubscribe on
  round end and on `visibilitychange`. A leaked motion listener is a bug.
- **Network**: go through `core/room/*`. Games never open their own socket.
- **Timers**: derive from server time (see [../multiplayer.md](../multiplayer.md)).
  `setInterval` for gameplay timing is forbidden — it drifts and stalls when
  backgrounded.
- **No blocking work** on the main thread during a round; keep frames < 16 ms.

## Comments

- Explain *why*, not *what*. Sensor thresholds, platform quirks and fairness
  compromises must be commented with the reason and the device it came from.
- `TODO(<topic>):` only with an issue or a roadmap line to point at.
