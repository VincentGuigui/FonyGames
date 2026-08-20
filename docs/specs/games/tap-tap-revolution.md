# Tap Tap Revolution

> Status: **draft**, awaiting validation. No code yet.

| | |
| --- | --- |
| **Slug** | `tap-tap-revolution` |
| **Catchy sentence** | *Chase the lit circle. Miss once and the song starts over* |
| **Illustration** | `www/src/games/tap-tap-revolution/art/card.svg` — a 10×10 grid of small circles, most hollow, one glowing orange mid-grid |
| **Players** | 2–8 |
| **Round length** | Highly variable — a clean run is well under a minute; a slip near the end can cost the whole thing (spec §12) |
| **Inputs** | touch |
| **Accent colour** | `#FB923C` |
| **Status** | draft |

## 1. Pitch

A hundred circles, all on screen at once. Exactly one is lit. Tap it and it
goes dark for good — and the next one lights up, somewhere else on the
grid, in an order only the round knows. Tap anything else and the whole
board comes back, lit from the very first circle again.

There is no score. Just a clock, running in hundredths, and whoever clears
all hundred first.

## 2. Core loop

1. Host starts the round. The referee deals one shuffled **order** — which
   of the 100 grid cells lights up 1st, 2nd, ... 100th — shared by everyone,
   the same way Squash Mosquitoes deals one shared pattern (spec §6).
2. Everyone's board starts identical: cell `order[0]` lit, the other 99
   dark and dim.
3. Tap the lit cell: it goes **gone** (hollowed out, like a burst Grid
   Attack cell) and `order[1]` lights up. Each correct tap also plays the
   next note of the tune (§5b).
4. **Tap anything that is not the lit cell — gone or merely dark — and your
   own board resets.** Every gone cell returns, the lit cell goes back to
   `order[0]`, and the tune rewinds to its first note. Nobody else's board
   is touched.
5. Clear all 100 and the clock stops. First to finish wins.

**Win condition:** first player to clear all 100 cells.
**Scoring:** none — see §12 for why a "no score" game still needs a
scoreboard, and what it shows instead.

### 2.1 Why a shared order, not a shared board

Squash Mosquitoes already answered this (its own spec §2): a pattern dealt
once by the referee's own random source is fair in a way a client-picked
one cannot be, and dealing it once means every player's board is the same
shape, which is what makes "how far along is everyone" a legible number
instead of a coincidence. Tap Tap Revolution reuses the exact mechanism —
same `random()`, same "shared order, private progress" split — for the
same reason.

Where it diverges from Squash Mosquitoes on purpose: that game forgives a
miss outright ("tapping empty ground... does nothing," its spec §2) and
rewards a hit by spawning more targets. This game does the opposite on
both counts — a hit removes a target and a miss punishes hard. Two
different feelings from the same board-dealing idea, not a copy of one.

### 2.2 The reset is the whole game, and it is genuinely harsh

Named plainly rather than softened: a slip on cell 99 costs cells 1 through
99 as much as a slip on cell 1 would. There is no partial credit, no
checkpoint, no "three strikes." That is not an oversight — it is the thing
that makes clearing all 100 mean something — but it is also, honestly, the
single biggest open question in this spec (§12): whether that is thrilling
or just cruel is a fact about real hands on a real phone, not something
this document can settle by writing confidently about it.

## 3. Modes / variations

| Mode | Blurb | Difference from core |
| --- | --- | --- |
| `classic` | The loop above | baseline |

Only `classic` at launch. Recorded, not built — both softer than the base
rule, because the base rule is already the hard version:

| Idea | Difference |
| --- | --- |
| `forgiving` | A miss costs only the current streak back to the last **ten**, not the whole board — checkpoints every ten cells |
| `strikes` | Three misses allowed before a reset, rather than one |

## 4. Screens

- **Lobby**: shared template. No host setting beyond `mode` — unlike Cat and
  Mouse or Neon Fall, nothing here is a per-round host choice.
- **Round**: the 10×10 grid fills the screen, portrait, one circle per
  cell — visually a translation of Grid Attack's cell grid (spec
  [grid-attack.md](grid-attack.md) §4) from squares to circles, but this
  board is never split into halves: there is nothing here to attack, only
  your own hundred circles. Three visual states, never colour alone:
  **idle** (dim outline), **lit** (glowing, pulsing, the one live target),
  **gone** (hollow, faded). The status bar shows cells remaining (§2) and
  the running clock in `SS.CC`, tenths visible enough to read while a thumb
  is moving.
- **A reset**: a brief, unmistakable beat across the whole board — every
  gone cell redrawing at once — not a silent snap back. Missing this
  feedback would make a reset feel like a bug rather than the rule.
- **Results**: winner, and everyone's finish time or "reset ×N, did not
  finish" for whoever the safety cap caught mid-board.

## 5. Inputs & sensors

Touch only — a tap on a cell. No sensors, no permissions, no fallback
needed because there is nothing to fall back from.

### 5b. One note per correct tap, reusing Shake Rush's exact song

`RUSH_DISTANCE` — Shake Rush's shake count — is already **100**
([shared/protocol.ts](../../../shared/protocol.ts)), and this board is
already **100** cells. That is not engineered; it is why this spec reuses
Shake Rush's melody outright rather than writing a new one: the same
`PHRASE`/`MELODY` split (a fifty-four-note phrase, twice, docs in
`shake-rush/melody.ts`) already lands exactly on a hundred-tap board with
nothing to trim or pad.

