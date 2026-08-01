# Hub specification

The hub is the site's entry point: a single screen that makes a stranger want to
play something in under ten seconds.

> Status: **draft**, awaiting validation.

## 1. Purpose

- Show the catalogue of games as a grid of cards.
- Let a player start or join a game in **≤ 3 taps** from opening the link.
- Carry zero game logic. The hub knows only `GameCard` metadata
  (see [../architecture.md](../architecture.md)).

## 2. Screen

```
┌─────────────────────────────┐
│ FonyGames            [?]    │  header: wordmark + about sheet
│ Silly games for the phone   │  tagline, one line
│ in your pocket.             │
│                             │
│ [ Join with a code  ____ ]  │  always visible: paste/type a room code
│                             │
│ ┌───────────┐ ┌───────────┐ │
│ │illustration│ │illustration│ │  1 column on narrow phones,
│ │ Bump Relay │ │Shake Sprint│ │  2 columns from 380 px
│ │ pitch      │ │ pitch      │ │
│ │ 2–8·2min·📳│ │ 2–8·1min·📳│ │
│ └───────────┘ └───────────┘ │
│            …                │
└─────────────────────────────┘
```

- **Card anatomy and copy rules**: see
  [../design/ui-guidelines.md](../design/ui-guidelines.md) §3. One illustration,
  one catchy sentence, no exceptions.
- Cards are ordered: `live` first (most-played-looking order is fine — a fixed
  curated order for now), then `beta`, then `soon` (dimmed, not tappable, no
  link).
- Illustrations are lazy-loaded; a coloured placeholder holds the space so the
  grid never jumps.

## 3. Filters (v1: minimal)

A single row of chips above the grid: `All` · `Same room` · `Outdoors` ·
`2 players`. Chips filter client-side on `GameCard` tags. No search box in v1 —
the catalogue is small enough to scan.

## 4. Navigation & URLs

| URL | Screen |
| --- | --- |
| `/` | Hub |
| `/<slug>/` | Game lobby (creates or joins a room) |
| `/<slug>/#<CODE>` | Join that room directly |
| `/about` | About sheet (also reachable from `[?]`) |

- Tapping a card goes straight to the game **lobby**, not to a rules page. Rules
  live in the lobby, in ≤ 3 bullets.
- The "Join with a code" field routes to the right game from the code alone: the
  server resolves `CODE → slug`, so a player pasting a code never needs to know
  which game their friends picked.
- Back from a lobby returns to the hub without losing scroll position.

## 5. Data source

The catalogue is a **static list** built at compile time from each game's
`card.ts`. No API call on first load. A game is added to the hub by adding its
folder — the hub imports the registry, it does not maintain its own copy.

## 6. Performance

- Hub first load ≤ 150 KB gzipped, illustrations excluded (budgets in
  [../architecture.md](../architecture.md)).
- No permission request, no sensor listener, no socket connection on the hub —
  the hub is inert until a card is tapped
  (see [../device-capabilities.md](../device-capabilities.md) §2.1).

## 7. States

| State | Behaviour |
| --- | --- |
| First visit | Grid + tagline; no modal, no cookie banner (nothing is stored) |
| Offline | Cached shell + "You're offline" strip; cards render, tapping explains |
| Invalid room code | Inline error under the field: "No room with that code" |
| Empty catalogue | Impossible — build fails if the registry is empty |

## 8. About sheet

One short paragraph on what FonyGames is, the privacy line ("nothing is stored,
positions never leave your room"), the safety line, and a link to the
repository.

## 9. Open questions

- Curated order vs. "recently played" (needs local storage — is that acceptable
  under the no-storage stance? Proposal: allow *local-only* storage for
  preferences, never for game data).
- Does v1 need the filter chips at all, with fewer than 6 live games?
