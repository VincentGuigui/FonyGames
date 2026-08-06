# Architecture

> **Status: the stack is decided and in place.** Remaining open questions are
> tracked in [roadmap.md](roadmap.md). Adding a *new* dependency still needs a
> yes from the maintainer (rule §3.3 in [../AGENTS.md](../AGENTS.md)).

## 1. Shape of the product

```
                    ┌──────────────────────────┐
   phone browser →  │  Hub + games             │  deployed by SFTP to the
                    │  on the PHP host: assets │  host's /www
                    │  static, HTML per request│
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

- **The assets are static; the HTML is rendered per request by PHP.** Everything a
  browser downloads — JS, CSS, SVG, PNG — is a content-hashed build artefact. The
  page around it is assembled by PHP from markup the build generated, so the
  operator can disable a game and the served HTML changes with no rebuild
  ([specs/seo.md](specs/seo.md) §4). PHP authors no markup of its own; that would
  be a second copy of the components, and it would drift.
- **Gameplay has no database.** A Durable Object holds one room's state in
  memory and is the referee; the room's state dies with the room, by design.
- A **MySQL** database exists on the host and is **not part of the game loop**. It
  is reachable only from PHP, never from the Durable Object — see
  [database.md](database.md) for why, and for the migration rules. Its first real
  use is the backoffice: feature flags and aggregate counters.
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
| Page HTML | **PHP on the host**, from build-generated markup | Flags without a rebuild, and a crawler sees the catalogue ([specs/seo.md](specs/seo.md)) |
| Backoffice | **PHP + MySQL**, same origin as the hub | Sessions, `hash_equals` and `mail()` come with the platform ([specs/backoffice.md](specs/backoffice.md)) |
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
  public/               copied verbatim: favicon, .htaccess, robots.txt, og/*.png
                        (NOT illustrations — design/illustrations.md §2 says why)
  src/
    main.tsx            mounts the hub
    tap-duel.tsx        mounts the Tap Duel lobby
    core/               shared runtime used by every game
      types.ts          the GameCard contract the hub reads
      art/              SVG → canvas sprite loader (illustrations.md §4)
      room/             room code, WebSocket client, server URL mapping
      sensors/          motion + bump built; orientation, GPS, mic still TODO
      ui/               theme tokens, QR code, shared components
    hub/                catalogue rendering and cards
    lobby/              the shared lobby: code, share, QR, presence
    games/
      registry.ts       the ordered catalogue: one import per game, nothing else
      <slug>/           one folder per game, INCLUDING the `soon` ones
        card.ts         hub metadata — a leaf, see the rule below
        art/            card.svg (the hub illustration) + any sprites
        game.ts         core loop            } built games only
        modes.ts        mode/variation definitions
shared/                 wire protocol, imported by BOTH www/ and worker/
  protocol.ts           message envelope and types
  players.ts            per-game player limits — a leaf, imported by every card
  names.ts              silly player names + avatars
  spillGeometry.ts      } game maths both sides must agree on
  goatSplit.ts          }
  catMouse.ts           }
worker/                 the room server (docs/realtime-server.md)
  index.ts              router: origin check, code check, idFromName
  Room.ts               the Durable Object — one per room
  bumpRelay.ts          Bump Relay round logic, driven through a Ctx interface
  spill.ts              } one referee per game, same Ctx shape, each with a
  goatSiege.ts          } .test.ts beside it (docs/testing.md §1.1)
  slingPuck.ts          }
  catMouse.ts           }
api/                    PHP: flags, the admin centre, counters. The only thing that
  lib/                  can reach MySQL (database.md §3). Tested by api/tests/run.php
  tests/                on plain `php`, wired into `npm test`
db/                     init.sql + idempotent migrations (database.md §4)
wrangler.jsonc          Worker config + the irreversible SQLite migration
dist/                   build output — generated, gitignored, deployed
  _hub/                 shell + one rendered <li> per card variant, read by index.php
  index.php             the hub, assembled per request (specs/seo.md §4)
```

**Rules:**
- A game only talks to the outside world through `core/`. No game imports
  another game.
- **Game logic that both sides must agree on goes in `shared/`; logic only one
  side can see does not.** Spill's seat geometry and Goat Siege's split lanes are
  shared because the server refereeing them has to compute the same answer. Sling
  Puck's physics is *not*, and deliberately: each phone simulates its own half of
  the board and nobody else can see it, so there is no second copy to agree with
  ([specs/games/sling-puck.md](specs/games/sling-puck.md) §4). Cat and Mouse is the
  in-between case and shows what the rule is really for: the client moves an icon
  and the server rules on whether that move was legal, so the *speed limit* is
  shared while the walking that obeys it is not
  ([specs/games/cat-and-mouse.md](specs/games/cat-and-mouse.md) §9).
