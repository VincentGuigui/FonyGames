# Realtime server (Cloudflare Durable Objects)

The room server. One Durable Object per room, WebSocket transport, no database.
Decision and cost analysis: [realtime-options.md](realtime-options.md).

Source: `worker/` · Config: `wrangler.jsonc` · Shared wire types: `shared/`

## 1. Why one object per room

`env.ROOM.idFromName(roomCode)` always resolves to the same object, anywhere in
the world. That gives room affinity as a platform guarantee — no sticky routing,
no shared cache — which is the single reason this beat Cloud Run and Firebase
([realtime-options.md](realtime-options.md) §3.3).

```
browser ──wss://<worker>/room?code=AB2C&game=spill──> Worker ──idFromName(code)──> Room DO
```

The Worker itself is a thin router: validate origin, validate code, hand off.
All state and all authority live in the object.

### Endpoints

| Route | Method | Purpose |
| --- | --- | --- |
| `/health` | GET | Liveness, for the backoffice |
| `/room?code=&game=` | WebSocket | Join a room. `game` is the slug of the page connecting |
| `/room/game?code=` | GET | `CODE → game slug`, or **404** if no room |

`/room/game` is what lets the hub's code field route by code alone, so a player
handed a code never needs to know which game their friends picked
([specs/hub.md](specs/hub.md) §4). Two properties it must keep:

- **It reads and writes nothing.** A lookup must not join a room, and must not
  bring one into being either — otherwise every mistyped code would leave an
  empty object behind. An unknown code is simply a room nobody has joined.
- **The first connection decides the game, and later ones cannot change it.**
  Otherwise opening another game's page on an existing code would repoint the
  room and send the hub somewhere wrong.

It is also the only route the hub itself calls, and the hub is on a different
origin from the Worker, so it is the only one that needs CORS. A simple GET with
no custom headers, so there is no preflight — just
`Access-Control-Allow-Origin` on the way back, for origins already on the
allow-list.

The slug is **sanitised, not trusted** (`worker/router.ts`): it is stored and
later handed to the hub, which turns it into a URL to navigate to, so anything
that is not a bare kebab-case name is refused. That is what keeps the join field
from becoming an open redirect.

## 2. Storage backend — irreversible

`wrangler.jsonc` declares:

```jsonc
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }]
```

> ⚠️ **This cannot be changed later.** The Workers Free plan only supports
> SQLite-backed Durable Objects, and Cloudflare rejects switching the backend on
> an already-deployed class. It had to be correct on the first deploy.

Never create the namespace by hand in the dashboard — it would be created with
the wrong backend and could not be converted.

## 3. Hibernation

The object uses `ctx.acceptWebSocket()` (not `server.accept()`), which enables
the **WebSocket Hibernation API**: sockets stay open while the object is evicted
from memory, so an idle lobby costs **no duration billing**.

The consequence for code: **per-connection state cannot live in an instance
field**, because the instance is discarded. A player's identity is attached to
the socket with `serializeAttachment()` and read back with
`deserializeAttachment()`. Room state lives in `ctx.storage`.

Anything rebuilt after hibernation must be non-essential. The rate-limit buckets
are a `WeakMap` and deliberately disposable.

### The frame sequence is the trap this rule exists for

`#seq` in `Room.ts` numbers every server→client frame, and `RoomClient` drops anything not
**above** the highest number it has seen — that is what makes a replayed frame after a reconnect
harmless. It was a plain counter starting at `0`, which is an instance field, so eviction reset
it: the next instance began again at 1, every frame it sent looked stale to a client that had
already seen 11, and the client silently discarded **all of them for the rest of the session**.

Silently is the problem. No error, no reconnect, no log — the room simply stopped updating, and
only for clients that had been there long enough to have a high-water mark.

It went unnoticed because none of the first five games goes quiet for long: something is on the
wire every few hundred milliseconds, so the object is rarely evicted mid-round. Pass the Bomb's fuse
is a deliberate 8–25 second silence, which is an eviction window by design — the `boom` that ends
the round was the first frame to land on a fresh instance, and it never arrived.

`#nextSeq()` now seeds from the clock — `max(#seq + 1, Date.now())`. Wall-clock time already
survives eviction and every previously sent value was also roughly `Date.now()`, so a new
instance resumes above them; the `+1` keeps it strictly increasing when two frames share a
millisecond, which `boom` and the `bomb` after it always do. The values are opaque to clients, so
making them timestamps costs nothing.

**The general rule:** anything a client compares *across* frames — a counter, a version, a
generation — is room state, not instance state. If it lives in a field and eviction resets it,
the client's memory outlives the server's and the two disagree with no symptom.

## 4. Lifecycle

| Event | Behaviour |
| --- | --- |
| Join | New player gets a UUID, a silly name and an emoji avatar. First player present becomes host. |
| Rejoin (`resume`) | Client replays its player id and reclaims the **same seat**, name and host role. This is what makes a phone lock, a 4G→WiFi handover, or a **page refresh** invisible. |
| Drop | Player is marked `connected: false`, **not removed**. An alarm is set for `RECONNECT_GRACE_MS` (60 s). |
| Grace expiry | The alarm removes them and re-broadcasts presence. |
| Host drops | The role is **held for `HOST_GRACE_MS` (8 s)**, then passed to another connected player by the alarm. |

### One alarm slot, everything that wants it

A Durable Object has exactly **one** alarm, and every game competes for it: a Tap
Duel timeout, a Pass the Bomb fuse, a Spill drop landing, a Goat Siege arrival, a
Sling Puck round cap — with seat/host housekeeping underneath all of them.

