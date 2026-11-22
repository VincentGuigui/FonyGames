# Double Fusion

| | |
| --- | --- |
| **Slug** | `merge-rush` |
| **Catchy sentence** | Slide, merge, climb. Out-score the whole room |
| **Illustration** | `www/src/games/merge-rush/art/card.svg` — a 4×4 grid of numbered, coloured tiles (2 to 32), a few merged into bigger ones |
| **Players** | 1–8 |
| **Round length** | 3 min (Highlander); untimed for Crescendo and a race — until somebody finishes |
| **Inputs** | touch |
| **Accent colour** | `#F472B6` |
| **Status** | 🎮 beta |

## 1. Pitch

The sliding-tile merge puzzle, in a room. Everyone gets the same starting board
and slides tiles to merge equal numbers into bigger ones, each on their own
phone. A strip of thumbnails shows everyone else's board as pure colour, so you
can watch the room climb — or panic — without a single number to read, and tap
any of them to watch that board live. Three modes (§3): puzzles that grow a tile
a level, a race to a tile, and one puzzle merged down to one.

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
| `crescendo` | Crescendo / Crescendo | Level after level, more tiles and longer puzzles: most levels wins | First to finish all 30 levels | Counts up; 30 min cap | Most levels, then who got there first |
| `race` | Race to 2048 / Course à 2048 (Endless race / Course sans fin) | First to make the tile wins | First accepted board with the target tile | Counts up; 30 min cap | Biggest tile, then score |
| `highlander` | Highlander / Highlander | There can be only one: merge the puzzle down to one tile | First accepted board with one tile | 3 min countdown | Fewest tiles left |

**Crescendo** (the default) is a run of 30 puzzles that grow and get longer:
each tile count from 2 to 16 is played **twice**, as two different puzzles
(levels 1–2 are 2 tiles, levels 29–30 the full 16), and every board merges down
to one tile with nothing spawning. Each player goes at their own pace on the same
puzzles; a level down to one tile counts, a beat of "Level n ✓" follows, and the
next is dealt. The score is levels finished, and **there is no countdown**: the
clock counts up, like a race's, and the round ends when someone finishes all 30
levels — which wins it outright. Nobody is hurried, so a first-timer is not cut
off early. If no one ever finishes, the 30 min cap ends the round and the
most levels win, then whoever reached that level first. ↺ restarts the current
level, and the clock runs on through it.

**The puzzles are hard on purpose, and searched for offline.** A board built to be
solvable (rows of descending chains collapsing into one) takes only 1–6 moves
however many tiles it has. So `scripts/crescendoBank.gen.ts` (`npm run
bank:crescendo`) starts from such a board and hill-climbs with a solver: move or
swap a tile, keep the change if the board is still solvable and its *shortest*
solution did not shrink. Moving tiles never changes the total, so it stays one
power of two. It keeps the six hardest distinct boards (a turned copy is not
distinct) per tile count in `shared/crescendoBank.ts`, with their shortest
solutions: about 2–3 moves at 2–3 tiles, 7 at 4, a dozen at 8 and 15–25 on a
full board. Searching takes seconds on a full board, so the phone and the
referee only *look up*: the seed picks two of the six for a tile count (one for
each of its levels) and turns or mirrors each, solution included. A test replays
every solution, has the solver confirm the shortest ones, and checks that
puzzles take ever more moves.

The referee believes a Crescendo report only for the level the player is on —
levels count one at a time, so none can be skipped — and only if its board holds
exactly that level's mass.

**Race.** The target is the host's pick of 512, 1024, 2048 (the default), 4096,
8192 or **∞**, and the name follows it ("Race to 512"). It is won by the first
report to **arrive** with the tile on the board — the same arrival rule Asteroid
Race uses for a finish — and the round ends for everyone at once.

