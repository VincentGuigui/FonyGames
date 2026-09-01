# Backoffice

A private operator view: is it up, what is it costing, and is anyone playing.

> Status: **specced, being built.** Roadmap M8. The privacy boundary in §1 is agreed
> *before* anything starts collecting.
>
> **This lives in PHP on the web host, not in the Worker.** A first implementation
> put the flags in a Durable Object and hand-rolled sessions, magic links and a
> mailer hop inside it; on 2026-08-06 that was judged over-built and moved to PHP,
> where the platform supplies all three. §2b, §4 and §5 record what changed and why,
> and [../roadmap.md](../roadmap.md) carries the decision row. The Worker keeps
> exactly one job here: **enforcing** a flag when a room is opened.

## 1. The privacy boundary — read this first

This line moved on 2026-08-20, on the maintainer's explicit instruction — see
[analytics.md](analytics.md) §1 for the reversal and the reasoning, rather than
repeating it here. What stands today:

| Allowed | Never |
| --- | --- |
| Rounds started / finished, per game | Any position or sensor reading — coordinates, motion samples, mic levels |
| Peak concurrent rooms, error counts | The IP address, in any form, at rest |
| A per-visitor id, a nickname, city/country, a referrer — [analytics.md](analytics.md) §3 | Anything that identifies a real person on its own (a password, an email) |
| Which of six named actions happened, and to which game | Per-room history after the room dies |

**Positions and sensor readings are the one line that never moved.** The hub's
footer still says so, and still means it literally
([device-capabilities.md](../device-capabilities.md) §6). What changed is the other
half of the old sentence — "nothing you do is stored" no longer holds, and the
footer's copy was rewritten to say what actually happens instead of a promise this
backoffice would otherwise be breaking quietly.

## 2. What it shows

### Health
- Worker `/health` for `fonygames-worker-dev` and `fonygames-worker`.
- Site reachability for both hosts.
- **Deployed revision**, read from the `.deploy-revision` file the deploy
  already writes to the web root ([deployment.md](../deployment.md) §5) — so
  "what is actually live" needs no extra plumbing.

### Cloudflare usage
Durable Object requests and duration against the free-tier ceilings modelled in
[realtime-options.md](../realtime-options.md) — 100k requests/day and
13,000 GB-s/day, roughly 4,100 heavy rounds a month. The point is an early
warning before the free tier runs out, not pretty graphs.

> Needs a **second API token with `Account Analytics: Read`**. The deploy token
> is scoped to *Edit Cloudflare Workers* and deliberately cannot read analytics —
> do not widen it; mint a separate read-only token.

### Play counter — ✅ built, resolved this section's original question
`games.plays` (the `Shared secret` row below), covered in full in §7. One counter, no
completion rate, no peak concurrent rooms — it answers "which game is played most",
not the fuller question this section originally asked.

### Activity stats — ✅ built, a different answer to the rest of that question
Per game and site-wide: card taps, rooms created and joined, rounds started and
finished, over a 7/30/90-day window, plus where visitors are roughly coming from.
It lives at `/<ADMIN_PATH>/stats/`, with sortable game columns and country/city
master-detail tables. Full design: [analytics.md](analytics.md).

**Not the design below.** That design blocked on authenticating a
Durable-Object-to-PHP write without a second shared secret (`MAIL_SECRET`'s own
mistake, §5) — and it stayed blocked, because `api/analytics.php` solves a different
problem instead: the browser reports its own activity, over an endpoint with **no
secret at all**. That is the `Unauthenticated endpoint` row below, chosen on purpose
once the boundary in §1 was redrawn to allow more than an aggregate counter — the
reasoning for why an open endpoint is an acceptable trade here, and what actually
bounds it, is in [analytics.md](analytics.md) §3.2.

The options originally weighed, kept for the record:

| Option | Cost |
| --- | --- |
| **Shared secret** (`STATS_SECRET`) | Reintroduces the two-copy drift this design just removed. The only option that authenticates the write — used for the play counter above, not for the activity log |
| **Unauthenticated endpoint** | No secret; anyone can post events. Bounded by an action allowlist and a per-visitor rate limit rather than by authentication — **built**, see analytics.md §3.2 |
| **Cloudflare analytics only** | Also built, as a separate system (§2 above) — request volume per Worker/site, no per-game or per-action granularity |
| **Skip it** | Superseded by the maintainer's decision to build the activity log instead |

