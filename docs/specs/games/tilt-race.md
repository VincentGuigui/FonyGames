# Tilt Race

| | |
| --- | --- |
| **Slug** | `tilt-race` |
| **Catchy sentence** | *Your phone is the steering wheel. Turn it right round* |
| **Illustration** | `www/src/games/tilt-race/art/card.svg` — a small car dead centre on a track of red-kerbed corridors, turned hard into a bend with skid marks trailing out of it |
| **Players** | 2–8 |
| **Round length** | ~100 s |
| **Inputs** | orientation + touch |
| **Accent colour** | `#E4572E` |
| **Status** | 🎮 beta — built; the 1:1 steering, the skid and the circuit's own length untested on real phones ([#14](https://github.com/VincentGuigui/FonyGames/issues/14)) |

## 1. Pitch

A little car on a track, seen from above. The map never moves — it is pinned
north-up like a paper map on a table — and **the phone is the steering wheel**:
turn it and the car turns with it, degree for degree, as far round as your
wrist will go.

It is the directness that makes it. There is no gain to learn and no rate to
anticipate: where the phone points, the car points.

## 2. Core loop

Forward is automatic. Turn the phone to turn the car; hold reverse to back out
of a mistake.

1. The referee rolls a **track** at start — one closed circuit with guardrails
   down both sides — identical for every player, and broadcasts it.
2. Everyone starts on the line together.
3. **Speed builds by itself**: 0 → 100 over `TILT_SPOOL_MS` (3 s), then
   100 → 120 over another 3 s. There is no throttle.
4. **The phone's own rotation is the heading**, one for one (§2.1, §5). Above
   100, the car **skids**: the momentum lags the heading and the car keeps some
   of its old direction through a turn.
5. **A reverse button** sits at the bottom of the screen — the bottom as
   gravity sees it, so it slides around the screen's edge as the phone turns.
   Press it and it **locks in place** until released, then falls back to
   wherever down has become.
6. **Guardrails cost speed, by the angle of the hit** (§2.3): square on to the
   rail leaves nothing, forty-five degrees leaves half, a pure graze costs
   nothing on impact — and then `TILT_SCRAPE_DECEL` keeps taking speed off for
   as long as the car is against the rail.
7. First across the finish line wins. Everyone else runs until
   `TILT_RUN_CAP_MS` so a whole room gets a placing.

**Win condition:** first across the finish line.
**Scoring:** finishing order; then distance along the track for anyone who did
not finish, and best lap as a footnote.

### 2.1 The map is fixed. The car turns.

The track is drawn in one orientation and never rotates; the camera follows the
car across it. The car sprite is at the centre of the screen and points wherever
the car is pointing.

**The steering is the phone's own rotation, and it is 1:1.** Turn the phone
through a quarter, a half or a whole circle in its own plane and the car's
heading turns by exactly that. No gain, no rate, no integration: `heading` is
`base + roll`, where `roll` comes straight from `roll.ts` — 0 when the phone is
upright, growing clockwise — and `base` is `TILT_UPRIGHT_HEADING`, a fixed
constant (up the map), not the track's own starting direction. **Upright means
up, always**: an earlier version set `base` to wherever the track happened to
start and zeroed `roll` on the round's first reading — "hold it however you
like" — which meant the car could start pointing sideways even with the phone
held bolt upright, and every correction from there was measured against that
arbitrary baseline rather than against upright, which read as the car turning
further than the wrist did. There is no per-round calibration any more.

The two halves are one decision, not two. It was the other way round first —
the car pinned upright with the world turning under it, steered by a tilt-to-
turn-rate — and that pairing cannot survive a 1:1 control: a map that turned
with the phone would cancel exactly the rotation the player is making, so the
car would sit motionless on screen no matter how far the wrist went, and the one
cue that the control is direct would be invisible. Fixed map, turning car.

**Nothing caps how fast the heading can change**, and nothing should: the skid
(§2.2) is the physics of a car that cannot change direction instantly, so a
violent flick makes it slide rather than teleport. A rate cap on top would break
the only property the control has.

`TILT_CORNER_RATE` (3.6 rad/s) is no longer enforced anywhere — it is what the
tightest corner *demands* at top speed, kept because it is the number the skid
has to be judged against and because it is what says the circuit is drivable at
all. 206°/s is well inside a wrist.

### 2.3 What a guardrail costs

Two things, and they are different in kind.

**The impact**, once, and continuous in the angle. Writing `into` for the
fraction of the car's momentum pointing *across* the track — |cos| against the
rail's local normal — the speed retained is `1 - into²`:

| Approach | `into` | Keeps |
| --- | --- | --- |
| square on to the rail | 1 | nothing |
| forty-five degrees | cos 45 | half |
| a pure graze, along the rail | 0 | everything |

