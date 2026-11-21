# Merge Rush

| | |
| --- | --- |
| **Slug** | `merge-rush` |
| **Catchy sentence** | Slide, merge, climb. Out-score the whole room |
| **Illustration** | `www/src/games/merge-rush/art/card.svg` — a 4×4 grid of coloured tiles, a few merged into bigger ones, an arrow sweeping across it |
| **Players** | 1–8 |
| **Round length** | 2 min (Time Attack), 3 min (Highlander), a race until somebody makes the tile |
| **Inputs** | touch |
| **Accent colour** | `#F472B6` |
| **Status** | 🎮 beta |

## 1. Pitch

The sliding-tile merge puzzle, in a room. Everyone gets the same starting board
and slides tiles to merge equal numbers into bigger ones, each on their own
phone. A strip of thumbnails shows everyone else's board as pure colour, so you
can watch the room climb — or panic — without a single number to read, and tap
any of them to watch that board live. Three modes (§3): the best score in two
minutes, a race to a tile, and a puzzle merged down to one.

## 2. Core loop

1. The host picks a mode (§3). The referee draws a **seed** and the round
   starts on a 3·2·1, every phone on the **same starting board** (§2.1) — a
   puzzle in Highlander.
2. Swipe (or tap an arrow) to slide every tile as far as it goes in that
   direction. Two equal tiles that meet merge into one of double the value.
3. A move that changed the board spawns one new tile — a 2, or now and then a 4
   — in an empty cell. Not in Highlander, where nothing ever spawns.
4. The round ends on the mode's own goal (§3), on its clock, or when every
   player has no move left. A player with no move left is **stuck** and keeps
   their result.

**Win condition:** depends on the mode (§3), and there is always a winner. When
the goal is not met, whoever is ahead by the mode's measure wins
(`compareEntries`); fewer moves breaks a tie, then whoever joined first.
**Scoring:** the value of every tile created by a merge, added up — merging two
8s scores 16. Nothing else scores. A solo round ends on "Bravo" rather than a
winner's name.

### 2.1 Same board, same luck

The seed fixes the two starting tiles **and** every tile that spawns after: the
n-th spawn of a round depends only on the seed, n and the board it lands on.
Two players who make the same moves therefore meet the same tiles, so a score
difference is a difference in play, not in draw. Both phones and the referee
run the same functions from `shared/merge.ts`.

### 2.2 Colour is one function

What colour a tile is — and how the thumbnails read — comes from **one
function**, `tileColor(value)` in `www/src/games/merge-rush/colors.ts`. The
board and the thumbnails both call it and nothing else decides a colour, so
retuning the palette is a change to that function alone. It takes a tile's
number (2, 4, 8, …; 0 is an empty cell) and returns a CSS colour.

## 3. Modes / variations

Picked by the host in the lobby, read-only for everyone else — who see the
host's pick as it is made ([multiplayer.md](../../multiplayer.md) §3) — and sent in the
`start` payload (`normaliseMergeOptions` sanitises it). Names are given in
both languages because they are the lobby's buttons.

| Mode | Name (EN / FR) | Blurb | Goal | Clock | When the goal is not met |
| --- | --- | --- | --- | --- | --- |
| `time-attack` | Time Attack / Contre-la-montre | Two minutes, highest score wins | — | 2 min countdown | Highest score |
| `race` | Race to 2048 / Course à 2048 | First to make the tile wins | First accepted board with the target tile | Counts up; 30 min cap | Biggest tile, then score |
| `highlander` | Highlander / Highlander | There can be only one: merge the puzzle down to one tile | First accepted board with one tile | 3 min countdown | Fewest tiles left |

**Race.** The target is the host's pick of 256, 512, 1024, 2048 (the default),
4096 or 8192, and the name follows it ("Race to 512"). It is won by the first
report to **arrive** with the tile on the board — the same arrival rule Asteroid
Race uses for a finish — and the round ends for everyone at once.

**Highlander** ("Il ne doit en rester qu'une" in French) is the film's line, and
the mode is exactly that. Every player gets the same puzzle: 5–7 tiles adding
up to one power of two, and **no tile ever spawns**, so merging them all leaves
one. `puzzle(seed)` builds it by splitting one tile in halves until there are
enough pieces, places them, and keeps the placement only if a breadth-first
solver (`solveDepth`) can finish it in no fewer than 6 moves — so every puzzle
is proved solvable, never hoped. A player who boxes themselves in taps **↺** to
put the puzzle back as it started; the clock keeps running and the moves keep
counting.

## 4. Screens

Lobby → countdown → round → results. The round screen, portrait, top to bottom:

- **The clock**, in the status bar, at twice its usual size. It turns **orange**
  with `30 s` left and **red, blinking once a second,** with `15 s` left
  (`timer.ts`; under reduced motion it stays red and does not blink).
- **Your score**, big.
- **Your board**: a 4×4 grid filling the width, each tile its colour and its
  number. Tiles **slide** to their new cell over about 110 ms rather than
  jumping; a merged tile pops in as the pair lands, and a new tile scales in.
  Swiping anywhere on the board moves.
- **Four arrow buttons** under the board, for anyone who cannot swipe, and in
  Highlander a fifth, **↺**, that puts the puzzle back as it started.
- **The other players**, pinned to the bottom of the screen: one block each,
  centred, top to bottom — their avatar, where they stand (their score in Time
  Attack, their best tile in a race, their tiles left in Highlander), and a
  **32×32 px** canvas of their board as 8 px colour squares, no numbers. Your
  own board is not thumbnailed; it is the big one above.

Under the score, one line names the mode — and in a race, your best tile so far.
In Highlander the big number is the tiles left rather than points.