Copied into this game's own `melody.ts`/`tune.ts` rather than imported
from `shake-rush/` — every game's sound, like its `card.ts`, is its own
file (docs/design/illustrations.md §3's leaf-file reasoning applies here
too) — but the notes and the `createTune()`-shaped API
(`step()`/`finish()`/`rewind()`/`seek()`/mute persistence under this
game's own storage key) are lifted verbatim. `step()` fires on every
**correct** tap; a reset calls `rewind()`, so the song restarts from its
first note exactly when the board does — the ear and the eye tell the same
story.

The order players hear notes in is fixed to **tap sequence**, not to grid
position: tap #1 always plays note #1 of the phrase, tap #37 always plays
note #37, regardless of which of the 100 cells `order[36]` happens to be
this round. The shuffled *layout* changes every round; the *tune* a clean
run produces never does — that is what makes it recognisable at all.

## 6. Networking

Same split as Squash Mosquitoes (spec §6, §9): the order is public, dealt
once by the referee; each player's own progress is a single number, and
only its **count** goes out to everyone else.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `taptap-tap` | client → server | `{roundId, cell}` | A finger landed on grid cell `cell` |
| `taptap` | server → both | `{roundId, order, remaining: Record<PlayerId, number>, finishedAt: Record<PlayerId, number \| null>, winner, phase}` | The shared, public half — never anyone's specific progress index |
| `taptap-progress` | server → **one player only** | `{roundId, index}` | This player's own position in `order` — which cell is lit, which are gone (`order[0..index-1]`) |

`index` resetting to 0 is carried in the same `taptap-progress` message a
correct tap would have used — there is no separate "you failed" message,
the same way Squash Mosquitoes has no separate message for a mosquito that
was already squashed. The client tells the difference by the number going
down instead of up.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player leaves mid-round | Removed from the standings; everyone else's board is untouched — there was never anything shared between boards but the order |
| Everyone still in when the safety cap hits | Ranked by cells remaining, fewest first; a tie in remaining is unranked between those players, same call Squash Mosquitoes makes at its own cap |
| A tap lands on a cell that is already gone | A miss, same as tapping any other wrong cell — resets |
| Two players finish in the same tick | The referee's own clock, not either client's, breaks the tie — whichever `finishedAt` it recorded first |
| Fewer than 2 players | Start disabled |
| A player refreshes mid-round | Same seat, same progress index — a refresh does not reset the board, only a wrong tap does |

## 8. Anti-cheat

Same posture as Squash Mosquitoes (spec §8, "As built"): the client
reports a physical fact — which cell it tapped — and only the referee
knows what that meant for this specific player.

- **The order is dealt server-side**, from the referee's own random
  source, never a client's.
- **Every tap is checked against the referee's own stored progress
  index** for that player, not against anything the client claims about
  itself. A modified client cannot claim to be further along, or to have
  survived a miss it did not.
- **Finish time is the server's clock**, at the tick the 100th correct tap
  is processed — not a duration the client reports.

## 9. Safety

Lowest-risk category in the catalogue: seated, both thumbs, nothing
thrown, swung, or requiring anyone to move. No safety copy needed beyond
the shared "you are playing a game on your phone" baseline every screen
already carries.

## 10. Data & privacy

Leaves the phone: which cell was tapped, per tap; player id, name, avatar.
Never a progress index or the order — those are the referee's to send
back, not the client's to declare. Room memory only, for the life of the
round.

## 11. Accessibility

- **This is a fine-motor-precision game with a zero-forgiveness penalty,
  and that combination disadvantages exactly the players Steady Hand's
  spec (§11) already named honestly for a different reason: a tremor,
  reduced dexterity, or an unfamiliar phone all turn one slip into the
  whole board.** No tuning fixes that outright, and this spec does not
  pretend one number would. What is worth doing, and is in scope for the
  base mode:
  - `forgiving` and `strikes` (§3) exist specifically as the softer modes a
    host who knows their group can reach for.
  - Cells never rely on colour alone for their state (§4): idle, lit and
    gone differ by outline weight and fill, not hue.
  - A reset is always announced with an unmissable visual + audio beat
    (§4, §5b's `rewind()`), never a silent, easy-to-miss snap back that
    would leave a player tapping a board that quietly stopped agreeing
    with them.
- No strobing. The lit cell pulses; it does not flash.
- The clock and the remaining-count are both numbers, never a bar or a
  ring alone.

## 12. Open questions

- **Is a full reset on any miss fun, or just cruel?** §2.2 already says
  this plainly: it is the single biggest open question in this whole
  spec, and only a real playtest with real thumbs answers it. `forgiving`
  and `strikes` (§3) are the two obvious knobs if the answer is "too
  harsh," recorded rather than built so the base rule gets a fair test
  first.
- **"No score, shows the time" (the ask) vs. a live scoreboard (§4, §6) —
  is showing everyone's remaining count while the round runs too close to
  a score after all?** The brief asked for time-only, but with 2–8 players
  racing at once, some live sense of standing seems necessary to make the
  race legible — reusing the reversed convention.
- **`SS.CC` vs `MM:SS.CC`** — is a round ever realistically going to run
  past 59.99 s given how harsh a reset is? If yes, the clock needs a
  minutes place; if a clean run is always well under a minute, hundredths
  alone read faster.
- **Does the melody's own phrase (borrowed wholesale from Shake Rush)
  actually suit a tapping game**, whose rhythm is thumb-speed rather than
  shake-speed? It is free to reuse and it is the ask, but the two motions
  do not obviously sound the same.
- **Is 10×10 the right shape**, or would a taller, narrower grid (matching
  a phone's own aspect ratio more closely than a square does) make the far
  corners easier to reach one-handed?
