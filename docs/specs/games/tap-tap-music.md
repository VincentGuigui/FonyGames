# Tap Tap Music

> Status: **live**.

| | |
| --- | --- |
| **Slug** | `tap-tap-music` |
| **Catchy sentence** | *Five circles light up at once. A miss only costs the last ten* |
| **Illustration** | `www/src/games/tap-tap-music/art/card.svg` — a 10×10 grid of small circles, most hollow, five glowing orange across the grid |
| **Players** | 2–8 |
| **Round length** | 30 s – 2 min for a clean run; a rough one runs longer, capped at 3 min (§7) |
| **Inputs** | touch |
| **Accent colour** | `#FB923C` |
| **Status** | live |

## 1. Pitch

A hundred circles, all on screen at once. **Five are lit**, and any of them
can be tapped in any order. Tap a live one and it goes dark for good — and
another one lights up somewhere else on the grid, in an order only the
round knows, to keep five live at all times. Tap anything else — a dark
circle, or one already gone — and you fall back to your last checkpoint of
ten (§2.2): a real setback, never the whole board.

There is no score. Just a clock, running in hundredths, and whoever clears
all hundred first.

## 2. Core loop

1. Host starts the round. The referee deals one shuffled **order** — a
   fixed sequence of all 100 grid cells, shared by everyone, the same way
   Squash Mosquitoes deals one shared pattern (spec §6).
2. Everyone's board starts identical: the first five cells in `order` are
   lit, the other 95 dark and dim.
3. **Five cells are live at once, and any of them may be tapped in any
   order** — this is the core mechanic, not a variation. Tap a live cell:
   it goes **gone** (hollowed out), and the next not-yet-cleared cell in
   `order` lights up to keep five live. Each correct tap also plays the
   next note of the tune (§5b) and lights the matching mark on the
   timeline above the grid (§4) — wherever in `order` that cell happens to
   sit, since clearing is no longer sequential.
4. **Tap anything that is not one of the five live cells — dark, or
   already gone — and you fall back to your last checkpoint of ten
   (§2.2).** The rewind undoes your most recently tapped cells, in the
   order you actually tapped them — not necessarily the highest positions
   in `order`, since out-of-order clearing can leave gaps. Every cell
   undone returns to play (it re-enters the live window once its turn
   comes back around) and the timeline's matching marks lose their passed
   style. Nobody else's board is touched.
5. Clear all 100 and the clock stops. First to finish wins.

**Win condition:** first player to clear all 100 cells.
**Scoring:** none — see §12 for why a "no score" game still needs a
scoreboard, and what it shows instead.

### 2.1 Why a shared order, not a shared board — and five live, not one

Squash Mosquitoes already answered the first half of this (its own spec
§2): a pattern dealt once by the referee's own random source is fair in a
way a client-picked one cannot be, and dealing it once means every
player's board is the same shape, which is what makes "how far along is
everyone" a legible number instead of a coincidence. Tap Tap Music
reuses the exact mechanism — same `random()`, same "shared order, private
progress" split — for the same reason.

**Five cells live at once, tappable in any order, is the one respect in
which the built game differs from this spec's very first draft**, which
had exactly one cell lit at a time, cleared strictly in `order`. It was
requested directly and is the base mechanic now, not a mode or a
variation. It changes what a player's own progress actually is: no longer
a single index into `order` (`order[0..k-1]` cleared, `order[k]` lit), it
is the literal, possibly-out-of-order **set of cells they have actually
tapped**, recorded in the order they tapped them. `taptapWindow(order,
cleared)` in `shared/protocol.ts` is the one pure function that turns that
history plus the shared `order` back into "which five cells are live
right now" — the referee and the client both compute it from the same two
facts, so neither can disagree with the other about what is currently
tappable.

