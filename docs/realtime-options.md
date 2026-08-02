# Realtime backend survey (decision D3)

Survey of options for the multiplayer transport, given two constraints from the
maintainer: **the existing backend is PHP**, and **a free solution is preferred**.

Prices checked August 2026. Sources at the bottom. Re-check before committing —
free tiers moved a lot in 2024–2026.

> Status: **survey, no decision taken.** Feeds [roadmap.md](roadmap.md) D3.

---

## 1. Why the load model comes first

"6 million messages/month" is meaningless until you know what a round costs.
FonyGames has **two very different traffic profiles**, and they differ by ~16×.

Assume a 6-player room, a 2-minute round, and the transmit caps already set in
[device-capabilities.md](device-capabilities.md) (≤20 Hz on the wire).

| | **Profile A — event games** | **Profile B — streaming games** |
| --- | --- | --- |
| Examples | Bump Relay, Tap Duel, Scream Meter | Tilt Arena, Shake Sprint |
| Client → server | ~0.5 msg/s/player → 3 msg/s | 20 Hz × 6 → 120 msg/s |
| Server → clients | ~2 events/s × 6 → 12 msg/s | 20 Hz × 6 → 120 msg/s |
| **Per 2-min round** | ~360 in + ~1,440 out = **~1,800** | ~14,400 in + ~14,400 out = **~28,800** |

**Profile B is the one that decides the bill.** Any pricing below is quoted
against it.

### The counting rule that matters most

Message-metered services **count fan-out**: one publish to a channel with 6
subscribers bills as **7 messages**, not 1. Ably and Pusher both work this way.
Cloudflare does the opposite — see §3.

---

## 2. Can the current PHP host do it? (almost certainly not)

A WebSocket server must be a **long-lived process holding open sockets**. That
is the opposite of PHP's request/response model under PHP-FPM.

| Approach | Verdict on typical shared hosting |
| --- | --- |
| **Ratchet** (ReactPHP) | Needs a persistent process + a bindable port. Shared hosts kill long-running processes and firewall custom ports. |
| **Workerman** / **Swoole** | Faster, same blocker. Swoole also needs a PECL extension you can't install. |
| **SSE from PHP** | Works over plain HTTP, but **holds one PHP-FPM worker per connected player**. A 6-player room eats 6 workers; shared plans cap at ~10–20. Two rooms and the whole site stops responding. Also server→client only. |
| **Long polling** | Same worker-exhaustion problem, worse latency. |
| **Mercure hub** | Good PHP companion, but it's a Go binary — same persistent-process blocker, and SSE is one-directional. |

**Even if a process survived**, you'd still need `wss://` on port 443 through
the host's web server, which shared plans don't let you configure.

### Test it rather than assume it

We know the host allows SSH. Ten seconds to settle it:

```bash
ssh <user>@<host>
php -v; which node go                       # what runtimes exist
php -r '$s=stream_socket_server("tcp://0.0.0.0:8099",$e,$m); var_dump($s,$m);'
nohup sleep 300 >/dev/null 2>&1 & disown    # does a background process survive?
sleep 10; ps -u "$USER" | grep sleep         # ...still there after logout?
```

If the socket binds **and** the process is still alive after you log out and
back in, self-hosting becomes viable. Otherwise §3.

**Key reframing:** the realtime server does *not* have to be PHP, and does not
have to live with the site. The static hub deploys to the PHP host exactly as it
does today; the realtime layer is a separate small service the browser connects
to directly. Our [architecture.md](architecture.md) already isolates this behind
`core/room`, so the choice is swappable.

---

## 3. Managed options — free tiers against Profile B