**Watching another player.** Tapping a thumbnail, at any moment — counting
down, mid-round, or stuck and waiting — opens that player's board full size,
with their name and standing, updating live as their reports arrive. A tap
anywhere closes it (Escape too). While it is open your own board does not move.

Sliding is drawn from `tiles.ts`, which follows the same move as
`shared/merge.ts` tile by tile only to know where each tile travelled from and
to; it never decides a result, and its test checks it agrees with the rules over
whole games.

The results list each player as `score pts · lvl n` (French `niv. n`), where the
level is the exponent of their best tile — a 128 is level 7 — so the line stays
short. Highlander lists `n tiles · m moves` instead.

## 5. Inputs & sensors

Touch only: a swipe of at least `MERGE_SWIPE_PX` along either axis, whichever is
larger. Arrow keys also work, as a courtesy. No sensors, no permissions, no
fallbacks needed.

## 6. Networking

Profile B, throttled ([../../realtime-options.md](../../realtime-options.md) §1):
a thumbnail has to be live, but not frame-rate.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `start` | client → server | `{ mode: 'merge', solo, merge: { mode, target } }` | Host starts; carries the lobby's mode and race target |
| `merge-board` | phone → server | `{ roundId, board, score, moves, over }` | This phone's board, at most every `MERGE_REPORT_MS`, and once more when it ends |
| `merge-rush` | server → all | `{ roundId, phase, startsAt, endsAt, seed, mode, target, roundMs, start, boards, solo, winner }` | Everyone's last accepted board and score, and the round's own rules |

`board` is 16 exponents — 0 empty, *k* for 2^*k* — row by row, and so is `start`,
the board every phone begins on. The referee seeds every player's entry with
it, so a thumbnail exists before its owner has moved. It owns the seed, the
starting board, the clock and the winner; the moves themselves happen on the
phone. A phone that reaches its mode's goal reports at once rather than on the
throttle, because in a race the first report to arrive wins. Watching another
player costs nothing on the wire: the board is already in every frame.

## 7. Failure & edge cases

- **Player leaves mid-round**: their last board and score stay on the strip and
  can still win; they stop holding the round open.
- **Host leaves**: promoted silently.
- **Too few players**: one is a legitimate round (1–8); the one player wins it.
- **Backgrounded tab or reload**: the round clock is the server's, so a phone
  that comes back has lost the time but not its board — it resumes from the
  referee's copy, and the next spawn lands where it would have, because every
  spawn is a function of the seed and the move count.
- **Everyone stuck**: the round ends early.
- **A race nobody can finish** — everyone stuck short of the tile, or a room
  racing to 8192 — ends on the 30 min cap, won by the biggest tile.
- **A Highlander puzzle boxed in** — two unequal tiles that can no longer meet —
  is what **↺** is for; the solver only promises the puzzle *can* be finished
  from its start.
- **Nobody moves**: everyone scores 0, and the first to join wins the tie.
- **A board that fills up with no merge available** is stuck, not lost — the
  score stands, and the phone shows that it is waiting for the others.

## 8. Anti-cheat

The phone reports its own board and score, so the referee bounds the claim by
what the rules could have produced. Every tile's mass came from a spawn, at most
4 each, so a board can hold no more than `startMass + 4 × moves` in total, and a
unit of mass merges at most once per doubling, so
`score ≤ 17 × (startMass + 4 × moves)`. Moves are bounded by the elapsed round
at `MERGE_MAX_MOVES_PER_S`. A report over a bound is **clipped, not rejected**
for the score and moves; a board that cannot exist is ignored and the previous
one kept. Score and moves never go down, and `over` never goes back.

Highlander is tighter still: nothing spawns, so a board is only believed if it
holds **exactly** the mass of the puzzle it started from, and a single tile
claiming more is ignored.

What is left unsolved: a client can report a board it did not earn that is still
within the bounds. This is a party game among people in one room, the same
posture every other report-your-own-number game takes.

## 9. Safety

Nothing to warn about.

## 10. Data & privacy

A 16-number board and two counters per report. Nothing stored past the room.

## 11. Accessibility

- **No gesture is the only way**: the four arrow buttons do everything a swipe
  does, and so do the arrow keys.
- **Colour is never the only signal on your own board**: every tile carries its
  number. The thumbnails are colour-only by design, and are a convenience —
  nothing in the game depends on reading one.
- **No sound**, nothing to say about hearing.
- **Reduced motion**: tiles do not slide, pop or scale; the board simply updates, and the red clock does not blink.

## 12. Open questions

1. **Is two minutes right?** Long enough to build a board, short enough to keep
   the room together. A round normally ends on the clock rather than on
   everyone getting stuck.
2. **The name.** "2048" is a trademark-adjacent title in the wild, so this is
   Merge Rush. Easy to change before launch.
3. **The palette.** `tileColor` starts as an evenly spaced hue ramp so every
   doubling is distinguishable from its neighbours; whether it reads at 8 px is
   the thumbnail test.
4. **Spawn mix.** 90 % 2s and 10 % 4s, as in the original, is untuned for a
   timed round.
5. **A race to 4096 or 8192 breaks the 30 s – 3 min rule** (AGENTS.md §4) — a
   good player needs several minutes for 2048 and far longer for 8192. They are
   on the list because they were asked for; whether a room actually sits
   through one is a playtest question, and the 30 min cap is only a backstop.
6. **Highlander's difficulty.** 5–7 tiles and a 6–12 move solution is a guess
   at "a puzzle, not a chore". `PUZZLE_MIN_DEPTH` and the tile count are the
   two numbers to turn.
