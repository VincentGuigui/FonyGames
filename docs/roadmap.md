# Roadmap & open decisions

## Milestones

| # | Milestone | Contents | State |
| --- | --- | --- | --- |
| M0 | **Foundations** | README, AGENTS/CLAUDE, docs index, conventions, hub spec, one game spec | ✅ done |
| M1 | **Decisions** | Stack, hosting, realtime and first game all settled | ✅ done |
| M2 | **Walking skeleton** | Vite+TS+Preact build; static hub with card grid and placeholder art; no realtime | ✅ done |
| M3 | **Room core** | Durable Object, client, and lobby (code · link · QR · presence · reconnect) | ✅ done |
| M4 | **First game live** | Tap Duel `pistol` mode end-to-end: armed → fire → result, server-refereed | ✅ done |
| M5 | **Second & third games** | `core/sensors` (motion + bump) built and tested; Bump Relay **server complete**, phone UI still to build | 🔨 in progress |
| M5b | **Two new games** | [Spill](specs/games/spill.md) **playable end to end** (table-position aiming, two themes, `npm test` harness); [Goat Siege](specs/games/goat-siege.md) spec written, not built | 🔨 in progress |
| M6 | **Polish** | Illustrations, sounds, PWA shell, perf budgets enforced | |
| M7 | **Field test** | Real party, real phones; fix what confused people | |
| M8 | **Backoffice** | Health, Cloudflare usage vs free tier, aggregate activity, **feature flags per game**. Spec: [specs/backoffice.md](specs/backoffice.md) | |
| M9 | **Smart join** | Draw-across-devices join (flagship) + shake-together fallback. Spec: [specs/join.md](specs/join.md) | |

## Open decisions

Each needs an explicit yes from the maintainer (AGENTS.md §3.3). Record the
answer here *and* in the doc it affects.

| # | Decision | Options | Proposal |
| --- | --- | --- | --- |
| ~~D1~~ | ~~Build tooling~~ | **DECIDED** — Vite + TypeScript (`strict`) | ✅ |
| ~~D2~~ | ~~UI layer~~ | **DECIDED** — Preact + plain CSS, design tokens in `core/ui/theme.css` | ✅ |
| ~~D3~~ | ~~Realtime transport~~ | **DECIDED** — Cloudflare Durable Objects on the free plan, WebSocket transport. Full survey: [realtime-options.md](realtime-options.md) | ✅ |
| ~~D4~~ | ~~Hosting~~ | **DECIDED** — shared hosting, deployed over SFTP by GitHub Actions from `dev`/`prod`. See [deployment.md](deployment.md) | ✅ |
| ~~D5~~ | ~~Domain~~ | **DECIDED** — `guigui.fr`, with `fonygames.` (prod) and `fonygames-dev.` (dev) subdomains | ✅ |
| ~~D6~~ | ~~First build~~ | **DECIDED** — hub shell first (M2, done), then Tap Duel as the room-core pathfinder | ✅ |
| ~~D7~~ | ~~Local preferences storage~~ | **DECIDED** — `sessionStorage` for the seat id (dies with the tab), `localStorage` for name and avatar (persists between visits). Never game data | ✅ |
| D8 | Language / i18n | English only · English + French from the start | **English only** in v1, keep strings in one file |
| D9 | Sound | Required from M4 · added in M6 | **M6**, but never load-bearing (UI guidelines §7) |
| D10 | Linter/formatter | ESLint + Prettier · Biome · none | **Biome** (one tool, fast) |

## Deferred (explicitly not now)

- Accounts, profiles, cross-room leaderboards.
- Native app or store distribution — a **non-goal**, not a deferral.
- Server-side persistence of any kind.
- Spectator streaming / big-screen companion view.
- Monetisation.

## Log of accepted decisions

