# Tentacules

| | |
| --- | --- |
| **Slug** | `tentacules` |
| **Catchy sentence** | Climb a wall of pegs, one tentacle at a time |
| **Illustration** | `www/src/games/tentacules/art/card.svg` — a cute round coral octopus with big shiny eyes and pink cheeks, star-shaped, its five tentacles gripping pegs on a reef wall, one reaching for a higher peg |
| **Players** | 1–8 |
| **Round length** | 1 min (Time trial); about 1 min, capped at 2 min (Summit) |
| **Inputs** | touch |
| **Accent colour** | `#FF7F6E` |
| **Status** | built — numbers untested on real thumbs |

## 1. Pitch

You are a five-armed octopus at the foot of a reef wall studded with pegs. Drag
one tentacle at a time to a higher peg and haul yourself up; stretch too far and
it will not reach, hang by one arm too long and you drop. When two arms hold you
wide apart you can pull back and fling yourself up like a slingshot. Everyone
climbs the same wall, and the other octopuses are shadows climbing beside you —
shadows that hold their pegs, so a peg one of them is on is not yours to take.

## 2. Core loop

In the lobby: *"Drag a tentacle onto a peg to climb. Keep at least two holding
on. Spread wide on two? Pull the octopus back and let go to leap."*

1. The round starts after a 3·2·1. Every octopus sits at the bottom of the wall,
   its five tentacles on its own five starting pegs around it, in its
   five-pointed star.
2. The player drags the tip of one tentacle and drops it on a peg. It sticks if
   the peg is within reach (§2.1); otherwise it springs back to the peg it left.
3. The body settles between the pegs it holds, keeping its star shape, so moving
   arms upward moves the octopus upward.
4. Once the body reaches the middle of the screen it stays there and the **wall
   scrolls down** instead.
5. **Slingshot** (§2.2): held by exactly two tentacles spread far apart, the
   octopus blinks yellow; drag the body back and release to leap upward. In the
   air, a tentacle reaches by itself for the best peg in range and grabs it.
6. **Falling** (§2.3): held by nothing, or by a single tentacle for more than 3 s,
   the octopus lets go and falls; the wall scrolls back up. The player can catch
   a peg on the way down by dragging a tentacle to it. A fall past the bottom
   puts the octopus back on the starting pegs.

**Win condition and scoring**: per mode (§3).

### 2.1 Reach and shape

All lengths are in **wall units**: the width of the wall is 1, whatever the
screen.

- A tentacle reaches at most `REACH` = 0.57 from the centre of the body (raised
  by half after the first build felt cramped). A drop
  further than that is refused, and the tentacle visibly stretches to its limit
  and springs back — the elasticity is the feedback. While a dragged tentacle
  is over a peg it would grab, it turns **green**; past its reach, red.
- **The body pulls itself up**: it sits 70 % of the way from the centre of its
  pegs to the highest point every held tentacle still reaches (`place`), so
  reaching a higher peg lifts it, and with five tentacles spread round it the
  star shows. Hanging by one tentacle, it dangles just below the peg. (A plain
  centroid was tried first: five tentacles stacked low anchored the body so far
  down that nothing above was ever in reach.)
- **Letting go**: a tentacle dropped on empty space lets go and dangles; a drop
  on a peg out of reach springs back to the peg it left. Letting low tentacles
  go is how a climber stops them anchoring the body.
- **A peg holds one tentacle**, from anyone. A peg held by your own tentacle
  cannot take another. A peg held by **another player** is drawn ringed in
  their colour, and can be **taken over once it has been held 3 s**
  (`SQUAT_MS`): a drop on it then wins it, and the holder's tentacle is knocked
  off. Held for less than 3 s, it is still theirs, and the drop springs back as
  an out-of-reach one does. So a climber can be bumped but not walled in.
- **Starting pegs are each player's own**, not part of the shared wall: every
  octopus starts — and starts again after a fall to the bottom — on five pegs
  only it can use and only it sees.
- One drag at a time: a second finger is ignored while a tentacle is held.

### 2.2 Slingshot

- **Armed** when exactly two tentacles hold, their pegs are at least 0.35 apart
  horizontally, and the angle between them seen from the body is at least 100°.
  The body blinks yellow while armed.
- The player drags the body away from the line between the two pegs — down and
  back — up to 0.25. Releasing launches the body in the opposite direction,
  speed proportional to the pull, under gravity; both tentacles let go. A full
  pull straight up rises `MAX_LEAP` = 1.5 wall units.
- In the air, the moment a free peg comes within `REACH` above the body's
  centre, one tentacle reaches for it and grabs: the highest such peg, at or
  after the top of the arc. The octopus then hangs by one tentacle, so the 3 s
  rule runs — the player must plant a second one.
- A pull of under 0.04 does nothing.

### 2.3 Falling