**Endless** (∞) is a race with no finish line: its target is an exponent no board
can reach (`MERGE_TARGET_ENDLESS`), so nobody ever wins it outright. Everyone
plays until they are stuck, the round ends when the last one is, and the biggest
tile — then the score — wins. 256 was dropped from the list: it ended a race in
well under a minute.

**Highlander** ("Il ne doit en rester qu'une" in French) is the film's line, and
the mode is exactly that. Every player gets the same puzzle: 5–7 tiles adding
up to one power of two, and **no tile ever spawns**, so merging them all leaves
one. `puzzle(seed)` builds it by splitting one tile in halves until there are
enough pieces, places them, and keeps the placement only if a breadth-first
solver (`solveDepth`) can finish it in no fewer than 6 moves — so every puzzle
is proved solvable, never hoped. A player who boxes themselves in taps **↺** to
put the puzzle back as it started; the clock keeps running and the moves keep
counting.

**The duration is what decides Highlander.** It is measured by the referee from
the start of the round to the report that arrives with the puzzle down to one
tile (`solvedMs`), so **every restart is inside it** — the clock does not stop
for ↺. The first to arrive ends the round, which makes the winner the fastest
solver by construction; if two ever reached one tile, the quicker `solvedMs`
ranks first.

## 4. Screens

Lobby → countdown → round → results. The round screen, portrait, top to bottom:

- **The clock**, in the status bar, at twice its usual size. It turns **orange**
  with `30 s` left and **red, blinking once a second,** with `15 s` left
  (`timer.ts`; under reduced motion it stays red and does not blink). A race
  shows it counting up. **Crescendo shows no clock at all** — it has no deadline,
  so the level is the only number that matters; the time still appears on the
  results, where it breaks a tie.
- **Your score**, big.
- **Your board**: a 4×4 grid filling the width, each tile its colour and its
  number. Tiles **slide** to their new cell over about 110 ms rather than
  jumping. A merged tile arrives in the colour of the pair it came from, settles
into its own over about a quarter of a second, and gives a jolt as it does — it
overshoots to 1.28× with a small twist, rings back past 1 and settles — while a
new tile scales in.
  Swiping anywhere on the board moves.
- **Four arrow buttons** under the board, for anyone who cannot swipe, and in
  Highlander a fifth, **↺**, that puts the puzzle back as it started.
- **The other players**, pinned to the bottom of the screen: one block each,
  centred, top to bottom — their avatar, where they stand (their level in
  Crescendo, their best tile in a race, their tiles left in Highlander), and a
  **32×32 px** canvas of their board as 8 px colour squares, no numbers. Your
  own board is not thumbnailed; it is the big one above.

Under the big number, one line names the mode — with your best tile so far in a
race, and the tiles on the board in Crescendo. The big number is the level in
Crescendo (`Level 3/30`), the tiles left in Highlander, and points in a race.
Both puzzle modes have the ↺ button; a puzzle never ends a player's round by
being stuck, since ↺ is always there.

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
short. Highlander lists the **solver's time** instead (`m:ss.t`) — a solved board
is always one tile, so the count would say nothing — and `n tiles left` only for
a player who did not finish.

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
  racing to 8192 — ends when the last player is stuck, or on the 30 min cap,
  won by the biggest tile. An endless race always ends this way.
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
- **Reduced motion**: tiles do not slide, jolt, change colour or scale; the board simply updates, and the red clock does not blink.

## 12. Open questions

1. **Crescendo has no clock, so how long is a round?** It ends when someone
   clears level 30, which takes a solver bot a few minutes and a person far
   longer; how long a room really takes — and whether a slow
   player drags the others past the 3 min a round is meant to run (AGENTS.md §4)
   — is the playtest question. Time Attack, the original two-minute score mode,
   was replaced by Crescendo, and then its countdown went too.
2. **The name.** "2048" is a trademark-adjacent title in the wild, so this is
   **Double Fusion** (it was Merge Rush at first). The slug stays `merge-rush` —
   the URL, the flag key and every shared link — because renaming it would
   break links already in group chats; the title is all a player reads.
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
