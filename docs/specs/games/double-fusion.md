# Double Fusion

| | |
| --- | --- |
| **Slug** | `double-fusion` |
| **Catchy sentence** | Swipe, merge, double and win! |
| **Illustration** | `www/src/games/double-fusion/art/card.svg` — a framed 4×4 grid of numbered, coloured tiles (2 to 32), a few merged into bigger ones |
| **Players** | 1–8 |
| **Round length** | 1 min (Highlander); untimed for Crescendo and a race — until somebody finishes |
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
2. Swipe to slide every tile as far as it goes in that
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
function**, `tileColor(value)` in `www/src/games/double-fusion/colors.ts`. The
board and the thumbnails both call it and nothing else decides a colour, so
retuning the palette is a change to that function alone. It takes a tile's
number (2, 4, 8, …; 0 is an empty cell) and returns a CSS colour.

## 3. Modes / variations

Picked by the host in the lobby, read-only for everyone else — who see the
host's pick as it is made ([multiplayer.md](../../multiplayer.md) §3) — and sent in the
`start` payload (`normaliseMergeOptions` sanitises it). Names are given in
both languages because they are the lobby's buttons, listed in this order — Race, Crescendo, Highlander — on the card and in the lobby, with the same blurbs.

| Mode | Name (EN / FR) | Blurb | Goal | Clock | When the goal is not met |
| --- | --- | --- | --- | --- | --- |
| `race` | Race to 2048 / Course à 2048 (Endless race / Course sans fin) | First to make the tile wins | First accepted board with the target tile | Counts up; 30 min cap | Biggest tile, then score |
| `crescendo` | Crescendo / Crescendo | Increasing difficulty levels | First to finish all 30 levels | Counts up; 30 min cap | Most levels, then who got there first |
| `highlander` | Highlander / Highlander | Puzzle: there can be only one number left | First accepted board with one tile | 60 s countdown | Fewest tiles left |

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
well under a minute. The target is a dropdown in the lobby, which keeps the
panel short.

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

### 3.1 Aggressive race

A race the host ticks **Mode agressif / Aggressive mode** on. Every merge that
makes a **64 or bigger** (`MERGE_MALUS_FROM`) **unlocks** one malus, of a kind
drawn at random. It appears under the player's board as an icon with its name,
and they **drag it onto a rival's thumbnail** to send it. A player holds at most
three (`MERGE_MALUS_STOCK`); one unlocked past that is lost.

| Malus | Icon | Effect on the receiver's board |
| --- | --- | --- |
| `explode` | 💥 | One of its smallest tiles blows up — only if that is a 2, 4 or 8 |
| `add` | ➕ | A 2, 4 or 8 drops on an empty cell |
| `freeze` | ❄️ | The next three swipes do nothing |
| `fog` | 🌫️ | The numbers vanish for three moves; only the colours are left |
| `stone` | 🪨 | A stone takes an empty cell for three moves: tiles stop against it and nothing merges across it, and nothing spawns on it |
| `gravity` | ⬇️ | Everything falls, exactly as a swipe down (no points, no spawn) — and again after each of the next three moves: the player can slide up, left or right, and it all drops back |
| `swap` | 🔀 | **Inversion**: the smallest tile and the biggest trade places (a tie is settled by `r`; nothing happens if all tiles are equal) |

A malus lasts **three moves** (`MERGE_MALUS_MOVES`), never seconds: a slow player
is hit as hard as a fast one, and the screen shows no countdown to explain. The
counting is `effects.ts`, shared by the phone and the bot. Gravity's extra falls
wait for the slide to settle, so a swipe made in that instant is ignored.
- **Who can take it**: anyone still playing but the sender. While there are two
  or more of them, whoever took the last malus — from anyone — cannot take the
  next (`malusTargets`). While dragging, the thumbnails that can take it are
  outlined and the others dimmed. A stuck player can still send what they hold.
- **Cooldown**: a player's maluses go out at least 10 s apart
  (`MERGE_MALUS_COOLDOWN_MS`); meanwhile their slots are dimmed with the seconds
  left, and nothing is lost.
