# Maximum Jump

| | |
| --- | --- |
| **Slug** | `maximum-jump` |
| **Catchy sentence** | Sprint, hit the line, fly. Longest jump wins |
| **Illustration** | `www/src/games/maximum-jump/art/card.svg` — a jumper mid-flight over a sand pit, the take-off line behind |
| **Players** | 1–8 |
| **Round length** | ~1–2 min (three attempts each) |
| **Inputs** | touch |
| **Accent colour** | `#EAB308` |
| **Status** | building |

## 1. Pitch

The long jump from the Apple IIe decathlon, on a phone. Two buttons are your
two legs and you alternate them to build speed; the faster you are going the
tighter the rhythm gets. Hit the take-off line exactly and you get a bonus and
the best angle; go over it and you faceplant into the sand. Then, in the air,
you hammer the jump button to stay aerodynamic.

## 2. Core loop

Three attempts each, best one counts. One attempt is three phases.

1. **Run-up.** The jumper starts at the left of a landscape board. Two big
   buttons at the bottom corners are the left and right leg. Alternating them
   takes a step; each step adds up to one speed increment, scored on how close
   the press was to the end of the previous leg's animation (§2.1). The
   animation gets shorter as the jumper gets faster, so the rhythm tightens
   with the speed.
2. **Take-off.** The line is at step 50. The jump button in the bottom centre
   fires the take-off. Past the line is a faceplant and scores nothing. Exactly
   on it is `MAXJUMP_TAKEOFF_BONUS` extra speed increments and the best angle,
   42°. Early is no bonus and a steeper, worse angle, up to 50° (§2.2).
3. **Flight.** A ballistic arc from the take-off speed and angle. By default the
   jumper sheds forward speed fast; tapping the jump button in the air holds
   that off, linearly, up to `MAXJUMP_FLAP_RATE` taps a second, at which point
   the arc is pure gravity (§2.3).

**Win condition:** the longest single jump in the room.
**Scoring:** the jump distance in metres, best of three. A faceplant is 0 m and
still uses an attempt.

### 2.1 What one step is worth

A press only counts when it is the *other* leg from the last one — pressing the
same leg twice is not a step at all, which costs the time rather than the
speed.

Each leg's animation runs for `stepMs(speed)`, from `MAXJUMP_STEP_SLOW_MS` at a
standstill down to `MAXJUMP_STEP_FAST_MS` at `MAXJUMP_MAX_SPEED`, linearly. The
press is scored against the moment that animation *ends*:

```
gain = clamp(1 − |pressedAt − animationEndsAt| / MAXJUMP_TIMING_WINDOW_MS, 0, 1)
speed += gain × MAXJUMP_SPEED_PER_STEP
```

So a press dead on the beat is worth a full increment, and a press half a window
out is worth half. There is no decay between steps: a slow, sloppy run-up is
punished by arriving at the line slow, not by losing what it already had.

### 2.2 The take-off

The jumper's position along the run-up is a **continuous** step count, not an
integer — it advances with the speed, and the 50th step is a place on the track
rather than a press.

| Where the button went | Speed | Angle |
| --- | --- | --- |
| past 50 | — | faceplant, 0 m |
| the last `MAXJUMP_PERFECT_BAND` of step 50 | `+MAXJUMP_TAKEOFF_BONUS` increments | 42° |
| between 49 and 50 | none | 50° → 42°, linear |
| before 49 | none | 50° |

The last stride is where the whole attempt is decided, which is what the linear
ramp over that one step is for: 50° is a high, short, safe jump and 42° is the
one that goes furthest, and the difference between them is a few hundredths of
a second of nerve.

### 2.3 The flight

Plain projectile motion from `v₀` and `θ`, at `MAXJUMP_GRAVITY`, plus a drag
term on the horizontal component only:

```
drag = MAXJUMP_DRAG × (1 − clamp(tapsPerSecond / MAXJUMP_FLAP_RATE, 0, 1))
vx  −= drag × vx × dt
```

