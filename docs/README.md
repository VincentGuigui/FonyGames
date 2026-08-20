# Documentation index

Every rule, decision and specification of FonyGames lives here. If a statement
is made in a discussion, it belongs in one of these files.

## Project

| Doc | What's in it |
| --- | --- |
| [../README.md](../README.md) | Project pitch, principles, layout, game catalogue |
| [../AGENTS.md](../AGENTS.md) | Dev workflow, golden rules, definition of done |
| [roadmap.md](roadmap.md) | Milestones and **open decisions awaiting validation** |

## Technical

| Doc | What's in it |
| --- | --- |
| [architecture.md](architecture.md) | Stack proposal, runtime shape, budgets, hosting |
| [multiplayer.md](multiplayer.md) | Rooms, join flow, transport, state sync, latency |
| [realtime-options.md](realtime-options.md) | Survey of realtime backends for D3: load model, free tiers, price comparison |
| [realtime-server.md](realtime-server.md) | The room server: Durable Objects, hibernation, lifecycle, limits, local dev |
| [device-capabilities.md](device-capabilities.md) | Sensors, GPS, bump detection, permissions, privacy, fallbacks |
| [deployment.md](deployment.md) | Branch model, GitHub Environments, secrets, SFTP deploy, troubleshooting |
| [database.md](database.md) | MySQL: what it may hold, init + idempotent migration rules, local MariaDB |
| [testing.md](testing.md) | What we test, how, and on which devices |

## Conventions

| Doc | What's in it |
| --- | --- |
| [conventions/commits.md](conventions/commits.md) | Commit types, format, examples |
| [conventions/code-style.md](conventions/code-style.md) | Naming, file layout, TS/CSS rules |

## Design

| Doc | What's in it |
| --- | --- |
| [design/ui-guidelines.md](design/ui-guidelines.md) | Layout, type, colour, motion, game card anatomy |
| [design/illustrations.md](design/illustrations.md) | Where art lives, the `<img>` colour trap, sprites vs procedural |
| [design/game-chrome.md](design/game-chrome.md) | The gear menu, the pre-round rules panel, and the one-source rules array |

## Specifications

| Doc | What's in it |
| --- | --- |
| [specs/README.md](specs/README.md) | Spec index and game catalogue status |
| [specs/hub.md](specs/hub.md) | The hub (entry point) specification |
| [specs/backoffice.md](specs/backoffice.md) | Flags, the admin centre, stats — in PHP on the web host |
| [specs/seo.md](specs/seo.md) | Link previews, `og:` tags, and the hub's HTML rendered per request |
| [specs/i18n.md](specs/i18n.md) | English + French: browser detection, the shared picker, translating a card |
| [specs/game-spec-template.md](specs/game-spec-template.md) | Template for a new game spec |
| `specs/games/*.md` | One file per game |

---

**Adding a doc?** Create it in the right folder, then add a row here *and* in
the index in [../AGENTS.md](../AGENTS.md). An unindexed doc does not exist.
