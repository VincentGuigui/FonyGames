# Backoffice

A private operator view: is it up, what is it costing, and is anyone playing.

> Status: **specced, not built.** Roadmap M8. The privacy boundary in §1 is agreed
> *before* anything starts collecting; §4's access model was settled on 2026-08-05.
> Two decisions are still open and block the build — see §5.

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

### Games & activity
Per game: rounds started, rounds finished, completion rate, peak concurrent
rooms. Useful for ordering the hub and for spotting a game nobody finishes,
which is a design bug worth knowing about.

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

A **singleton Durable Object** (`idFromName('flags')`) inside the room Worker.
Per-environment separation then costs nothing: `dev` and `prod` are already
separate Workers with separate namespaces, so their flags are separate by
construction.

MySQL is **not** the source of truth here — the Worker cannot reach it
([../database.md](../database.md) §3), and two sources would drift. MySQL keeps
only the audit trail: who changed what, when.

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /flags` | public, cacheable ~60 s | The hub reads this |
| `POST /admin/flags` | bearer token (`ADMIN_TOKEN`, a Wrangler secret) | The backoffice writes this |

### Behaviour details

- **In-flight games finish.** Disabling blocks *new* rooms; a duel already
  running is never interrupted. Concretely the Worker refuses a connection for a
  non-active game **unless that room already has a connected player**.
- **The hub renders before the flags arrive.** The compiled registry paints the
  grid immediately (the ≤ 2.5 s budget in
  [../architecture.md](../architecture.md) §4 comes first), then the flag fetch
  reconciles. Changing a flag is rare, so this is almost always a no-op.
- **Unknown slug, or `/flags` unreachable → treated as `active`.** Fail-open, on
  purpose: a Worker hiccup must not blank the whole catalogue. The consequence
  is that a flag is **not** a security control — for something genuinely
  dangerous, remove the game and deploy. Written here so nobody later mistakes
  it for one.

## 3. Where the data lives

This is the **first real use of MySQL**, and it follows the topology already
fixed in [database.md](../database.md) §3 — the Durable Object cannot reach the
database, so counters go:

```
Room DO ──end of round, HTTPS──> PHP endpoint ──> MySQL
```

Off the gameplay path, so a slow database can never affect a round.

Building it therefore triggers the rules in [database.md](../database.md) §4: an
`init.sql`, idempotent migrations under `db/migrations/`, and local MariaDB as
the test target.

## 4. Access — a hidden URL and a magic link

Three layers, and only the third is a real control:

| Layer | What it stops | What it does not |
| --- | --- | --- |
| An unguessable path | Casual discovery, crawlers | Anyone who has ever seen the URL |
| A magic link to **one** address | Everyone who is not the operator | Someone with access to that mailbox |
| The Worker checking every write | A forged request | — |

**The path is not the security.** It is written down here so nobody later treats it
as if it were: a URL leaks through browser history, a shared screen, a Referer
header. The link is what authenticates.

### The flow

Everything privileged lives on the **Worker**, under `/admin/*`, because the Worker
already owns the flags and is the only thing that can enforce them. The page itself
is static and can sit on the web host at the hidden path.

1. `POST /admin/link { email }` — the Worker compares against the `ADMIN_EMAIL`
   secret **in constant time** and replies `204` either way. Identical response for
   a wrong address, so the endpoint cannot be used to discover who the operator is.
2. On a match it mints 32 random bytes, stores only their **SHA-256** with a
   10-minute expiry, and emails a link. One outstanding token at a time: a new
   request replaces the old.
3. The token travels in the URL **fragment**, never the query string — a fragment
   is not sent to the server, so it cannot land in an access log or a `Referer`.
   The page reads it and posts it to `POST /admin/session`.
4. The Worker hashes, compares, **deletes** (single use), and returns a signed
   session token valid 12 hours. The page keeps it in `sessionStorage`.
5. Every later call carries `Authorization: Bearer <session>`.

A **bearer session, not a cookie**, and that is forced rather than chosen: the
Worker is on `*.workers.dev` and the site is on `guigui.fr`, so a cookie would be
cross-site and need `SameSite=None` plus credentialed CORS. A bearer header avoids
all of it and matches the `ADMIN_TOKEN` pattern already in §2b.

`POST /admin/link` is **rate limited** — a handful an hour per IP. Without it the
endpoint is a way to spam the operator's inbox from anywhere.

`ADMIN_TOKEN` stays as break-glass for `curl`, so a broken mailbox cannot lock the
operator out of their own flags.

### Secrets

Wrangler secrets, **not a file in the repo.** A committed file leaks the address; a
gitignored one breaks a fresh clone and cannot be read by a deployed Worker at all,
which is where it is needed.

| Secret | Contents |
| --- | --- |
| `ADMIN_EMAIL` | The one address a link may be sent to |
| `ADMIN_SESSION_KEY` | HMAC key for signing session tokens |
| `ADMIN_TOKEN` | Break-glass bearer for `curl` (§2b) |

Set with `wrangler secret put <NAME> --env dev|prod`. Separate values per
environment, so a dev link can never open prod.

### What is deliberately absent

No accounts, no password, no reset flow, no second factor. There is exactly one
operator and the mailbox *is* the second factor. Adding an auth system for one
person would be the tail wagging the dog — the same reasoning the earlier
basic-auth answer had, kept, with the mechanism upgraded because basic auth over a
shared host means a password in a config file somewhere.

## 5. Decisions still open — these block the build

### D-A. How does the link actually get sent?

The Worker cannot open an SMTP connection, so an email needs a route out. Three,
with the trade named:

| Route | Cost | Risk |
| --- | --- | --- |
| **The PHP host** — Worker POSTs to a small PHP endpoint with a shared secret, PHP sends | No new vendor, no new account. Reuses the **exact seam §3 already needs** for counters | Shared-host deliverability is unpredictable. For one known recipient, usually fine |
| A transactional API (Resend, Postmark, Brevo) | One HTTP call, one more secret, free tier covers this by orders of magnitude | A new third-party account and a new dependency — AGENTS §3.3 territory |
| MailChannels | Was the free default for Workers | **Believed no longer free for Workers** since 2024. Would need checking before counting on it |

**Recommendation: the PHP host.** The Worker→PHP hop has to exist anyway for the
counters, so this adds a route rather than a dependency, and nothing new to sign up
for. If deliverability disappoints in practice, swapping in a transactional API is
one function.

### D-B. Is "new" a fourth state, or a separate field?

The maintainer asked for **enable / disable / new**. Two readings, and they are
different data models:

| Reading | Shape | Consequence |
| --- | --- | --- |
| One enum | `active` \| `disabled` \| `hidden` \| `new` | Simple, one control. But a game cannot be *new and disabled*, and `new` would silently mean "playable" |
| Two fields | availability `active`/`disabled`/`hidden`, plus a separate `new` flag | Says what is true: novelty and availability are unrelated. Two controls per game |

**Recommendation: two fields**, for the same reason §2b already separates the flag
from build-time `status` — a `beta` game can be `active`. Novelty is presentation,
availability is enforcement, and the Worker only cares about the second. It also
makes `new` runtime-settable, which is the point: today `status: 'new'` is compiled
into `card.ts` and needs a deploy to clear.

### Still genuinely open, not blocking

- Retention for the aggregate counters — forever, or rolled up monthly?
- Should health checks alert (email/push), or only display?
- Is a UI needed at all for v1, or a JSON endpoint plus the Cloudflare dashboard?
  Now that there is a session mechanism, a small UI is cheap — but the honest
  answer for *health and usage* alone was always the dashboard.
