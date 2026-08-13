# FonyGames

**Silly multiplayer games for the phone already in your pocket.**

FonyGames is a hub of short, funny, **multiplayer games that run in a mobile web
browser**. No app store, no install, no account: someone shares a link, everyone
taps it, the game starts. Games use what a phone actually has — touch, motion,
bump, tilt, compass, GPS, mic, vibration — so they feel physical instead of
being yet another screen.

> Status: **four games playable** — Tap Duel, Spill, Goat Siege and Sling Puck —
> on a Cloudflare Durable Object room server. All in beta: none has yet been
> played by real people in a real room, which is milestone M7 and the only thing
> that can settle the balance numbers. See [docs/roadmap.md](docs/roadmap.md).

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
worker/   the room server — Cloudflare Durable Objects
shared/   wire protocol and game maths used by both sides
dist/     build output — generated, gitignored, deployed
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
| In-game chrome (gear menu, rules panel) | [docs/design/game-chrome.md](docs/design/game-chrome.md) |
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

| Game | Pitch | Main input | State |
| --- | --- | --- | --- |
| **[Tap Duel](docs/specs/games/tap-duel.md)** | *The fastest thumb in the room takes the round.* | Touch | 🎮 `pistol` playable |
| **[Spill](docs/specs/games/spill.md)** | *Fling your water at the neighbours before they flood you.* | Touch | 🎮 playable, beta |
| **[Pass the Bomb](docs/specs/games/pass-the-bomb.md)** | *Smash phones together to pass the bomb before it blows.* | Bump / motion | 🎮 playable, beta |
| **[Goat Siege](docs/specs/games/goat-siege.md)** | *Shoo the neighbours' goats before they eat your cabbages.* | Touch | 🎮 playable, beta |
| **[Sling Puck](docs/specs/games/sling-puck.md)** | *Sling every puck onto their side before they sling them back.* | Touch | 🎮 playable, beta |
| **[Cat and Mouse](docs/specs/games/cat-and-mouse.md)** | *One cat, a floor full of mice, and nowhere to hide.* | Touch | ✅ built, beta |
| **[Shake Rush](docs/specs/games/shake-rush.md)** | *Shake like your life depends on it — first to the finish wins.* | Motion | 📝 spec written |
| **Tilt Arena** | *Tilt to steer, crash to win.* | Orientation | 💡 idea |
| **[Steady Hand](docs/specs/games/steady-hand.md)** | *Hold your phone perfectly still. Longer than everyone else.* | Motion | 🎮 playable, beta |
| **Ghost Tag** | *One ghost, a whole neighbourhood, and a map that only whispers.* | GPS | 💡 idea |
| **Zone Rush** | *Claim real streets by standing on them longer than your rivals.* | GPS | 💡 idea |
| **Ghost Hunt** | *Sweep the room for ghosts only your phone can see.* | Tilt + camera | 📝 draft |
| **Scream Meter** | *Loudest wins. Your neighbours will not be thanked.* | Microphone | 💡 idea |

Full index and status: [docs/specs/README.md](docs/specs/README.md).

---

## Getting started

```bash
npm install
npm run worker:dev     # the room server on :8787
npm run dev            # the site on :5173, reachable from a phone on the LAN
```

Both are needed: the site is static, and every multiplayer round goes through
the Worker. Then `npm run typecheck && npm test` before committing.

Contributors should read [AGENTS.md](AGENTS.md) first — it indexes everything
else.