At `MAXJUMP_FLAP_RATE` taps a second the drag term is gone and the arc is pure
ballistics; at none it is the full `MAXJUMP_DRAG` and the jumper stalls out of
the air. The tap rate is measured over a rolling
`MAXJUMP_TAP_WINDOW_MS`, so it responds within the flight rather than after it.

The jump ends when the jumper comes back to ground level. The distance is the
horizontal ground covered from the line, in metres.

## 3. Modes / variations

| Mode | Blurb | Difference from core |
| --- | --- | --- |
| `classic` | Three attempts, best jump wins | baseline |

## 4. Screens

Lobby → countdown → attempt → landing → next attempt → scoreboard.

**Landscape**, and locked to it on Ready/Start
([device-capabilities.md](../../device-capabilities.md) §5b): the run-up is the
screen's long axis, and the game does not exist in portrait.

The board is a side-on track. The jumper runs left to right against a scrolling
background, the take-off line and the sand pit come into view as the line
approaches, and the camera follows the jumper through the flight. Big and live:
the speed bar along the top, the steps remaining to the line, and — once in the
air — the distance so far, counting up.

Three controls, all thumb-reachable in landscape: left leg bottom-left, right
leg bottom-right, jump bottom-centre.

## 5. Inputs & sensors

Touch only. No sensor, no permission, and therefore no fallback to describe.

## 6. Networking

**The phone runs the whole attempt.** The run-up, the take-off and the flight
are one player's own physics on their own screen, and nothing about them is
worth a round trip — a leg press that waited 150 ms for a referee would not be
the game the issue describes. What crosses the wire is the result.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `jump-result` | phone → room | `{ roundId, attempt, speed, distance }` | One attempt finished. `distance` is 0 for a faceplant. |
| `maximum-jump` | room → phones | `MaximumJumpState` | The ladder: best distance and best speed per player, the attempt each is on, phase and winner. |

The referee owns the attempt count, the cap and the winner. It keeps each
player's **best** distance and never lowers it, so a reconnect resumes from the
room's own record.

## 7. Failure & edge cases

- **Player leaves mid-round**: their best stays on the ladder and can still win
  it — nobody was jumping against them directly.
- **Too few players**: one is a legitimate round (1–8). Solo records no winner.
- **Backgrounded tab**: the attempt in flight is lost, and the attempt counts.
  The referee's cap ends the round whatever any phone is doing.
- **Nobody jumps at all**: everyone scores 0 m, no winner.
- **Ties**: unranked, the same call every other game here makes.
- **A player who never finishes three attempts**: the round cap
  (`MAXJUMP_ROUND_CAP_MS`) ends it and their best so far stands.

## 8. Anti-cheat

The phone reports its own distance, so the referee bounds it by what the
physics could possibly produce: the range of a projectile launched at
`MAXJUMP_MAX_SPEED` and 45° under `MAXJUMP_GRAVITY` with no drag at all, plus a
little slack. A phone claiming more than the game's own best case is clamped to
it.

That bounds the exploit rather than detecting it, which is the same posture the
other report-your-own-number games take: a client that lies within the physics
gets away with it, and the cost of catching that is replaying every leg press
on the server.

## 9. Safety

Touch only, nothing moves but a thumb. Nothing to warn about.

## 10. Data & privacy

Two numbers per attempt — a speed and a distance. Nothing else leaves the phone,
and nothing is stored past the room's lifetime.

## 11. Accessibility

The mechanic is fast, repeated, precise tapping, which is exactly what it is and
cannot be adapted without becoming a different game. The lobby says so.

The speed, the steps left and the final distance are all announced as text, so a
player with low vision can follow the run-up by the numbers rather than the
sprite.

## 12. Open questions

1. **Four taps a second, or five?** The issue says both — "at least 5 per
   second" for no deceleration, and "linear formula for 0 to 4 taps per sec".
   Built with 5 as the top of the ramp, because that is what the no-drag
   requirement asks for; worth a playtest to see whether 5/s is reachable on a
   phone held in two hands.
2. **Is fifty steps the right run-up?** Long enough to build the rhythm, short
   enough that a failed attempt is not a punishment. Untested on real thumbs.
3. **Three attempts, or one?** Three matches the sport and gives a room three
   chances at a good one. It also makes a round three times as long.
