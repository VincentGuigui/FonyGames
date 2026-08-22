# Analytics

Two separate systems, both added 2026-08-20, both covered by the revised privacy
boundary in [backoffice.md](backoffice.md) §1: **Cloudflare Web Analytics** (§2, a
third-party beacon, no server code) and a **custom activity log** (§3–§7, this
repository's own table and endpoint). Neither touches a position, a motion sample or a
mic level — those stay exactly as private as [device-capabilities.md](../device-capabilities.md)
§6 already says.

## 1. What changed, and the question this repository does not answer

Before this, [backoffice.md](backoffice.md) §1 drew the line at **anonymous aggregate
counters, full stop** — no visitor id, no name, nothing that could be traced to one
person across two events. That line is redrawn here, on the maintainer's explicit
instruction, to allow a bounded exception:

| Now allowed | Still never |
| --- | --- |
| A visitor id, in a cookie, tying events together across a visit and between visits | The IP address, in any form, at rest |
| A nickname, if the player has set one | A password, an email, or anything that identifies a real person by itself |
| City/country, resolved from the connecting address and then discarded | A position, a motion sample, a mic level, or anything from `device-capabilities.md` §1 |
| Which of six named actions happened, and to which game | Free-text of what a player typed, beyond the nickname |

This is a real reversal, not a refinement — a returning visitor is now traceable across
a session in a way the old boundary explicitly ruled out, and the hub's footer copy
changed to say so (`www/src/hub/Hub.tsx`, both languages in `core/i18n/strings.ts`).

**Left open, deliberately: consent.** A year-long visitor-id cookie tied to a
nickname and a city is the kind of thing some jurisdictions' cookie-consent or
GDPR-style rules would care about, and nothing in this build makes that determination —
no consent banner was added, and none should be inferred as unnecessary from its
absence. That is the maintainer's call to make with real advice, not a default this
spec sets by building around it quietly.

## 2. Cloudflare Web Analytics

A third-party beacon script, one per environment, injected at build time by
`scripts/beacon.mjs` (npm's `build:beacon`, between `build:ssr` and `build:api`) into
every built page's `</head>` — every game, and the hub's SSR shell
(`dist/_hub/page.html`).

- **The site tag is committed**, in `shared/hosts.json`'s
  `environments.<env>.webAnalyticsToken` — deliberately not a secret, because it ships
  in the HTML of every page a visitor can already view-source. It identifies a site to
  Cloudflare; it authorises nothing.
- **Chosen by `FONY_ENV`**, set by the deploy workflow from the branch name (`dev`/
  `prod`) and otherwise unset. No `FONY_ENV` means no beacon at all — a local
  `npm run build` reports nothing to anybody, which is also why there is no way to
  preview this locally beyond running the script by hand with the env var set.
- **The admin page is excluded** (`SKIP` in `beacon.mjs`) — it already carries
  `X-Robots-Tag: noindex` (`api/htaccess-admin`), and beaconing it would put the secret
  `ADMIN_PATH` into a Cloudflare dashboard as a page path.
- Read through the ordinary Cloudflare dashboard for the site — this repository has no
  code that reads it back. (The **Worker** usage numbers in §7's Cloudflare tab are a
  different Cloudflare product, `api/lib/Usage.php`, and were built long before this.)

## 3. The activity log

`analytics_event` (`db/init.sql`, `db/migrations/0004_analytics.sql`) — one row per
event, written by `api/lib/Analytics.php` through the public endpoint `api/analytics.php`.

| Column | From | Never |
| --- | --- | --- |
| `at` | The server's own clock | The client's clock — a phone's clock is often wrong and always forgeable |
| `visitor_id` | An HttpOnly cookie PHP mints on the first event, a year's `Max-Age` | Chosen or read by client script |
| `city`, `country` | The connecting address, resolved once through `Geolocator` and discarded | The address itself — see §3.1 |
| `referrer` | `document.referrer`, same-origin ones dropped client-side | — |
| `nickname` | Whatever `core/profile.ts` currently holds, if anything | Anything else typed anywhere in the app |
| `action`, `object` | One of six fixed strings, and a game slug or null | Free text |

### 3.1 The one rule that matters: no IP address, ever

`Analytics::callerIp()` reads the connecting address from the request. It is handed
straight to a `Geolocator` — `IpInfoGeolocator` (ipinfo.io, when `ipinfo_token` is
configured) or `NoGeolocator` (when it is not) — and then goes out of scope. `city` and
`country` are the only trace that survives; there is no column, no log line and no
cache keyed on the address anywhere in this path. The ipinfo request carries the
token as an `Authorization: Bearer` header and the current environment's public
FonyGames origin as `Referer`. That origin is selected by environment from
`shared/hosts.json`, never copied into the PHP client. `api/tests/analytics_test.php`
asserts the schema has no such column by name, and that a recorded row never contains
the test address as a substring.

### 3.2 The endpoint is intentionally open

`api/analytics.php` has no shared secret, unlike `api/played.php`. A secret shipped to
every browser is not a secret, and pretending otherwise would be worse than admitting
the endpoint is open. What bounds it instead:

- **A closed action vocabulary** — `Analytics::ACTIONS`: `hub_nav`, `game_select`,
  `room_create`, `room_join`, `game_start`, `game_played`. Anything else is a 400.
- **`object` must be a real slug** (`Flags::slug()`, the same validator the router and
  the flags table use) — refused rather than silently dropped, so a caller and this
  endpoint can never disagree about what happened.
- **Every string is capped** at its column width (`Analytics::text()`), so a request
  cannot be made large by being verbose.
- **A per-visitor rate limit** — `Analytics::RATE_LIMIT` events per
  `Analytics::RATE_WINDOW_MS`, read back from the table itself rather than a separate
  counter. Bounds an accident (a stuck client loop, an idle `curl`), not a determined
  abuser — anyone can drop the cookie for a fresh budget, and no comment here should be
  read as claiming otherwise.
- **A 204 with no body, on every path** — success, a rate limit, an unconfigured
  host, a database error, all look identical over the wire. Analytics must never be the
  reason a player sees something break, and the beacon is fire-and-forget on the client
  side too (§4), so there is nothing useful a real error body could tell it.

### 3.3 The operator's off switch

`analytics_enabled` in `config.php`, read by `App::analyticsEnabled()`. Defaults to on —
a host that has been given a database and a schema has opted in by that act, mirroring
`plays_token`'s own reasoning in `api/played.php`. Set to `false` and the endpoint keeps
answering 204 exactly as before; the client cannot tell the difference, and nothing
retries.

## 4. The client — `www/src/core/analytics.ts`

`track(action, object?)`, called at the six places in §7 where each of those actions
actually happens. Deliberately small:

- **Fire-and-forget.** Nothing awaits it, nothing retries, a failure is swallowed. The
  designed failure mode is a missing row, never a broken round.
- **`sendBeacon` first, `fetch` with `keepalive` as the fallback** — both survive the
  page unloading, which is exactly when the interesting events happen (tapping a card,
  leaving a finished round).
- **`text/plain`, not `application/json`, on the wire.** A JSON content type on
  `sendBeacon` triggers a CORS preflight, and a preflight during page unload is the one
  request that does not get to happen. PHP reads the raw body and decodes it itself, so
  the declared type never mattered to that side.
- **Respects Do Not Track and Global Privacy Control** (`isRefused()`). Not required by
  anything technical — a choice, the same one `device-capabilities.md` already makes
  about sensor permissions. A player who has set either gets no rows at all, so the
  dashboard undercounts by design; that is written down here so nobody later reads a dip
  as a bug.
- **The referrer is computed fresh on every call**, not cached at import time
  (`externalReferrer(document.referrer, location.origin)`) — `document.referrer` never
  changes after the document loads, so there was nothing to gain from caching it, and
  reading it lazily is what keeps the module importable, and its two pure helpers
  (`isRefused`, `externalReferrer`) unit-testable, without a DOM
  (`www/src/core/analytics.test.ts`).

## 5. Adding a seventh action

Add it to `Analytics::ACTIONS` in `api/lib/Analytics.php` and to the `AnalyticsAction`
union in `www/src/core/analytics.ts`, matching strings. `api/tests/analytics_test.php`
reads the client file as text and fails if the two lists disagree — the same technique
`config_test.php` uses for config keys, for the same reason: a silent rename is a
silently dropped event.

## 6. The stats queries — `Analytics::summary()`

One method, and everything it returns is a `COUNT` or a `GROUP BY` — there is no
"events for visitor X" query anywhere in this class, on purpose. That is how the
boundary in §1 ("aggregate to the operator, never a list of what one visitor did") is
actually enforced: not by a check inside the method, but by the method never being
*shaped* to answer the other question.

- **`totals`** — one count per action, over a window (`?days=`, clamped to
  `Analytics::SUMMARY_MAX_DAYS`).
- **`uniqueVisitors`** — `COUNT(DISTINCT visitor_id)`.
- **`topGames`** — every slug that appears as an `object`, with a count per action,
  ranked by `game_played`. Keyed on the slug as it was reported, not joined against the
  live catalogue, so a renamed or removed game still shows its history.
- **`countries`** — the ten most common non-null country values.
- **`cities`** — up to ten cities for each country in that master list, carrying
  their country code so the UI can present a country master table and city detail.
- **`referrers`** — grouped by **host**, not the exact URL (`referrerHosts()`, via
  `parse_url()`). A raw referrer is close to unique per visit; the host
  ("came from a link on x.com") is the aggregate that means something.

## 7. Stats — `www/src/ops.ts`

A **stats** link on the main admin page opens the dedicated relative route
`stats/` under the deployed secret admin directory (`/<ADMIN_PATH>/stats/`). It
is a separate Vite page, remains protected by the same HttpOnly session and
inherits the admin directory's noindex/no-store headers. The screen has two tabs:

- **Cloudflare monitoring** — the health checks and Cloudflare Worker usage that used
  to share the main flags page. Moved here because both make outbound calls with their
  own timeouts, and the flag switches must stay usable regardless of how those are
  going — exactly the reasoning `loadUsage()` already gave for loading them apart from
  everything else; only the page they load into changed.
- **Analytics** — `loadAnalytics()`, a 7/30/90-day window selector over
  `?a=analytics&days=N`. Per-game analytics are a client-side sortable table;
  changing a sort header makes no new request. Countries form a master table,
  and selecting one displays its sortable city detail table. Referrers remain
  aggregated by host. A linked child route `stats/diagnostic/` includes an
  authenticated IPinfo diagnostic for `8.8.8.8`, showing the configured Referer,
  response status and detailed parsed response without exposing the token.

Full page replace on every tab or window switch, the same style `signIn()`/`render()`
already use elsewhere in this file — one user, and the cost of tracking which half of
the DOM changed was never worth it here.

### The six actions and where each one fires

| Action | Fires |
| --- | --- |
| `hub_nav` | The hub mounting (`Hub.tsx`, once per real page load — never during `scripts/ssr.mjs`'s build-time render, since `useEffect` only runs on the client) |
| `game_select` | Once per game page load, in `RoomGate`'s own mount effect — the one component every game's page passes through |
| `room_join` | The same `RoomGate` effect, only when that load arrived with a code already in the URL — a followed link and a same-page-but-different-game code redirect look identical from here, and both are a join; **or** typing a code for the *same* game into `JoinByCode`'s Join tab (`RoomChoice`) |
| `room_create` | The chooser's Create button (`RoomChoice`) |
| `game_start` | The lobby's Start button (`GameLobby`), and the end screen's Play again / Next round button (`GameOver`) |
| `game_played` | The end screen (`GameOver`) mounting — it is remounted once per round, so mounting *is* the event, the same reasoning its own `useSettled()` already relies on |
