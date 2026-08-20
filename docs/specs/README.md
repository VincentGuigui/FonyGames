# Specifications index

Specs come **before** code (AGENTS.md §5). A game is not built until its spec is
written, registered here, and validated by the maintainer.

| Spec | What it covers | Status |
| --- | --- | --- |
| [hub.md](hub.md) | The entry point: game grid, cards, navigation | 📝 draft |
| [game-spec-template.md](game-spec-template.md) | Template to copy for a new game | ✅ stable |
| [join.md](join.md) | How players get into a room: link/code/QR, and the smart-join design | 📝 tier 1 built, tier 2 specced |
| [backoffice.md](backoffice.md) | Operator view: health, Cloudflare usage, aggregate activity, feature flags. **PHP on the web host** | 🚧 building |
| [seo.md](seo.md) | Link previews (`og:`/`twitter:`), and the hub's HTML rendered by PHP per request | 🚧 building |
| [i18n.md](i18n.md) | English + French: browser detection, the shared picker, translating a card | ✅ built |

## Game catalogue

Each game is sold by **one illustration + one catchy sentence**. Status:
`💡 idea` (one-liner only) → `📝 draft` (spec written) → `✅ approved` →
`🚧 building` → `🎮 live`.

| Game | Catchy sentence | Input | Players | Status |
| --- | --- | --- | --- | --- |
| [Pass the Bomb](games/pass-the-bomb.md) | *Smash phones together to pass the bomb before it blows* | bump / motion | 3–8 | 🎮 beta — untested on real phones bumping |
| [Shake Rush](games/shake-rush.md) | *Shake like your life depends on it — first to the finish wins* | motion | 2–8 | 🎮 beta — distance and threshold untested on real arms |
| Tilt Arena | *Tilt to steer, crash to win* | orientation | 2–6 | 💡 idea |
| [Steady Hand](games/steady-hand.md) | *Hold your phone perfectly still. Longer than everyone else* | motion | 2–8 | 🎮 beta — tolerance curve untested on real hands |
| [Tap Duel](games/tap-duel.md) | *The fastest thumb in the room takes the round* | touch | 2–8 | 🎮 `pistol` live · `sprint`/`simon` to come |
| Ghost Tag | *One ghost, a whole neighbourhood, and a map that only whispers* | GPS | 3–10 | 💡 idea — **name clashes with Ghost Hunt** |
| Zone Rush | *Claim real streets by standing on them longer than your rivals* | GPS | 2–10 | 💡 idea |
| [Ghost Hunt](games/ghost-hunt.md) | *Sweep the room for ghosts only your phone can see* | orientation + camera | 2–10 | 🎮 beta — cone and dwell untested in a real room; **name still clashes with Ghost Tag** |
| Scream Meter | *Loudest wins. Your neighbours will not be thanked* | mic | 2–8 | 💡 idea |
| [Spill](games/spill.md) | *Fling your water at the neighbours before they flood you* | touch | 2–4 | 🎮 `ring` beta — numbers untested on a real table |
| [Goat Siege](games/goat-siege.md) | *Shoo the neighbours' goats before they eat your cabbages* | touch | 2–4 | 🎮 beta — balance untested |
| [Sling Puck](games/sling-puck.md) | *Sling every puck onto their side before they sling them back* | touch | 2 | 🎮 `classic` beta — puck count and gap width untested |
| [Cat and Mouse](games/cat-and-mouse.md) | *One cat, a floor full of mice, and nowhere to hide* | touch | 2–6 | ✅ `chase` built · beta |
| [Grid Attack](games/grid-attack.md) | *Break their grid before they break yours* | touch | 2 | 🎮 beta — the **only landscape board**; two-second fuse untested by two people in a room |
| [Squash Mosquitoes](games/squash-mosquitoes.md) | *Squash all 66 before anyone else does* | touch | 2–8 | 🚧 building |

### Idea notes (not yet specs)

- **Tilt Arena** — sumo/bumper-car arena on a shared board, phone tilt = thrust;
  modes: last-one-standing, football, king-of-the-hill.
- **Tap Duel** — reaction and rhythm duels; modes: pistol duel (tap on the
  signal, false start = loss), tap sprint, Simon-style sequence.
- **Ghost Tag** — one hidden player, others hunt with distance-only hints;
  contact confirmed by bump; modes: classic tag, hot/cold, blackout.
- **Zone Rush** — the map is split into cells; standing in a cell claims it over
  time; modes: territory, capture-the-flag, walk-the-most-cells.
- **Scream Meter** — mic level battles; modes: loudest, longest note, quietest
  (whisper duel), choir (team sync).
- **Spill** — phones flat in a ring; flick your water onto a neighbour's phone,
  aiming by their real position on the table. Empty to win, 40 drops to lose.
  Rendering is split behind a `Theme` interface, with water the one look shipped.
  Full spec written.
- **Goat Siege** — lob goats into a neighbour's vegetable patch; shooing one
  splits it into two kids that scatter. Last cabbage standing wins. Full spec
  written.
- **Cat and Mouse** — one player is the cat, the rest are mice on one shared
  floor; drag your own icon and it stops the moment you let go. Three lives each.
  The **first Profile B game** in the catalogue — the cat and the mice have to see
  each other, so positions genuinely go on the wire. Full spec written; awaiting a
  go-ahead before any code.
- **Sling Puck** — *passe-trappe* on two phones nose to nose. Each phone
  simulates its own half of the board locally at 60 fps; the only thing on the
  wire is a puck crossing the gap, which is what keeps continuous physics inside
  the cheap cost profile. Full spec written.

Promote an idea by copying [game-spec-template.md](game-spec-template.md) to
`games/<slug>.md`, filling it, and updating the row above in a `spec:` commit.
