# Steady Hand

> Status: **draft**, awaiting validation. No code yet.

| | |
| --- | --- |
| **Slug** | `steady-hand` |
| **Catchy sentence** | *Hold your phone perfectly still. Longer than everyone else* |
| **Illustration** | `www/src/games/steady-hand/art/card.svg` — a phone held perfectly level, a target centred on it |
| **Players** | 2–8 |
| **Round length** | ~1 min, hard cap 2 min |
| **Inputs** | motion (accelerometer) |
| **Accent colour** | `#C084FC` |
| **Status** | draft |

## 1. Pitch

Everything else in the catalogue asks you to move. This one asks you to stop.

Hold your phone out in front of you and keep it still. The tolerance tightens as
the round goes on, so it always ends, and the last hand still steady wins. It is
quiet, it is tense, and it makes a room go completely silent — which is a
different kind of funny from the shouting games.

## 2. Core loop

1. The host starts. A three-second settle window lets everyone get into position
   before anything counts.
2. Everyone is `steady`. Your phone measures its own **wobble** (§2.1) and sends
   it on a tick.
3. Exceed the current tolerance and you are **out**, instantly and visibly.
4. The tolerance **tightens** on a schedule (§2.2), so a room full of statues
   still produces a winner.
5. Last player steady wins. If the 2 min cap arrives, the steadiest average wins.

**Win condition:** be the last player not eliminated.
**Scoring:** 1 point for the win, plus a survival time worth showing on the
results screen.

### 2.1 Wobble

Wobble is the **change** in the acceleration vector, not its magnitude —
gravity is 9.81 m/s² and constant, so magnitude alone says nothing about whether
you are holding still.

```
wobble = |a(t) - a(t-1)|          smoothed over a short window
```

Reported as a rolling maximum over the tick, not a mean: a single flinch is
exactly what the game is looking for, and a mean would hide it.

| Constant | Value | Why |
| --- | --- | --- |
| `STEADY_TICK_MS` | 200 | Fast enough to catch a flinch, slow enough to be 5 msg/s |
| `WOBBLE_START` | 1.2 m/s² | Forgiving: breathing and a pulse must not eliminate anyone |
| `WOBBLE_FLOOR` | 0.25 m/s² | Tight enough that nobody survives it for long |
| `TIGHTEN_EVERY_MS` | 10 000 | One step every ten seconds |
| `TIGHTEN_FACTOR` | 0.8 | Ten steps from start to floor, so ~90 s worst case |

### 2.2 Why the tolerance has to tighten

Without it, a player who rests the phone on a table never wobbles and the round
never ends. Tightening guarantees termination and gives the round a shape: easy
for twenty seconds, then visibly nervy, then brutal.

It is the same structural trick as Pass the Bomb's shrinking fuse, and for the
same reason — a game between evenly matched players needs a clock that closes
in, or it is decided by boredom.

### 2.3 It must be held, not parked

Resting the phone on a table wins trivially, so the game refuses to count you as
steady unless the phone is **held up**:

- The gravity vector must be within `HOLD_CONE` (**35°**) of horizontal-ish —
  i.e. the screen facing you, not flat to the ceiling.
- Flat on a table for more than 1 s → eliminated, with the honest reason:
  *"Phone put down"*, not a vague "you moved".

This is the one rule that needs saying out loud in the rules panel, because a
player who is eliminated for cheating they did not know was cheating will think
the game is broken.

## 3. Modes / variations

None at launch. Recorded, not built:

| Idea | Difference |
| --- | --- |
| `one-hand` | Held at arm's length, the tolerance tightens twice as fast |
| `sabotage` | Eliminated players get one 3 s "shout" that flashes everyone's screen |
| `lives` | Three strikes instead of instant elimination, for a longer, gentler round |

`sabotage` is the interesting one: it solves the spectator problem in §12 by
giving the dead something to do to the living.

## 4. Screens

- **Lobby**: shared template, permission primer, and the "held not parked" rule
  (§2.3) stated where it cannot be missed.
- **Round — steady**: your wobble as a **meter that fills toward the limit**, the
  current tolerance as a line on it, and how many players are left. The meter is
  the whole game: it has to be readable without moving your eyes much, so it is
  large, central, and changes colour *and* fill.
- **Round — the moment you go**: full-screen, unmistakable, naming the reason
  (*"You moved"* / *"Phone put down"*). Then you become a spectator.
- **Spectator**: who is left, and their live wobble meters — watching four people
  sweat is the best part of being out.
