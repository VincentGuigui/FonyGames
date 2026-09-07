# Tilt Race

| | |
| --- | --- |
| **Slug** | `tilt-race` |
| **Catchy sentence** | *The car holds still. Tilt the world around it* |
| **Illustration** | `www/src/games/tilt-race/art/card.svg` — a small car dead centre, the track and its guardrails rotated hard around it, skid marks trailing out of the turn |
| **Players** | 2–8 |
| **Round length** | ~100 s |
| **Inputs** | orientation + touch |
| **Accent colour** | `#E4572E` |
| **Status** | 📝 draft — awaiting approval ([#14](https://github.com/VincentGuigui/FonyGames/issues/14)) |

## 1. Pitch

A little car on a track, seen from above — except the car never turns. It sits
dead centre pointing up, and tilting the phone **rotates the world around it**.
The whole track swings; you thread it through the gap.

It is the inversion that makes it, and it is the reason the game needs a
primer: for about ten seconds it feels wrong, and then it feels like nothing
else in the catalogue.

## 2. Core loop

Forward is automatic and the car cannot steer. Tilt to rotate the track under
it; hold reverse to back out of a mistake.

1. The referee rolls a **track** at start — one closed circuit with guardrails
   down both sides — identical for every player, and broadcasts it.
2. Everyone starts on the line together.
3. **Speed builds by itself**: 0 → 100 over `TILT_SPOOL_MS` (3 s), then
   100 → 120 over another 3 s. There is no throttle.
4. **Tilt rotates the terrain** around the fixed car (§5). Above 100, the car
   **skids**: rotation lags the tilt and the car keeps some of its old heading
   through a turn.
5. **A reverse button** sits at the bottom of the screen — the bottom as
   gravity sees it, so it slides around the screen's edge as the phone turns.
   Press it and it **locks in place** until released, then falls back to
   wherever down has become.
6. **Guardrails cost speed**: a front-on hit resets speed to 0; a glancing hit
   scrubs it by `TILT_SCRAPE_FRICTION`.
7. First across the finish line wins. Everyone else runs until
   `TILT_RUN_CAP_MS` so a whole room gets a placing.

**Win condition:** first across the finish line.
**Scoring:** finishing order; then distance along the track for anyone who did
not finish, and best lap as a footnote.

### 2.1 What "the car is fixed" actually means

The car is drawn at the centre of the screen, pointing up, always. What
changes is the **world transform**: the track rotates and translates under it.
That is a rendering decision with one simulation consequence worth stating —
the physics still runs in track space, where the car has a heading and a
velocity like anything else. The renderer simply always puts the camera on the
car and rotates so the car's heading is up.

This is the same relationship Asteroid Race has between its ship and its
tunnel, and the same trap: the offsets must be derived from the axis they are
applied to, or the framing drifts with the aspect ratio.

### 2.2 Skid

Below 100, rotation is immediate — the world turns exactly as far as the tilt
says. Above it, the car's heading is a **low-passed** version of the tilt,
lagging by `TILT_SKID_TAU`, and the velocity keeps pointing where the car used
to face. That is what makes the last 20 of the speed range a cost as well as a
gain: the fast line is faster only if you can hold it.

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
- **The track**, rotating and translating under it, guardrails clearly drawn —
  the one thing that must be readable at speed.
- **A speed readout** and the spool state, small, top-left.
- **The reverse button**, bottom-as-gravity-sees-it, sliding around the screen
  edge; locked while pressed.
- **A progress rail** with every player's dot, as Crowd Race has, since
  otherwise a race with eight cars on separate parts of the track is invisible.

## 5. Inputs & sensors

**`deviceorientation`** through the shared filter in
`www/src/core/sensors/steer.ts`, calibrated at Ready
([../device-capabilities.md](../device-capabilities.md) §2).

- **One axis steers** (`gamma` → world rotation rate), with the dead zone the
  shared filter already applies so a hand at rest does not creep.
- **Gravity's own direction** places the reverse button, from the same
  orientation event — no separate sensor.
- **Touch** for the reverse button only.

**Fallbacks** (mandatory): none. The inverted tilt is the entire game, and a
touch-steered version is a different one — the same call AGENTS.md §4 allows
for Asteroid Race and Neon Fall. Disclosed in the lobby before anyone starts.

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
- **Solo**: a time trial. Supported.

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
- **Reduced motion**: the world still rotates — that is the game — but the
  skid's visual smear and the collision shake are suppressed.
- **The progress rail is announced as text** ("4th of 6, lap 1"), so the race
  state does not depend on reading a rotating map.
- **The reverse button has a fixed accessible position** as an option, for
  anyone for whom a button that moves is worse than a button in the wrong
  place.

## 12. Open questions

1. **"Every 0.25 ms"** (§6) — confirmed as 250 ms?
2. **What the speed numbers mean.** 0–100–120 is given without units; this
   spec treats them as arbitrary game units and derives the actual world speed
   from a target lap time (~100 s), the way Gravity Shooter derives launch
   speed from a target flight duration rather than picking a number.
3. **`TILT_SKID_TAU`** — the single number that decides whether the top of the
   speed range is exciting or infuriating.
4. **Does the reverse button really need to move?** It is a lovely detail and a
   genuine accessibility cost; an option to pin it is proposed above, but the
   default needs deciding.
5. **Track generation**: a closed circuit that never self-intersects, at a
   width the skid can survive, is the real work here. Worth deciding up front
   whether it is generated from a spline or assembled from pre-made tiles —
   the tile version is far easier to guarantee and far easier to draw.