| Date | Decision | Where it's written |
| --- | --- | --- |
| 2026-08-01 | Docs-first workflow, commit convention, three golden rules | [../AGENTS.md](../AGENTS.md), [conventions/commits.md](conventions/commits.md) |
| 2026-08-01 | Hub sells a game with one illustration + one catchy sentence | [design/ui-guidelines.md](design/ui-guidelines.md), [specs/hub.md](specs/hub.md) |
| 2026-08-01 | Mobile web only, no install, no accounts, nothing persisted | [../README.md](../README.md), [architecture.md](architecture.md) |
| 2026-08-01 | **D4 hosting**: shared host, deployed by GitHub Actions over SFTP | [deployment.md](deployment.md) |
| 2026-08-01 | ~~Branch model `feature → dev → prod`~~ — superseded below. `dev`/`prod` auto-deploy to their own host via a same-named GitHub Environment | [deployment.md](deployment.md), [../AGENTS.md](../AGENTS.md) §5 |
| 2026-08-02 | **Branch model**: `main` is trunk and default branch (deploys nothing); `dev`/`prod` are fast-forwarded from `main` to deploy. Work branches are `feat/` · `fix/` · `docs/` · `chore/`. Replaces the vendor-prefixed default branch the repo was created with | [conventions/commits.md](conventions/commits.md), [deployment.md](deployment.md), [../AGENTS.md](../AGENTS.md) §5 |
| 2026-08-02 | **The realtime layer does not have to be PHP.** The PHP host keeps serving the static hub; the WebSocket service is a separate deployment | [realtime-options.md](realtime-options.md) §2, §7 |
| 2026-08-02 | **WebRTC rejected as the foundation.** Same-room players on mixed 4G/WiFi have no local path; mobile CGNAT forces TURN relay, so the latency win disappears while the complexity stays. Reconsider only for a same-WiFi offline mode | [realtime-options.md](realtime-options.md) §5 |
| 2026-08-02 | **D3 realtime**: Cloudflare Durable Objects, free plan, WebSocket. One object per room is a platform primitive; outgoing messages are free | [realtime-options.md](realtime-options.md) |
| 2026-08-02 | **MySQL is available on the host** but is not used for game state. Any use requires an init script plus idempotent migrations; local MariaDB for tests | [database.md](database.md) |
| 2026-08-01 | ~~Only `www/` is published~~ — superseded: `www/` is source, the built `dist/` is what ships | [deployment.md](deployment.md) §5 |
| 2026-08-02 | **D5 domain**: `guigui.fr` — `fonygames.guigui.fr` (prod), `fonygames-dev.guigui.fr` (dev). Room server on `*.vincent-f02.workers.dev` | [realtime-server.md](realtime-server.md) §6 |
| 2026-08-02 | **Smart join**: "draw across devices on a table" is the flagship — the only method that also yields relative device positions. Shake-together is the fallback; bump is rejected for joining (pairwise). GPS is a coarse gate, never proof | [specs/join.md](specs/join.md) |
| 2026-08-02 | **Backoffice activity metrics are anonymous aggregates only** — no per-player tracking, ever. Otherwise the about-sheet privacy promise becomes a lie | [specs/backoffice.md](specs/backoffice.md) §1 |
| 2026-08-02 | **A page refresh must keep your seat, name and host role.** Seat id in `sessionStorage` (per tab); host promotion deferred by `HOST_GRACE_MS` so reloading does not hand the role away | [realtime-server.md](realtime-server.md) §4 |
| 2026-08-02 | **Spill aims by physical table position**, using assigned seats plus one convention — *top edge toward the middle of the table* — rather than the compass. No permission, no flaky sensor. M9's draw-across-devices calibration later replaces the manual arrangement | [specs/games/spill.md](specs/games/spill.md) §2 |
| 2026-08-02 | **Continuously-animated games send trajectories, never positions.** A goat is a deterministic arc, so one message describes the whole flight. Keeps action games in Profile A of the cost model instead of Profile B | [specs/games/goat-siege.md](specs/games/goat-siege.md) §5 |
| 2026-08-02 | **D7 local storage**: `localStorage` for name/avatar (persists between visits), `sessionStorage` for the seat id (dies with the tab). Chosen over a cookie — the server never reads either, so a cookie would only add bytes to every request | [specs/games/tap-duel.md](specs/games/tap-duel.md) §10 |
| 2026-08-02 | **Feature flags per game**: three states (`active` / `disabled` / `hidden`), separate per environment, held in a singleton Durable Object. dev always shows every game with a badge stating its real state. Enforced in the Worker, not just hidden on the hub — a shared link bypasses the grid. In-flight games finish. Fail-open, so a flag is not a security control | [specs/backoffice.md](specs/backoffice.md) §2b |
| 2026-08-02 | **D1/D2 stack**: Vite + TypeScript (`strict`) + Preact + plain CSS. **D6**: hub shell first, then Tap Duel | [architecture.md](architecture.md) §2 |
| 2026-08-02 | **One shared geometry module per game that needs it.** Spill's seating maths lives in `shared/`, imported by both the Worker and the browser, in one handedness (canvas: x right, y down, clockwise from up). Writing it twice is how aiming ends up silently mirrored | [specs/games/spill.md](specs/games/spill.md) §2 |
| 2026-08-02 | **The Durable Object has one alarm slot, so all scheduling goes through `#rearm()`**, which takes the earliest deadline across seat housekeeping and every game. Each subsystem arming the alarm itself meant whichever ran last cancelled the others | [realtime-server.md](realtime-server.md) §4 |
| 2026-08-02 | **A dropped socket is not a departure.** Spill only removes a player when their seat is actually reaped, so a refresh keeps their water. Bump Relay is the deliberate exception — the bomb cannot sit on an empty seat | [specs/games/spill.md](specs/games/spill.md) §8 |
| 2026-08-02 | **A second theme is part of building a theme interface.** One implementation proves nothing; `balloon` exists because balloons are discrete objects rather than a liquid, which is what forced `Theme` to be a real abstraction | [specs/games/spill.md](specs/games/spill.md) §6 |
| 2026-08-02 | **`npm test` exists**: game modules are written against a `Ctx` interface and driven through a fake one with a controlled clock. No new dependency (esbuild ships with Vite). D10 would change the runner, not the shape | [testing.md](testing.md) §1.1 |
