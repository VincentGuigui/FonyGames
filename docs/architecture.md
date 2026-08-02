# Architecture

> **Status: the stack is decided and in place.** Remaining open questions are
> tracked in [roadmap.md](roadmap.md). Adding a *new* dependency still needs a
> yes from the maintainer (rule §3.3 in [../AGENTS.md](../AGENTS.md)).

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

## 2. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript, `strict` ✅ **decided** | Catch sensor/state bugs before the phone does |
| Build | Vite ✅ **decided** | Fast, multi-page friendly |
| UI | **Preact** + plain CSS ✅ **decided** | ~4 KB; component state without the payload of React |
| Rendering | DOM + CSS for UI, `<canvas>` only where a game needs it | Cheaper, more accessible |
| Realtime | WebSocket, JSON messages | Universally supported on mobile browsers |
| Server | **Cloudflare Durable Objects** — one object per room ✅ **decided** | Room affinity is a platform primitive; free at our scale ([realtime-options.md](realtime-options.md)) |
| Hosting | Static `www/` on the PHP host via SFTP ✅ **decided** | [deployment.md](deployment.md) |
| Persistence | MySQL on the host, via PHP, **outside the game loop** | [database.md](database.md) |
| PWA | Manifest + offline shell later, **never** an install requirement | Zero friction rule |

WebRTC data channels were evaluated and **rejected** as the transport
([realtime-options.md](realtime-options.md) §5).

## 3. Source layout

`www/` is **source**. The browser never sees it — Vite compiles it to `dist/`,
and `dist/` is what the deploy uploads ([deployment.md](deployment.md) §5).

```
package.json            scripts: dev · build · typecheck
tsconfig.json
vite.config.ts          root: www/ · outDir: dist/
www/
  index.html            hub entry            } multi-page: one real index.html
  tap-duel/index.html   game entry           } per route, no SPA rewrite needed
  public/               copied verbatim (favicon, later: illustrations)
  src/
    main.tsx            mounts the hub
    tap-duel.tsx        mounts the Tap Duel lobby
    core/               shared runtime used by every game
      types.ts          the GameCard contract the hub reads
      room/             room code, WebSocket client, server URL mapping
      sensors/          motion, orientation, geolocation, bump, mic   (TODO)
      ui/               theme tokens, QR code, shared components
    hub/                catalogue rendering, cards, placeholder art
    lobby/              the shared lobby: code, share, QR, presence
    games/
      registry.ts       the catalogue the hub renders
      <slug>/           one folder per built game
        game.ts         core loop
        modes.ts        mode/variation definitions
        card.ts         hub metadata: title, pitch, illustration, tags
shared/                 wire protocol, imported by BOTH www/ and worker/
  protocol.ts           message envelope and types
  names.ts              silly player names + avatars
worker/                 the room server (docs/realtime-server.md)
  index.ts              router: origin check, code check, idFromName
  Room.ts               the Durable Object — one per room
wrangler.jsonc          Worker config + the irreversible SQLite migration
dist/                   build output — generated, gitignored, deployed
```

**Rules:**
- A game only talks to the outside world through `core/`. No game imports
  another game.
- A game that is still `soon` lives as an entry in `games/registry.ts`. When it
  is actually built it gets a folder and its card moves to
  `games/<slug>/card.ts`, which the registry then imports.

### Commands

| | |
| --- | --- |
| `npm run dev` | Vite dev server, bound to `0.0.0.0` so a phone on the LAN can open it |
| `npm run build` | `tsc --noEmit` then `vite build` → `dist/` |
| `npm run typecheck` | Types only — site **and** worker (two tsconfigs) |
| `npm run worker:dev` | `wrangler dev` on :8787, fully local |

### Game contract

Every game exposes the same metadata so the hub can render it without knowing
anything about it. Source of truth: `www/src/core/types.ts`.

```ts
type GameCard = {
  slug: string;            // url segment, kebab-case
  title: string;           // "Bump Relay"
  pitch: string;           // ONE catchy sentence, ≤ 60 chars
  motif: GameMotif;        // placeholder art until real illustrations (M6)
  accent: string;          // '#RRGGBB', from the game's spec
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
