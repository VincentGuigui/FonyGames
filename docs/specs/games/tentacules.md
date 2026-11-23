# Tentacules

| | |
| --- | --- |
| **Slug** | `tentacules` |
| **Catchy sentence** | Climb a wall of pegs, one tentacle at a time |
| **Illustration** | `www/src/games/tentacules/art/card.svg` — a coral octopus, star-shaped, its five tentacles gripping round pegs on a reef wall, one tentacle mid-reach for a higher peg |
| **Players** | 1–8 |
| **Round length** | 1 min (Time trial); about 1 min, capped at 3 min (Summit) |
| **Inputs** | touch |
| **Accent colour** | `#FF7F6E` |
| **Status** | draft |

## 1. Pitch

You are a five-armed octopus at the foot of a reef wall studded with pegs. Drag
one tentacle at a time to a higher peg and haul yourself up; stretch too far and
it will not reach, hang by one arm too long and you drop. When two arms hold you
wide apart you can pull back and fling yourself up like a slingshot. Everyone
climbs the same wall, and the other octopuses are shadows climbing beside you.

## 2. Core loop

In the lobby: *"Drag a tentacle onto a peg to climb. Keep at least two holding
on. Spread wide on two? Pull the octopus back and let go to leap."*

1. The round starts after a 3·2·1. Every octopus sits at the bottom of the wall,
   its five tentacles on five starting pegs around it, in its five-pointed star.
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

- A tentacle reaches at most `REACH` = 0.38 from the centre of the body. A drop
  further than that is refused, and the tentacle visibly stretches to its limit
  and springs back — the elasticity is the feedback.
- The body sits at the centroid of the pegs it holds, then is pulled the least
  distance needed to keep every held tentacle within `REACH`. With five
  tentacles spread round it, that is the star.
- A peg already held by one tentacle cannot take another.
- One drag at a time: a second finger is ignored while a tentacle is held.

### 2.2 Slingshot

- **Armed** when exactly two tentacles hold, their pegs are at least 0.45 apart
  horizontally, and the angle between them seen from the body is at least 120°.
  The body blinks yellow while armed.
- The player drags the body away from the line between the two pegs — down and
  back — up to 0.25. Releasing launches the body in the opposite direction,
  speed proportional to the pull, under gravity; both tentacles let go.
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
  slingshot.
- **Harder as it rises**: spine steps grow from `0.5 × REACH` at the bottom to
  `0.8 × REACH` by the Summit line's height, and the pegs thin out, so the
  slingshot becomes the quicker way rather than the only one.
- The decor is a reef: coral, rock, a little weed, scrolling with the wall.

## 3. Modes / variations

| Mode | Name (EN / FR) | Blurb (lobby) | Goal | Clock | When the goal is not met |
| --- | --- | --- | --- | --- | --- |
| `trial` | Time trial / Contre-la-montre | Climb as high as you can in one minute | Highest point reached in 60 s | 60 s countdown | — |
| `summit` | Summit / Sommet | First to the finish line wins | First to touch the line | Counts up; 3 min cap | Highest point reached |

- **Time trial** (default): the score is the **highest point the body reached**,
  so a late fall does not wipe a good climb. Ties: whoever reached it first.
- **Summit**: a finish line across the wall, at a height an average climber
  reaches in about a minute (40 wall units at first; tuned by playtest). The
  first report to arrive with the body on the line wins outright and ends the
  round for everyone.

## 4. Screens

Standard flow: lobby (host picks the mode, others see it) → countdown → round →
results.

**Round screen** (portrait):

- **The wall** fills the screen; the camera follows the body up to mid-screen,
  then the wall scrolls instead. Pegs are round knobs, the free ones brighter
  than the ones held.
- **Your octopus**: a coral body with eyes (`art/octopus.svg`) and five
  tentacles drawn as tapering curves from the body to their pegs. A dragged
  tentacle follows the finger, turning red at the edge of its reach. Yellow
  blink when the slingshot is armed; a dashed arc while pulling back shows the
  launch direction.
- **The other players**: their octopuses as translucent dark **shadows** behind
  the wall's pegs, at their real height. One out of view shows as an avatar chip
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

Phone-run, like Double Fusion: the climb happens on the phone, the referee owns
the seed, the clock, the finish and the winner, and bounds what a phone claims.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `start` | host → server | `{ mode: 'tentacules', tentacules: { mode } }` | Start a round |
| `tentacules` | server → all | `TentaculesState`: round id, phase, seed, mode, startsAt, endsAt, per player `{ height, best, pose, finishedMs? }`, winner | The round as the referee knows it |
| `tentacules-pose` | phone → server | `{ roundId, height, best, pose }`, at most 5 per second | Where I am: body height and position, and the peg each tentacle holds (or null) |

- `pose` is the body's `x, y` and five peg ids or `null`: enough to draw a
  shadow, about 60 bytes.
- Shadows are drawn from the latest pose, eased toward the next, so 100–300 ms
  of latency reads as a slightly lazy shadow, never a jump.
- Summit's finish is the first `tentacules-pose` to **arrive** with the body on
  the line — the same arrival rule as Asteroid Race and Double Fusion's race.

## 7. Failure & edge cases

- **Player leaves**: their best stands and can still win; they stop holding the
  round open; their shadow fades out.
- **Host leaves**: promoted silently.
- **Alone**: a legitimate round (1–8); the one player wins it.
- **Backgrounded tab or reload**: the clock is the server's; the phone comes back
  on the starting pegs with its `best` kept — rebuilding a hold mid-wall from a
  reported pose would be easy to abuse.
- **Screen lock mid-hang**: the 3 s rule runs on the phone's clock, so the
  octopus has fallen when the player comes back.
- **Ties**: Time trial, whoever reached the height first; Summit, arrival order.

## 8. Anti-cheat

The phone reports its own height, so the referee bounds it:

- **Climb rate**: `best` may rise at most `MAX_CLIMB_PER_S` (3 wall units per
  second, above a slingshot's best) since the last report; more is clipped.
- **Pegs exist**: every peg id in a pose must exist in the seed's wall, and the
  held pegs must be within `2 × REACH` of each other — a pose that cannot be
  held is ignored.
- **Height matches the hold**: a held body's height must be within `REACH` of a
  held peg.

What is left: a client can fake a plausible climb within those bounds. A party
game among people in one room — the same posture as every other
report-your-own-number game here.

## 9. Safety

Touch only; no movement of the phone or the player. No safety copy needed.

## 10. Data & privacy

Poses and heights are relayed within the room and never stored.

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

1. **Time trial length**: 60 s as asked, or 90 s so a fall is recoverable?
2. **Time trial score**: highest point reached (proposed), or height at the bell
   (harsher, makes the last seconds tense)?
3. **Summit line**: 40 m to start with, adjusted after a playtest; 3 min cap.
4. **Slingshot thresholds** (0.45 apart, 120°) and whether it can ever be
   *required*: proposed never — the spine is always climbable on foot.
5. **Rendering**: Canvas 2D, no engine — about 100 pegs on screen and six
   curves is light work. A rendering engine is not proposed.
6. **The other octopuses**: shadows only (proposed), or also their names?