- **Animation**: an unlocked malus flies from the tile whose merge earned it to
  its slot; the dragged icon shrinks into the thumbnail it is dropped on; the
  receiver sees it fly from the sender's thumbnail to the cell it lands on (the
  board's centre for the ones that last), then a notice shows **only the icon
  and its name, for a second** — no sender, no explanation. Reduced motion: no
  flights.
- **Who decides what**: the referee keeps each player's unlocked maluses and
  draws their kind, then — when one is sent — the dropped tile and a number `r`;
  only the receiver knows its board, so it picks the cell with `r`
  (`applyMalus`). Phones report `fusions`, their count of big merges; the
  referee unlocks one when that count goes up and the board it came with holds
  a 64 or more, and refuses a send it cannot honour (not held, too soon, a
  rival who cannot take it). The other modes never unlock any — Crescendo and
  Highlander are puzzles that must stay solvable — and neither does a lone
  player, who has nobody to send to.
- **The bot** (admin solo test only): so the mode can be tried alone, an
  aggressive race started with solo testing on (`core/solo.ts`) plays a **bot**
  (`bot.ts`) on the phone — a rival in the thumbnail strip, 🤖 *Bot*, that can
  be watched like anyone. It makes **one move a second** on the room's own seed
  (the player's tiles, the same luck), keeps its big tile in a corner, and plays
  the whole malus game: it unlocks by the same rule (a merge into 64 or more),
  sends when it holds one and its 10 s are up, and takes what is dropped on it —
  an explosion, a tile, a stone, a freeze, gravity — for the same three moves — fog
  meaning nothing to it.
  The referee only knows it as a rival id (`MERGE_BOT_ID`) maluses can be sent
  to, and, since the bot's maluses land on the phone without it, skips the mass
  bound for that round: there is nobody to cheat. The bot never wins; it is
  there to be played against and looked at.

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
- **No arrow buttons**: the swipe is the game, and the arrow keys cover a
  desktop. In the puzzle modes a **↺** button sits top left, above the board,
  and puts the puzzle back as it was dealt.
- **The merge note**: every move that merges plays a light, breathy note, like
  blowing across a bottle, a semitone above the last — an endless rise, since
  it is a Shepard tone (`chime.ts`): each note is one pitch class in seven
  octaves, loudest in the middle and fading out at both ends, so the top of the
  scale hands over to the bottom unheard. Three moves without a merge and it
  starts again from the low note. On by default, remembered per phone, with a
  **Sound** toggle in the gear menu; the merge's jolt is its visual twin.
- **In an aggressive race**, the unlocked maluses sit in three slots under the
  board (§3.1).
- **The other players**, pinned to the bottom of the screen: one block each,
  centred, top to bottom — their avatar, where they stand (the level they are on
  in Crescendo, their best tile in a race, their tiles left in Highlander), and a
  **32×32 px** canvas of their board as 8 px colour squares, no numbers. Your
  own board is not thumbnailed; it is the big one above.

The big number is the level in Crescendo (`Level 3/30`), the tiles left in
Highlander, and in a race **your best tile over the target** — `512 / 2048`, or
`512 / ∞` in an endless one — followed by 😈 when the race is aggressive. A race
shows **no score and no title line**: the two tiles are all the player needs.
Crescendo and Highlander keep a line under the number naming the mode (and, in
Crescendo, the tiles on the board). A puzzle never ends a player's round by
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
| `double-fusion` | server → all | `{ roundId, phase, startsAt, endsAt, seed, mode, target, roundMs, start, boards, solo, winner }` | Everyone's last accepted board and score, and the round's own rules |

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

In an aggressive race, every `add` malus raises its receiver's mass bound by the
tile it dropped, since that mass came from no spawn.

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

- **The swipe is the only way on a phone** — a deliberate choice: the game is
  the gesture. The arrow keys do everything a swipe does on a desktop.
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
   **Double Fusion** (it was Merge Rush at first). The slug followed the name
   while nobody had the old link: `double-fusion` is the URL, the folder and the
   flag key. Anything named `merge` inside — the wire `mode`, `shared/merge.ts`,
   the referee's file — is the game's mechanic, not its slug, and stays.
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
