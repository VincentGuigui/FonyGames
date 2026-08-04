# <Game Name>

> Copy this file to `docs/specs/games/<slug>.md`, fill every section, register
> the game in [../specs/README.md](README.md), commit as
> `spec: add <Game Name> game spec`. Delete the quoted instructions as you go.
> Nothing gets built before this is approved.

| | |
| --- | --- |
| **Slug** | `kebab-case` (folder + URL) |
| **Catchy sentence** | One line, ≤ 60 chars, imperative or second person, no period |
| **Illustration** | `www/src/games/<slug>/art/card.svg` — describe it in one line |
| **Players** | min–max |
| **Round length** | e.g. 1–2 min |
| **Inputs** | touch / motion / orientation / gps / compass / mic |
| **Accent colour** | `#RRGGBB` |
| **Status** | idea / draft / approved / building / live |

## 1. Pitch

Two or three sentences for contributors (the *card* only ever shows the one
catchy sentence). What does it feel like to play?

## 2. Core loop

The one paragraph that explains the game to a player in the lobby, then the
loop as steps:

1. …
2. …
3. …

**Win condition:** …
**Scoring:** …

## 3. Modes / variations

| Mode | Blurb (one line, shown in the lobby) | Difference from core |
| --- | --- | --- |
| `classic` | | baseline |
| | | |

Every mode shares the core loop. A mode that doesn't is a different game.

## 4. Screens

Lobby → primer → countdown → round → results. Describe anything that differs
from the standard flow in [../multiplayer.md](../multiplayer.md), and sketch the
round screen (what's big, what's live, what the player looks at).

## 5. Inputs & sensors

Which sensors, at what rate, with which thresholds. Reference the shared
definitions in [../device-capabilities.md](../device-capabilities.md) rather
than redefining them.

**Fallbacks** (mandatory): what happens when each permission is denied or the
sensor is missing.

## 6. Networking

Messages this game adds on top of the core envelope, who is authoritative for
what, and how it tolerates 100–300 ms of latency.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| | | | |

## 7. Failure & edge cases

Player leaves mid-round, host leaves, too few players, permission denied,
weak GPS, backgrounded tab, everyone loses simultaneously, ties.

## 8. Anti-cheat

How the obvious exploit is neutralised (shaking constantly, spoofing GPS,
faking a bump, tapping with ten fingers). Plausibility checks the server runs.

## 9. Safety

Mandatory for motion and GPS games. The exact copy shown to players and the
limits enforced (time cap, play area, "gently").

## 10. Data & privacy

Exactly what leaves the phone, at what precision, and for how long it exists.
Default: relayed within the room, never stored.

## 11. Accessibility

How a player with reduced motion, low vision, or no sound can still play, and
which mode is the accessible one if the main mechanic can't be adapted.

## 12. Open questions

Anything needing maintainer validation before build.
