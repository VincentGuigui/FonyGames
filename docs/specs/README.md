# Specifications index

Specs come **before** code (AGENTS.md §5). A game is not built until its spec is
written, registered here, and validated by the maintainer.

| Spec | What it covers | Status |
| --- | --- | --- |
| [hub.md](hub.md) | The entry point: game grid, cards, navigation | 📝 draft |
| [game-spec-template.md](game-spec-template.md) | Template to copy for a new game | ✅ stable |
| [join.md](join.md) | How players get into a room: link/code/QR, and the smart-join design | 📝 tier 1 built, tier 2 specced |
| [backoffice.md](backoffice.md) | Operator view: health, Cloudflare usage, aggregate activity | 📝 stub |

## Game catalogue

Each game is sold by **one illustration + one catchy sentence**. Status:
`💡 idea` (one-liner only) → `📝 draft` (spec written) → `✅ approved` →
`🚧 building` → `🎮 live`.

| Game | Catchy sentence | Input | Players | Status |
| --- | --- | --- | --- | --- |
| [Bump Relay](games/bump-relay.md) | *Smash phones together to pass the bomb before it blows* | bump / motion | 3–8 | 📝 draft |
| Shake Sprint | *Shake like your life depends on it — first to the finish wins* | motion | 2–8 | 💡 idea |
| Tilt Arena | *Tilt to steer, crash to win* | orientation | 2–6 | 💡 idea |
| Steady Hand | *Hold your phone perfectly still. Longer than everyone else* | motion | 2–8 | 💡 idea |
| [Tap Duel](games/tap-duel.md) | *The fastest thumb in the room takes the round* | touch | 2–8 | 🎮 `pistol` live · `sprint`/`simon` to come |
| Ghost Tag | *One ghost, a whole neighbourhood, and a map that only whispers* | GPS | 3–10 | 💡 idea |
| Zone Rush | *Claim real streets by standing on them longer than your rivals* | GPS | 2–10 | 💡 idea |
| Compass Hunt | *Follow the arrow to the treasure — so is everyone else* | compass + GPS | 2–10 | 💡 idea |
| Scream Meter | *Loudest wins. Your neighbours will not be thanked* | mic | 2–8 | 💡 idea |
| [Spill](games/spill.md) | *Fling your water at the neighbours before they flood you* | touch | 2–4 | 🎮 `ring` beta — numbers untested on a real table |
| [Goat Siege](games/goat-siege.md) | *Shoo the neighbours' goats before they eat your cabbages* | touch | 2–4 | 🎮 beta — balance untested |
| [Sling Puck](games/sling-puck.md) | *Sling every puck onto their side before they sling them back* | touch | 2 | 🎮 `classic` beta — puck count and gap width untested |

### Idea notes (not yet specs)

- **Shake Sprint** — shake energy drives an avatar down a track; modes: plain
  race, relay (pass the baton by bump), sabotage (spend energy to slow a rival).
- **Tilt Arena** — sumo/bumper-car arena on a shared board, phone tilt = thrust;
  modes: last-one-standing, football, king-of-the-hill.
- **Steady Hand** — inverse of shaking: lowest motion wins; modes: pure
  stillness, "surgeon" (stay still while the game tries to make you laugh),
  team average.
- **Tap Duel** — reaction and rhythm duels; modes: pistol duel (tap on the
  signal, false start = loss), tap sprint, Simon-style sequence.
- **Ghost Tag** — one hidden player, others hunt with distance-only hints;
  contact confirmed by bump; modes: classic tag, hot/cold, blackout.
- **Zone Rush** — the map is split into cells; standing in a cell claims it over
  time; modes: territory, capture-the-flag, walk-the-most-cells.
- **Compass Hunt** — a virtual treasure at a GPS point, players see only a
  heading arrow and a distance; modes: race, hot-potato treasure, team relay.
- **Scream Meter** — mic level battles; modes: loudest, longest note, quietest
  (whisper duel), choir (team sync).
- **Spill** — phones flat in a ring; flick your water onto a neighbour's phone,
  aiming by their real position on the table. Empty to win, 40 drops to lose.
  Rendering is theme-swappable (water / balloon / …). Full spec written.
- **Goat Siege** — lob goats into a neighbour's vegetable patch; shooing one
  splits it into two kids that scatter. Last cabbage standing wins. Full spec
  written.
- **Sling Puck** — *passe-trappe* on two phones nose to nose. Each phone
  simulates its own half of the board locally at 60 fps; the only thing on the
  wire is a puck crossing the gap, which is what keeps continuous physics inside
  the cheap cost profile. Full spec written.

Promote an idea by copying [game-spec-template.md](game-spec-template.md) to
`games/<slug>.md`, filling it, and updating the row above in a `spec:` commit.
