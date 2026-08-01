# FonyGames

**Silly multiplayer games for the phone already in your pocket.**

FonyGames is a hub of short, funny, **multiplayer games that run in a mobile web
browser**. No app store, no install, no account: someone shares a link, everyone
taps it, the game starts. Games use what a phone actually has — touch, motion,
bump, tilt, compass, GPS, mic, vibration — so they feel physical instead of
being yet another screen.

> Status: **bootstrapping**. Specs and conventions first, code next.
> Tech stack is proposed, not frozen — see
> [docs/roadmap.md](docs/roadmap.md) for the open decisions.

---

## The idea in three lines

1. Open `fonygames` on your phone → the **hub** shows a grid of games.
2. Each game is sold by **one illustration and one catchy sentence**.
3. Pick a game, pick a **mode**, share the room link/code, play together.

---

## Principles

| | |
| --- | --- |
| **Mobile web only** | Portrait, one-handed, thumb-reachable. No install. |
| **≤ 3 taps to play** | Link → game → go. Friction kills party games. |
| **Physical** | Sensors over buttons whenever it makes the game funnier. |
| **Short rounds** | 30 s to 3 min. Then "again?". |
| **Together** | Every game is multiplayer-first, same room or across town. |
| **Safe** | Gentle bumps only. Never ask a player to run into traffic. |

---

## Repository layout

```
docs/     documentation and specifications
www/      source code of the site (hub + games)
```

- **[AGENTS.md](AGENTS.md)** — dev workflow and rules (start here to contribute).
- **[CLAUDE.md](CLAUDE.md)** — pointer to `AGENTS.md` for AI agents.

---

## Documentation

Full index: **[docs/README.md](docs/README.md)**

| Topic | Doc |
| --- | --- |
| Architecture & tech stack | [docs/architecture.md](docs/architecture.md) |
| Multiplayer & networking | [docs/multiplayer.md](docs/multiplayer.md) |
| Sensors, GPS, bump, permissions | [docs/device-capabilities.md](docs/device-capabilities.md) |
| UI / UX guidelines | [docs/design/ui-guidelines.md](docs/design/ui-guidelines.md) |
| Commit convention | [docs/conventions/commits.md](docs/conventions/commits.md) |
| Code style | [docs/conventions/code-style.md](docs/conventions/code-style.md) |
| Testing | [docs/testing.md](docs/testing.md) |
| Roadmap & open decisions | [docs/roadmap.md](docs/roadmap.md) |

## Specifications

Index: **[docs/specs/README.md](docs/specs/README.md)**

- [Hub specification](docs/specs/hub.md) — the game selection entry point.
- [Game spec template](docs/specs/game-spec-template.md) — copy this for a new game.
- Game specs live in `docs/specs/games/`.

### Game catalogue (candidates)

| Game | Pitch | Main input |
| --- | --- | --- |
| **Bump Relay** | *Smash phones together to pass the bomb before it blows.* | Bump / motion |
| **Shake Sprint** | *Shake like your life depends on it — first to the finish wins.* | Motion |
| **Tilt Arena** | *Tilt to steer, crash to win.* | Orientation |
| **Steady Hand** | *Hold your phone perfectly still. Longer than everyone else.* | Motion |
| **Tap Duel** | *The fastest thumb in the room takes the round.* | Touch |
| **Ghost Tag** | *One ghost, a whole neighbourhood, and a map that only whispers.* | GPS |
| **Zone Rush** | *Claim real streets by standing on them longer than your rivals.* | GPS |
| **Compass Hunt** | *Follow the arrow to the treasure — everyone else is following it too.* | Compass + GPS |
| **Scream Meter** | *Loudest wins. Your neighbours will not be thanked.* | Microphone |

Only [Bump Relay](docs/specs/games/bump-relay.md) is fully specified so far; the
rest are one-liners awaiting validation before being written up.

---

## Getting started

Nothing to run yet — `www/` is empty on purpose until the stack is validated.
Contributors should read [AGENTS.md](AGENTS.md) first.