Where this game diverges from Squash Mosquitoes on purpose, beyond the
board-dealing mechanism: that game forgives a miss outright ("tapping
empty ground... does nothing," its spec §2) and rewards a hit by spawning
more targets. This game does the opposite on both counts — a hit removes
a target, and a miss costs real ground. Two different feelings from the
same board-dealing idea, not a copy of one.

### 2.2 A miss costs the streak back to the last checkpoint of ten

**As built**, replacing the draft's original "reset the whole board on any
miss": a player's cleared count is checked off in checkpoints of ten
(`TAPTAP_CHECKPOINT`), and a miss rewinds it to
`Math.floor(clearedCount / 10) * 10` — the last one crossed, never further
back — by undoing the **most recently tapped cells**, in the order they
were actually tapped. Because clearing can happen out of `order` (§2.1), a
rewind does not necessarily undo the highest positions in `order`: a
player who tapped cell 47 as their 3rd correct tap and cell 12 as their
13th, then missed, loses cell 12 (the most recent) back to the checkpoint
before it would ever touch cell 47 (tapped much earlier in their own
history, however far ahead it sits in `order`).

This was the spec's own §12 open question, drafted before any code and
flagged there as the single biggest one in the document — whether a full
reset is thrilling or just cruel is a fact about real hands on a real
phone. The answer that shipped is the checkpoint idea the draft recorded
as a softer alternative, not the harsher full-reset rule it originally
proposed as the base. A miss is never free — erasing up to nine correct
taps at a stretch is still a genuine cost, and clearing all 100 without a
single one still means something — but it is no longer possible for a
single mistap deep into a clean run to erase the entire run. The timeline
(§4) exists specifically to make this rule legible while it happens: which
cells are safe, and how far back a miss just sent you.

The harsher "reset to zero on any miss" is recorded below (§3) as the
unbuilt alternative, for a host who wants it — it never shipped as the
base rule.

## 3. Modes / variations

| Mode | Blurb | Difference from core |
| --- | --- | --- |
| `classic` | The loop above — a miss rewinds to the last checkpoint of ten | baseline |

Only `classic` at launch. Recorded, not built — both harsher than the base
rule, for a host who wants more risk than the checkpoint gives:

| Idea | Difference |
| --- | --- |
| `hardcore` | A miss resets the whole board to zero — the draft's original base rule, never shipped (§2.2) |
| `strikes` | Three misses allowed before a full reset, rather than one |

## 4. Screens

- **Lobby**: shared template. No host setting beyond `mode` — unlike Cat and
  Mouse or Neon Fall, nothing here is a per-round host choice.
- **Round**: a timeline above a 10×10 grid, portrait, one circle per cell. The
  grid spans the screen width minus its safe-area margins, while its square
  aspect keeps every circle round —
  visually a translation of Grid Attack's cell grid (spec
  [grid-attack.md](grid-attack.md) §4) from squares to circles, but this
  board is never split into halves: there is nothing here to attack, only
  your own hundred circles. Three visual states, never colour alone:
  **idle** (dim outline), **lit** (glowing, pulsing — up to five at once,
  §2.1), **gone** (hollow, faded, still tappable — spec §7). The status
  bar shows cells remaining (§2) and the running clock in `SS.CC`,
  hundredths visible enough to read while a thumb is moving.
- **The timeline** (as built, not in the original draft): a strip above the
  grid, one mark per position in the shared order — a hundred marks in the
  game's own accent colour, every tenth (a checkpoint, §2.2) drawn a little
  larger. A mark a player has correctly reached turns green and pulses
  once, the instant it is reached. **A checkpoint rewind is the whole
  reason this exists**: every mark past the checkpoint a miss just landed
  on loses its green style and reverts to the plain accent colour, so the
  player sees exactly which cells were just given back, not only that the
  remaining count went up. This is drawn from the shared order's *position*
  (0–99), never from a physical grid cell, so it reads the same "how far
  along am I" regardless of which of the hundred circles happens to be lit.
- **Results**: winner, and everyone's finish time in `SS.CC`, or their
  remaining count for whoever the safety cap caught mid-board.

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
too) — but the notes are lifted verbatim. The API is leaner than Shake
Rush's own, and deliberately so (`tune.ts`'s own docblock): a shake is
guessed locally and corrected from the server a beat later, but a tap here
is never guessed — every `taptap-progress` message (§6) already carries
the server's own confirmed cleared history — so the whole API is one
call, `seekTo(count)`, driven straight off how many cells that history
holds.

**Notes are indexed by tap count, not by position in `order`** — this is
the one place the "five at once, any order" mechanic (§2.1) had to change
the original single-target draft's design. Tap sequence #1 always plays
note #1 of the phrase, whichever of the hundred cells happened to be the
one actually tapped first; tap sequence #37 plays note #37 regardless of
where in `order` that 37th cleared cell sits. Advancing plays the notes
gained, one per correct tap. **A checkpoint rewind is silent** — the
timeline (§4) already carries its own unmistakable beat for a miss — and
because notes are indexed by count, the very next correct tap after a
rewind sings exactly the note it would have sung before the miss. The
shuffled *layout* changes every round; the *tune* a clean run produces
never does — that is what makes it recognisable at all.

## 6. Networking

Same split as Squash Mosquitoes (spec §6, §9): the order is public, dealt
once by the referee; each player's own cleared history is private, and
only its **count** goes out to everyone else.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `taptap-tap` | client → server | `{roundId, cell}` | A finger landed on grid cell `cell` |
| `taptap` | server → both | `{roundId, order, remaining: Record<PlayerId, number>, finishedAt: Record<PlayerId, number \| null>, winner, phase}` | The shared, public half — never anyone's specific cleared cells |
| `taptap-progress` | server → **one player only** | `{roundId, cleared: number[]}` | This player's own cleared cells, in the order they actually tapped them — `taptapWindow(order, cleared)` derives which five are live from this |

