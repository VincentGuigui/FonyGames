# Squash Mosquitoes

| | |
| --- | --- |
| **Slug** | `squash-mosquitoes` |
| **Catchy sentence** | *Squash all 66 before anyone else does* |
| **Illustration** | `www/src/games/squash-mosquitoes/art/card.svg` — a purple mosquito silhouette crossed out inside a red no-entry circle |
| **Players** | 2–8 |
| **Round length** | ~1–2 min, hard cap 3 min |
| **Inputs** | touch |
| **Accent colour** | `#8A6DC9` (purple) |
| **Status** | 🎮 building |

## 1. Pitch

Everyone gets the same swarm — the same sixty-six hiding spots, in the same
order — on their own private screen. Squash one and two more appear. Squash
those and the swarm only grows. Halfway through they start flying. First
phone to clear its own sixty-six wins.

It is a solitaire board played at the same time as everyone else, which is
what makes it a party game rather than eight people staring at their own
phone in silence: the panel showing everyone's count is the whole social
payload, the same way Shake Rush's shared track is.

## 2. Core loop

1. The host starts. The referee deals **one shared pattern** — 66 of the
   grid's 117 possible spots, in a random order — and sends it to every
   phone at once. Play begins together, after the usual rules panel.
2. Each phone runs its **own** copy of the swarm, in that same order: one
   mosquito appears. Tap it to squash it.
3. Every squash spawns the **next two** unsquashed mosquitoes from the
   pattern. Squashing is what feeds the swarm — sit still and nothing new
   appears, but nothing chases you either.
4. Squashed mosquitoes are never removed. They stay on the board as a red
   smear, so late in a round the grid is a scoreboard of its own: a spreading
   stain of everywhere you have already hit.
5. The 34th mosquito spawned onward **flies** — while its visual size is chosen
   randomly as large, normal or small — wandering inside its own cell. A static
   swarm that size would be a chore, not a panic.
6. First phone to squash all 66 wins. The round ends the instant they do.

**Win condition:** first to 66 on your own board.
**Scoring:** how many you have squashed, shown for everyone (§6) — the same
number the win condition is counting toward, so a player who is not going to
win still has something to watch climb.

### 2.1 The spawn rule, precisely

> *At first, one mosquito appears. For each one squashed, the next two
> unspawned mosquitoes in the pattern appear.*

Each squash removes one mosquito from the board and (while any remain
unspawned) adds two, so the count of things alive at once climbs by roughly
one **every** squash — 1, then 2, then 3, then 4 — for as long as the pattern
still has fresh entries to give out. That climb is the difficulty curve, and
it needs no separate tuning: by the time the pattern is exhausted a fast
player can have twenty or thirty things alive on their own board at once,
purely from squashing quickly. A slow player never sees the swarm balloon,
because nothing spawns without a squash to pay for it — which is also why
this can never be a game you lose by doing nothing. Standing still just
means nobody plays it, not that it beats you.

### 2.2 Movement progression and random size are separate

Mosquito **N** in the pattern (1-indexed) is static for N ≤ 33 and flying for
N ≥ 34 — `SQUASH_STATIC_COUNT` in `shared/protocol.ts`. This movement progression
remains shared and deterministic. **Size is independent:** each phone rolls each
mosquito as large (120% of normal), normal, or small (the existing half-cell size)
when it first appears. Size is private cosmetic state and never travels on the wire.

- **Static** (1–33): the hitbox follows its random size. Slow and generous,
  because this half exists to let the swarm build before it gets hard.
- **Flying** (34–66): it wanders continuously inside the bounds of its own
  cell — never past the edge, because a mosquito that could drift into a
  neighbour's territory would make one cell's fate depend on another's. Its
  random size remains visible while it flies.

### 2.3 Each mosquito picks its own spot, and flies in to reach it