**Health and Cloudflare usage are built and need none of this** — both are read-only
outbound calls from PHP, with no new credential and nothing to keep in step.

## 2b. Feature flags — turning games on and off

The operator can switch each game between four states **at runtime**, without a
commit or a deploy. A game is exactly one of these — never two at once (see §5,
"One state, not two fields").

| State | On **prod** | On **dev** |
| --- | --- | --- |
| `new` | Shown and playable, badged *new* (or HOT/WEEK if either applies) | Same |
| `active` | Normal: shown and playable | Shown and playable |
| `soon` | Shown, **greyed out, not playable**, optional short reason | **Shown and playable**, with a badge reading *soon* (or the reason, once set) |
| `hidden` | **Absent from the hub** entirely, and not reachable | **Shown**, with a badge reading *hidden* |

**dev always shows everything**, with the badge stating what prod would do.
That makes dev a preview of the catalogue rather than a copy of prod's
restrictions — deliberately so, since dev exists to try things. The cost is
that dev does not reproduce prod's blocking behaviour; if you need to verify
the block itself, check prod or read the Worker logs — or, signed in as the
admin on dev, flip the hub's own `Prod preview` chip (docs/specs/hub.md §3),
which asks nothing of the server and only changes what this one browser tab
renders.

### Why the hub cannot enforce this on its own

Hiding a card is **cosmetic**. A bookmarked or shared
`/tap-duel/#AB2C` goes straight to the lobby and never consults the grid. So the
state is enforced in **two places**, and the Worker is the one that counts:

| Layer | Role |
| --- | --- |
| Hub | Presentation — hides or greys the card |
| **Worker** | **Enforcement** — refuses to open a room for a non-active game |

### The flag and `status` are different axes

`status` (`soon` / `beta` / `live`) is build-time intent: *how finished is this
game*. The flag is runtime state: *may it be played right now*. They do not
override each other — a `beta` game can be `active`, and a `live` game's flag can
be set to `soon` for maintenance. The card renders on the stricter of the two
(`cardState` in `shared/flags.ts`) — which is also why the runtime state reuses
the word `soon` rather than keeping the old `disabled`: both are the same kind of
caveat to a player, whether the code doesn't exist yet or the operator paused it.

### Where the flags live

**MySQL is the source of truth, and PHP is the only writer.** Every admin write
also regenerates a flat `flags.json` in the web root, which is what everything
reads:

```
admin (PHP) ──write──> MySQL ──regenerate──> web-root/flags.json
                                                 │
                     index.php, per request  <───┤   (inlined into the page — spec seo.md §4)
                     the Worker, HTTPS + 60 s in-memory cache  <┘
```

| Reader | How | Why that way |
| --- | --- | --- |
| The hub | PHP reads the file on the same disk and **inlines the flags into the page** | No request, no CORS, and no paint-then-reconcile flicker |
| The Worker | `fetch` of `flags.json`, cached ~60 s in memory, last good copy served on error | It is the only thing that can enforce (below), and it is cross-origin |

**A flat file rather than a PHP endpoint on the read path**, because the Worker's
read sits on room-open, which shares the ±250 ms budget. A shared-host
PHP + MySQL round trip per room open is the one place that latency would show. The
file is served by the web server and cached in the Worker anyway.

**This reverses an earlier decision.** Until 2026-08-06 the flags lived in a
singleton Durable Object, and this document argued MySQL *could not* be the source
of truth because the Worker cannot reach it ([../database.md](../database.md) §3).
That was true and is now beside the point: once the writer is PHP, the constraint
applies to the writer's neighbour rather than to the writer. The Worker never
touches MySQL — it reads a file over HTTPS, which is the topology database.md §3
already sanctions. See [../roadmap.md](../roadmap.md) for the full decision row.

### Nothing populates `games`, and that is the design

An **absent row means the default** — `active`, not new. A row appears the first time
you change that game, and disappears from nobody's concern if you never do. So a
**working, untouched install has an empty table**, which is worth stating because it
looks broken: you go and look in phpMyAdmin after a migration and there is nothing
there.

Sparse rather than seeded, for two reasons. Nothing drifts when a game is added or
removed — no seed row to remember, no orphan left behind — and the default exists in
exactly one place, `Flags::default()`, rather than in both the schema and the code.

The admin centre says as much, and distinguishes the one state that *is* a fault:

| State | What it means |
| --- | --- |
| no rows, no `flags.json` | Untouched install. Every game active, which is the default |
| `flags.json` published and empty | Same, and the Worker has a file to read |
| rows, and a `flags.json` holding them | Normal operation |
| **rows but NO `flags.json`** | **A failed publish.** The Worker enforces the old answer while this page shows the new one — the only one of these that is loud |

### Behaviour details

- **In-flight games finish.** Disabling blocks *new* rooms; a duel already
  running is never interrupted. Concretely the Worker refuses a connection for a
  non-active game **unless that room already has a connected player**.
- **The hub never waits for the flags, and never reconciles them.** They arrive
  inlined in the server-rendered page ([seo.md](seo.md) §4), so the first paint is
  already correct and there is no second render. This replaces the earlier
  paint-then-fetch-then-reconcile design, which briefly showed a disabled game as
  playable.
- **Unknown slug, or the flags unreadable → treated as `active`.** Fail-open, on
  purpose: a Worker hiccup must not blank the whole catalogue. The consequence
  is that a flag is **not** a security control — for something genuinely
  dangerous, remove the game and deploy. Written here so nobody later mistakes
  it for one.

## 2c. Schema management

The admin centre runs the migrations, so a schema change does not need a shell on the
host. `api/lib/Migrator.php` is the runner; `db/migrate.php` is the same runner from a
command line ([../database.md](../database.md) §5), and the deploy calls the same
endpoint after it uploads.

| Action | Auth | Purpose |
| --- | --- | --- |
| `GET ?a=schema` | session or `ADMIN_TOKEN` | Applied and pending migrations |
| `POST ?a=migrate` | session or `ADMIN_TOKEN` | Apply pending, then republish `flags.json` |

### The bootstrap problem, and the one deliberate pre-auth answer

**On an empty database you cannot sign in to run the migration that lets you sign in.**
Requesting a magic link writes a rate-limit attempt to `admin_link_attempt`, a table the
migrations create. `Auth::authorisedByToken()` touches no table, so `ADMIN_TOKEN` is the
way in, and the page offers a field for it.

For the page to *know* to offer that field, `?a=schema` answers **one question without
credentials: whether the schema is installed.** It carries no applied list and stops
answering the moment the schema exists. What it gives away is one bit, to somebody who
already has the secret admin path and can therefore already see a login form — and
without it the first run is a dead end.

After a successful run the page hands off to the normal sign-in, because the magic link
works from that moment on.

### "Unreachable" is not "not installed"

Three states, and the page says which — they used to collapse into one:

| State | Answer |
| --- | --- |
| Connected, tables absent | `503 schemaMissing` + the pending list → the bootstrap panel |
| **Cannot connect at all** | `503 dbUnreachable`, plus `dbError` for an authorised caller |
| Connected, tables present | the action's normal answer |

`Migrator::installed()` used to return false for *any* error, so a wrong DSN produced the
bootstrap panel — offering to migrate a server that could not be reached, which is the
wrong fix presented confidently. Only SQLSTATE `42S02` means absent now
([../database.md](../database.md) §4).

The `dbError` string is the driver's own message and it **names the database user and
host**, so it is included only once the caller has been authorised. The anonymous
pre-auth probe gets `dbUnreachable` and nothing more.

Two orderings make this work, and both are load-bearing rather than stylistic:

1. **Token authorisation is settled before anything opens the connection.** Building an
   `Auth` constructs a `PdoAuthStore`, so `App::auth()` is where an unreachable database
   first throws — above every handler in `api/index.php`. `App::tokenMatches()` answers
   from config alone, so the failure that follows can name itself to the caller entitled
   to hear it. That caller is usually the deploy.
2. **`catch (PDOException)` precedes `catch (RuntimeException)`**, because `PDOException`
   extends it. Without that, a missing table was reported as *"the mailer refused the
   message"* — the most misleading answer available, since it sends the operator to check
   their mail configuration.

An uncaught throwable is worse than either: on a host with `display_errors` off it is a
**500 with an empty body**, which is what made the first deploy of `?a=migrate`
undiagnosable from CI. `api/index.php` now installs an exception handler and a shutdown
handler above its own `require`, and `api/preflight.php` covers the one case they cannot
— a parse error in `index.php` itself ([../deployment.md](../deployment.md) §3.6c, §3.6d).

### What the runner will not do