- **Every game has a folder, built or not.** A `soon` game's folder holds only
  `card.ts` and `art/card.svg`, so removing a game is one `git rm -r` plus one
  line out of `registry.ts`.
- **A `card.ts` is a leaf.** It may import only `core/types`, `shared/players`
  and its own `art/`. The hub imports every card, so one import of a game's
  runtime puts *every* game in the hub chunk — guarded by
  `www/src/games/cards.test.ts`. Full contract:
  [design/illustrations.md](design/illustrations.md).
- **Art is a file, not code.** Illustrations and sprites are `.svg` under
  `games/<slug>/art/`, imported with `?url&no-inline` so Vite cannot base64 them
  into a chunk. They therefore cannot use `currentColor` or CSS variables — an
  `<img>` has no access to the page's stylesheet
  ([design/illustrations.md](design/illustrations.md) §3).

### Commands

| | |
| --- | --- |
| `npm run dev` | Vite dev server, bound to `0.0.0.0` so a phone on the LAN can open it |
| `npm run build` | `tsc --noEmit` then `vite build` → `dist/` |
| `npm run typecheck` | Types only — site **and** worker (two tsconfigs) |
| `npm test` | Game-logic harness on plain Node ([testing.md](testing.md) §1.1) — every game's referee, plus Sling Puck's board physics — **and** the PHP suite |
| `npm run test:php` | The PHP half alone, on plain `php`. No framework, same shape as the Node harness |
| `npm run worker:dev` | `wrangler dev` on :8787, fully local |

`output.experimentalMinChunkSize` is set for a reason worth knowing: a `card.ts`
imported by both the hub and its own game page is split into a ~700-byte shared
chunk, and the hub imports all thirteen — four extra requests on the one page with a
first-load target. Absorbing chunks that small into their importers duplicates a few
hundred bytes and keeps the hub at one request.

Each game page is its own Vite entry (`rollupOptions.input`) with a real
`index.html`, so static hosting serves `/spill/` straight from disk and needs no
SPA rewrite. Today: `hub`, `tap-duel`, `spill`, `goat-siege`, `sling-puck`.
**Adding a game means adding an entry there** as well as a card in the registry. Rollup resolves those paths from the working directory, not from
Vite's `root`.

### Game contract

Every game exposes the same metadata so the hub can render it without knowing
anything about it. Source of truth: `www/src/core/types.ts`.

```ts
type GameCard = {
  slug: string;            // url segment, kebab-case
  title: string;           // "Bump Relay"
  pitch: string;           // ONE catchy sentence, ≤ 60 chars
  art: { src: string;      // from `import … from './art/card.svg?url&no-inline'`
         alt: string };    // what it SHOWS — required, ui-guidelines §6
  accent: string;          // '#RRGGBB', from the game's spec — also in card.svg
  players: PlayerLimits;   // from shared/players.ts, so it cannot drift
  duration: string;        // "1–2 min"
  inputs: Array<'touch'|'motion'|'orientation'|'gps'|'compass'|'mic'>;
  modes: Array<{ id: string; name: string; blurb: string }>;
  status: 'live' | 'new' | 'soon';   // badge, order and tappability, in one switch
};
```

## 4. Budgets

| Budget | Target |
| --- | --- |
| Hub first load (gzipped) | ≤ 150 KB, illustrations **excluded** — they ship as separate hashed `.svg` assets, never base64 inside a chunk. Proof: `grep -c 'data:image/svg' dist/assets/hub-*.js` is 0. Baseline for the chunk itself: 3,444 bytes on 2026-08-04 |
| Server-rendered HTML | Counts toward the hub budget. The grid markup is in the document as well as in the JS (the client needs the component to hydrate), so **both numbers are recorded** on any change — a smaller chunk is not a win if the HTML grew more. Measured 2026-08-06: 2,851 bytes of gzipped HTML, 2,074 for the hub chunk, **17,110 bytes for the whole first load** including CSS and the shared chunks |
| Per-game load (gzipped) | ≤ 150 KB on top of the shared core. A game page imports **its own card only**, never the registry, so it does not carry the other twelve |
| Time to interactive on 4G mid-range Android | ≤ 2.5 s |
| Realtime message size | ≤ 1 KB typical, ≤ 8 KB hard cap |
| Sensor sample rate sent over the wire | ≤ 20 Hz, always throttled |

Exceeding a budget is a `perf:` bug, not a fact of life.

## 5. Non-goals

- No native app, no store distribution, no push notifications.
- No user accounts, no persistent profiles, no leaderboards across rooms (for
  now — would need storage and a privacy review).
- **No client-side routing.** Each game is a real page ([§3](#3-source-layout)).
- No framework on the server. PHP concatenates strings the build produced; it does
  not render components ([specs/seo.md](specs/seo.md) §4).
