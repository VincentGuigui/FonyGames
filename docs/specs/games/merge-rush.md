# Merge Rush

| | |
| --- | --- |
| **Slug** | `merge-rush` |
| **Catchy sentence** | Slide, merge, climb. Out-score the whole room |
| **Illustration** | `www/src/games/merge-rush/art/card.svg` — a 4×4 grid of coloured tiles, a few merged into bigger ones, an arrow sweeping across it |
| **Players** | 1–8 |
| **Round length** | 2 min |
| **Inputs** | touch |
| **Accent colour** | `#F472B6` |
| **Status** | 📝 draft |

## 1. Pitch

The sliding-tile merge puzzle, in a room. Everyone gets the same starting board
and slides tiles to merge equal numbers into bigger ones, each on their own
phone. A strip of thumbnails shows everyone else's board as pure colour, so you
can watch the room climb — or panic — without a single number to read.

## 2. Core loop

1. The referee draws a **seed** and the round starts on a 3·2·1. Every phone
   builds the **same starting board** from that seed (§2.1).
2. Swipe (or tap an arrow) to slide every tile as far as it goes in that
   direction. Two equal tiles that meet merge into one of double the value.
3. A move that changed the board spawns one new tile — a 2, or now and then a 4
   — in an empty cell.
4. The round ends after `MERGE_ROUND_MS`, or when every player has no move left.
   A player with no move left is **stuck** and keeps their score.

**Win condition:** highest score. A tie at the top is unranked.
**Scoring:** the value of every tile created by a merge, added up — merging two
8s scores 16. Nothing else scores. A solo round has no winner.

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

| Mode | Blurb (one line, shown in the lobby) | Difference from core |
| --- | --- | --- |
| `classic` | Two minutes. Highest score wins | baseline |

## 4. Screens

Lobby → countdown → round → results. The round screen, portrait, top to bottom:

- **Score and time**: your score, big, and the seconds left in the status bar.
- **The thumbnails**: one per *other* player, each a **32×32 px** canvas — the
  4×4 board as 8 px colour squares, no numbers — with their avatar and score
  beside it. Your own board is not thumbnailed; it is the big one below.
- **Your board**: a 4×4 grid filling the width, each tile its colour and its
  number. Swiping anywhere on it moves.
- **Four arrow buttons** under the board, for anyone who cannot swipe.

## 5. Inputs & sensors

Touch only: a swipe of at least `MERGE_SWIPE_PX` along either axis, whichever is
larger. Arrow keys also work, as a courtesy. No sensors, no permissions, no
fallbacks needed.

## 6. Networking

Profile B, throttled ([../../realtime-options.md](../../realtime-options.md) §1):
a thumbnail has to be live, but not frame-rate.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `start` | client → server | `{ mode: 'merge', solo }` | Host starts |
| `merge-board` | phone → server | `{ roundId, board, score, moves, over }` | This phone's board, at most every `MERGE_REPORT_MS`, and once more when it ends |
| `merge-rush` | server → all | `{ roundId, phase, startsAt, endsAt, seed, boards, solo, winner }` | Everyone's last accepted board and score |

`board` is 16 exponents — 0 empty, *k* for 2^*k* — row by row. The referee seeds
every player's entry with the starting board, so a thumbnail exists before its
owner has moved. It owns the seed, the clock and the winner; the moves
themselves happen on the phone.

## 7. Failure & edge cases

- **Player leaves mid-round**: their last board and score stay on the strip and
  can still win; they stop holding the round open.
- **Host leaves**: promoted silently.
- **Too few players**: one is a legitimate round (1–8); solo has no winner.
- **Backgrounded tab**: the round clock is the server's, so a phone that comes
  back has lost the time but not its board.
- **Everyone stuck**: the round ends early.
- **Nobody moves**: everyone scores 0, no winner.
- **A board that fills up with no merge available** is stuck, not lost — the
  score stands.

## 8. Anti-cheat

The phone reports its own board and score, so the referee bounds the claim by
what the rules could have produced. Every tile's mass came from a spawn, at most
4 each, so a board can hold no more than `startMass + 4 × moves` in total, and a
unit of mass merges at most once per doubling, so
`score ≤ 17 × (startMass + 4 × moves)`. Moves are bounded by the elapsed round
at `MERGE_MAX_MOVES_PER_S`. A report over a bound is **clipped, not rejected**
for the score and moves; a board that cannot exist is ignored and the previous
one kept. Score and moves never go down, and `over` never goes back.

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
- **Reduced motion**: tiles do not animate; the board simply updates.

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