- **No transaction around DDL.** MariaDB commits as it goes, so wrapping a migration
  would be false safety. The first failing statement stops the run and is reported with
  its file and 1-based index; the file is **not** recorded as applied, so the recovery is
  "fix it and run again" — which is what the idempotency rule exists to make safe.
- **No stored routines.** `DELIMITER`, triggers, procedures and functions are refused
  rather than mis-split ([../database.md](../database.md) §4).

## 3. Where the data lives

MySQL's **first real use is the feature flags** (§2b). The play counter (§7) is
the second, and it shares the row: one table, `games`, holding what the operator
decided and what the players did.

The counter follows the topology fixed in [database.md](../database.md) §3 — the
Durable Object cannot reach the database:

```
Room DO ──end of round, HTTPS──> api/played.php ──> MySQL ──> flags.json ──> the hub
```

Off the gameplay path, and nothing waits for it: the result is already on every
screen before the request leaves.

## 4. Access — a hidden URL and a magic link

Three layers, and only the third is a real control:

| Layer | What it stops | What it does not |
| --- | --- | --- |
| An unguessable path | Casual discovery, crawlers | Anyone who has ever seen the URL |
| A magic link to **one** address | Everyone who is not the operator | Someone with access to that mailbox |
| A session check on every write | A forged request | — |

**The path is not the security.** It is written down here so nobody later treats it
as if it were: a URL leaks through browser history, a shared screen, a Referer
header. The link is what authenticates.

**And this repository is public**, so the path cannot simply be a committed folder
name — that would publish it. The build emits a placeholder directory and the deploy
renames it to the `ADMIN_PATH` secret, so the real path exists only in the GitHub
environment and on the host ([../deployment.md](../deployment.md) §3.4).

**And the path must not leak through `robots.txt` either.** A `Disallow:` line
naming it publishes it to everyone who reads the file, so the admin path is
deliberately absent from `robots.txt` ([seo.md](seo.md) §3).

### The flow