Those first two rows are the rule as it was given, and `1 - into²` is the curve
through them. It is also the honest physical reading rather than a fitted one:
`1 - into²` is `along²`, so what is absorbed is the kinetic energy aimed across
the rail and what survives is the energy running along it.

**The scrape**, every frame the car is still touching, at `TILT_SCRAPE_DECEL`
(180 units/s²). This is what makes riding a wall round a corner a losing line
rather than a free guide, and it has to beat the spool to mean anything at all
— a car regains speed at about `TILT_CRUISE_SPEED` per second, so anything under
100 would let a scraping car accelerate. The net −80 u/s² is about a second and
a half of contact to stop from cruise, and an immediate recovery the moment the
car comes off.

**The momentum, after either, follows the rail's own tangent — not the
wheel.** A hit used to leave the car's direction of travel exactly wherever the
wheel was already pointing, and since that is usually roughly at the wall (it
is what caused the hit), the very next frame re-squared the car into the same
rail before any of the surviving `along` speed had covered any distance —
reading, on a real phone, as the car stopping dead rather than sliding. The
skid lag (§2.2) is what is supposed to keep a car's own momentum independent
of the wheel for a moment, but it only ran above cruise, and a hit routinely
scrubs the car below it in the same frame — so a bumped car kept the lag one
frame too briefly, in exactly the frame it mattered. Fixed by locking the
momentum to the rail's tangent on contact and keeping the lag alive for as
long as the car was touching a rail last frame, regardless of speed —
`drive.ts`'s `step`, `drive.test.ts`'s own hard-angle-hit checks.

`TILT_HEAD_ON` survives as a *presentation* threshold only: it decides whether
the renderer plays the head-on shake or the graze one. The speed is continuous
in the angle either way.

The physics still runs in track space, where the car has a real heading and a
real velocity — this is the same trap Asteroid Race warns about: the offsets
must be derived from the axis they are
applied to, or the framing drifts with the aspect ratio.

### 2.2 Skid

Below 100 the car goes exactly where it points. Above it, its **momentum** is a
low-passed version of its heading, lagging by `TILT_SKID_TAU_MS`, so the
velocity keeps pointing where the car used to face. That is what makes the last
20 of the speed range a cost as well as a gain: the fast line is faster only if
you can hold it.

It is also the only limit on how fast the car can be turned, now that the
heading is the wrist's own (§2.1) — snap the phone round at speed and the car
does not follow, it slides.

## 3. Modes / variations

| Mode | Blurb (one line, shown in the lobby) | Difference from core |
| --- | --- | --- |
| `sprint` | One lap, first across wins | baseline |
| `endurance` | Three laps. Skids compound | 3 laps, and a hit costs a fixed 2 s stop rather than just speed |

## 4. Screens

Standard flow. The primer is load-bearing: it shows the inverted control with
one sentence and a tiny animation, because a player who starts without it will
spend their first ten seconds turning the wrong way.

The round screen:

- **The car**, dead centre, never moving on screen and never rotating.
  Hue-rotated to this phone's own avatar when `/avatar-colors.json` has an
  entry for it — `core/avatarColor.ts` and `core/art/tint.ts`,
  [illustrations.md §4](../design/illustrations.md). Rivals stay their own
  emoji glyph (below), never a coloured car of their own.
- **The track**, rotating and translating under it, guardrails clearly drawn —
  the one thing that must be readable at speed.
- **A speed readout** and the spool state, small, top-left.
- **The reverse button**, bottom-as-gravity-sees-it, sliding around the screen
  edge; locked while pressed.
- **A progress rail** with every player's dot, as Crowd Race has, since
  otherwise a race with eight cars on separate parts of the track is invisible.

## 5. Inputs & sensors

**`deviceorientation`**, read once and used twice, through `roll.ts` — not the
shared `core/sensors/steer.ts` filter, which this game no longer uses.

- **The phone's in-plane rotation steers** it, 1:1 (§2.1), permission asked
  for at Ready ([../device-capabilities.md](../device-capabilities.md) §2).
  Upright is the zero, always — no per-round calibration.
- **Gravity's own direction** places the reverse button, from the same event.
- **Touch** for the reverse button only.

**Why not `gamma`.** `gamma` spans only −90..90 and folds back on itself past
vertical, so it cannot describe a phone turned right round — and turning right
round is the control. The in-plane direction of **gravity** can: it sweeps a
full circle with no fold and no gimbal, and `gravityButton.ts` already derives
it, pose by pose, for the reverse button. One instrument, two consumers.