A shrink in `cleared`'s length from the last one sent is carried in the
same `taptap-progress` message a correct tap would have used — there is
no separate "you failed" message, the same way Squash Mosquitoes has no
separate message for a mosquito that was already squashed. The client
tells the difference by the length going down instead of up.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player leaves mid-round | Removed from the standings; everyone else's board is untouched — there was never anything shared between boards but the order |
| Everyone still in when the 3-minute safety cap hits | Ranked by cells remaining, fewest first; a tie in remaining is unranked between those players, same call Squash Mosquitoes makes at its own cap |
| A tap lands on a cell that is already gone, or one not currently among the five live | A miss, same as tapping any other wrong cell — rewinds to the last checkpoint (§2.2) |
| Two players finish in the same tick | The referee's own clock, not either client's, breaks the tie — whichever `finishedAt` it recorded first |
| Fewer than 2 players | Start disabled |
| A player refreshes mid-round | Same seat, same cleared history — a refresh does not reset the board, only a wrong tap does |

## 8. Anti-cheat

Same posture as Squash Mosquitoes (spec §8, "As built"): the client
reports a physical fact — which cell it tapped — and only the referee
knows what that meant for this specific player.

- **The order is dealt server-side**, from the referee's own random
  source, never a client's.
- **Every tap is checked against `taptapWindow(order, cleared)`, computed
  from the referee's own stored cleared history** for that player, not
  against anything the client claims about itself. A modified client
  cannot claim to be further along, to have cleared a cell it did not, or
  to have survived a miss it did not.
- **Finish time is the server's clock**, at the tick the 100th correct tap
  is processed — not a duration the client reports.

## 9. Safety

Lowest-risk category in the catalogue: seated, both thumbs, nothing
thrown, swung, or requiring anyone to move. No safety copy needed beyond
the shared "you are playing a game on your phone" baseline every screen
already carries.

## 10. Data & privacy

Leaves the phone: which cell was tapped, per tap; player id, name, avatar.
Never a cleared history or the order — those are the referee's to send
back, not the client's to declare. Room memory only, for the life of the
round.

## 11. Accessibility

- **This is still a fine-motor-precision game, and that disadvantages
  exactly the players Steady Hand's spec (§11) already named honestly for
  a different reason: a tremor, reduced dexterity, or an unfamiliar phone
  all make a slip more likely.** The checkpoint rule (§2.2) is the mitigation
  already in the base game — a miss costs at most nine cells rather than
  the whole board — and it is there for this reason as much as for feel.
  What is also true:
  - `hardcore` and `strikes` (§3) are recorded, harsher alternatives for a
    host who wants more risk than the checkpoint gives — never the
    default, and never forced on a room that has not asked for them.
  - Cells never rely on colour alone for their state (§4): idle, lit and
    gone differ by outline weight and fill, not hue. The timeline's passed
    marks are the one place colour (green) carries real information, and
    they are also the one place a shape change (the size step at every
    tenth) and a one-time animation carry the same information alongside
    it — never colour alone in isolation.
  - A checkpoint rewind is always announced with an unmissable visual beat
    on the timeline (§4) — the passed marks past the checkpoint losing
    their green style at once — never a silent, easy-to-miss change that
    would leave a player tapping a board that quietly stopped agreeing
    with them.
- No strobing. Lit cells pulse; they do not flash. The timeline's
  pulse-once animation respects `prefers-reduced-motion` (no animation,
  the colour change alone still carries the state).
- The clock and the remaining-count are both numbers, never a bar or a
  ring alone.

## 12. Open questions

- **Resolved**: a full reset on any miss was the single biggest open
  question in this spec before any code existed (§2.2's original text).
  The checkpoint rule shipped as the base game instead — real setback,
  never total — and `hardcore` (the original full-reset idea) is recorded
  in §3 rather than built. A live playtest, not a written argument,
  settled it in the checkpoint's favour.
- **Is ten cells the right checkpoint size?** Smaller checkpoints forgive
  more; larger ones make each individual miss matter more. Ten was chosen
  because it divides the 100-cell board evenly and gives the timeline a
  legible "every tenth mark is a checkpoint" rule (§4) — not because it was
  measured against a real round of misses.
- **Is five the right number of live cells?** More than one was requested
  directly (§2.1) and five is what shipped, but nothing about that number
  was measured against real thumbs — fewer live cells narrows the field
  and makes each one easier to find; more spreads attention thinner across
  a bigger grid search. `TAPTAP_WINDOW_SIZE` in `shared/protocol.ts` is the
  one constant to change if a playtest says otherwise.
- **"No score, shows the time" (the ask) vs. a live scoreboard (§4, §6) —
  is showing everyone's remaining count while the round runs too close to
  a score after all?** The brief asked for time-only, but with 2–8 players
  racing at once, some live sense of standing seems necessary to make the
  race legible — reusing the reversed convention.
- **`SS.CC` vs `MM:SS.CC`** — with the checkpoint rule softening how much a
  miss costs, is a round now more likely to run past 59.99 s than it was
  under the original harsher draft? If clean-and-rough runs both stay
  under a minute in practice, hundredths alone still read faster than a
  minutes place would.
- **Does the melody's own phrase (borrowed wholesale from Shake Rush)
  actually suit a tapping game**, whose rhythm is thumb-speed rather than
  shake-speed? It is free to reuse and it is the ask, but the two motions
  do not obviously sound the same.
- **Is 10×10 the right shape**, or would a taller, narrower grid (matching
  a phone's own aspect ratio more closely than a square does) make the far
  corners easier to reach one-handed?