Everything privileged lives in **PHP on the web host**, under the hidden path,
because that is where the flags are written ([§2b](#2b-feature-flags--turning-games-on-and-off))
and it is same-origin with the page.

1. `POST link.php { email }` — compares against the configured address with
   `hash_equals` and replies `204` either way. Identical response for a wrong
   address, so the endpoint cannot be used to discover who the operator is.
2. On a match it mints `random_bytes(32)`, stores only their **SHA-256** with a
   10-minute expiry, and `mail()`s a link. One outstanding token at a time: a new
   request replaces the old.
3. The token travels in the URL **fragment**, never the query string — a fragment
   is not sent to the server, so it cannot land in an access log or a `Referer`.
   The page reads it and posts it to `session.php`.
4. PHP hashes, compares, **deletes** (single use), and calls `session_start()`.
   The persistent cookie is `HttpOnly; Secure; SameSite=Lax`, valid 12 hours;
   PHP's session garbage collector is configured to the same lifetime so it cannot
   discard the server session after its short default interval.
5. Every later call is same-origin and carries the cookie automatically.

**A session cookie, not a bearer token.** The earlier design was forced into a
bearer header because the admin lived on the Worker at `*.workers.dev` while the
page was on `guigui.fr` — cross-site, so a cookie would have needed
`SameSite=None` plus credentialed CORS. Once the admin is PHP on the same origin,
that constraint disappears along with the hand-written HMAC session tokens, the
constant-time compare and the CORS preflight that existed only to serve it.

`link.php` is **rate limited** — a handful an hour per IP — and **the limit is
checked before the address is**, so a rate-limited response cannot be read as
"you guessed the right address, try later".

`ADMIN_TOKEN` stays as break-glass for `curl`, so a broken mailbox cannot lock the
operator out of their own flags.

### Secrets

A PHP config file **outside the web root**, written by the deploy from GitHub
environment secrets ([../deployment.md](../deployment.md) §3). Not committed — the
repository is public — and not in the web root, where a mis-set handler would serve
it as text.

| Secret | Contents |
| --- | --- |
| `ADMIN_EMAIL` | The one address a link may be sent to |
| `ADMIN_TOKEN` | Break-glass bearer for `curl`, above |
| `CLOUDFLARE_ANALYTICS_TOKEN` | Read-only analytics token, for the usage panel |
| `CLOUDFLARE_ACCOUNT_ID` | Account id — the same secret the room server deploy uses |

**No `ADMIN_SESSION_KEY`** — PHP's own session handling replaces the tokens it
signed. **No `MAIL_SECRET`** — see §5. And **no Wrangler secrets at all**: the
Worker's only remaining interest in any of this is reading `flags.json`, which is
public.

`CLOUDFLARE_ANALYTICS_TOKEN` moving to the server side is a straight improvement: it is
read by PHP and never reaches a browser.

### What is deliberately absent

No accounts, no password, no reset flow, no second factor. There is exactly one
operator and the mailbox *is* the second factor. Adding an auth system for one
person would be the tail wagging the dog — the same reasoning the earlier
basic-auth answer had, kept, with the mechanism upgraded because basic auth over a
shared host means a password in a config file somewhere.

## 5. How the mail and the flag fields were settled

### The mail goes out with `mail()`, from the code that wants it

`mail()` on the host is confirmed working (2026-08-05), and the code that mints the
link is now PHP on that same host, so sending it is one function call with no
credential, no endpoint and no shared secret.

**This supersedes the 2026-08-05 decision** that had the Worker `POST` to a PHP
mailer behind a `MAIL_SECRET`. That design was correct while the admin lived in the
Worker, and it carried a cost this document named at the time: `MAIL_SECRET` had to
exist in two systems, byte-identical, with **no automated check that the two copies
matched** — CI can read the GitHub copy and has no access to the Wrangler one. It
therefore also owed a manual "test the mail path" button whose only job was to
detect that drift. Moving the admin to PHP deletes the secret, the endpoint, the
drift, the pre-flight check and the button together.

The remaining cost is unchanged and still worth naming: **shared-host
deliverability is unpredictable**. For one known recipient it is usually fine, and
if it disappoints, swapping in Resend or Postmark is one function plus one
credential. `ADMIN_TOKEN` is the break-glass in the meantime, which is the other
reason it stays.

MailChannels was not chosen: it was the free default for Workers and is believed to
have ended that in 2024. Now moot, since nothing sends from a Worker.

### One state, not two fields

**This supersedes the "Availability and novelty are separate fields" decision
below (superseded 2026-09-01).** That design kept `availability`
(`active`/`disabled`/`hidden`, what the Worker enforces) and `isNew` (its own
runtime flag, driving only the NEW badge) as two independent fields, specifically
so a game could be "new and disabled" at once. The operator asked instead for the
simpler mental model — a game is exactly one of `new` / `active` / `soon` /
`hidden`, never two at once — at the cost of that one combination. `disabled` is
renamed `soon` in the same change, to read the same as the build-time "not built
yet" `status` value that the stricter-of-the-two rule already treated as the same
kind of caveat (§2b).

The migration is lossless for anything a player could ever see: `cardState()`
never surfaced the NEW badge for a `disabled` or `hidden` game in the old model —
only `active` + `isNew` ever produced a visible badge, and that combination
becomes `new` in the new one (`db/migrations/0005_flag_state.sql`).

**What follows is the original reasoning, kept for the record rather than
rewritten:**

`availability` was `active` / `disabled` / `hidden` and was what the **Worker
enforced**. `isNew` was its own runtime flag and only drove the NEW badge.

Two fields rather than a four-value enum, for the same reason §2b separated
the flag from build-time `status`: a game could be **new and disabled** at once,
and folding novelty into the enum would make `new` silently mean "playable" —
mixing presentation into the one thing that is a control.

It also made novelty settable without a deploy, which was the point. Before that,
`status: 'new'` was compiled into `card.ts`, so clearing a badge needed a release.
Build-time `status` stayed as intent; the runtime flag won where they disagreed, on
the stricter reading — a rule that still holds today, just over one field instead
of two.

### Still genuinely open, not blocking

- Retention for the aggregate counters — forever, or rolled up monthly?
- Should health checks alert (email/push), or only display?
- Is a UI needed at all for v1, or a JSON endpoint plus the Cloudflare dashboard?
  Now that there is a session mechanism, a small UI is cheap — but the honest
  answer for *health and usage* alone was always the dashboard.

## 6. Solo testing — starting a game on your own

Every game needs at least two phones, which is correct for playing and hostile to
looking. Checking whether a screen renders, whether a new accent reads on a real
handset, or whether a lobby copy change fits meant rounding up a second device every
time. This is the switch that stops that.

**A toggle in the admin centre, under `solo testing`.** Turn it on and the next game
you open lets you start alone.

### What it changes — exactly two things

1. **The minimum player count.** `enoughToStart(connected, limits, solo)` in
   [`shared/players.ts`](../../shared/players.ts) accepts one player instead of the
   game's minimum. **The maximum still applies**, and so does everything else about
   the room.
2. **"Last one standing."** Steady Hand, Pass the Bomb, Goat Siege and Spill end a
   round when one player is left. Alone you are the last one standing before the
   round has drawn a frame, so it would finish in the tick it started. In a solo
   round the threshold drops to *nobody* left — `lastStanding(left, solo)`.

Note the second one is a **lowered threshold, not a deleted condition**. Writing it
as `!solo && left <= 1` reads correctly and is wrong: a solo round whose only player
is eliminated then runs on with nobody in it, and Pass the Bomb draws its next holder
from an empty array and broadcasts an `undefined` player id. `worker/solo.test.ts`
asserts both directions, and that mutation fails it.

Nothing else moves. No score, no timing, no difficulty curve, no elimination rule —
a solo round is the real game with one player in it, which is the only version of it
worth looking at.

### Sling Puck is excluded

It is two phones laid end to end with a gap between them; a solo board has no
opposite half. Supporting it would mean inventing a second player rather than
relaxing a rule, so `startSling` still requires exactly two. The lobby says so on
screen when the flag is on, rather than leaving a dead Start button to be discovered.

### Where the switch lives, and why it is not a permission

The admin centre is PHP behind a magic-link session; the game pages are static files
talking to a Worker and have no session of their own. There is no shared login to
consult — but there **is** the browser you signed in with, so the admin page writes
`fony.solo` to `localStorage` ([`www/src/core/solo.ts`](../../www/src/core/solo.ts))
and the game lobbies read it, sending `solo: true` with `start`. Every shared game
lobby also checks the HttpOnly admin session through the same-origin API. Only an
authenticated admin browser sees the Enable/Disable solo-testing switch there;
changing it updates every mounted game screen in that browser immediately.

That is a convenience, not a control. Anyone can set the same key from a console, and
what they win is the ability to play by themselves in their own room. The same
sentence is already true of the feature flags in §2b: there is nothing here to
protect. The lobby shows a notice whenever the flag is on, because the flag is sticky
and set in another tab — otherwise a round that starts with one player looks like a
bug in the game rather than a switch somebody left on.

## 7. Play counts — the HOT card

**One number per game: rounds that finished with a winner.** It orders the hub —
the most-played game leads and wears HOT ([hub.md](hub.md) §2) — and it is the
only thing in this system a *player* can move.

### The path a count takes

```
Room DO  ──POST {slug}──>  api/played.php  ──>  games.plays += 1
                                            └─> flags.json republished
                                                        └─> index.php orders the grid
```

The Durable Object is the only thing that knows a round ended, and MySQL is the
only thing that can remember it across rooms; they cannot speak directly
([database.md](../database.md) §3). So the Object posts and PHP writes — the shape
that section has always specified, now actually built.

**The endpoint is derived, not configured.** `api/played.php` sits beside
`flags.json` on the same host, so the Worker builds its URL from `FLAGS_URL`
(`worker/plays.ts`). One var, so a dev Worker cannot end up counting into
production because somebody updated one setting and not the other.

**Nothing waits for it.** The result is on every screen before the request leaves,
the call is fire-and-forget with a short timeout, and a host that is down, slow or
has no schema yet costs nothing but a count.

**The count always lands; the republish can wait.** `games.plays += 1` is one
atomic `UPDATE`, so no round is ever lost to two finishing at once. Republishing
`flags.json` is not the same shape — it rereads every row and rewrites the whole
file — so `FlagService::count()` skips it if the last count-triggered republish
was under `RECOUNT_DEBOUNCE_MS` (30 minutes) ago. At real traffic that is the
difference between one rename and a race of them all fighting over the same path;
the number in MySQL is correct either way, and a skipped republish is picked up by
the very next round. **This floor is only on the automatic path.** An admin flag
edit and the explicit repair `?a=republish` always write immediately — a human
asked for that result, and neither should have to wait on however recently a round
happened to finish.

### What counts as a game played

Read off the end frame each game already broadcasts, in `endsRound()`
(`worker/plays.ts`), so a game is counted the day it broadcasts an end frame
rather than the day somebody remembers to add a call.

| Game | Counted when |
| --- | --- |
| Tap Duel | the **match** is won (`matchWinnerId`), not each duel — a match is to ten, and counting duels would make one evening look like ten |
| Pass the Bomb | a `boom` leaves exactly one player standing |
| Steady Hand | there is a `winner` |
| Ghost Hunt | somebody caught at least one ghost |
| Shake Rush | the leader travelled at all |
| Spill · Goat Siege · Sling Puck | there is a `winnerId` |
| Cat and Mouse | the cat won, or a mouse survived |

**A round nobody won is not a game played.** Everyone leaving, a duel both players
false-started, a hunt with no catches: they happened, but counting them would make
an abandoned game look popular.

### Why it is a separate endpoint, and what stops it being a vandalism tool

`index.php` is entirely privileged and lives under the secret `ADMIN_PATH`
directory. The Worker cannot know that path — it is secret precisely so nothing
finds it — so the counter is its own file at a fixed public URL holding exactly one
capability.

Two things bound it:

- **The catalogue is the allowlist.** Only a slug the build rendered a card for can
  be counted, so nothing can create rows and the table stays one row per game
  however the endpoint is used.
- **`plays_token`, when set, is required** — in `config.php` and as the Worker's
  `PLAYS_TOKEN` secret. Left empty, the endpoint is open, and the worst anyone can
  do is make their favourite game wear HOT. That is a deliberate trade: a counter
  that refuses to count until a secret is deployed is a feature that silently does
  nothing on every host the operator has not been back to.

It writes one column of one row and leaves **no audit row**: the change log is for
decisions the operator made, and this is not one.

### A counted game gets a flag row

`bump()` creates a row for a game nobody has ever configured, because the first
round it is played is that row's reason to exist. The row carries default flags —
`active`, not new — which is exactly what an absent row already meant, so nothing
about the game's behaviour changes. It does mean a played game now appears in
`flags.json` with its defaults, where before the file listed only what the operator
had touched.

## 8. Stale build files

The deploy's SFTP sync is `full`, which uploads everything and **never deletes** on
the remote ([../deployment.md](../deployment.md) §5) — the only mode that deletes
diffs git commits, and `dist/` is generated and gitignored, so it would see nothing
and delete nothing either. Consequence: every content-hashed file a build has ever
emitted into `assets/` (JS chunks, CSS, `?url`-imported SVGs) stays on the host
forever, with no functional harm but unbounded disk growth. Diagnostics → **Stale
files** shows how many of those are safe to delete, and deletes them on request.

| Action | Auth | Purpose |
| --- | --- | --- |
| `GET ?a=stale-assets` | session or `ADMIN_TOKEN` | Filenames in `assets/` the current build does not reference |
| `POST ?a=delete-stale-assets` | session or `ADMIN_TOKEN` | Delete exactly those files |

### Compared against the manifest, never by age

The first version of this idea was "delete anything older than the last deploy".
Wrong: `lftp mirror`'s `full` sync skips re-uploading a file already present under
the same name and size, so a content-hashed file whose content hasn't changed across
several builds never gets its remote modification date refreshed — while still being
exactly what the current pages reference. Comparing by age would eventually delete
live files.

Instead, `api/lib/StaleAssets.php` compares against **what the current build actually
emitted.** Vite already computes this in `dist/.vite/manifest.json`; `scripts/ssr.mjs`
reads it for the hashed image URLs it renders and then deletes it before deploy — it
"lists every source path" and must not ship. This feature adds one thing before that
deletion: a trimmed copy, just the flat list of output filenames with no source
paths, written to `dist-private/assets-manifest.json` — the same private root
`stage-api.mjs` already uploads one level above `/www` for `hosts.json` and `db/`
([../deployment.md](../deployment.md) §3.1), reachable by PHP and never over HTTP.
No manifest on a host (not yet redeployed with this feature, or a plain repo
checkout) means nothing to safely compare against, so `orphaned()` reports zero
rather than guess — guessing here means deleting files.

### The file list is always recomputed server-side

`delete()` calls `orphaned()` itself, every time; the request body is never read for
this action. There is no field anywhere that names a file to delete, so there is no
path-traversal or arbitrary-delete surface to close — the only files `unlink()` ever
sees are ones `scandir()` just returned from the one directory this class is told
about.

### Scope: `assets/` only

This never touches a whole leftover route directory from a renamed or removed game
(an old `dist/tap-tap-revolution/` after a rename, say) — that's a different shape of
problem, still a manual cleanup the way an old `index.html` is
([seo.md](seo.md) §4), and out of scope here.