- **Results**: winner, then survival times.

## 5. Inputs & sensors

Motion, through `core/sensors/motion.ts`. A new `core/sensors/steady.ts`
implements §2.1 — the third interpreter beside `bump.ts` and `shake.ts`, and
like them the only place that reads raw samples.

Permission is requested from a tap in the lobby, never on arrival
([device-capabilities.md](../../device-capabilities.md) §2).

**Fallbacks: there are none, and the card says so.**

This is the second game after Cat and Mouse to ship without one, and for a
harder reason: Cat and Mouse could have had a touch mode and chose not to;
Steady Hand *cannot*. "Hold a phone still" has no touch equivalent — a tap
fallback would be a different game wearing this one's name. A player without
motion access joins as a **spectator**, which is a real role here (§4) rather
than a consolation.

## 6. Networking

Server is authoritative for the tolerance, eliminations and the result.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `wobble` | client → server | `{w, held, roundId}` | My rolling-max wobble this tick, and whether the phone is held (§2.3) |
| `steady` | server → clients | `{roundId, tolerance, alive[], w: {playerId: wobble}}` | The state of the room |
| `steady-out` | server → clients | `{roundId, victim, reason, alive[]}` | Somebody went |
| `steady-end` | server → clients | `{roundId, winner, times}` | Round over |

**Silence is elimination.** A phone that stops sending for `2 × STEADY_TICK_MS`
is out. Without that rule the winning move is to close the tab, and it also
covers the backgrounded-tab case for free.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| Tab backgrounded | Motion events stop → silence → eliminated. Deliberate, and the rules say so |
| Player disconnects | Eliminated with reason `left` |
| Everyone eliminated on the same tick | The one with the lowest wobble that tick survives and wins |
| Nobody eliminated by the 2 min cap | Lowest average wobble wins |
| A player rejoins mid-round | Spectator until the next round. There is no way back into a round you were eliminated from |
| Fewer than 2 players | Start disabled |

## 8. Anti-cheat

The honest position, stated plainly because the alternative is theatre: **a
client that reports zero wobble forever cannot be caught.** The server sees only
what the phone claims.

What is worth doing anyway:

- **A perfectly constant value is itself suspicious.** Real hands produce noise;
  an exact 0.000 for twenty ticks is not a steady hand, it is a patched client.
  Flagged, not auto-eliminated — a false accusation is worse than a cheat.
- **Silence is elimination** (§6), which closes the simplest exploit.
- **The `held` flag** (§2.3) makes the laziest physical cheat — table, lap, knee
  — cost something.
- And the room can see you. Everyone is standing in a circle holding a phone out;
  the cheat that matters is resting your elbow on a chair back, and your friends
  will notice.

## 9. Safety

Low risk, but not zero: people hold a pose and stop paying attention to the room.

> **Feet planted, elbows in. If your arm gets tired, put it down — being out is
> better than dropping your phone on the dog.**

Enforced: the 2 min cap.

## 10. Data & privacy

Leaves the phone: one wobble number per 200 ms, a boolean, player id, name,
avatar. Never the accelerometer stream. Room memory only.

## 11. Accessibility

The uncomfortable one, and it needs saying rather than burying: **this game
disadvantages anyone with a tremor, and no tuning fixes that.** A tolerance
loose enough to include an essential tremor is loose enough that nobody is ever
eliminated.

What can be done, and is:

- The **spectator role is real** (§4), not a waiting room — watching the meters is
  genuinely the second-best seat.
- `lives` mode (§3) softens elimination from a cliff to a slope.
- Elimination always names its reason, so nobody is left guessing.
- The meter carries fill, number and colour — never colour alone.
- No flashing on elimination; a fade under `prefers-reduced-motion`.

The card should not pretend otherwise: this is a game about fine motor control,
and the catalogue is large enough to carry one.

## 12. Open questions

- Are the numbers in §2.1 anywhere near right? All five are guesses. `WOBBLE_START`
  in particular has to survive a nervous person's pulse at arm's length.
- Does elimination-on-first-flinch make for a good party game, or is `lives` the
  better default? A single flinch ending your round after 40 s of tension may be
  more annoying than dramatic.
- Do eliminated players need something to do (`sabotage`, §3)? A minute of
  watching is fine; three rounds of it is not.
- Should the tolerance tighten on a **timer** or on **survivors** — e.g. tighten
  each time someone goes out? Survivor-driven tightening ends faster with a big
  group and slower with two, which may be the better shape.
