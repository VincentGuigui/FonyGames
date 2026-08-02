# Backoffice

A private operator view: is it up, what is it costing, and is anyone playing.

> Status: **stub, not built.** Roadmap M8. This file exists so the privacy
> boundary is agreed *before* anything starts collecting.

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

## 4. Access

It is not public. Simplest workable answer for a one-maintainer project: HTTP
basic auth via the host, over HTTPS, on an unguessable path. **No user accounts**
— adding an auth system for a single operator would be the tail wagging the dog.

## 5. Open questions

- Is a UI needed at all, or is a single JSON endpoint plus the Cloudflare
  dashboard enough for v1? (Cheapest honest answer: probably the latter.)
- Retention for the aggregate counters — forever, or rolled up monthly?
- Should health checks alert (email/push), or only display?
