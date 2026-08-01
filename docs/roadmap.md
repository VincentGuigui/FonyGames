# Roadmap & open decisions

## Milestones

| # | Milestone | Contents | State |
| --- | --- | --- | --- |
| M0 | **Foundations** | README, AGENTS/CLAUDE, docs index, conventions, hub spec, one game spec | ✅ done |
| M1 | **Decisions** | Validate the stack, hosting and the first game (see below) | ⏳ awaiting maintainer |
| M2 | **Walking skeleton** | `www/` builds; static hub with placeholder cards; no realtime yet | blocked by M1 |
| M3 | **Room core** | Realtime server, room create/join by link·QR·code, lobby, presence, reconnect | blocked by M2 |
| M4 | **First game live** | The validated flagship game, end-to-end on real phones, one mode | blocked by M3 |
| M5 | **Second & third games** | Prove `core/` is reusable; add modes to the flagship | |
| M6 | **Polish** | Illustrations, sounds, PWA shell, perf budgets enforced | |
| M7 | **Field test** | Real party, real phones; fix what confused people | |

## Open decisions (blocking M2)

Each needs an explicit yes from the maintainer (AGENTS.md §3.3). Record the
answer here *and* in the doc it affects.

| # | Decision | Options | Proposal |
| --- | --- | --- | --- |
| D1 | Build tooling | Vite + TypeScript · plain ES modules, no build · a framework | **Vite + TS** |
| D2 | UI layer | No framework (custom components + CSS) · Preact · Svelte | **No framework** for v1 |
| D3 | Realtime transport ⚠️ **now the critical one** | Self-hosted Node + `ws` · WebRTC data channels (peer-to-peer) · managed service (PartyKit / Cloudflare Durable Objects / Supabase Realtime) | D4 settled the *static* side only: the host serves files, and shared hosting usually neither runs a long-lived Node process nor proxies WebSocket upgrades. The host **does** give SSH access, so ask it whether persistent processes and a WebSocket reverse-proxy are allowed — if not, a managed realtime service is the answer |
| ~~D4~~ | ~~Hosting~~ | **DECIDED** — shared hosting, deployed over SFTP by GitHub Actions from `dev`/`prod`. See [deployment.md](deployment.md) | ✅ |
| D5 | Domain | `fonygames.*` — is one owned? | — |
| D6 | Flagship game to build first | Bump Relay (physical, iconic, needs 3+ players) · Tap Duel (simplest, proves the room core with 2 players) · Tilt Arena | **Tap Duel first as the technical pathfinder, Bump Relay as the flagship**, or go straight to Bump Relay if we accept a longer M4 |
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
| 2026-08-01 | Branch model `feature → dev → prod`, each of `dev`/`prod` auto-deploying to its own host via a same-named GitHub Environment | [deployment.md](deployment.md), [../AGENTS.md](../AGENTS.md) §5 |
| 2026-08-01 | Only `www/` is published; docs and repo metadata never reach the server | [deployment.md](deployment.md) §5 |
