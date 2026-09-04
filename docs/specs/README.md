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
| [analytics.md](analytics.md) | The Cloudflare beacon, the activity log, and the admin dashboard | ✅ built |

## Game catalogue

Each game is sold by **one illustration + one catchy sentence**. Status:
`💡 idea` (one-liner only) → `📝 draft` (spec written) → `✅ approved` →
`🚧 building` → `🎮 live`.

| Game | Catchy sentence | Input | Players | Status |
| --- | --- | --- | --- | --- |
| Random game | *Can't decide? Let the dice choose for you* | touch | 1–10 | 🎮 built — a redirector, not a spec'd game; picks any built game at random |
| [Pass the Bomb](games/pass-the-bomb.md) | *Smash phones together to pass the bomb before it blows* | bump / motion | 3–8 | 🎮 beta — untested on real phones bumping |
| [Shake Rush](games/shake-rush.md) | *Shake like your life depends on it — first to the finish wins* | motion | 2–8 | 🎮 beta — distance and threshold untested on real arms |
| [Steady Hand](games/steady-hand.md) | *Hold your phone perfectly still. Longer than everyone else* | motion | 2–8 | 🎮 beta — tolerance curve untested on real hands |
| [Tap Duel](games/tap-duel.md) | *The fastest thumb in the room takes the round* | touch | 2–8 | 🎮 `pistol` live · `sprint`/`simon` to come |
| [Tap Fighter](games/tap-fighter.md) | *Pick six moves, then watch the fight unfold* | touch | 2 | 🎮 beta — balance and animation timing untested on two real phones |
| [Ghost Hunt](games/ghost-hunt.md) | *Sweep the room for ghosts only your phone can see* | orientation + camera | 2–10 | 🎮 beta — cone and dwell untested in a real room |
| [Spill](games/spill.md) | *Fling your water at the neighbours before they flood you* | touch | 2–4 | 🎮 `ring` beta — numbers untested on a real table |
| [Goat Siege](games/goat-siege.md) | *Shoo the neighbours' goats before they eat your cabbages* | touch | 2–4 | 🎮 beta — balance untested |
| [Sling Puck](games/sling-puck.md) | *Sling every puck onto their side before they sling them back* | touch | 2 | 🎮 `classic` beta — puck count and gap width untested |
| [Cat and Mouse](games/cat-and-mouse.md) | *One cat, a floor full of mice, and nowhere to hide* | touch | 2–6 | ✅ `chase` built · beta |
| [Grid Attack](games/grid-attack.md) | *Break their grid before they break yours* | touch | 2 | 🎮 beta — the **only landscape board**; two-second fuse untested by two people in a room |
| [Squash Mosquitoes](games/squash-mosquitoes.md) | *Squash all 66 before anyone else does* | touch | 2–8 | 🚧 building |
| [Neon Fall](games/neon-fall.md) | *Dodge five lanes of neon fire, or shoot down what falls* | orientation + touch | 2 | 🎮 beta — plain `<canvas>`; numbers untested on real phones tilting |
| [Tap Tap Music](games/tap-tap-music.md) | *Switch off every lamp as fast as you can* | touch | 2–8 | 🎮 beta — checkpoint and window size untested on real thumbs |
| [Tic-Tac-Tic-Tac-Toe](games/tic-tac-tic-tac-toe.md) | *Win the little boards to conquer the big one* | touch | 2 | 📝 draft — awaiting approval |
| [100 Taps](games/hundred-taps.md) | *Find them in order. Fastest fingers win* | touch | 2–8 | 🎮 beta — checkpoint size, window size and pitch curve untested on real thumbs |
| [UFO Hunt](games/ufo-hunt.md) | *One saucer, everyone's lasers. Highest score wins* | orientation + camera | 2–10 | 🎮 beta — scope, cooldown and round-length numbers untested on real thumbs |
| [Aliens love cows](games/aliens-love-cows.md) | *Pick a barn. Dodge the beam* | touch | 2–8 | 🎮 beta — the hover/transit/abduction timing and a full 8-cow pileup on one barn untested on real thumbs |
| [Tiles Surfer](games/tiles-surfer.md) | *Tap the tile the instant it hits the line* | touch | 1–8 | 🎮 beta — spawn cadence, safety cap and difficulty curve untested on real thumbs |
| [Gravity Shooter](games/gravity-shooter.md) | *Bend your shot around a planet and blow up their ship* | touch | 2 | 🎮 beta — gravity strength and hit radius untested on real thumbs |
| [Asteroid Race](games/asteroid-race.md) | *Dodge the rocks, blast the rest, get there first* | orientation + touch | 1–8 | 🎮 beta — the field's own numbers untested on real thumbs ([#24](https://github.com/VincentGuigui/FonyGames/issues/24)) |

