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
│ │ Pass the Bomb │ │Shake Rush│ │  2 columns from 380 px
│ │ pitch      │ │ pitch      │ │
│ │ 2–8·2min·📳│ │ 2–8·1min·📳│ │
│ └───────────┘ └───────────┘ │
│            …                │
└─────────────────────────────┘
```

- **Card anatomy and copy rules**: see
  [../design/ui-guidelines.md](../design/ui-guidelines.md) §3. One illustration,
  one catchy sentence, no exceptions.
- Cards are ordered: `live` first, then `soon` (dimmed, not tappable, no link).
  The order comes from `ORDER` in `games/registry.ts`, one entry per status.
- **The most-played game leads, wearing HOT.** One card moves — the rest keep the
  curated order. A shelf sorted entirely by popularity stops being curated and
  becomes a chart, with every new game buried at the bottom forever; lifting the
  single most-played one is the whole of the "what is everyone playing" signal
  without that. The counts come from `plays` in the published `flags.json`
  ([backoffice.md](backoffice.md) §7).
- **HOT replaces NEW** on that card. There is one badge slot, so the two are
  ranked rather than stacked: NEW says nobody has tried this yet, HOT says
  everybody has, and a card claiming both says nothing. A paused or unbuilt game
  never wears it — those badges are caveats, and a caveat outranks a boast.
- **A tie badges nobody**, and moves nobody. Two games on the same count means
  there is no single most-played game, and picking one by slug order would make
  the badge move for a reason no player could see. Same rule as the score panel's
  leader ([../design/game-chrome.md](../design/game-chrome.md) §6).
- The rule lives in `hottest()`/`promote()` in `shared/flags.ts`, and is
  **re-implemented in PHP** (`Flags::hottest`) because the server renders the grid
  and the client hydrates it — the two must agree exactly or Preact re-orders the
  page after paint. Both are asserted against the same table of cases.
- **One card wears WEEK automatically, from the calendar alone — no operator, no
  flag.** It is the ISO-8601 week number's own index into every `live` game,
  sorted alphabetically by its own (English) title: week 1 picks the first title,
  week 2 the second, and the rotation wraps once every game has had a turn. The
  same slug returns on the same calendar week every year — that repetition is
  the whole point, since it is what makes the rule nameable in one sentence
  rather than a schedule someone has to maintain. Sorted by the untranslated
  title specifically, so a French visitor and an English one see the same game:
  sorting *after* translation would give two languages two different orders.
- **WEEK is ranked below HOT and above NEW.** HOT is a measured fact — people are
  actually playing this — and always outranks a scheduled tag; NEW sits below
  WEEK so the rotation the maintainer asked for stays visible rather than
  quietly buried behind every game that also happens to be flagged new. Unlike
  HOT, **WEEK never moves the grid.** It only tags whichever card already sits
  at its curated (or hot-promoted) position — a schedule is not a popularity
  signal, and does not compete with one for the front of the shelf.
- The rule lives in `gameOfWeek()`/`isoWeek()` in `shared/flags.ts`, computed
  independently — never transmitted — by both the client (from `catalogue()` at
  render time) and the PHP build (`weekOrder()` in `scripts/ssr.mjs`, baked into
  `cards.php` once, since the list of live games' titles cannot change without a
  deploy anyway). **Re-implemented in PHP** (`Flags::gameOfWeek`/`Flags::isoWeek`)
  for the same reason HOT is: the server renders the grid, the client hydrates
  it, and the two must agree exactly. `gmdate('W')` already computes an ISO week
  number on the PHP side; the TypeScript side has to hand-roll the same rule,
  and both are asserted, date for date, against the same table of boundary
  cases (a year with 53 ISO weeks, a year beginning on a Sunday).
- **Runtime feature flags** can additionally grey out or hide a card; see
  [backoffice.md](backoffice.md) §2b. They are orthogonal to `status`, and the
  first paint is **already correct**: PHP applies them while rendering the page and
  inlines them for the client, so there is no fetch to wait for and no second
  render ([seo.md](seo.md) §4). An earlier design painted the compiled registry and
  reconciled afterwards, which briefly showed a disabled game as playable.
- Illustrations are lazy-loaded: `loading="lazy"` on an `<img>` with intrinsic
  `width`/`height`, so the box is reserved even if the stylesheet is late. The
  placeholder is the game's accent at 14%, painted by the element — it stays
  behind the transparent art after it loads, so it is one paint doing two jobs.
  See [../design/illustrations.md](../design/illustrations.md).

## 3. Filters (v1: minimal)

A single row of chips above the grid: `All` · `Same room` · `Outdoors` ·
`2 players`. Chips filter client-side on `GameCard` tags. No search box in v1 —
the catalogue is small enough to scan.

## 4. Navigation & URLs

| URL | Screen |
| --- | --- |
| `/` | Hub |
| `/<slug>/` | Join-or-create chooser ([join.md](join.md) §Landing on a game page) |
| `/<slug>/#<CODE>` | Join that room directly |
| `/about` | About sheet (also reachable from `[?]`) |

- Tapping a card goes straight to the game **lobby**, not to a rules page. Rules
  live in the lobby, in ≤ 3 bullets.
- The "Join with a code" field routes to the right game from the code alone: the
  server resolves `CODE → slug`, so a player pasting a code never needs to know
  which game their friends picked.
- **That field is one component**, `www/src/core/ui/JoinByCode.tsx`, shared by the hub
  and by every game's chooser — so the rule above holds in both places rather than
  being reimplemented in the second one.
- Back from a lobby returns to the hub without losing scroll position.

## 5. Data source

The catalogue is a **static list** built at compile time from each game's
`card.ts`. No API call on first load, and none afterwards either: the page arrives
with the flags in it. A game is added to the hub by adding its folder — the hub
imports the registry, it does not maintain its own copy.

*Which* of those cards the server puts in the HTML is decided per request from the
current flags, so hiding a game takes effect without a rebuild
([seo.md](seo.md) §4). The list is compile-time; the selection is not.

The order in `registry.ts` is the curated order from §2 and is **written out as
explicit imports**, not discovered by `import.meta.glob`: a glob is a Vite-only
transform that breaks any node-run test importing the registry, it is untyped, and
it would throw the ordering away.

## 6. Performance

- Hub first load ≤ 150 KB gzipped, illustrations excluded (budgets in
  [../architecture.md](../architecture.md)).
- No permission request, no sensor listener, no socket connection on the hub —
  the hub is inert until a card is tapped
  (see [../device-capabilities.md](../device-capabilities.md) §2.1).

## 7. States

| State | Behaviour |
| --- | --- |
| First visit | Grid + tagline; no modal. Activity is recorded from the first tap — [analytics.md](analytics.md) §1 |
| Offline | Cached shell + "You're offline" strip; cards render, tapping explains |
| Invalid room code | Inline error under the field: "No room with that code" |
| Empty catalogue | Impossible — build fails if the registry is empty |

## 8. About sheet

One short paragraph on what FonyGames is, the privacy line — positions and sensor
readings never leave your room, and what activity *is* recorded is the bounded,
disclosed exception in [analytics.md](analytics.md) §1, not "nothing" — the safety
line, and a link to the repository.

## 9. Open questions

- Curated order vs. "recently played" (needs local storage — is that acceptable
  under the no-storage stance? Proposal: allow *local-only* storage for
  preferences, never for game data).
- Does v1 need the filter chips at all, with fewer than 6 live games?