- **One tentacle** holding for more than 3 s (`HANG_MS`): it lets go.
- **None** holding: the body falls under gravity, tentacles trailing.
- While falling the player may drag any tentacle to any peg within reach of the
  body *at that moment*; it grabs, the fall stops, and the one-tentacle clock
  starts.
- Falling below the starting height resets the octopus onto the five starting
  pegs. The round clock keeps running; the fall is the penalty.

### 2.4 The wall

- **Same wall for everyone**, built from the round's seed, as tall as the round
  needs — rows are generated as the climb gets there, from the seed and the row
  number alone, so every phone draws the same pegs at the same height.
- **Always climbable**: each band of the wall is built around a *spine*, a chain
  of pegs each within `0.8 × REACH` of the last, plus decoy pegs. The spine alone
  can always be climbed with two tentacles holding, so no section ever needs the
  slingshot — up to 8 m. There are **two interleaved spines**, so one player
  sitting on a peg never blocks the way for long.
- **Harder as it rises**: spine steps grow from `0.5 × REACH` at the bottom to
  `0.8 × REACH` by 25 m (the Summit line), and the pegs thin out.
- **Gaps above 8 m**: some bands then have a **gap** — a stretch no tentacle can
  bridge — that only a slingshot leap clears. Every gap is preceded by a
  **launch pair**: two pegs far enough apart to arm the slingshot (§2.2). A gap
  is two reaches and a little more (`2 × REACH + 0.1`), so no step from peg to
  peg crosses it, and well inside a leap plus a reach, so a leap always does. Gaps come more often as the wall rises: about one every 6 m at
  8 m, one every 3 m by 25 m.
- The decor is a reef: coral, rock, a little weed, scrolling with the wall.

## 3. Modes / variations

| Mode | Name (EN / FR) | Blurb (lobby) | Goal | Clock | When the goal is not met |
| --- | --- | --- | --- | --- | --- |
| `trial` | Time trial / Contre-la-montre | Climb as high as you can in one minute | Highest point reached in 60 s | 60 s countdown | — |
| `summit` | Summit / Sommet | First to the finish line wins | First to touch the line | Counts up; 2 min cap | Highest point reached |

- **Time trial** (default): the score is the **highest point the body reached**,
  so a late fall does not wipe a good climb. Ties: whoever reached it first.
- **Summit**: a finish line across the wall, at a height an average climber
  reaches in about a minute: **25 m** (tuned by playtest). The
  first report to arrive with the body on the line wins outright and ends the
  round for everyone.

## 4. Screens

Standard flow: lobby (host picks the mode, others see it) → countdown → round →
results.

**Round screen** (portrait):

- **The wall** fills the screen; the camera follows the body up to mid-screen,
  then the wall scrolls instead. Pegs are round knobs, the free ones brighter
  than the ones held.
- **Your octopus is cute**, and that is a requirement, not a polish item: a
  round, soft head bigger than its body would suggest, two big shiny eyes with
  white highlights, pink cheeks, a tiny smile — and **pink-lilac**, head and
  tentacles, on every player's own screen (rivals' shadows keep their avatar
  colour, so they are told apart). Its face reacts: content while
  holding on; worried brows and a wobbly mouth hanging by one tentacle;
  squeezed eyes and an "o" mouth while pulling back the slingshot; a delighted
  open smile in flight; dizzy spiral eyes after a fall. The faces are sprites
  in `art/` (one SVG per expression), the head shape stays the same. Tentacles
  are drawn as soft tapering curves with a row of little suckers, ending in a
  curl where they hold. A dragged
  tentacle follows the finger, turning red at the edge of its reach. Yellow
  blink when the slingshot is armed; a dashed arc while pulling back shows the
  launch direction.
- **The other players**: their octopuses as translucent **shadows** behind the
  wall's pegs — the same cute silhouette, darker, with their **name and avatar**
  floating above — at their real height, and the pegs they hold ringed in their
  colour: a solid ring for the first 3 s, then a pulsing dashed one, meaning it
  can be taken over. A shadow moves only when one of its tentacles grabs or lets go (§6),
  sliding over 200 ms to its new place. One out of view shows as an avatar chip
  on the screen's top or bottom edge, with its height.
- **Top**: the clock (Time trial counts down, Summit counts up) and your height
  in metres (1 wall unit = 1 m). In Summit, a strip on the right edge shows the
  line and every player's height on it.
- **Warnings**: the one-tentacle countdown as a draining ring on the body;
  "Let go!" / "Lâché !" when it falls.

**Results**: ranked by the mode's measure — height for Time trial, finish time
then height for Summit.

## 5. Inputs & sensors

Touch only: pointer events on a canvas, one active drag. A drag starts on a
tentacle tip (hit radius 0.06) or, while armed, on the body. No sensors, no
permissions.

**Fallbacks**: none needed. Arrow keys are not offered — the game is the drag.

## 6. Networking