### Idea notes (not yet specs)

- **Tap Duel** — reaction and rhythm duels; modes: pistol duel (tap on the
  signal, false start = loss), tap sprint, Simon-style sequence.
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
- **Neon Fall** — one player tilts a glowing glider smoothly across five
  unmarked lanes as it falls; the other has five lane-aligned triggers and a
  three-shot burst to shoot it down before it lands. No score, win or lose.
  Full spec written and approved; a PixiJS spike measured ~221 KB gzipped
  for the minimal import, over the whole per-game budget on its own, so it
  builds on a plain `<canvas>` instead, same as Goat Siege and Spill. Built
  and verified end to end in the browser.
- **Tap Tap Music** — 100 circles, **five live at once, tappable in
  any order**, from a shared, server-dealt order; a correct tap clears it
  and plays the next note of Shake Rush's own melody (which is already
  exactly 100 notes long, keyed to tap count rather than grid position), a
  wrong tap rewinds to the last checkpoint of ten rather than resetting
  the whole board — the softer of the two ideas §12 originally recorded,
  shipped as the base rule instead of the harsher full-reset the draft
  proposed. A timeline above the grid — a hundred accent-coloured marks,
  every tenth larger, passed ones turning green — makes a player's
  position and any rewind legible at a glance, even with clearing now
  happening out of order. First to clear all 100 wins, no score, just the
  clock. Built and verified end to end in the browser.
- **100 Taps** — Tap Tap Music's sibling, with the reveal mechanic removed:
  all 100 numbers are shuffled onto the grid and visible from the start, so
  a player already knows what's next (their own cleared count plus one) and
  the task is finding where it landed, rather than watching a moving window
  of live cells. A later pass added a window back in a different form
  (games/hundred-taps.md's own 2026-08-25 note): every number is still
  always visible, but only the next ten due are ever tappable at once,
  everything else a real disabled button — bounding the search without
  hiding anything. No music track — each tap plays a note a little higher
  than the last, from a formula rather than a fixed melody, so a checkpoint
  rewind naturally drops the pitch back down with it. The same checkpoint-
  of-ten rewind rule is reused unchanged. Cells are coloured by a computed
  gradient, pink (top-right) to violet (bottom-left), pure decoration —
  every cell always shows its own number regardless of state. Built and
  verified end to end in the browser: shared shuffle, gradient rendering,
  correct-tap advance, the tappable window sliding with progress and with a
  rewind, checkpoint rewind, and first-to-100 win all confirmed against a
  real Worker with two players.
- **UFO Hunt** — Ghost Hunt's own aiming and permission model (phone-aim,
  camera as scenery, per-player calibration, no compass) reused directly,
  with a new core loop: the invisible ghost becomes a visible, animated
  saucer, and instead of racing each other to separate targets, everyone
  fires at the **same shared health bar** — co-op damage, competitive
  scoring. A fixed center crosshair replaces the dial; tap anywhere to fire,
  and the closer the saucer was to center at that instant, the more damage
  (10 dead-center, linear down to 0 at the edge of the scope). A saucer's
  health starts at 50 and the next one is always 50 tougher. Camera and
  orientation are both hard-required with no fallback this time — a
  deliberate departure from Ghost Hunt's own "every denial has a landing
  place" design, argued in the spec. Built and verified end to end against a
  real Worker: solo mode, the permission primer granting both sensors from one
  tap, repeated dead-centre shots dropping the shared health bar and crediting
  score at the rate the impact formula predicts, and a kill spawning the next,
  tougher wave. Caught and fixed one real bug this way — the camera's video
  element was never receiving its stream on the round screen, because the
  effect attaching it depended only on the permission being granted, which
  happens in the lobby before that element even exists.

Promote an idea by copying [game-spec-template.md](game-spec-template.md) to
`games/<slug>.md`, filling it, and updating the row above in a `spec:` commit.
