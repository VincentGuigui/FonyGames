# Grid Attack

> Status: **playable end to end** — referee, board and the landscape gate all built and
> covered by `npm test`.

| | |
| --- | --- |
| **Slug** | `grid-attack` |
| **Catchy sentence** | *Break their grid before they break yours* |
| **Illustration** | `www/src/games/grid-attack/art/card.svg` — two grids facing each other, one cell lit and coming apart |
| **Players** | 2 (exactly) |
| **Round length** | 1–2 min |
| **Inputs** | touch |
| **Accent colour** | `#A78BFA` violet — and `#A3E635` lime for the other grid |
| **Status** | **playable end to end** |

## 1. Pitch

Your grid on the left, theirs on the right, both on screen at once. Three quick taps on one
of theirs lights it up; it pulses faster and faster for two seconds and then bursts, and
they lose a life. Three quick taps on one of yours puts it out.

Both of you are doing both things at the same time, with two thumbs each, which is the
whole game: every second you spend attacking is a second you are not watching your own
half.

## 2. Core loop

1. Both grids start whole — **4×4**, sixteen cells each — and both players start on
   `GRID_LIVES` (**5**).
2. Tapping a cell on **their** half `GRID_TAPS` (**3**) times, quickly, **lights** it.
3. A lit cell pulses, accelerating, for `GRID_FUSE_MS` (**2 s**).
4. Tapping a lit cell on **your** half three times, quickly, **puts it out**.
5. A cell nobody puts out **bursts**: it is gone, and its owner loses a life.
6. First to run out of lives loses.

**Win condition:** the other player runs out of lives.

### 2.1 Three taps means three taps *quickly*

`GRID_TAP_WINDOW_MS` (1.2 s) is the longest gap allowed between taps in one run. A slower
tap is the first tap of a new run, not the next of the old one.

This is not polish, it is the difference between a game and a broken one. Progress that
never decays lets an attacker leave two taps on all sixteen cells at leisure and then
finish them in one sweep — sixteen cells armed at once against a defender who can save
perhaps three. It is also simply what a person means when they say "tap it three times".

### 2.2 What the two halves cost

Attack and defence take the same three taps on purpose. The race is about **noticing**,
not about tapping faster than the other person: three taps is well inside anybody's reach,
so a cell is lost because you were looking at the wrong half, which is the tension the game
is for.

Five lives against sixteen cells means a grid always ends the game with cells to spare —
losing is running out of lives, never running out of board.

## 3. The board is sideways

The only landscape board in the catalogue, because two 4×4 grids side by side do not fit
in a portrait phone at a size a thumb can hit.

- The **lobby is portrait** like every other, because it is the shared template
  ([../../design/game-chrome.md](../../design/game-chrome.md) §1).
- The round opens on a **loading screen with one button**. Tapping it asks for fullscreen —
  which every browser refuses outside a user gesture, and iPhone Safari has no element
  fullscreen at all — and tells the referee this phone is looking at a board.
- **The round does not start until both have tapped it.** Two seconds of being attacked
  while reading a "go fullscreen" prompt is two seconds nobody played. `GRID_READY_WAIT_MS`
  (30 s) is the backstop: a phone left face down cannot strand the other player.
- Fullscreen is **best effort and never blocking**. The board plays fine without it; a game
  that refused to start because it could not go fullscreen would be broken on every iPhone
  in the room.

While a board is mounted, `useLandscapeRound` (core/screen.ts) puts `data-landscape` on the
root element. That flips the shared orientation notice: "turn your phone upright" stays out
of the way, and its mirror image — *turn your phone sideways* — takes over
([../../design/game-chrome.md](../../design/game-chrome.md) §7).

## 4. Screens

- **Lobby**: shared template, plus one panel saying the board is sideways and fullscreen.
  No solo test mode — two grids facing each other have nothing to show alone, the same
  reason Sling Puck opts out.
- **Loading**: the fullscreen button, then "waiting for the other phone".
- **Board**: your grid left, theirs right, **on both phones**. Named by whose they are and
  never mirrored: a board that swapped sides would make "the top left one" mean two
  different cells in a game whose entire content is two people shouting about cells.
- **Results**: the shared end screen, lives left per player.

Each cell is a rounded square with a **coloured border** — violet yours, lime theirs — and
almost no fill. A border rather than a fill because a filled cell has nowhere left to go
when it lights up, and lighting up has to be unmissable.

### 4.1 The pulse

A lit cell's flash **accelerates**: about once a second when it lights, about ten times a
second just before it goes. Drawn as one animation whose `animation-duration` is recomputed
every frame from how much fuse is left (`pulseMs` in `game.ts`), rather than as two or
three "fast" classes — stepped speeds read as three different animations rather than one
thing running out of time.

The curve is squared, because a linear ramp spends most of its length in the slow half
where nothing looks urgent.

