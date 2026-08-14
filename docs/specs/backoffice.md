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

"User activity" here means **anonymous aggregate counters, and nothing else.**

| Allowed | Never |
| --- | --- |
| Rounds started / finished, per game | Per-player tracking of any kind |
| Peak concurrent rooms | Player names, ids or avatars |
| Completion rate, average round length | Any position or sensor reading |
| Error counts | Per-room history after the room dies |

The hub's about sheet promises players that nothing they do is stored and that
positions never leave their room. A backoffice that recorded individual activity
would make that a lie. Aggregates only — and if a metric cannot be computed from
counters, it does not get collected.

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

### Games & activity — ⏸ **blocked on one decision, not on work**
Per game: rounds started, rounds finished, completion rate, peak concurrent
rooms. Useful for ordering the hub and for spotting a game nobody finishes,
which is a design bug worth knowing about.

**Not built, and deliberately not built quietly.** The counters can only come from
the Durable Object, which means a `Room → PHP` write endpoint — and that endpoint
has to be authenticated, or anyone on the internet can inflate the numbers the hub
is ordered by. Authenticating it means a shared secret in **two** systems, a
Wrangler secret and a GitHub secret that must be byte-identical with no automated
way to check.

That is exactly `MAIL_SECRET`, which was deleted on 2026-08-06 for exactly that
reason (§5). Rebuilding it three commits later, for anonymous play counts, is a
trade the maintainer should make rather than one that should appear in a diff.

The options, with what each actually costs:

| Option | Cost |
| --- | --- |
| **Shared secret** (`STATS_SECRET`) | Reintroduces the two-copy drift this design just removed. It is the only option that authenticates the write |
| **Unauthenticated endpoint** | No secret; anyone can inflate the counters. They are anonymous aggregates, so this is vandalism rather than a breach — but the hub's ordering would be built on numbers a stranger can move |
| **Cloudflare analytics only** | Already built, no new anything. Gives request volume per Worker, so "is anyone playing" is answerable; per-game granularity is not |
| **Skip it** | The completion rate is the one metric worth having, and it is a design signal rather than an operational one. It can wait for a play test |

**Health and Cloudflare usage are built and need none of this** — both are read-only
outbound calls from PHP, with no new credential and nothing to keep in step.

## 2b. Feature flags — turning games on and off

The operator can switch each game between three states **at runtime**, without a
commit or a deploy.

| State | On **prod** | On **dev** |
| --- | --- | --- |
| `active` | Normal: shown and playable | Shown and playable |
| `disabled` | Shown, **greyed out, not playable**, optional short reason | **Shown and playable**, with a badge reading *disabled* |
| `hidden` | **Absent from the hub** entirely, and not reachable | **Shown**, with a badge reading *hidden* |

**dev always shows everything**, with the badge stating what prod would do.
That makes dev a preview of the catalogue rather than a copy of prod's
restrictions — deliberately so, since dev exists to try things. The cost is
that dev does not reproduce prod's blocking behaviour; if you need to verify
the block itself, check prod or read the Worker logs.

### Why the hub cannot enforce this on its own

Hiding a card is **cosmetic**. A bookmarked or shared
`/tap-duel/#AB2C` goes straight to the lobby and never consults the grid. So the
state is enforced in **two places**, and the Worker is the one that counts:

| Layer | Role |
| --- | --- |
| Hub | Presentation — hides or greys the card |
| **Worker** | **Enforcement** — refuses to open a room for a non-active game |

### Flags are orthogonal to `status`

`status` (`soon` / `beta` / `live`) is build-time intent: *how finished is this
game*. The flag is runtime availability: *may it be played right now*. They do
not override each other — a `beta` game can be `active`, and a `live` game can
be `disabled` for maintenance. The card renders on the stricter of the two.

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

### Nothing populates `game_flags`, and that is the design

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

MySQL's **first real use is the feature flags** (§2b), not the counters. The flags
need no new wire path: PHP is both the writer and the publisher.

If the counters in §2 are ever built, they follow the topology already fixed in
[database.md](../database.md) §3 — the Durable Object cannot reach the database:

```
Room DO ──end of round, HTTPS──> PHP endpoint ──> MySQL
```

Off the gameplay path, so a slow database can never affect a round. The open
question is not the topology; it is how that endpoint is authenticated, and §2
lays out what each answer costs.

Building it therefore triggers the rules in [database.md](../database.md) §4: an
`init.sql`, idempotent migrations under `db/migrations/`, and local MariaDB as
the test target.

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
   The cookie is `HttpOnly; Secure; SameSite=Lax`, valid 12 hours.
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

### Availability and novelty are separate fields

`availability` is `active` / `disabled` / `hidden` and is what the **Worker
enforces**. `isNew` is its own runtime flag and only drives the NEW badge.

Two fields rather than a four-value enum, for the same reason §2b already separates
the flag from build-time `status`: a game can be **new and disabled** at once, and
folding novelty into the enum would make `new` silently mean "playable" — mixing
presentation into the one thing that is a control.

It also makes novelty settable without a deploy, which is the point. Today
`status: 'new'` is compiled into `card.ts`, so clearing a badge needs a release.
Build-time `status` stays as intent; the runtime flag wins where they disagree, on
the stricter reading.

### Still genuinely open, not blocking

- Retention for the aggregate counters — forever, or rolled up monthly?
- Should health checks alert (email/push), or only display?
- Is a UI needed at all for v1, or a JSON endpoint plus the Cloudflare dashboard?
  Now that there is a session mechanism, a small UI is cheap — but the honest
  answer for *health and usage* alone was always the dashboard.
