# Steady Hand

> Status: **draft**, awaiting validation. No code yet.

| | |
| --- | --- |
| **Slug** | `steady-hand` |
| **Catchy sentence** | *Hold your phone perfectly still. Longer than everyone else* |
| **Illustration** | `www/src/games/steady-hand/art/card.svg` — a phone held perfectly level, a target centred on it |
| **Players** | 2–8 |
| **Round length** | ~1–2 min, hard cap 2 min |
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
2. Everyone starts with **three lives**. Your phone measures its own **wobble**
   (§2.1) and sends it on a tick.
3. Exceed the current tolerance and you lose **one life**, visibly, with a second
   of grace before the next one can be taken (§2.4). At zero you are out.
4. The tolerance **tightens** on a schedule (§2.2), so a room full of statues
   still produces a winner.
5. Last player with a life wins. If the 2 min cap arrives, the steadiest average
   wins.

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
| `STEADY_LIVES` | 3 | A flinch costs a life, not the round (§2.4) |
| `GRACE_MS` | 1000 | After losing a life, wobble is ignored while you resettle |

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
- Flat on a table for more than 1 s → **eliminated outright, bypassing lives**,
  with the honest reason: *"Phone put down"*, not a vague "you moved".

Parking costs the round rather than a life on purpose. Lives exist to forgive a
flinch, which is the game being hard; putting the phone down is not a flinch, and
three free goes at the one cheat the game can actually detect would make the
detection pointless.

This is the one rule that needs saying out loud in the rules panel, because a
player who is eliminated for cheating they did not know was cheating will think
the game is broken.

### 2.4 Three lives, and the grace window

A single flinch ending a 40-second hold is more annoying than dramatic — it
punishes the nervous rather than the unsteady, and it empties the room fast in a
game whose tension comes from watching several people suffer at once.

Three lives change the shape: the first slip is a scare, the second is a
countdown, the third is the end. The room thins gradually and the last thirty
seconds have two or three people left rather than one.

**The grace window is not a nicety, it is required.** Wobble is reported every
200 ms, and the flinch that costs a life is still in progress on the next tick —
without grace, one twitch spends all three lives in 600 ms and the mode does
nothing. After a life is lost, wobble is ignored for `GRACE_MS`, which is also
long enough to get the phone back under control.

**Sudden death** — one life — is recorded as a mode in §3 rather than the
default, because it is the harsher version of a game that is already tense.

## 3. Modes / variations

None at launch. Recorded, not built:

| Idea | Difference |
| --- | --- |
| `sudden-death` | One life. The knife-edge version, for a room that has played it before |
| `one-hand` | Held at arm's length, the tolerance tightens twice as fast |
| `sabotage` | Eliminated players get one 3 s "shout" that flashes everyone's screen |

`sabotage` is the interesting one: it solves the spectator problem in §12 by
giving the dead something to do to the living.

## 4. Screens

- **Lobby**: shared template, permission primer, and the "held not parked" rule
  (§2.3) stated where it cannot be missed.
- **Round — steady**: your wobble as a **meter that fills toward the limit**, the
  current tolerance as a line on it, your **remaining lives as pips and a number**,
  and how many players are left. The meter is
  the whole game: it has to be readable without moving your eyes much, so it is
  large, central, and changes colour *and* fill.
- **Losing a life**: a hard, brief full-screen beat — the count that is left, big —
  then straight back to the meter. It has to be unmissable without stealing the
  second of grace you need to resettle.
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
([device-capabilities.md](../../device-capabilities.md) §2) — and since there is no
fallback to choose between (below), **that tap is Ready, or Start for the host**,
not a button of its own. A primer button in front of a permission the player has no
alternative to only ever delays the same answer, so the panel keeps the explanation
and loses the button ([issue #29](https://github.com/VincentGuigui/FonyGames/issues/29);
`onBeforeReady` in [game-chrome.md](../../design/game-chrome.md) §1).

A refusal does **not** swallow that tap. It cannot: refusing here means spectating,
which is a way to be in the round rather than a way to be kept out of it, so the
round starts anyway and the lobby says plainly that this phone has no meter. That is
the opposite of UFO Hunt, whose own no-fallback permissions really do block
([ufo-hunt.md](ufo-hunt.md) §5.3) — the difference is whether there is a seat left
for somebody who said no.

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
| `steady` | server → clients | `{roundId, tolerance, alive[], lives: {playerId: n}, w: {playerId: wobble}}` | The state of the room |
| `steady-hit` | server → clients | `{roundId, victim, lives, graceUntil}` | Somebody lost a life |
| `steady-out` | server → clients | `{roundId, victim, reason, alive[]}` | Somebody spent their last one |
| `steady-end` | server → clients | `{roundId, winner, times}` | Round over |

**Silence is elimination.** A phone that stops sending for `3 × STEADY_TICK_MS`
is out, with reason `left`. Without that rule the winning move is to close the
tab, and it also covers the backgrounded-tab case for free. Three ticks rather
than two so that one dropped frame on a bad connection is not an execution.

**An empty window is never sent.** The phone reports only tick windows that
actually contained accelerometer samples; a window with none is silence, and
silence is the server's to interpret. This is what makes the rule above
enforceable at all — a window with no samples has a wobble of zero, which is
indistinguishable from a flawless hold, so a phone whose sensor had stopped used
to report a perfect score forever and refresh its own liveness while doing it.
Turning the sensor off was a winning move. Pinned by
`www/src/games/steady-hand/game.test.ts` §the detector reports what it measured.

**The tick is a stored moment, not an interval.** `Steady.tickAt` holds the
server time the next broadcast is due, because Room's single alarm slot decides
which game it was woken for by comparing the clock against that number — a
deadline computed as "now plus a tick" is never due, and the round silently loses
both its tightening tolerance and the silence reaper while still looking alive,
since eliminations broadcast from the wobble path regardless.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| Tab backgrounded | Motion events stop → nothing to report → silence → eliminated. Deliberate, and the rules say so |
| Motion permission revoked mid-round | Same path as above: no samples, so nothing is sent, so eliminated for silence |
| Player disconnects | Eliminated with reason `left` |
| Everyone spends their last life on the same tick | The one with the lowest wobble that tick keeps one life and wins |
| A life is lost during the grace window | Impossible by construction — grace is enforced server-side, not by the phone |
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
- **Silence is elimination** (§6), which closes the simplest exploit — and the
  phone never sends a window it did not measure, which is what stops a dead
  sensor from being reported as a perfect hold (§6).
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
- **Three lives is the default** precisely because it softens elimination from a
  cliff to a slope. It does not fix the tremor problem — nothing does — but it
  means one bad moment is not the whole round.
- Elimination always names its reason, so nobody is left guessing.
- The meter carries fill, number and colour — never colour alone.
- No flashing on elimination; a fade under `prefers-reduced-motion`.

The card should not pretend otherwise: this is a game about fine motor control,
and the catalogue is large enough to carry one.

## 12. Open questions

- Are the numbers in §2.1 anywhere near right? All five are guesses. `WOBBLE_START`
  in particular has to survive a nervous person's pulse at arm's length.
- Do eliminated players need something to do (`sabotage`, §3)? A minute of
  watching is fine; three rounds of it is not.
- Should the tolerance tighten on a **timer** or on **survivors** — e.g. tighten
  each time someone goes out? Survivor-driven tightening ends faster with a big
  group and slower with two, which may be the better shape.