A swarm lined up dead-centre on every cell reads as a grid, not bugs. The
moment a phone first sees a mosquito active, it rolls that mosquito a
**target**: an offset from the cell's own centre, up to half a cell either
way on both axes. Static mosquitoes sit there for good; flying ones wander
around it exactly as before (§2.2) — the target is where the wander is
centred, not a replacement for it.

It also picks an entrance: one of the four screen edges, a point along that
edge, and a phase for its wiggle. Over the next 550 ms (`SQUASH_ENTRY_MS`,
`www/src/games/squash-mosquitoes/game.ts`) it flies in from there to its
target along a sine-wave path rather than a straight line — a perpendicular
wiggle that fades in and back out so the path still lands exactly on the
target. `www/src/games/squash-mosquitoes/game.test.ts` proves the pure
geometry: the path starts exactly at the entry point, ends exactly on the
target, and two mosquitoes given different phases do not swing in lockstep.

**Rolled once, per player, per mosquito.** Nobody else is ever shown this
board (§9), so there is nothing for two phones to disagree about, and
nothing here ever touches the wire. A new round rolls every mosquito a
fresh target and a fresh entrance — the previous round's scatter meant
nothing once the pattern's indices have been dealt out again.

## 3. Modes / variations

None. One board, one pattern shape, one rule for what flies. A mode picker
on a game this short would be ceremony nobody asked for.

## 4. Screens

- **Lobby**: the shared template. No safety line and no permission primer —
  this is touch on a still phone, the one input every device already has.
- **Round**: the grid fills the screen, over a real photo of skin
  (`art/skin.jpg` — the joke is that the board *is* skin, and the swarm is
  landing on it) — flat `#F0BEAC` behind it as a fallback for the one frame
  before the photo decodes, or if it never does. Mosquitoes are drawn as a
  cartoon bug (`art/mosquito.svg`); a squashed one (`art/mosquito-squashed.svg`)
  is flattened, crossed-eyed, and carries its own splat and blood drops —
  nothing is layered behind it in CSS. `StatusBar` carries your own squashed
  count — in red rather than `StatusBar`'s usual accent-on-the-number default,
  since the count here IS the blood; the accent (purple) moves to the label
  instead. The `Scoreboard` panel (bottom-right, `best="high"`) carries
  everyone else's, which is the entire live social read on the round — you
  cannot see anyone else's board, only how far along they are.

  **The swarm has a sound**: a continuous mid-pitched buzz, on for as long as the round
  is (`www/src/games/squash-mosquitoes/buzz.ts` — one sawtooth oscillator under a slow
  vibrato, so it reads as a wingbeat rather than a synth tone), toggled from the same
  `SoundToggle` idiom as Shake Rush's own tune. Purely ambient: it carries no state and
  is never retriggered per squash, unlike a per-tap cue would be.
- **Results**: the shared end screen ([../../design/game-chrome.md](../../design/game-chrome.md) §8) —
  the winner's avatar, everyone's count out of 66.

## 5. Inputs & sensors

Touch only, `pointerdown`. No sensor, no permission, no fallback needed — the
one game in the catalogue that asks nothing of the phone beyond a screen and
a finger.

## 6. Networking

Server-authoritative for every spawn and every squash. **Two kinds of state,
because two different audiences need them:**

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `squash-tap` | client → server | `{roundId, position}` | A finger landed on grid cell `position` |
| `squash` | server → clients | the whole `SquashState` | Pattern, `startsAt`/`endsAt`, everyone's squashed **count**, phase, winner |
| `squash-board` | server → **one** client | `{roundId, board}` | That player's own active and squashed pattern indices |

**`squash` is broadcast; `squash-board` is not.** Everyone's board is a
private race against the same pattern, and a phone showing anyone else's
would tell you where their next mosquito already is — a spoiler this game's
whole shape depends on not giving away. Only the *count* travels to
everybody, in `squash`, which is the one number the shared scoreboard needs
and the one number that reveals nothing about geometry.