Under `prefers-reduced-motion` the cell **holds solid** instead of flashing. It still says
"this one", and an accelerating strobe is exactly what that setting exists to turn off.

### 4.2 The cell fills as you tap it

A radial gradient from the middle of the cell, growing and darkening with each tap — a
third, two thirds, full. So the feedback **is the cell** rather than a badge stuck on one:
you are visibly loading the thing you are hitting, and at a glance across a board you can
see which cells you are part-way through.

It replaced three small pips, which said the same thing in the corner of the eye and said
it about a cell rather than with one. Local — see §6 — and it exists because three taps
with no feedback is indistinguishable from a dead button.

The fill is its own layer rather than the cell's background, so it can grow from the centre
without touching the border and without fighting the pulse, which animates the background
underneath it. A run that goes stale takes its fill with it: a fill left behind after the
referee has given up on the run would promise a tap that is not going to land.

## 5. Inputs

Touch only, and `pointerdown` rather than `click`: this is a mashing game and a click waits
for the release. The board sets `touch-action: manipulation` and calls `preventDefault`, or
the browser reads a fast run of taps as a double-tap zoom and eats every second one.

## 6. Networking

Server is authoritative for every cell, every fuse, every life and every tap count.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `grid-tap` | client → server | `{roundId, cell, side}` | A finger landed. `side` is `mine` or `theirs` — resolved against the seating, so a phone cannot tap on somebody else's behalf by naming them |
| `grid-ready` | client → server | `{roundId}` | This phone is looking at the board |
| `grid` | server → clients | the whole `GridState` | Cells, fuses, lives, who is ready, phase and winner |

**One frame, sent whole.** Two arrays of sixteen small objects is small enough that there
is nothing to gain from diffing, and a phone that missed a frame or joined late needs no
resync path at all.

### 6.1 Tap progress is never on the wire

A cell tells its owner **nothing** until it is armed. That is the game — so "somebody is
two taps into this one" is the single fact that must not travel, and the referee sends no
frame at all for the first two taps of a run.

Which leaves the tapper with no feedback, so the count is *also* kept on the phone, purely
to draw the pips: an optimistic echo of what the server is doing, with the same rule and
the same window, thrown away whenever a frame lands. It is never authority. The two
implementations are deliberately separate rather than shared — one is the rule and one is a
guess at it, and shared code would make them easy to confuse.

### 6.2 Fuses are drawn from the clock

`burstAt` is a **server** time, and everything about how a cell looks is computed from it
against the shared clock on every animation frame. So a phone that missed a frame, joined
mid-fuse or was backgrounded for a second shows the same cell at the same moment as the
other phone, instead of starting its own two seconds whenever the news arrived.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player leaves | The round ends and the other one wins. Two grids facing each other do not shrink to one |
| One phone never taps the fullscreen button | The round starts anyway after `GRID_READY_WAIT_MS`. They are simply behind |
| A tap on a cell that has already burst | Ignored, from either side. There is nothing there |
| Attacking a cell that is already lit | Ignored — there is only ever one thing a cell is waiting for |
| Defending a cell that is not lit | Ignored, same rule |
| A saved cell, and the attacker taps once more | Nothing. The attacker's finished run is cleared with the save, or one stray tap would re-light a cell that was just rescued |
| Both players reach zero on the same tick | No winner, and the end screen says so |
| The safety cap (`GRID_ROUND_CAP_MS`, 5 min) | Whoever has more lives takes it; level is a draw |

## 8. Anti-cheat

The server counts the taps, owns the clock and resolves `side` against the seating, so a
crafted client can send taps faster than a finger but gains nothing it could not get by
tapping — three taps is three taps, and the fuse is the server's. What it *cannot* do is
learn anything: the frames carry no tap progress, so there is nothing to read.

Out-of-range cells, non-integers, stale round ids and unknown players are all dropped.

## 9. Data & privacy

Leaves the phone: which cell was tapped, and which half. Nothing else.

## 10. Accessibility

- Every cell is a real `<button>` with a label naming its row and column and what is
  happening to it, so the board is playable and readable without seeing the pulse.
- The pulse respects `prefers-reduced-motion` (§4.1).
- The two halves are told apart by **position and label**, not only by colour — yours is
  always left and captioned "Yours".
- Cells are as large as the half allows, which at 4×4 on a phone in landscape is a
  comfortable target.

## 11. Open questions

- Is two seconds right? It is long enough to cross the screen and short enough to punish
  looking away, but it has not been played by two people in a room.
- Should a burst cell take its neighbours' *borders* with it, so a shrinking grid looks
  damaged rather than dotted? Cosmetic, and easier to judge once it has been played.
- Should there be a limit on how many of their cells you can have lit at once? Currently
  none: arm as many as you can reach.
