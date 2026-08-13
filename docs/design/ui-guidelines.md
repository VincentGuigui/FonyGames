# UI / UX guidelines

Party games on a phone, held with one hand, in a noisy room, by someone who has
never seen the site before. Design for that.

## 1. Layout

- **Portrait first.** Landscape is only allowed if a game explicitly needs it,
  and it must say so in its spec with a rotate prompt.
- **Thumb zone**: primary actions in the bottom third, full-width, ≥ 56 px tall.
  Never put the main action at the top of the screen.
- **Safe areas**: respect `env(safe-area-inset-*)`. No content under notches or
  home indicators.
- **Viewport**: `100dvh`, not `100vh` (mobile browser chrome). No page scroll
  during a round — a game screen is a fixed canvas.
- **One decision per screen.** Hub → pick game. Lobby → pick mode / start.
  Round → play. Results → play again.

## 2. Type & colour

- System font stack; no webfont on first load (payload + FOUT).
- Minimum body size 16 px (also prevents iOS input zoom). Scores and timers are
  huge — readable at arm's length, on a table, by three people at once.
- Dark background by default (battery on OLED, works in a bar at night), with a
  bright accent per game. Each game may own an accent colour, declared in its
  spec; the hub stays neutral.
- **Contrast ≥ 4.5:1** for text. Never encode game state by colour alone —
  always pair with a shape, icon or label (colour-blind players exist and party
  games are fast).

## 3. Game card (hub) — anatomy

A card is a **promise in one glance**:

```
┌───────────────────────────┐
│                           │
│      ILLUSTRATION         │  explicit: you can guess the game from it alone
│                           │
├───────────────────────────┤
│ Pass the Bomb                │  title
│ Smash phones together to  │  ONE catchy sentence, ≤ 60 chars, no period
│ pass the bomb.            │
│ 2–8 · 1–2 min · 📳 motion │  players · duration · input icons
└───────────────────────────┘
```

Rules:
- Exactly **one illustration** and **one sentence**. No paragraph, no feature
  list, no "learn more".
- The sentence says what *you do*, in the second person or the imperative.
  "Shake like your life depends on it" ✅ — "A fun shaking game" ❌.
- Illustrations share a single style (see §6) and a 4:3 ratio.
- Cards show a `soon` or `new` badge; a `soon` card is not tappable. `new` is a
  **sales** label, not a maturity claim — the hub's job is to make someone tap, and
  "beta", which this replaced, reads as *might be broken*. Where a game actually
  stands ("playable, but the balance numbers are guesses") belongs in its spec's
  Status row, which is honest and which nobody browsing the hub reads.

## 4. Motion & feedback

- Every tap gets feedback within 100 ms: press state, haptic (where available),
  or sound.
- Animations ≤ 200 ms, and all of them respect
  `@media (prefers-reduced-motion: reduce)`.
- Countdown before any physical action: **3 · 2 · 1**, big, with sound and
  vibration. Nobody should be surprised into swinging their phone.
- Results screen always names a winner, celebrates loudly, and offers
  "Play again" as the primary button.

## 5. Copy

- Short, playful, never smug. Two-word buttons: "Play again", "Copy link".
- Rules explained in ≤ 3 bullets, shown once in the lobby, re-openable via "?".
- Error copy says what to do next: "No GPS signal — step outside or try Same
  Room mode."
- Language: English first. Any i18n decision goes through
  [../roadmap.md](../roadmap.md).

## 6. Illustration style

- One consistent style across the catalogue: flat, bold shapes, thick outlines,
  high contrast on dark, minimal detail (it must read at 160 px wide).
- Show **the action**, not a logo: two phones tapping, a tilted phone, a runner
  on a map.
- Format: SVG when possible, otherwise WebP; ≤ 40 KB each; lazy-loaded below the
  fold; `alt` text describing the action — and the `alt` is **required by the
  type**, as `GameCard.art.alt`, so it cannot be forgotten.
- Each game's illustration is `www/src/games/<slug>/art/card.svg`, `viewBox="0 0
  120 90"`, transparent, and **literal hex colours only** — no `currentColor` and
  no CSS variables, because it is loaded through `<img>` and cannot see the page's
  stylesheet. Mechanics, and the phone glyph's fixed outline weight:
  [illustrations.md](./illustrations.md).

## 7. Accessibility floor

- Everything reachable by tap; no gesture is the *only* way to do something
  (except the game mechanic itself).
- A game mechanic **should** declare a touch fallback. Where one is deliberately
  not offered, the game's spec must say so explicitly and name who that excludes.
- Focus states visible; buttons are `<button>`; the hub grid is a list.
- No flashing above 3 Hz.
- Sound is never required to play — every audio cue has a visual twin.