**Positions, not pattern indices, cross the wire from the client.** A tap
reports the grid cell that was actually touched — the physical fact — and
the referee is the one that knows which pattern index (if any) lives there
for that player. This is the same shape as Grid Attack's `{cell, side}`:
the client says what happened, the server says what it meant.

**No coordinates for a flying mosquito are ever sent, in either direction.**
The wander is client-only cosmetics, seeded from the pattern index and drawn
as a pure function of server time — deterministic on any one phone, and
irrelevant to any other, because nobody else is shown this board at all
(spec §9). The referee only ever needs to know **which cell**, never
**where in the cell**.

### As built

The referee generates the pattern itself, with its own `random()` — the same
shape Ghost Hunt uses to place a ghost — rather than trusting a client to
deal a fair shuffle of its own hand. A phone cannot be the fairest source of
randomness for a game it is also playing.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player disconnects mid-round | Their board simply stops changing — there is no continuous tick to mark them "away" from, unlike Shake Rush's stream of shake reports. They rejoin to the same board, same count |
| Everyone disconnects | Round is abandoned, no result |
| The 3-minute cap arrives with nobody at 66 | Whoever has squashed the most wins. A tie for the lead is no winner, same as Spill's tied flood |
| A tap on an empty cell, or a squashed one, or one not yet spawned | Ignored. There is nothing there to squash |
| Two phones somehow claim the same pattern index (they cannot: boards are per-player) | Not reachable — no board is shared, so there is no race to referee between players, only within one player's own screen |

## 8. Anti-cheat

- **Squashing only ever changes state on the server.** The client renders
  what it is told, same as everywhere else.
- A tap names a **cell**, never a pattern index or a claim about what kind
  of mosquito was there — the referee is the only thing that knows either.
- Out-of-range cells, non-integers, a stale `roundId`, and a tap after the
  round is `done` are all dropped.
- There is nothing to gain from tapping faster than a finger can move: a
  cell with nothing alive in it does nothing no matter how it is hit, and
  the spawn rule already hands out two more the instant one is properly
  squashed — there is no queue to get ahead of by spamming.

## 9. Data & privacy

Leaves the phone: which cell was tapped, player id, name, avatar. Nobody's
board — including your own opponents' cell layouts — ever reaches another
player's screen; only the running total does.

## 10. Accessibility

- Every mosquito, static or flying, is a real element with a label naming
  its row and column, so the board is inspectable without tracking motion by
  eye.
- The squashed count is shown as a number in `StatusBar`, never implied by
  the state of the grid alone.
- Flying motion is small, contained to one cell, and never accelerates —
  nothing here approaches a flash-rate concern, but a player who prefers
  stillness has only the static half of the board to rely on for the last
  33, which is a real cost worth naming rather than hiding.

## 11. Open questions

- `SQUASH_STATIC_COUNT` at 33 (exactly half) is still a guess, untested by a real
  thumb against a real screen. `SQUASH_FLY_SCALE` started at ¼, was raised to
  ⅓ once real play found it too small a target, and then to ½.
- `SQUASH_ENTRY_MS` (550), `SQUASH_ENTRY_WIGGLE` (18px) and `SQUASH_ENTRY_WAVES`
  (2) are all first guesses, same as the rest of this section — a real table
  might want the swarm to fly in faster, or wiggle more or less on the way.
- Is the doubling spawn rule too generous? A fast squasher can end up
  fighting twenty-plus mosquitoes at once near the end of the pattern purely
  from their own success — thrilling or overwhelming, and only a table of
  real players will say which.
- The 9×13 grid (117 cells for 66 mosquitoes) leaves 51 cells that never see
  a spawn all round. Untested whether that reads as "room to move" or as
  dead space on a small phone screen.
- Should a flying mosquito's wander speed pick up the later it is in the
  pattern, the way Grid Attack's fuse accelerates? Not built — everything
  currently flies at one speed.