| Service | Free tier | **Heavy rounds/month free** | Notes |
| --- | --- | --- | --- |
| **Cloudflare Durable Objects** | 100k requests/day, 13,000 GB-s/day. **Incoming WS billed 20:1, outgoing WS free** | **~4,100** (≈139/day) | Wildly ahead. Fan-out costs nothing. |
| **Ably** | 6M msg/month, 200 connections, 500 msg/s | ~208 | Counts fan-out. No daily cap. |
| **Pusher Channels** | 200k msg/**day**, 100 connections | ~7/day (~210/mo) | Counts fan-out. Daily cap bites hard. |
| **Supabase Realtime** | 2M msg/month, 200 concurrent | ~69 | Tightest. Useful if you want auth + DB in one. |

### Why Cloudflare is ~20× cheaper for this workload

Two rules compound in our favour:

- **Outgoing WebSocket messages are free.** Broadcast is the bulk of a game's
  traffic (server → every player), and it costs nothing.
- **Incoming messages bill 20:1** — 20 client messages = 1 billed request.

Profile B per round: 14,400 inbound ÷ 20 = **720 billed requests**; all 14,400
outbound are **free**. Compare Ably, where the same round costs 28,800 messages.

Duration is not the binding constraint: a 128 MB object awake for a 2-min round
is ~15 GB-s, so 13,000 GB-s/day allows ~866 rounds/day — requests run out first.
The Hibernation API means idle rooms holding open sockets aren't billed at all.

**Cost of the trade:** it's TypeScript on Cloudflare's runtime, not PHP, and
Durable Objects are Cloudflare-specific. `core/room` limits the blast radius if
we ever move.

---

## 4. Self-hosted free

| Option | Reality in 2026 |
| --- | --- |
| **Oracle Cloud Always Free** | The only genuinely free **always-on** VM left: up to 4 ARM OCPUs / 24 GB RAM, no expiry. Could run Node **or PHP Workerman** — the one path that keeps the stack PHP. Caveats: A1 capacity is often unavailable in a given region, new accounts get flagged/declined a lot, and you own TLS, updates, restarts and uptime. |
| **Fly.io** | Free tier removed in 2024. Trial only. |
| **Render** | Free web services **spin down after 15 min idle**, 30–60 s cold start — fatal for "tap the link and play". WebSockets on paid plans. |
| **Railway** | $1/month credit ≈ a few hours. Not always-on. |
| **Koyeb** | Free Starter tier closed to new users after the Mistral acquisition in early 2026. |
| **Soketi** | Free open-source, Pusher-protocol-compatible server. Not a host — still needs a VM (i.e. Oracle, or a paid VPS). |

Vercel/Netlify cannot help: serverless, no long-lived connections.

---

## 5. Wildcard: WebRTC peer-to-peer

Players in the same physical room are the common case for FonyGames. WebRTC data
channels send game traffic **directly phone-to-phone**, so per-message cost is
zero and latency is the best available. A signalling server is still needed, but
only for a handful of messages per join — that fits inside *any* free tier,
including a plain PHP endpoint on the current host.

Honest downsides:
- **Mesh doesn't scale**: n×(n−1)/2 connections. Fine at 6, ugly at 10.
- **TURN relay** is needed for the ~10–20% of networks where direct connection
  fails. Public TURN is not free at any volume; self-hosting coturn needs a VM.
- **No server authority.** Our specs make the server the referee for scoring and
  anti-cheat ([multiplayer.md](multiplayer.md) §4, bump pairing in
  [device-capabilities.md](device-capabilities.md) §3). P2P gives that up, or
  needs a trusted-host election that a cheater can win.

Viable as a **latency optimisation later**, poor as the foundation.

---

## 6. Paid comparison

Modelled at **1,000 Profile-B rounds/month** (~28.8M raw messages — a genuinely
active party game).

| Option | Monthly | What you get / why |
| --- | --- | --- |
| **Cloudflare (free plan)** | **€0** | 1,000 rounds ≈ 24k billed req/day vs 100k/day allowance. Fits free. |
| **Oracle Always Free VM** | **€0** | Unmetered by message count. You run it. |
| **Cloudflare Workers Paid** | **$5** | Headroom: 1M req/mo + 400k GB-s included, then $0.15/M req. Only needed past ~4,000 rounds/mo. |
| **Hetzner CX-series VPS** | **€4.35** | Full control, 20 TB egress. Could run PHP Workerman. |
| **DigitalOcean / Linode** | **$5** | 1 vCPU / 1 GB. |
| **Supabase Pro** | **$25** | Only if you also want auth + Postgres. |
| **Pusher Startup** | **$49** | 10M msg/mo — **not enough** at this load; realistically Pro **$99** (4M/day). |
| **Ably pay-as-you-go** | **~$57** | 6M free, then 22.8M × $2.50/M. |

The spread is the story: **€0–5 versus $57–99** for identical gameplay, decided
almost entirely by whether the provider charges for fan-out.

---

## 7. Recommendation

1. **Cloudflare Durable Objects, free plan.** Best fit by a wide margin: free at
   our scale, purpose-built for room-shaped state (one object per room *is* the
   model), WebSocket hibernation for idle lobbies, and global edge latency. It
   costs us "the realtime bit is TypeScript, not PHP".
2. **Fallback if PHP is a hard requirement:** Oracle Always Free VM running
   Workerman. Free and PHP, but you own the operations, and Oracle's signup and
   capacity lottery is a real risk.
3. **Not recommended:** Pusher/Ably/Supabase free tiers — all three run out
   during a single evening of testing Profile B, and their paid tiers cost 10–20×
   Cloudflare for this shape of traffic.

**Before deciding, answer two questions:**
- Is "realtime layer is not PHP" acceptable? (§2 reframing)
- Run the SSH test in §2 — if the host *does* allow persistent processes, the
  self-hosted PHP option gets much more attractive.

---

## Sources

- [Ably pricing](https://ably.com/docs/platform/pricing) · [how Ably counts messages](https://faqs.ably.com/how-does-ably-count-messages) · [Ably vs Pusher pricing](https://ably.com/compare/ably-vs-pusher/pricing)
- [Pusher pricing overview](https://ably.com/topic/pusher-pricing) · [Pusher plans 2026](https://getpulsesignal.com/pricing/pusher)
- [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits) · [Supabase free tier 2026](https://automationatlas.io/answers/supabase-free-tier-limits-2026/)
- [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing) · [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) · [Oracle free tier review 2026](https://space-node.net/blog/oracle-vps-free-tier-review-2026)
- [Platforms with a real free tier 2026](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026) · [Fly.io alternatives after the free tier died](https://expresstech.io/7-fly-io-alternatives-in-2026-real-pricing-after-the-free-tier-died/)
- [PHP WebSocket libraries guide](https://websocket.org/guides/languages/php/)
- [Hetzner pricing calculator](https://costgoat.com/pricing/hetzner) · [Cloud VPS comparison 2026](https://apicalculators.com/cloud-vps-comparison)