**Only what is done is sent: a tentacle grabbing a peg, or letting go.** Never
the drag, the flight or the fall in between. A body held by pegs sits where its
pegs put it (§2.1) — a pure function of the wall and the held pegs — so every
phone and the referee can place any octopus from its holds alone.

The phone runs its own octopus; the referee owns the seed, the clock, **who
holds which peg**, every player's height and best, the finish and the winner.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `start` | host → server | `{ mode: 'tentacules', tentacules: { mode } }` | Start a round |
| `tentacules-grab` | phone → server | `{ roundId, arm, peg }` | Tentacle `arm` (0–4) now holds `peg` |
| `tentacules-let-go` | phone → server | `{ roundId, arms }` | These tentacles let go (a fall, a launch, a lift to move one) |
| `tentacules-reset` | phone → server | `{ roundId }` | Fell past the bottom: back on its own starting pegs |
| `tentacules` | server → all | `TentaculesState`: round id, phase, seed, mode, startsAt, endsAt, per player `{ holds, since, best, bestAt, finishedMs? }` — `holds` the five pegs held (or null), `since` when each hold began — and the winner | The round as the referee knows it |

- **A peg is exclusive, so the referee decides**, by arrival. A grab of a free
  peg is accepted. A grab of a peg another player has held for less than 3 s is
  refused, and the next state shows that tentacle free; held 3 s or more, the
  grab wins it and the holder's tentacle is let go. The phone attaches at once
  (no wait for a round trip) and acts on the state when it comes: a refused
  tentacle springs back, a knocked-off one lets go — and the octopus may then be
  down to one tentacle, or none. `since` lets a phone show which rival pegs are
  already up for grabs.
- **Moving a tentacle** is a let-go of its old peg sent with the grab of the new
  one, so a drag that is dropped back where it was sends nothing.
- **Height and best are the referee's**, computed from the holds; phones never
  report a number. Summit's finish is the first grab that puts a body on the
  line.
- **Shadows** jump only on these events, eased over 200 ms; 100–300 ms of
  latency reads as a slightly slow climber, never a glitch.
- Each event is a few dozen bytes, and a fast climber sends perhaps two a
  second.

## 7. Failure & edge cases

- **Player leaves**: their best stands and can still win; they stop holding the
  round open; their shadow fades out and their pegs are released at once, so
  nobody is left stuck below an absent octopus.
- **Host leaves**: promoted silently.
- **Alone**: a legitimate round (1–8); the one player wins it.
- **Backgrounded tab or reload**: the clock is the server's, and so are the
  holds: the phone comes back on the pegs the referee says it holds, its body
  placed from them. A phone that comes back holding nothing starts again from
  its starting pegs, its `best` kept.
- **Screen lock mid-hang**: the 3 s rule runs on the phone's clock, so the
  octopus has fallen when the player comes back.
- **Ties**: Time trial, whoever reached the height first; Summit, arrival order.

## 8. Anti-cheat

Phones report grabs, not heights, and the referee knows the wall, so most of it
is simply checked:

- **The peg exists** in the seed's wall (or is one of the player's own starting
  pegs), and is free or has been held by someone else for at least 3 s.
- **It is within reach**: while the octopus holds at least one peg, the new peg
  must be within `REACH` of where those holds put the body. With none held — a
  slingshot catch or a fall — the body's position is the phone's own business,
  so the bound is looser: within `REACH` + the highest slingshot leap
  (`MAX_LEAP`) of where it last was held.
- **Height is computed, not claimed**: the referee places the body from its
  holds; a phone cannot report a height it does not hold.

What is left: a client could grab its way up faster than a thumb, within reach
each time. Grabs are rate-limited (8 a second), and beyond that this is a party
game among people in one room — the same posture as the other phone-run games.

## 9. Safety

Touch only; no movement of the phone or the player. No safety copy needed.

## 10. Data & privacy

Grabs and holds are relayed within the room and never stored.

## 11. Accessibility

- **Reduced motion**: the wall jumps rather than scrolls smoothly when the
  camera moves more than a screen; the yellow blink becomes a steady yellow
  outline; no camera shake on landing.
- **Colour is not the only signal**: armed slingshot is outline + a "⤴" badge;
  reach limit is a red tentacle *and* a stop in the stretch.
- **No sound needed**: every cue is visual.
- The drag is the game; there is no alternative input (as with Double Fusion's
  swipe, a deliberate choice).

## 12. Open questions

Decided with the maintainer: 60 s Time trial scored on the highest point
reached; Summit at 25 m with a 2 min cap; a held peg can be taken over after
3 s; shadows show names; the slingshot is needed above 8 m, armed at 0.35 apart
and 100°; the octopuses are cute.

Left to playtest: the numbers — `REACH`, the leap, the gap spacing, the 25 m
line. Rendering is Canvas 2D with no engine (about 100 pegs and six curves on
screen).