`rollTracker` **accumulates** rather than reporting an angle, adding the short
way round from each reading to the last, so passing upside-down is continuous
and two turns of the wrist read as two turns. There is no smoothing and no dead
zone: the angle of a vector is a far steadier signal than one component of one,
and a dead zone would break the very property the control is for. Below
`ROLL_MIN_GRAVITY` of in-plane gravity — a phone nearly flat on its back — there
is no direction to read and the tracker holds still rather than following noise.

**Fallbacks** (mandatory): none. The tilt steering is the entire game, and a
touch-steered version is a different one — the same call AGENTS.md §4 allows
for Asteroid Race and Neon Fall. Disclosed in the lobby before anyone starts.

**Fullscreen + a real portrait lock on Ready/Start**
(`GameCard.screen`, [../../device-capabilities.md](../../device-capabilities.md) §5b):
the steering IS rolling the phone in its own plane, which is exactly the motion a
phone's own auto-rotate watches for, so a hard turn mid-corner could otherwise flip
the OS into landscape and reflow the board under the player's thumbs mid-race.

## 6. Networking

Profile A-ish: continuous play, but almost nothing on the wire.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `tilt-track` | server → all | `{ roundId, seed, track, startsAt }` | The circuit, rolled once |
| `tilt-move` | client → server | `{ roundId, s, lap, at }` | Progress along the track — an arc length, not a position |
| `tilt-field` | server → all | `{ roundId, at, players: {id: {s, lap}} }` | Everyone's progress, 4×/s |
| `tilt-finish` | client → server | `{ roundId, at }` | Crossed the line |
| `tilt-result` | server → all | `{ roundId, order: [id], progress: {id: {s, lap}} }` | Placings |

**Progress, not position.** A rival's exact `(x, y, heading)` is of no use to
anyone — nobody collides with anybody — so what travels is one number: how far
along the track they are. That is what the progress rail needs and nothing
more, and it is a fraction of the bytes.

### A correction to the issue

The issue says clients report **"every 0.25ms"**. That is 4000 messages a
second and certainly a slip for **250 ms** (4 Hz), which is what this spec
adopts and what every other continuous game here uses. Flagged as §12 Q1 in
case something else was meant.

## 7. Failure & edge cases

- **Player leaves mid-race**: dropped from the field, keeps their progress in
  the placings, marked as left.
- **Host leaves**: the race runs on; the track and clock are the referee's.
- **Permission denied**: cannot play (§5); spectates on the rail.
- **Backgrounded tab**: stops simulating and reporting; on return it rejoins at
  the referee's clock, having lost the time. Dimmed on the rail while silent.
- **Car wedged against a rail at zero speed**: reverse exists precisely for
  this, and the spool restarts from 0 when it is released.
- **Nobody finishes** before `TILT_RUN_CAP_MS`: placings by progress.
- **Solo (1 player)**: the card promises 2–8, and the referee enforces the
  card (AGENTS.md §4), so a lone player cannot start a public race. Nothing
  about a one-car race is broken though, and solo testing (`shared/players.ts`)
  opens it as a time trial for exactly that reason.

## 8. Anti-cheat

Each phone reports its own progress, so the mitigation is the same bound
Asteroid Race uses:

- **Reported progress is clamped** to what the speed curve could have covered
  since the last report, plus slack for one collision-free straight.
- **Lap counts must increase by one at a time**, and only after passing the
  line.
- **The track is the referee's**, so nobody races a straight line.

## 9. Safety

Mandatory:

> **You turn the phone, not yourself.** Sit down for this one, keep your elbows
> in, and don't play it standing on a bus.

Enforced: the race is capped at `TILT_RUN_CAP_MS`, and nothing rewards moving
your body or swinging the phone.

## 10. Data & privacy

One arc length and a lap number per player, 4×/s, relayed in the room and never
stored. Raw orientation readings never leave the phone.

## 11. Accessibility

- **Tilt-only is an exclusion**, disclosed in the lobby (§5).
- **Sensitivity is adjustable** in the gear menu, as Asteroid Race's is.
- **Reduced motion**: the map never rotates at all now, which is a real
  improvement here — only the car turns. The skid's visual smear and the
  collision shake are still suppressed.
- **The progress rail is announced as text** ("4th of 6, lap 1"), so the race
  state does not depend on reading a rotating map.
- **The reverse button has a fixed accessible position** as an option, for
  anyone for whom a button that moves is worse than a button in the wrong
  place.

## 12. Open questions

Five were open when this spec was written. Building it settled four, and
turned up two the spec had not thought to ask.

1. ~~**"Every 0.25 ms"** (§6).~~ **Settled as 250 ms** (`TILT_REPORT_MS`), the
   rate every other continuous game here uses. Still worth a word from the
   maintainer if something else was meant.
