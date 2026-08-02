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
