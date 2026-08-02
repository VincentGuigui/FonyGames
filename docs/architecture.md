# Architecture

> **Status: PROPOSAL.** Nothing in the "Stack" section is frozen. It must be
> validated by the maintainer before any dependency or build tool lands
> (see rule §3.3 in [../AGENTS.md](../AGENTS.md)). Open questions are tracked in
> [roadmap.md](roadmap.md).

## 1. Shape of the product

```
                    ┌──────────────────────────┐
   phone browser →  │  Hub + games (static)    │  deployed by SFTP to the
                    │  served by the PHP host  │  host's /www
                    └─────┬──────────────┬─────┘
                          │              │
           WebSocket ─────┘              └───── HTTPS (rare, non-gameplay)
                          │                            │
        ┌─────────────────┴────────┐      ┌────────────┴──────────┐
        │ Cloudflare Durable Object│      │ PHP endpoint  → MySQL │
        │ one per room, in memory  │      │ persistence only      │
        │ authoritative, no DB     │      │ NOT on the game path  │
        └──────────────────────────┘      └───────────────────────┘
```

- The **hub and the games are static assets**, deployed to the PHP host
  ([deployment.md](deployment.md)).
- **Gameplay has no database.** A Durable Object holds one room's state in
  memory and is the referee; the room's state dies with the room, by design.
- A **MySQL** database exists on the host but is **not part of the game loop**,
  and is unused today. It is reachable only from PHP, never from the Durable
  Object — see [database.md](database.md) for why, and for the migration rules.
- A game that needs no other player state (e.g. a pure local warm-up mode) must
  still work with the server unreachable.

## 2. Stack (proposed)

| Layer | Proposal | Why |
| --- | --- | --- |
| Language | TypeScript | Catch sensor/state bugs before the phone does |
| Build | Vite | Fast, zero-config, multi-page friendly |
| UI | No framework — small custom components + CSS | Payload budget; games are canvas/DOM-light |
| Rendering | DOM + CSS for UI, `<canvas>` only where a game needs it | Cheaper, more accessible |
| Realtime | WebSocket, JSON messages | Universally supported on mobile browsers |
| Server | **Cloudflare Durable Objects** — one object per room ✅ **decided** | Room affinity is a platform primitive; free at our scale ([realtime-options.md](realtime-options.md)) |
| Hosting | Static `www/` on the PHP host via SFTP ✅ **decided** | [deployment.md](deployment.md) |
| Persistence | MySQL on the host, via PHP, **outside the game loop** | [database.md](database.md) |
| PWA | Manifest + offline shell later, **never** an install requirement | Zero friction rule |

WebRTC data channels were evaluated and **rejected** as the transport
([realtime-options.md](realtime-options.md) §5). Still open: Preact instead of
no-framework. See [roadmap.md](roadmap.md).

## 3. Source layout (proposed, under `www/`)

```
www/
  index.html            hub
  src/
    hub/                catalogue rendering, game cards
    core/               shared runtime used by every game
      room/             join, room code, presence, messaging
      sensors/          motion, orientation, geolocation, bump, mic
      ui/               buttons, sheets, countdown, scoreboard, toasts
      state/            tiny store + round/timer helpers
    games/
      <slug>/
        index.html      game entry (or route)
        game.ts         core loop
        modes.ts        mode/variation definitions
        card.ts         hub metadata: title, pitch, illustration, tags
  public/
    illustrations/      one illustration per game
```

**Rule:** a game only talks to the outside world through `core/`. No game
imports another game.

### Game contract

Every game exposes the same metadata so the hub can render it without knowing
anything about it:

```ts
type GameCard = {
  slug: string;            // url segment, kebab-case
  title: string;           // "Bump Relay"
  pitch: string;           // ONE catchy sentence, ≤ 60 chars
  illustration: string;    // path, explicit at a glance
  players: [min: number, max: number];
  duration: string;        // "1–2 min"
  inputs: Array<'touch'|'motion'|'orientation'|'gps'|'compass'|'mic'>;
  modes: Array<{ id: string; name: string; blurb: string }>;
  status: 'live' | 'beta' | 'soon';
};
```

## 4. Budgets

| Budget | Target |
| --- | --- |
| Hub first load (gzipped) | ≤ 150 KB, illustrations lazy-loaded |
| Per-game load (gzipped) | ≤ 150 KB on top of the shared core |
| Time to interactive on 4G mid-range Android | ≤ 2.5 s |
| Realtime message size | ≤ 1 KB typical, ≤ 8 KB hard cap |
| Sensor sample rate sent over the wire | ≤ 20 Hz, always throttled |

Exceeding a budget is a `perf:` bug, not a fact of life.

## 5. Non-goals

- No native app, no store distribution, no push notifications.
- No user accounts, no persistent profiles, no leaderboards across rooms (for
  now — would need storage and a privacy review).
- No server-side rendering.