2. ~~**What the speed numbers mean.**~~ **Settled**: the issue's 100 and 120 are
   `TILT_CRUISE_SPEED` and `TILT_TOP_SPEED` in world units per second, where a
   grid tile is 100 units — and the circuit's *length* is then derived from a
   ~100 s target lap rather than the speed being derived from a guess.
   `shared/tiltTrack.test.ts` measures the median lap at 105 s across 120
   rolled circuits.
3. ~~**`TILT_SKID_TAU_MS`.**~~ **Settled at 110 ms, and it cannot be judged
   alone.** A constant turn rate against a first-order lag settles at
   `rate × tau` radians of slide, so the skid and the turn rate multiply. At the
   320 ms first written here a corner-rate turn would settle at 66° of slide,
   which is a spin rather than a skid; 110 ms puts it at 23°. The test asserts
   the *product*, against `TILT_CORNER_RATE`. Since the heading is now the
   wrist's own, this is also the only thing between a violent flick and an
   instant reversal — which is exactly the physics it should be.
4. **Does the reverse button really need to move?** Still open, and still a
   lovely detail with a real accessibility cost. It is built as the issue asks
   — it follows gravity round the screen's edge and freezes while held — and
   `gravityButton.test.ts` pins every pose. The pin-it-in-place option in §11
   is **not** built.
5. ~~**Track generation**: spline or tiles?~~ **Settled, and stronger than
   either.** The circuit is the **boundary of a polyomino**: grow a blob of grid
   cells, and its outline is the centreline. Closed for free, non-self-crossing
   provided the blob has no hole and no diagonal pinch (both tested before a
   cell is accepted), and the rails cannot meet because two sides of a
   one-cell arm are a whole tile apart. 200 rolled circuits are checked segment
   pair by segment pair.

Two the build raised:

6. **The tightest corner asks for 206°/s of wrist.** A snaking circuit contains
   corners of radius `TILE / 3`, and following one at top speed needs 3.6 rad/s
   (`TILT_CORNER_RATE`). Nothing caps it any more — the wrist is the limit — but
   it is a real physical demand, and whether a hand can hold that through a
   sequence of corners is the first thing to find out on a real phone. The
   alternative is a slower car or a looser roller, and both change the lap time.
7. **The circuit reads as a maze rather than a race track.** Getting a 100 s lap
   out of an 11×15 grid means corridors packed one tile apart, so a lot of road
   is visible that cannot be reached from where the car is. It is correct — the
   rails are real — but a wider grid with a shorter blob would look more like a
   circuit, at the cost of the lap length. `endurance` mode (three laps) would
   let the circuit itself be a third of the size, which may be the real answer.

One a real phone raised, reversing a piece of §2.1/§5 as built:

8. **`base` is a fixed constant now, not a per-round calibration.** The first
   build zeroed `roll.ts` on the round's first reading and set `base` to
   wherever the track happened to start — "hold it however you like" — which
   read, on a real phone, as the car turning further than the wrist did:
   holding the phone bolt upright at the green light could still show it
   pointing sideways, since the baseline was the track's own arbitrary start
   direction rather than upright, and correcting that mismatch by hand looked
   exactly like an over-eager control. Upright now always means "up the map"
   (`TILT_UPRIGHT_HEADING`, `drive.ts`), and there is no calibration step left
   to remove. The cost, not yet weighed against a real circuit: the car can
   start pointing away from the road it is standing on, if a given track's own
   first stretch does not happen to run north — untested against whether that
   reads as confusing at the green light the way the old mismatch did.
9. **`downVector`'s formula was wrong off the four poses it was validated
   against.** A real phone raised this too: a steady roll read as changing
   direction on its own when the phone was pitched back or forth, with nobody
   touching the steering. The formula matched the actual device-orientation
   rotation matrix only when `beta` or `gamma` sat at the extreme that zeroes
   the missing cosine — true at "held upright," "upside down," and the two
   edge-down poses, false everywhere else, which is any ordinary grip.
   Corrected in `gravityButton.ts`; `gravityButton.test.ts` now also pins a
   pose with both axes away from their extremes.
10. **The reverse button was sliding to the edge opposite the player's
    thumb.** A second sign bug in the same vector, and the exact failure mode
    #9's own doc warns about: `downVector`'s `x` had picked up an extra `-`
    somewhere along the way — correct for `roll.ts`'s own "clockwise on the
    wrist is clockwise on the road" need, backwards for the button's much
    simpler "which edge is lowest right now." Fixed by keeping `downVector`
    as the raw screen direction and moving the compensating `-` into
    `rollAngle`, where the clockwise convention actually lives;
    `gravityButton.test.ts` now also checks `reverseSpot` end to end, not
    just `downVector`'s raw output, which is what let this one through.
