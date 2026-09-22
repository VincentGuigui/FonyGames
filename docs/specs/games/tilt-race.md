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
   100 → 240 over another 3 s. There is no throttle. (Top speed was 120;
   doubled on maintainer request — §12 Q2.)
4. **The phone's own rotation is the heading**, one for one (§2.1, §5). Above
   100, the car **skids**: the momentum lags the heading and the car keeps some
   of its old direction through a turn.
5. **A reverse button** sits at the bottom of the screen — the bottom as
   gravity sees it, so it slides around the screen's edge as the phone turns,
   **every frame**, off the same sensor reading that steers the car. Press it
   and it **locks in place** until released, then falls back to wherever down
   has become, and its face **turns with gravity** so the arrow points at the
   real floor whatever the phone is doing (`reverseSpin`, issue #43). Its icon
   is a straight arrow down: the car backs straight out the way it came, where
   a curved return arrow read as "turn round".
6. **The car is two points, and it turns about the back one** (§2.3) — the
   steered wheels are at the front, so the wrist swings the nose and the tail
   follows, in reverse the other way round.
7. **Guardrails turn the car, they do not stop it** (§2.3), and **only the end
   being driven into one costs anything**: clip a wall with the tail while
   going forwards and the car is simply put back on the road, same speed, same
   direction. A hit on the leading end keeps whatever of the momentum was
   already running along the rail and loses what was running across it; putting
   that end back swings the body straight, so a car squares itself up with a
   wall it is scraping; and the scrape costs what the angle says
   (`TILT_SCRAPE_DECEL` broadside, `TILT_SCRAPE_ALIGNED` of that once running
   true) — so squaring up is worth doing, and the wall never brings the car to
   a standstill.
8. First across the finish line wins. Everyone else runs until
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
tightest corner *demanded* at the original 120 top speed, kept frozen because
it is the number the skid has to be judged against. 206°/s is well inside a
wrist; the same corner at the current, doubled top speed asks for about
7.2 rad/s, which is not (§12 Q11) — an accepted cost of the extra speed, not a
number this constant tracks any more.

### 2.3 The body, and what a guardrail does to it

**The car is two points, not a box round its centre.** A front point and a
rear point, `TILT_WHEELBASE` apart (39 units), each carrying a disc of half the
car's width — a capsule `TILT_CAR_LENGTH` × `TILT_CAR_WIDTH` (70 × 31, the
sprite's own 225/512 aspect). `TrackCanvas` draws the sprite at those same two
constants centred on the same midpoint, so the body and the picture cannot
drift apart: what the player sees touch a rail is what touched it.

Two points rather than one centre, because **a car does not pivot about its
middle**, and rather than four corners, because the question the physics
actually needs to answer is *which end is touching*.

**Steering swings the front about the back.** The steered wheels are at the
front, so turning the wheel holds the back still and points the front
somewhere else. A single centre point and a heading give you the other thing —
the nose going one way and the tail the other — so every turn of the wrist
crabbed the whole car sideways out of its lane and swept the tail into rails it
was nowhere near. In reverse the pivot swaps ends, because backing a car up is
the tail that swings. Measured: one frame of a turned wrist moves the leading
end 19.3 units and the trailing end 0.1 (`thePivot` in `drive.test.ts`).

This is also what made the autopilot's lap drop from 125 s and a long tally of
rail touches to **54 s and none at all** — not a physics tuning, just a car that
goes where it is pointed instead of shouldering its way round every corner.

**One edge case disappears with the box.** The rounded rectangle stuck its
corners out at the diagonal, so past about 0.92 rad (53°) across the road there
was no legal pose at all — the body was against both rails at once and the
physics had to keep working in a state with no answer. A capsule's reach across
the road is `halfWheelbase·sinθ + radius`, topping out at 19.5 + 15.5 = 35
against the 36 the road gives, so **a car on the centreline fits at every angle,
sideways included**. A car can still be pinned against a rail; it just always
has somewhere legal to be put.

**Which end hit decides whether it costs anything at all.**

The *leading* end is the one the car is being driven onto — the nose going
forwards, the tail in reverse. Only that one pays:

- **The trailing end clipping a wall is free.** Nothing is being driven into
  the wall there, so there is no momentum for the wall to take. All that is
  owed is the overlap: the tail is put back on the road and the body swings
  round the nose, at the same speed, in the same direction of travel, with no
  bump reported and the spool untouched. Measured: 170 u/s in, 170 u/s out, the
  tail lifted 11 units back onto the road while the nose moved 3.6
  (`theFreeEnd` in `drive.test.ts`). That swing is the two-point body earning
  its keep — a tail that clips a wall steps the car out, exactly as it would on
  tarmac, instead of braking it.
- **The leading end is what the rest of this section is about.**

**And what a rail does to that end is turn the car, not stop it.**

The momentum is split against the rail: the component running *across* it is
absorbed by the wall, the component running *along* it is kept, whole. That
single projection is the whole impact rule — a graze keeps nearly all its
speed because nearly all of it was already going the rail's way, and a square
hit keeps nearly none because none of it was. Nothing further is taken off on
contact.

| Approach | Keeps |
| --- | --- |
| square on to the rail | nothing — there was nothing along it to keep |
| forty-five degrees | cos 45, about 71% |
| a pure graze, along the rail | everything |

**Then the rear wheels, twice over.** The car is rear-wheel drive and the
engine does not care that there is a wall: it keeps pushing along the car's own
heading, and the rail turns whatever part of that runs along itself into motion
(`TILT_RAIL_DRIVE`, 240 u/s²). So a car sitting at an angle against a guardrail
crabs along it rather than sticking where it landed.

**And the drive tucks the far end IN, rather than swinging the near end out**
(`TILT_REAR_TUCK`). A rear-wheel-drive car scraping its nose along a wall is
turned by the wall's reaction at the nose against the thrust behind it: the tail
comes round until the car lies flush. Pushing the nose off the wall instead —
the obvious reading — leaves the car permanently angled and never actually
sliding, which is what issue #42 kept reporting. Measured: a car hitting at
0.69 rad closes to 0.10 rad of the rail within a second, its tail coming in from
14 units of clearance to 3.6 while the nose stays on the wall.

This is the one thing in the game allowed to sit on top of the phone's own
heading, and it is deliberately a **debt, not a second steering input**:

- it is carried in its own field, `align`, so `heading` is `base + roll + align`
  and the wrist's contribution is never overwritten;
- it is **bounded** by `TILT_ALIGN_MAX` (0.7 rad, 40°), so a player who points
  90° into a wall gets a car 50° off it — helped, not taken out of their hands;
- it **relaxes back to zero** the moment the car is free, over
  `TILT_ALIGN_RELAX_MS` (260 ms), so the 1:1 promise of §2.1 is restored within
  a quarter second of leaving the wall.

Nose **exactly** square into a wall is the one case with no way out but
reverse, and now for a reason rather than by decree: the rail pushes the
touching end straight back down the car's own axis, so there is no sideways
component, nothing to swing the body about its tail, and nothing along the rail
for the wheels to bite. Off square by any margin at all and the geometry starts
turning it out. Measured: dead square it settles at 1.9 u/s and stays there
until reverse is pressed.

**Then the scrape, and it costs what the angle says.** Every frame of contact,
at `TILT_SCRAPE_DECEL` (90 u/s²) scaled by how far the car is from running true:

```
scrape = TILT_SCRAPE_DECEL × (TILT_SCRAPE_ALIGNED + (1 − TILT_SCRAPE_ALIGNED) × |sin misalignment|)
```

So a car dragged broadside pays 90 u/s² and one running along the wall pays
22.5 — where both used to pay a flat 180. Charging the same for both is what
made every graze read as a crash, and it left the alignment above nothing to
earn. The floor is not zero on purpose: at zero the outside wall becomes free
banking to lean on round every corner.

Wall-riding is deliberately not much of a speed penalty; what makes the outside
wall a bad line is the geometry, not the friction (§12 Q9).

**...but never to a dead stop.** Drive and scrape are both accelerations, so on
their own one simply beats the other. `TILT_RAIL_CRAWL` (35 u/s at full
nose-along-rail) is the equilibrium they are missing — under
`TILT_REVERSE_SPEED`, so scraping is still the slowest way round, but a car
against a wall is never stuck.

**The momentum, after all of it, follows the rail's own tangent, not the
wheel**, and the skid lag (§2.2) stays alive for as long as the car is touching
a rail whatever its speed. Otherwise the wheel — still aimed at the wall, since
that is what caused the hit — re-squares the car into the same rail before any
of the surviving speed has covered any distance.

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

### 4.1 Smoke trail

Above `TILT_CRUISE_SPEED` the car lays a smoke trail instead of the solid wedge
it used to draw (issue #44).

`art/smoke.png` is a 3×1 sheet of puffs, generated by `generate-smoke.mjs` and
checked by `test:smoke-art`. Five puffs (`TILT_SMOKE_PUFFS`) live at once,
spread over `TILT_SMOKE_LIFE_MS`; one is re-issued every fifth of that, and the
oldest slot is reused rather than the list growing, so the trail is a fixed loop
that allocates nothing mid-race.

Each puff keeps the position **and heading** the car had when it was laid, so
the trail bends with the line actually driven rather than trailing straight
behind. It drifts backwards along that heading (`TILT_SMOKE_DRIFT`), spreads
(`TILT_SMOKE_SPREAD`) and fades linearly to nothing.

The maths is in `smoke.ts`, DOM-free and tested; `TrackCanvas` only draws it,
in world space so the smoke stays on the road the car drove over.

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
- **Car pinned against a rail**: it crabs along and squares itself up as it
  goes (§2.3), so this is a slow patch rather than a dead end — measured at 116
  units in the first second from a 0.69 rad hit, closing to 0.07 rad of the
  rail. There is no "wedged with no legal pose" case any more: the two-point
  body fits on the centreline at every angle, sideways included. Only a nose
  driven **exactly** square into a wall has nothing to turn it, and reverse is
  the way out of that; `TILT_RAIL_CRAWL` is the floor until it is pressed, and
  the spool restarts from 0 when it is released.
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

**A lap is arc actually covered, not an arc length that wrapped.** The phone
carries `travelled`, the signed arc it has run since the flag, and `lap` is
`floor(travelled / length)` — nothing else. The wrap test this replaced ("was it
past three quarters, and is it inside the first quarter now?") could not tell a
car finishing a lap from a car **sitting on the start line**, because arc 0 and
arc `length` are the same point and every car starts on it. A few units of
wobble at the lights therefore banked a whole lap, and on a one-lap race that
was the race.

It did not stop there, and this is the part worth remembering: the phone then
reported a lap it had not run, the referee's own clamp above refused that claim
and pinned the stored progress to *the speed curve*, and the ratchet kept it
there. **The progress rail then climbed at a flat `TILT_CLAIM_SLACK ×
TILT_TOP_SPEED` = 360 units/s for the rest of the race, ignoring the car
completely** — measured in a browser at a dead-constant 2.68% of the lap per
second while the car's own speed swung between 32 and 105. The anti-cheat was
working exactly as designed; it was being fed a lie by the lap counter. Two
checks in `drive.test.ts` hold the line now: a car left on the start line has
run no lap, and nor has one nudged back and forth across it.
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

1. **Does the reverse button really need to move?** It is built as the issue
   asks — it follows gravity round the screen's edge, turns its face to match
   (§2, #43) and freezes while held — and `gravityButton.test.ts` pins every
   pose. The pin-it-in-place option in §11 is **not** built, and the
   accessibility cost of a moving control is real.
2. **The tightest corner asks for 206°/s of wrist.** A snaking circuit contains
   corners of radius `TILE / 3`, and following one at top speed needs 3.6 rad/s
   (`TILT_CORNER_RATE`). Nothing caps it — the wrist is the limit — but whether
   a hand can hold that through a sequence of corners is the first thing to find
   out on a real phone. The alternative is a slower car or a looser roller, and
   both change the lap time.
3. **The circuit reads as a maze rather than a race track.** Getting a 100 s lap
   out of an 11×15 grid means corridors packed one tile apart, so a lot of road
   is visible that cannot be reached from where the car is. It is correct — the
   rails are real — but a wider grid with a shorter blob would look more like a
   circuit, at the cost of the lap length. `endurance` mode (three laps) would
   let the circuit itself be a third of the size.
4. **Wall-riding is barely a speed penalty.** A car running true along a rail
   pays 22.5 u/s², less than the spool gives back, so a squared-up car against a
   wall climbs back to its own curve. Worth a playtest: the only thing
   discouraging the outside wall is the racing line. The lever is
   `TILT_SCRAPE_ALIGNED`, not the base figure.
5. **The rail is allowed to steer, a little.** `align` sits on top of the
   phone's 1:1 heading (§2.1) — the body turning because a rail pushed one end.
   Bounded (`TILT_ALIGN_MAX`, 40°) and gone within a quarter second of coming
   off the wall, but it is a real exception to the game's strongest promise and
   should be watched for on a phone.
