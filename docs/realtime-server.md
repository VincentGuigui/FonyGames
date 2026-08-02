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
browser ──wss://<worker>/room?code=AB2C──> Worker ──idFromName(code)──> Room DO
```

The Worker itself is a thin router: validate origin, validate code, hand off.
All state and all authority live in the object.

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

## 4. Lifecycle

| Event | Behaviour |
| --- | --- |
| Join | New player gets a UUID, a silly name and an emoji avatar. First player present becomes host. |
| Rejoin (`resume`) | Client replays its player id and reclaims the **same seat**, name and host role. This is what makes a phone lock or a 4G→WiFi handover invisible. |
| Drop | Player is marked `connected: false`, **not removed**. An alarm is set for `RECONNECT_GRACE_MS` (60 s). |
| Grace expiry | The alarm removes them and re-broadcasts presence. |
| Host leaves | Another connected player is promoted silently. The host is a UI role only — the object owns round state, so a host leaving never stalls a room. |
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

| Branch | Worker |
| --- | --- |
| `dev` | `fonygames-rooms-dev` |
| `prod` | `fonygames-rooms-prod` |

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
