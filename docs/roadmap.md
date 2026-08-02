# Roadmap & open decisions

## Milestones

| # | Milestone | Contents | State |
| --- | --- | --- | --- |
| M0 | **Foundations** | README, AGENTS/CLAUDE, docs index, conventions, hub spec, one game spec | ✅ done |
| M1 | **Decisions** | Stack, hosting, realtime and first game all settled | ✅ done |
| M2 | **Walking skeleton** | Vite+TS+Preact build; static hub with card grid and placeholder art; no realtime | ✅ done |
| M3 | **Room core** | Durable Object + client done and tested; **lobby UI still to build** | 🔨 in progress |
| M4 | **First game live** | Tap Duel end-to-end on real phones, one mode | blocked by M3 |
| M5 | **Second & third games** | Prove `core/` is reusable; add modes to the flagship | |
| M6 | **Polish** | Illustrations, sounds, PWA shell, perf budgets enforced | |
| M7 | **Field test** | Real party, real phones; fix what confused people | |

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
| D7 | Local preferences storage | No storage at all · `localStorage` for name/avatar/last mode only | **Local-only preferences**, never game data |
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
| 2026-08-02 | **D1/D2 stack**: Vite + TypeScript (`strict`) + Preact + plain CSS. **D6**: hub shell first, then Tap Duel | [architecture.md](architecture.md) §2 |