Every subsystem calling `storage.setAlarm()` directly does not work — whichever
ran last silently cancels the others, so a duel timeout could swallow a pending
seat reap, and a reap could swallow a drop in mid-air. Both are the kind of bug
that only shows up under a specific interleaving.

So: **nothing outside `Room` sets the alarm.** The game modules save their state
and call `ctx.setAlarm()`, which Room implements as `#rearm()` — ignoring the
requested time and recomputing the earliest deadline across every subsystem from
persisted state. `alarm()` likewise never assumes it was woken for its own
reason: it runs whatever is actually due, then re-arms from scratch.

A module cannot know what else wants the slot, so it is not allowed to decide.

### Why refresh is the hard case

A page refresh destroys the JS context, so the seat id has to survive outside
it — `www/src/core/room/seat.ts` keeps it in **sessionStorage**, which lives
exactly as long as the tab. Without that, `join` arrives with no `resume`, the
server mints a new player, and the old one lingers as a ghost for a minute:
you see yourself twice.

Two consequences follow, and both are load-bearing:

1. **Host promotion is deferred, not immediate.** A refresh is
   indistinguishable from a disconnect, so promoting the instant a socket drops
   handed the host role to someone else every time the host reloaded. Promotion
   now happens in the alarm, once `HOST_GRACE_MS` has passed — long enough for a
   reload (~1–2 s), short enough that a player who actually walked off does not
   block the room for a full minute.
2. **One live socket per seat.** Duplicating a tab copies sessionStorage, so two
   tabs can resume the same seat. `#onJoin` closes any other socket holding that
   id, and `#onGone` ignores a close when another live socket still holds the
   seat — otherwise the old socket's close event would mark a player away who
   had already successfully resumed.
| Room empties | Once no players remain and no socket is attached, `storage.deleteAll()`. A room's state dies with the room ([architecture.md](architecture.md) §1). |

## 5. Safety limits

| Limit | Value | Why |
| --- | --- | --- |
| Origin allow-list | `ALLOWED_ORIGINS` var | Browsers send no preflight for WebSocket, so the `Origin` header check in `worker/index.ts` is the only place an unknown site can be refused. |
| Room code | Must match the shared alphabet | Rejected with 400 before any object is created, so a bad code cannot spawn junk rooms. |
| Players | `MAX_PLAYERS` = 10 | |
| Inbound rate | 20 msg/s per player | [multiplayer.md](multiplayer.md) §4 |
| Frame size | 8 KB | Larger frames are dropped, not parsed. |
| Message parsing | Non-JSON and unknown `t` are ignored | Junk must never crash a room others are playing in. |

Names are trimmed and capped at 20 chars; avatars must be one of a known set —
both strings render on other players' phones.

## 6. Environments

Two Workers, so a dev round can never land in a production room (separate
Workers mean separate DO namespaces):

| Branch | Site | Worker | Worker URL |
| --- | --- | --- | --- |
| `dev` | `https://fonygames-dev.guigui.fr` | `fonygames-worker-dev` | `wss://fonygames-worker-dev.vincent-f02.workers.dev` |
| `prod` | `https://fonygames.guigui.fr` | `fonygames-worker` | `wss://fonygames-worker.vincent-f02.workers.dev` |

`fonygames-worker` is the Worker originally created in the Cloudflare dashboard,
reused for prod rather than orphaned.

The browser picks its Worker from `window.location.hostname` in
`www/src/core/room/config.ts` — a static map, **not** a build-time variable,
because the site is built in Vite's `production` mode on *both* branches and a
single `.env.production` could not tell the two hosts apart. Unknown hostnames
(localhost, previews) fall back to `ws://127.0.0.1:8787`.

Set `VITE_ROOM_URL` to override, e.g. to point a phone on the LAN at a laptop
running `wrangler dev`.

> ⚠️ **`durable_objects` and `vars` are not inherited by environments** in
> `wrangler.jsonc` — they must be repeated inside every `env` block. Omit them
> and the Worker deploys happily with **no `ROOM` binding**, failing only at
> runtime. `wrangler deploy --env <e> --dry-run` prints the resolved bindings;
> check `ROOM` is listed before trusting a config change. `migrations` and
> `compatibility_date` *are* inherited.

### Do not deploy without `--env`

The top-level `name` in `wrangler.jsonc` is deliberately `fonygames-worker-local`,
a Worker that exists nowhere. A bare `wrangler deploy` would use that block, so
the mistake creates a throwaway Worker instead of clobbering dev or prod. The
npm scripts are `worker:deploy:dev` and `worker:deploy:prod` for the same reason.

Deployed by the same GitHub Actions workflow as the site, reading
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the matching GitHub
Environment ([deployment.md](deployment.md) §3).

`ALLOWED_ORIGINS` is a plain var per environment in `wrangler.jsonc` — it is not
a secret, and having it visible makes the allow-list auditable.

## 7. Local development

```bash
npm run worker:dev      # wrangler dev on :8787, fully local
npm run dev             # the site, on :5173
```

`http://localhost:5173` and `http://127.0.0.1:5173` are already in the local
allow-list.

> `wrangler dev` **persists Durable Object storage between runs** in
> `.wrangler/state`. A room you tested five minutes ago still has its players.
> Delete that directory for a clean slate — otherwise you will chase phantom
> duplicate players that are just leftovers.

## 8. Client

`www/src/core/room/client.ts` is the only thing in the app that opens a socket;
games go through it. It handles reconnect with backoff, replays the player id to
reclaim its seat, drops out-of-order frames using the server's `s` sequence, and
tracks the server clock offset.

**Timers must use `client.now()`**, never a bare `Date.now()` — countdowns are
rendered from server time ([multiplayer.md](multiplayer.md) §4).
